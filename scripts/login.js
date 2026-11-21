'use strict';
/**
 * Complete the institutional (CARSI / CERNET federation) login for both databases.
 *
 *   node login.js --school "<your school's CARSI display name>" [--wait 300]
 *
 * The script drives the browser all the way to the university IdP login page,
 * then hands over: the user types the campus account + password in the visible
 * window. Credentials never pass through this script.
 *
 * After the Web of Science login succeeds, Elsevier is linked automatically by
 * reusing the CARSI SSO session (no second password entry).
 */
const lib = require('./lib/cdp');

const CLARIVATE =
  'https://access.clarivate.com/login?app=wos&alternative=true' +
  '&goto=https:%2F%2Fwww.webofknowledge.com' +
  '&shibShireURL=https:%2F%2Fwww.webofknowledge.com%2F%3Fauth%3DShibboleth' +
  '&shibReturnURL=https:%2F%2Fwww.webofknowledge.com%2F%3Fmode%3DNextgen%26action%3Dtransfer%26path%3D%252Fwos%26DestApp%3DUA' +
  '&referrer=mode%3DNextgen%26path%3D%252Fwos%26DestApp%3DUA%26action%3Dtransfer&roaming=true';

const BANNER = '【请在这里输入学校账号密码】';

function parseArgs(argv) {
  const out = { school: process.env.DBS_SCHOOL || '', wait: 300 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--school') out.school = argv[++i];
    else if (argv[i] === '--wait') out.wait = parseInt(argv[++i], 10) || 300;
  }
  return out;
}

const log = (m) => console.error('[login] ' + m);

/* ---------------------------------------------------------------- */
/* Step 1: drive Clarivate -> CARSI -> university IdP               */
/* ---------------------------------------------------------------- */
async function driveToIdp(cdp, school) {
  log('opening Clarivate institutional login');
  await lib.navigate(cdp, CLARIVATE, 4000);

  const hasSelect = await lib.waitFor(cdp, "!!document.querySelector('#mat-select-0')", 35000);
  if (!hasSelect) throw new Error('institution selector not found on Clarivate login page');

  log('selecting CHINA CERNET Federation');
  await lib.evalJs(
    cdp,
    `(async () => {
      const s = document.querySelector('#mat-select-0');
      if (s) s.click();
      await new Promise(r => setTimeout(r, 2000));
      const o = [...document.querySelectorAll('mat-option')].find(x => /CHINA CERNET/i.test(x.innerText));
      if (o) o.click();
      return !!o;
    })()`
  );
  await lib.sleep(2500);

  log('clicking 转到机构');
  const nav1 = cdp.waitEvent('Page.loadEventFired', 40000);
  await lib.evalJs(cdp, "(()=>{const b=[...document.querySelectorAll('button')].find(x=>/转到机构/.test(x.innerText)); if(b){b.click(); return true;} return false;})()");
  await nav1;
  await lib.sleep(3000);

  const hasInput = await lib.waitFor(cdp, "!!document.querySelector('#show')", 35000);
  if (!hasInput) throw new Error('CARSI search box not found (unexpected federation page)');

  log('searching school: ' + school);
  await lib.evalJs(
    cdp,
    `(async () => {
      const i = document.querySelector('#show');
      i.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, ${JSON.stringify(school)});
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('keyup', { bubbles: true }));
      await new Promise(r => setTimeout(r, 2200));
      return i.value;
    })()`
  );
  await lib.sleep(1800);

  log('selecting the school entry');
  const picked = await lib.evalJs(
    cdp,
    `(() => {
      const a = [...document.querySelectorAll('a.dropdown-item')].find(x => x.innerText.includes(${JSON.stringify(school)}));
      if (a) { a.click(); return true; }
      return false;
    })()`
  );
  if (!picked) throw new Error('school not found in CARSI list: ' + school);
  await lib.sleep(2500);

  log('jumping to the university IdP');
  const nav2 = cdp.waitEvent('Page.loadEventFired', 45000);
  await lib.evalJs(cdp, "(()=>{const b=document.querySelector('#idpSkipButton'); if(b){b.click(); return true;} return false;})()");
  await nav2;
  await lib.sleep(3500);

  const onIdp = await lib.waitFor(cdp, "!!document.querySelector('#username')", 30000);
  if (!onIdp) {
    const url = await lib.evalJs(cdp, 'location.href');
    throw new Error('did not reach the IdP login form; current url = ' + url);
  }

  await lib.evalJs(cdp, `document.title = ${JSON.stringify(BANNER)}`);
  await cdp.send('Page.bringToFront');
  return true;
}

/* ---------------------------------------------------------------- */
/* Step 2: wait for the human to log in                             */
/* ---------------------------------------------------------------- */
async function waitForWosLogin(cdp, seconds) {
  log(`waiting up to ${seconds}s for the user to sign in...`);
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const url = await lib.evalJs(cdp, 'location.href');
    if (url && /webofknowledge\.com\/wos|webofscience\.clarivate\.cn\/wos/.test(url)) {
      log('Web of Science session established');
      return true;
    }
    // an explicit IdP error is worth surfacing immediately
    const err = await lib.evalJs(
      cdp,
      "(document.body.innerText.match(/(账号或密码错误|用户名或密码错误|Invalid credentials|authentication failed)/i)||[])[1] || null"
    );
    if (err) throw new Error('IdP rejected the credentials: ' + err);
    await lib.sleep(4000);
  }
  return false;
}

/* ---------------------------------------------------------------- */
/* Step 3: link Elsevier through the existing CARSI SSO             */
/* ---------------------------------------------------------------- */
async function linkElsevier(cdp, school) {
  log('linking Elsevier via CARSI SSO');
  await lib.applyDesktopUA(cdp);
  await lib.navigate(cdp, 'https://www.sciencedirect.com/user/institution/login?relogin=true', 6000);

  const hasBox = await lib.waitFor(cdp, "!!document.querySelector('#bdd-email')", 35000);
  if (!hasBox) {
    log('org search box not found; Elsevier may already be linked');
    return false;
  }

  await lib.evalJs(cdp, "(()=>{const i=document.querySelector('#bdd-email'); i.focus(); i.click(); return true;})()");
  await lib.sleep(600);
  await cdp.send('Input.insertText', { text: school });
  await lib.sleep(3500);

  const clicked = await lib.evalJs(
    cdp,
    `(() => {
      const els = [...document.querySelectorAll('li, a, button, [role="option"]')]
        .filter(e => e.children.length <= 2 && (e.innerText || '').includes(${JSON.stringify(school)}));
      if (!els.length) return false;
      els[els.length - 1].click();
      return true;
    })()`
  );
  if (!clicked) {
    log('school not offered in the Elsevier org list');
    return false;
  }

  await lib.sleep(9000);
  const linked = await lib.waitFor(
    cdp,
    "/Brought to you by/i.test(document.body.innerText)",
    45000
  );
  return !!linked;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.school) {
    console.error('[login] 缺少学校参数，脚本不知道要登录哪所学校。');
    console.error('[login] 请用 --school "<你的学校在 CARSI 里的显示名>" 指定，例如：');
    console.error('[login]   node login.js --school "XX大学"');
    process.exit(2);
  }
  await lib.ensureBrowser();

  const { cdp } = await lib.getSiteTab('clarivate.com');
  let result = { ok: false, school: args.school };

  try {
    await driveToIdp(cdp, args.school);
    console.error('');
    console.error('==========================================================');
    console.error('  A browser window titled ' + BANNER + ' is now open.');
    console.error('  Please type your campus account and password there and');
    console.error('  press 登录. The credentials are never read by this script.');
    console.error('==========================================================');
    console.error('');

    const loggedIn = await waitForWosLogin(cdp, args.wait);
    if (!loggedIn) {
      result.error = 'timed out waiting for the user to sign in';
      result.hint = 're-run login.js, or increase --wait';
      lib.emit(result);
      process.exit(2);
    }

    result.wos = true;
    result.elsevier = await linkElsevier(cdp, args.school);
    result.ok = true;
    result.next = 'node scripts/check.js   # verify both sessions';
    lib.emit(result);
  } finally {
    cdp.close();
  }
}

main().catch((e) => {
  lib.emit({ ok: false, error: e.message });
  process.exit(1);
});
