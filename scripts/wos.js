'use strict';
/**
 * Search Web of Science Core Collection.
 *
 *   node wos.js "machine learning materials" [--limit 25] [--out result.json]
 *
 * Requires an active institutional session in the controlled browser profile.
 * If the session is missing the script exits with code 2 and needLogin=true;
 * run login.js in that case.
 */
const fs = require('fs');
const lib = require('./lib/cdp');

const WOS_HOME = 'https://webofscience.clarivate.cn/wos/woscc/smart-search';

function parseArgs(argv) {
  const out = { query: null, limit: 0, outFile: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--out') out.outFile = argv[++i];
    else rest.push(a);
  }
  out.query = rest.join(' ').trim();
  return out;
}

const PARSE_JS = `(() => {
  const txt = document.body.innerText || '';
  const countMatch = txt.match(/([\\d,]+)\\s+results from Web of Science Core Collection/i);
  const instMatch = txt.match(/Sign in to access\\s*\\n?\\s*([^\\n]+)/i);

  const records = [...document.querySelectorAll('app-record')].map((r) => {
    const t = r.querySelector('[data-ta="summary-record-title-link"]');
    const authors = r.querySelector('[data-ta$="MainDiv-author-en"]');
    const date = r.querySelector('[data-ta="summary-record-pubdate"]');
    const jr = r.querySelector('[data-ta="jcr-link-menu"]');
    const citedA = r.querySelector('a[href*="citing-summary"]');
    const doiA = [...r.querySelectorAll('a')].find((a) => /KeyAID=/.test(a.href || ''));
    let doi = null;
    if (doiA) {
      const m = doiA.href.match(/KeyAID=([^&]+)/);
      if (m) doi = decodeURIComponent(m[1]);
    }
    let href = t ? t.getAttribute('href') : null;
    return {
      title: t ? t.innerText.trim() : null,
      authors: authors ? authors.innerText.trim() : null,
      journal: jr ? jr.innerText.replace(/arrow_drop_down/g, '').trim() : null,
      date: date ? date.innerText.trim() : null,
      cited: citedA ? citedA.innerText.trim() : null,
      doi,
      url: href ? 'https://webofscience.clarivate.cn' + href : null,
    };
  }).filter((r) => r.title);

  return JSON.stringify({
    url: location.href,
    total: countMatch ? countMatch[1] : null,
    institution: instMatch ? instMatch[1].trim() : null,
    signedIn: /Sign out|My account|Manage account/i.test(txt),
    records,
  });
})()`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('usage: node wos.js "<query>" [--limit N] [--out file.json]');
    process.exit(1);
  }

  await lib.ensureBrowser();

  const { cdp } = await lib.getSiteTab('webofscience.clarivate.cn');
  try {
    // the override is per-CDP-session, so re-apply on every run
    await lib.applyDesktopUA(cdp);

    // always start from a clean smart-search page
    const ready = await lib.navigateAndWait(
      cdp,
      WOS_HOME,
      "!!document.querySelector('#composeQuerySmartSearch')",
      40000
    );
    if (!ready) {
      const body = await lib.evalJs(cdp, 'document.body ? document.body.innerText.slice(0,400) : ""');
      lib.emit({ ok: false, error: 'search box not found', url: await lib.evalJs(cdp, 'location.href'), body });
      process.exit(3);
    }

    // session check
    const inst = await lib.evalJs(cdp, "(document.body.innerText.match(/Sign in to access\\s*\\n?\\s*([^\\n]+)/i)||[])[1] || null");
    if (!inst) {
      lib.emit({
        ok: false,
        needLogin: true,
        reason: 'no institutional session detected on Web of Science',
        hint: 'run: node scripts/login.js',
      });
      process.exit(2);
    }

    // type the query
    await lib.evalJs(cdp, "(()=>{const i=document.querySelector('#composeQuerySmartSearch'); if(!i) return null; i.focus(); i.click(); return true;})()");
    await lib.sleep(600);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await cdp.send('Input.insertText', { text: args.query });
    await lib.sleep(900);

    const navWait = cdp.waitEvent('Page.loadEventFired', 2500);
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: type === 'char' ? '\r' : undefined,
        unmodifiedText: type === 'char' ? '\r' : undefined,
      });
    }
    // WoS is an SPA: the results view may swap in without a load event, so
    // this is a best-effort short wait and the DOM poll below is authoritative.
    await navWait;

    const gotResults = await lib.waitFor(
      cdp,
      "location.href.includes('/summary/') && document.querySelectorAll('[data-ta=\"summary-record-title-link\"]').length > 0",
      45000
    );
    await lib.sleep(900);

    // WoS lazily renders a record's title only once it nears the viewport, so
    // walk down the page until the requested number of titles is materialised.
    const want = args.limit > 0 ? args.limit : 25;
    const countJs = "document.querySelectorAll('[data-ta=\"summary-record-title-link\"]').length";
    let seen = -1;
    for (let i = 0; i < 40; i++) {
      const n = (await lib.evalJs(cdp, countJs)) || 0;
      if (n >= want) break;
      if (n === seen) {
        const atBottom = await lib.evalJs(cdp, '(window.innerHeight + window.scrollY) >= document.body.scrollHeight - 60');
        if (atBottom) break;
      }
      seen = n;
      await lib.evalJs(cdp, 'window.scrollBy(0, 900)');
      await lib.sleep(420);
    }
    await lib.evalJs(cdp, 'window.scrollTo(0, 0)');
    await lib.sleep(400);

    const raw = await lib.evalJs(cdp, PARSE_JS);
    if (!raw) {
      lib.emit({ ok: false, error: 'failed to read results page' });
      process.exit(4);
    }
    const data = JSON.parse(raw);
    data.query = args.query;
    data.source = 'Web of Science Core Collection';
    if (args.limit > 0) data.records = data.records.slice(0, args.limit);
    data.returned = data.records.length;
    data.ok = true;
    data.parsed = !!gotResults;

    if (args.outFile) {
      fs.writeFileSync(args.outFile, JSON.stringify(data, null, 2), 'utf8');
      data.outFile = args.outFile;
    }
    lib.emitAndExit(data, 0);
  } finally {
    cdp.close();
  }
}

main().catch((e) => {
  lib.emit({ ok: false, error: e.message });
  process.exit(1);
});
