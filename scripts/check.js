'use strict';
/**
 * Health check: is the institutional session still valid for each database?
 *
 *   node check.js
 *
 * Exit code 0 = both usable, 2 = at least one needs login.
 */
const lib = require('./lib/cdp');

async function checkWos() {
  const { cdp } = await lib.getSiteTab('webofscience.clarivate.cn');
  try {
    await lib.applyDesktopUA(cdp);
    const ok = await lib.navigateAndWait(
      cdp,
      'https://webofscience.clarivate.cn/wos/woscc/smart-search',
      "!!document.querySelector('#composeQuerySmartSearch')",
      40000
    );
    const info = await lib.evalJs(
      cdp,
      `(() => {
        const txt = document.body.innerText || '';
        const m = txt.match(/Sign in to access\\s*\\n?\\s*([^\\n]+)/i);
        return JSON.stringify({
          institution: m ? m[1].trim() : null,
          signedIn: /Sign out|Manage account/i.test(txt),
          hasSearchBox: !!document.querySelector('#composeQuerySmartSearch')
        });
      })()`
    );
    const d = info ? JSON.parse(info) : {};
    return {
      database: 'Web of Science Core Collection',
      usable: !!(ok && d.institution),
      needsLogin: !d.institution,
      institution: d.institution,
      signedIn: d.signedIn,
    };
  } finally {
    cdp.close();
  }
}

async function checkElsevier() {
  const { cdp } = await lib.getSiteTab('sciencedirect.com');
  try {
    await lib.applyDesktopUA(cdp);
    await lib.navigateAndWait(
      cdp,
      'https://www.sciencedirect.com/',
      "/Brought to you by|Find articles with these terms|Are you a robot|problem providing the content/i.test(document.body.innerText)",
      40000
    );
    const info = await lib.evalJs(
      cdp,
      `(() => {
        const txt = document.body.innerText || '';
        const m = txt.match(/Brought to you by:\\s*([^\\n]+)/i);
        return JSON.stringify({
          institution: m ? m[1].trim() : null,
          blocked: /Are you a robot|captcha challenge|problem providing the content/i.test(txt)
        });
      })()`
    );
    const d = info ? JSON.parse(info) : {};
    return {
      database: 'ScienceDirect (Elsevier)',
      usable: !d.blocked,
      needsLogin: !d.institution,
      institution: d.institution,
      blocked: !!d.blocked,
      note: d.institution
        ? 'institutional full text enabled'
        : 'anonymous session: search + abstracts work, full text does not',
    };
  } finally {
    cdp.close();
  }
}

async function main() {
  await lib.ensureBrowser();
  const wos = await checkWos();
  await lib.sleep(1500);
  const els = await checkElsevier();

  const result = {
    ok: wos.usable && els.usable,
    browser: { port: lib.PORT, profile: lib.PROFILE_DIR },
    wos,
    elsevier: els,
    next:
      wos.needsLogin || els.needsLogin
        ? 'node scripts/login.js   # completes the CARSI institutional login'
        : null,
  };
  lib.emitAndExit(result, result.ok ? 0 : 2);
}

main().catch((e) => {
  lib.emit({ ok: false, error: e.message });
  process.exit(1);
});
