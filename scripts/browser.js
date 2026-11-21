'use strict';
/**
 * Manage the controlled browser instance.
 *
 *   node browser.js status
 *   node browser.js start
 *   node browser.js stop
 */
const lib = require('./lib/cdp');

async function main() {
  const cmd = process.argv[2] || 'status';

  if (cmd === 'start') {
    const r = await lib.ensureBrowser();
    lib.emit({ ok: true, action: 'start', ...r });
    return;
  }

  if (cmd === 'stop') {
    const r = await lib.stopBrowser();
    lib.emit({ ok: true, action: 'stop', ...r });
    return;
  }

  if (cmd === 'status') {
    const up = await lib.isUp();
    const exe = lib.findQuark();
    let tabs = [];
    if (up) {
      try {
        tabs = (await lib.listTargets()).map((t) => ({ title: (t.title || '').slice(0, 60), url: (t.url || '').slice(0, 90) }));
      } catch (e) {
        /* ignore */
      }
    }
    lib.emit({
      ok: true,
      running: up,
      port: lib.PORT,
      profile: lib.PROFILE_DIR,
      profileExists: require('fs').existsSync(lib.PROFILE_DIR),
      quarkExe: exe,
      tabs,
    });
    return;
  }

  console.error('usage: node browser.js [status|start|stop]');
  process.exit(1);
}

main().catch((e) => {
  lib.emit({ ok: false, error: e.message });
  process.exit(1);
});
