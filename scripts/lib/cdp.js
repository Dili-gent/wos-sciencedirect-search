'use strict';
/**
 * Shared CDP client for driving a controlled Quark (Chromium) instance.
 * Zero dependencies: uses Node >= 21 built-in WebSocket.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = parseInt(process.env.DBS_PORT || '9334', 10);
const HOST = '127.0.0.1';

const PROFILE_DIR =
  process.env.DBS_PROFILE ||
  path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'WorkBuddyDBSearch', 'profile');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Quark executable discovery                                          */
/* ------------------------------------------------------------------ */
function findQuark() {
  if (process.env.QUARK_EXE && fs.existsSync(process.env.QUARK_EXE)) return process.env.QUARK_EXE;

  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Quark', 'Application', 'quark.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Quark', 'quark.exe'),
    path.join(process.env.ProgramFiles || '', 'Quark', 'quark.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Quark', 'quark.exe'),
    'C:\\Program Files\\Quark\\quark.exe',
    'C:\\Program Files (x86)\\Quark\\quark.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // last resort: ask the OS
  try {
    const out = execSync('where quark.exe', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch (e) {
    /* ignore */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Tiny HTTP helper against the DevTools endpoint                      */
/* ------------------------------------------------------------------ */
function httpJson(method, urlPath, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, timeout }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          resolve(d);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('http timeout'));
    });
    req.end();
  });
}

async function isUp() {
  try {
    const v = await httpJson('GET', '/json/version', 2500);
    return !!(v && v.Browser);
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Browser lifecycle                                                   */
/* ------------------------------------------------------------------ */
async function ensureBrowser({ verbose = true } = {}) {
  if (await isUp()) return { started: false, port: PORT, profile: PROFILE_DIR };

  const exe = findQuark();
  if (!exe) {
    throw new Error(
      'Quark executable not found. Set QUARK_EXE to the full path of quark.exe.'
    );
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'about:blank',
  ];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();

  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    await sleep(700);
    if (await isUp()) {
      if (verbose) console.error(`[browser] started pid=${child.pid} port=${PORT}`);
      return { started: true, pid: child.pid, port: PORT, profile: PROFILE_DIR, exe };
    }
  }
  throw new Error('Browser did not expose the DevTools endpoint within 40s.');
}

async function stopBrowser() {
  if (!(await isUp())) return { stopped: false, reason: 'not running' };
  try {
    const list = await httpJson('GET', '/json/list');
    const first = Array.isArray(list) ? list[0] : null;
    if (first) {
      const ws = new WebSocket(first.webSocketDebuggerUrl);
      await new Promise((r, j) => {
        ws.addEventListener('open', r);
        ws.addEventListener('error', j);
        setTimeout(() => j(new Error('ws timeout')), 5000);
      });
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await sleep(1500);
    }
  } catch (e) {
    /* fall through to taskkill */
  }
  await sleep(1000);
  if (await isUp()) {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='quark.exe'\\" | Where-Object { $_.CommandLine -like '*${PORT}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
        { stdio: 'ignore' }
      );
    } catch (e) {
      /* ignore */
    }
  }
  return { stopped: !(await isUp()) };
}

/* ------------------------------------------------------------------ */
/* CDP session                                                         */
/* ------------------------------------------------------------------ */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(JSON.stringify(m.error)));
        else res(m.result);
      } else if (m.method) {
        (this.handlers.get(m.method) || []).forEach((h) => h(m.params));
      }
    });
  }
  send(method, params = {}, timeout = 45000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('cdp timeout: ' + method));
        }
      }, timeout);
    });
  }
  on(method, fn) {
    const a = this.handlers.get(method) || [];
    a.push(fn);
    this.handlers.set(method, a);
  }
  waitEvent(method, timeout = 45000) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(false);
        }
      }, timeout);
      this.on(method, () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(true);
        }
      });
    });
  }
  close() {
    try {
      this.ws.close();
    } catch (e) {
      /* ignore */
    }
  }
}

async function listTargets() {
  const l = await httpJson('GET', '/json/list');
  return Array.isArray(l) ? l.filter((t) => t.type === 'page') : [];
}

async function createTab(url = 'about:blank') {
  return httpJson('PUT', '/json/new?' + encodeURIComponent(url));
}

async function closeTab(id) {
  try {
    return await httpJson('GET', '/json/close/' + id);
  } catch (e) {
    return null;
  }
}

async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
    setTimeout(() => j(new Error('ws open timeout')), 15000);
  });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

/**
 * Reuse the tab that already sits on `urlMatch`, otherwise create one.
 * Returns { cdp, target, created }.
 */
async function getSiteTab(urlMatch) {
  const tabs = await listTargets();
  let target = tabs.find((t) => t.url && t.url.includes(urlMatch));
  let created = false;
  if (!target) {
    target = await createTab('about:blank');
    created = true;
  }
  const cdp = await attach(target);
  return { cdp, target, created };
}

/** Override UA + client hints. Required before hitting Elsevier, which blocks QuarkPC UA. */
async function applyDesktopUA(cdp) {
  await cdp.send('Network.enable');
  await cdp.send('Network.setUserAgentOverride', {
    userAgent: UA,
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
    platform: 'Win32',
    userAgentMetadata: {
      brands: [
        { brand: 'Chromium', version: '144' },
        { brand: 'Google Chrome', version: '144' },
        { brand: 'Not-A.Brand', version: '99' },
      ],
      fullVersion: '144.0.7559.86',
      fullVersionList: [
        { brand: 'Chromium', version: '144.0.7559.86' },
        { brand: 'Google Chrome', version: '144.0.7559.86' },
        { brand: 'Not-A.Brand', version: '99.0.0.0' },
      ],
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  });
}

async function evalJs(cdp, expression, timeout = 45000) {
  try {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (r.exceptionDetails) return null;
    return r.result.value;
  } catch (e) {
    return null;
  }
}

async function navigate(cdp, url, settle = 2500) {
  const loaded = cdp.waitEvent('Page.loadEventFired', 45000);
  try {
    await cdp.send('Page.navigate', { url });
  } catch (e) {
    /* navigation may destroy the context; the load event still fires */
  }
  await loaded;
  await sleep(settle);
}

async function waitFor(cdp, expression, timeout = 40000, poll = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await evalJs(cdp, expression);
    if (v) return v;
    await sleep(poll);
  }
  return null;
}

/**
 * Navigate and wait for a DOM predicate instead of the load event.
 * Both target sites are heavy SPAs whose load event can lag 20s+ behind the
 * content we actually need, so polling the DOM is far faster.
 */
async function navigateAndWait(cdp, url, predicate, timeout = 45000) {
  try {
    await cdp.send('Page.navigate', { url });
  } catch (e) {
    /* navigation may destroy the execution context; polling recovers */
  }
  return waitFor(cdp, predicate, timeout, 500);
}

async function screenshot(cdp, file) {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  return file;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

/**
 * Write the JSON result and exit. Without an explicit exit Node lingers on the
 * open WebSocket / spawned child handles for up to a minute after the work is
 * already done.
 */
function emitAndExit(obj, code = 0) {
  const payload = JSON.stringify(obj, null, 2) + '\n';
  process.stdout.write(payload, () => process.exit(code));
  const t = setTimeout(() => process.exit(code), 5000);
  if (t.unref) t.unref();
}

module.exports = {
  PORT,
  PROFILE_DIR,
  UA,
  sleep,
  findQuark,
  httpJson,
  isUp,
  ensureBrowser,
  stopBrowser,
  CDP,
  listTargets,
  createTab,
  closeTab,
  attach,
  getSiteTab,
  applyDesktopUA,
  evalJs,
  navigate,
  navigateAndWait,
  waitFor,
  screenshot,
  emit,
  emitAndExit,
};
