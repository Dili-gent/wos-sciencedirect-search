---
name: wos-sciencedirect-search
description: Search Web of Science Core Collection and Elsevier ScienceDirect for literature using a controlled local browser that reuses a saved institutional (CARSI) login session. Use this skill whenever the user asks to search, query, look up, or retrieve academic papers from Web of Science, WoS, SCI, ScienceDirect, or Elsevier; to run a literature search or systematic review query; to collect paper metadata (titles, authors, journals, years, DOIs, citation counts, PDF links) from these two databases; or to check whether access to these databases is still working. Also trigger on Chinese phrasings such as 检索文献, 查文献, 文献检索, 数据库检索, 在 Web of Science 里查, 在 Elsevier 上找文献, 下载全文.
agent_created: true
---

# Web of Science & ScienceDirect Literature Search

Drive a dedicated Quark (Chromium 144) instance over the DevTools protocol to search two subscription databases that have no public API. The browser profile is persistent and already carries the university's CARSI session, so search works immediately without re-authentication.

## Environment requirements (first-time setup)

- **Windows** with **Quark** (Chromium 144) installed. `scripts/lib/cdp.js` auto-discovers `quark.exe` from the usual install locations; if discovery fails, point `QUARK_EXE` at the full path.
- **Node.js ≥ 21.** The built-in `WebSocket` client is required and there are **zero npm dependencies**. If `node` is not on `PATH`, call it by full path or prepend its `bin` directory to `PATH` for the command.
- An institutional **CARSI** account entitled to Web of Science Core Collection and ScienceDirect.
- Defaults you can override with environment variables: profile directory `%LOCALAPPDATA%\WorkBuddyDBSearch\profile` (`DBS_PROFILE`), CDP port `9334` (`DBS_PORT`), login target school (`DBS_SCHOOL` or `--school`).

First run, in this order:

```bash
node scripts/login.js --school "<your university's exact CARSI display name>"
node scripts/check.js
```

`check.js` is the gate: only start searching once it returns `"ok": true`.

## When to use this skill

- Any request to find literature in **Web of Science** / **WoS** / **SCI** / **ScienceDirect** / **Elsevier**
- Collecting paper metadata for a review: titles, authors, journals, dates, DOIs, citation counts, PDF links
- Verifying that database access still works after a long gap

Do **not** use it for PubMed, arXiv, Crossref, or Google Scholar — those have open APIs and do not need a browser.

## Architecture in one paragraph

A controlled `quark.exe` runs with `--user-data-dir` pointing at a persistent profile and `--remote-debugging-port=9334`. Scripts attach over CDP, navigate, type like a human, and parse the rendered DOM. The profile at `%LOCALAPPDATA%\WorkBuddyDBSearch\profile` holds the institutional cookies, which is why no login is needed on the normal path. All scripts live in `scripts/` and share `scripts/lib/cdp.js`.

## Standard workflow

1. **Verify access** — always start here. It is fast and tells you whether the session survived.

```bash
node scripts/check.js
```

- Exit `0` and `"ok": true` → both databases are usable, go straight to searching.
- Exit `2` and `needsLogin: true` → the institutional session expired. Run `node scripts/login.js` (see *Re-authentication* below) before searching.

2. **Search Web of Science**

```bash
node scripts/wos.js "machine learning interatomic potentials" --limit 20 --out wos.json
```

3. **Search ScienceDirect**

```bash
node scripts/els.js "perovskite solar cell stability" --from 2023 --to 2026 --type FLA --limit 20 --out els.json
```

4. **Report results.** Each script prints one JSON object on stdout; diagnostics go to stderr. Present a compact table (title / journal / year / DOI / cited-by) rather than dumping raw JSON at the user.

## Command reference

### `scripts/check.js`

```bash
node scripts/check.js
```

Emits `{ ok, wos: {...}, elsevier: {...} }` with `usable`, `needsLogin`, and the recognised `institution` for each database.

### `scripts/wos.js`

```bash
node scripts/wos.js "<query>" [--limit N] [--out file.json]
```

- `<query>` accepts plain keywords. Web of Science Smart Search also understands field tags, so `TS=(graphene) AND PY=(2022-2026)` works.
- Returns `total` (the full hit count) plus up to `--limit` records (default cap 25, one page).
- Each record: `title`, `authors`, `journal`, `date`, `cited`, `doi`, `url`.
- WoS renders a record's title lazily as it approaches the viewport, so the script scrolls the page until `--limit` titles materialise. Larger limits cost proportionally more time.

### `scripts/els.js`

```bash
node scripts/els.js "<query>" [--from YYYY] [--to YYYY] [--type all|FLA|REV] [--limit N] [--offset N] [--out file.json]
```

- `--type FLA` = research articles only, `REV` = reviews only, `all` (default) = no type filter.
- `--offset` pages through results (page size 25).
- Each record: `title`, `url`, `journal`, `date`, `authors[]`, `doi`, `pii`, `type`, `access`, `pdf`.
- `access: "Full text access"` plus a non-null `pdf` means the institution is entitled to the PDF.

### `scripts/browser.js`

```bash
node scripts/browser.js status   # is the browser up, which profile, which tabs
node scripts/browser.js start    # launch if not running
node scripts/browser.js stop     # shut it down
```

### `scripts/login.js`

```bash
node scripts/login.js --school "<your school's exact CARSI display name>" [--wait 300]
```

## Re-authentication (only when `check.js` says `needsLogin`)

The session lasts until the university forces a re-login. When it expires:

1. Run `node scripts/login.js`. It drives the whole chain automatically: Clarivate → institutional login → `CHINA CERNET Federation` → CARSI → the university IdP login form.
2. Tell the user a browser window titled **【请在这里输入学校账号密码】** is open and ask them to type their campus account and password there.
3. The script polls until the Web of Science session appears, then links Elsevier automatically by reusing the CARSI SSO session — **no second password entry**.

**Never ask for or handle the user's password.** The script only prepares the page; the human types the credentials into the browser.

To target a different university, pass `--school "<exact CARSI display name>"`.

## Critical constraints

- **Elsevier blocks the Quark user agent.** Any ScienceDirect request without `applyDesktopUA()` returns `CPE00001` / "problem providing the content". `els.js` and `check.js` already apply it; if writing new automation, apply the override **before** the first navigation.
- **Elsevier rate-limits aggressively.** Rapid successive requests trigger an "Are you a robot?" captcha. `els.js` exits with `needCaptcha: true` in that case. Handling: tell the user, open the browser window, let them solve the captcha once, then retry after a short pause. Do not hammer retries.
- **Do not use `fetch()` to pull ScienceDirect PDFs.** It is fingerprinted as a bot and returns a 403 challenge page. Download through the browser or hand the `pdf` URL to the user.
- **Web of Science needs a real browser.** The site is an Angular SPA; `curl` only ever returns a shell.
- **Do not close the user's own browser.** The controlled instance is separate; identify it by the `--user-data-dir` flag containing `WorkBuddyDBSearch`.
- **Each script run relaunches the browser.** The sandbox reclaims child processes when a command ends, so there is no warm browser between calls. Startup is ~1s, which is negligible.
- **Expected runtimes** on a warm cache: `check.js` ~20s (two sites), `els.js` ~9s, `wos.js` ~25s (grows with `--limit` because of lazy rendering).
- Page size is one page per call. For more ScienceDirect results, raise `--offset`; for Web of Science, refine the query or raise `--limit`.

## Reference files

- `references/selectors.md` — the exact DOM selectors each parser depends on. Read this first when a parser breaks after a site redesign.
- `references/troubleshooting.md` — symptom-first diagnosis for browser launch failures, expired sessions, captcha walls, and empty result sets.
