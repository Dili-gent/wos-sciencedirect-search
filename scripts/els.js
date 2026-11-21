'use strict';
/**
 * Search Elsevier ScienceDirect.
 *
 *   node els.js "perovskite solar cell stability" \
 *        [--from 2020] [--to 2026] [--type all|FLA|REV] [--limit 25] [--offset 0] [--out result.json]
 *
 * Works with an anonymous session (search + abstracts). With an institutional
 * session it also reports full-text availability and PDF links.
 */
const fs = require('fs');
const lib = require('./lib/cdp');

const SD_HOME = 'https://www.sciencedirect.com/';

function parseArgs(argv) {
  const out = { query: null, from: null, to: null, type: 'all', limit: 0, offset: 0, outFile: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') out.from = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--type') out.type = argv[++i];
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--offset') out.offset = parseInt(argv[++i], 10) || 0;
    else if (a === '--out') out.outFile = argv[++i];
    else rest.push(a);
  }
  out.query = rest.join(' ').trim();
  return out;
}

const PARSE_JS = `(() => {
  const txt = document.body.innerText || '';
  const blocked = /Are you a robot|captcha challenge/i.test(txt);
  const countMatch = txt.match(/([\\d,]+)\\s+results/i);
  const instMatch = txt.match(/Brought to you by:\\s*([^\\n]+)/i);

  const items = [...document.querySelectorAll('li.ResultItem')].map((li) => {
    const a = li.querySelector('h2.result-list-title-heading a');
    const jr = li.querySelector('a.subtype-srctitle-link');
    const dateSpans = li.querySelectorAll('.srctitle-date-fields > span');
    const authors = [...li.querySelectorAll('ol.Authors li span.author')].map((x) => x.innerText.trim());
    const access = li.querySelector('.access-label');
    const type = li.querySelector('.article-type');
    const pdf = li.querySelector('a[href*="pdfft"]');
    const pii = a && a.id ? a.id.replace(/^title-/, '') : null;
    return {
      title: a ? a.innerText.trim() : null,
      url: a ? 'https://www.sciencedirect.com' + a.getAttribute('href') : null,
      journal: jr ? jr.innerText.trim() : null,
      date: dateSpans.length > 1 ? dateSpans[1].innerText.trim() : null,
      authors,
      doi: li.getAttribute('data-doi') || null,
      pii,
      type: type ? type.innerText.trim() : null,
      access: access ? access.innerText.trim() : null,
      pdf: pdf ? 'https://www.sciencedirect.com' + pdf.getAttribute('href') : null,
    };
  }).filter((r) => r.title);

  return JSON.stringify({
    url: location.href,
    blocked,
    total: countMatch ? countMatch[1] : null,
    institution: instMatch ? instMatch[1].trim() : null,
    records: items,
  });
})()`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('usage: node els.js "<query>" [--from YYYY] [--to YYYY] [--type all|FLA|REV] [--limit N] [--offset N] [--out file.json]');
    process.exit(1);
  }

  await lib.ensureBrowser();

  const { cdp, created } = await lib.getSiteTab('sciencedirect.com');
  try {
    // UA override MUST be applied before any Elsevier request
    await lib.applyDesktopUA(cdp);

    let url = 'https://www.sciencedirect.com/search?qs=' + encodeURIComponent(args.query);
    if (args.from || args.to) url += '&date=' + (args.from || '') + '-' + (args.to || '');
    if (args.type && args.type !== 'all') url += '&articleTypes=' + args.type;
    if (args.offset > 0) url += '&offset=' + args.offset;

    const ready = await lib.navigateAndWait(
      cdp,
      url,
      "document.querySelectorAll('li.ResultItem').length > 0 || /Are you a robot|captcha challenge|0 results|No results/i.test(document.body.innerText)",
      45000
    );

    await lib.sleep(700);
    const raw = await lib.evalJs(cdp, PARSE_JS);
    if (!raw) {
      lib.emit({ ok: false, error: 'failed to read results page' });
      process.exit(4);
    }
    const data = JSON.parse(raw);

    if (data.blocked) {
      lib.emit({
        ok: false,
        needCaptcha: true,
        reason: 'Elsevier served an anti-bot captcha',
        hint: 'open the controlled browser window and solve the captcha once, then retry; keep request rates low',
        url: data.url,
      });
      process.exit(2);
    }

    data.query = args.query;
    data.source = 'ScienceDirect (Elsevier)';
    data.filters = { from: args.from, to: args.to, type: args.type, offset: args.offset };
    if (args.limit > 0) data.records = data.records.slice(0, args.limit);
    data.returned = data.records.length;
    data.ok = true;
    data.parsed = !!ready;

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
