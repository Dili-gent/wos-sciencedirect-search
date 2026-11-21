# Troubleshooting

Diagnose by symptom. Run every command from the skill's `scripts/` directory.

## `Error: Quark executable not found`

`findQuark()` probes a fixed candidate list and then falls back to `where quark.exe`.

Fix by exporting the path explicitly:

```bash
export QUARK_EXE="D:/path/to/Quark/quark.exe"
```

On Git Bash, use forward slashes and quote the path.

## `Browser did not expose the DevTools endpoint within 40s`

The process started but never opened the debugging port. Causes, in order of likelihood:

1. **Another Quark instance already owns the profile directory.** Chromium forwards
   the command line to the running instance and exits, so no debug port appears.
   Check with `node scripts/browser.js status`. If it reports `running: false` but a
   `quark.exe` is holding the profile, stop it first:
   ```bash
   powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='quark.exe'\" | Where-Object { \$_.CommandLine -like '*WorkBuddyDBSearch*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
   ```
2. **Port 9334 is taken** by something else. Set `DBS_PORT=9444` and retry.
3. **Antivirus blocked the port bind.** Allow `quark.exe` locally.

## `check.js` reports `needsLogin: true`

The institutional session expired — normal after weeks of inactivity, a password
change, or a server-side session purge.

```bash
node scripts/login.js
```

The script parks the browser on the university IdP login form and waits. Tell the
user to sign in in the visible window. Credentials never pass through the script.

## `els.js` exits with `needCaptcha: true`

Elsevier served an "Are you a robot?" wall. This is rate limiting, not a broken parser.

1. Bring the browser window to the front and ask the user to solve the captcha once.
2. Wait ~60 seconds before the next request.
3. Space out subsequent calls; do not loop over dozens of queries back to back.

If it triggers immediately on the very first request, the UA override probably did
not apply — confirm `applyDesktopUA()` ran before the first navigation.

## ScienceDirect shows `CPE00001` / "problem providing the content"

The request carried a non-Chrome user agent (Quark appends `QuarkPC/...` to its UA,
which Elsevier fingerprints). `els.js` and `check.js` override this automatically.
Any custom automation must call `applyDesktopUA(cdp)` **before** navigating.

## `wos.js` returns `total: null` and zero records

Usually one of:

- The query produced no hits — try a simpler keyword set.
- The results page had not finished rendering. `wos.js` already waits for
  `app-record` elements; on a slow link, raise the settle time after `navWait`.
- The session expired mid-flight — re-run `check.js`.

## Parser returns zero records but the page visibly has results

A site redesign changed the DOM. Open `references/selectors.md`, compare the
documented selectors against the live page, and update the `PARSE_JS` constant in
`wos.js` or `els.js`. Both parsers are single self-contained expression strings,
so patching is a one-block edit.

## Only a few results come back

- **Web of Science** lazily renders a record's title only when it nears the
  viewport. `wos.js` scrolls the page until `--limit` titles appear, but if the
  page is short it may stop early. Raise `--limit` and the scroll loop keeps going.
- **ScienceDirect** returns 25 per page. Raise `--offset` in steps of 25.
- For a larger harvest, refine the query with field tags (`TS=`, `PY=`, `AU=`) rather
  than trying to page through tens of thousands of hits.

## `wos.js` returns `total: 3803` but `returned: 0`

The container elements existed but titles had not rendered yet. `wos.js` now waits on
`[data-ta="summary-record-title-link"]` rather than `app-record` for exactly this
reason. If it recurs, the site changed its lazy-render trigger — increase the settle
sleep after the scroll loop, or scroll in smaller steps (900 → 500 px).

## The user's own browser is affected

It must not be. The controlled instance is identified by
`--user-data-dir=...\WorkBuddyDBSearch\profile` and runs on its own port. Verify with:

```bash
node scripts/browser.js status
```

If `profile` points somewhere unexpected, `DBS_PROFILE` is set in the environment.

## Wiping the saved session

Deleting the profile forces a fresh login on the next run:

```bash
node scripts/browser.js stop
rm -rf "$LOCALAPPDATA/WorkBuddyDBSearch/profile"
```

Only do this when the user asks, or when the profile is corrupt.
