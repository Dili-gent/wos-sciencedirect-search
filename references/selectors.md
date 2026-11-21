# DOM selectors these parsers depend on

Both sites are Angular/React SPAs. Everything below was verified against the
live sites in November 2026. When a parser silently returns zero records, check
these selectors first — a redesign is almost always the cause.

## Web of Science (`webofscience.clarivate.cn`)

Entry points:

| Purpose | URL |
|---|---|
| Smart Search (main entry) | `https://webofscience.clarivate.cn/wos/woscc/smart-search` |
| Results page | `.../wos/woscc/summary/<session-id>/<query-id>/relevance/1` |
| Full record | `.../wos/woscc/full-record/WOS:000439850800044` |

Elements:

| Field | Selector | Notes |
|---|---|---|
| Query input | `#composeQuerySmartSearch` | Single text input on the Smart Search page |
| Result count | regex `([\d,]+)\s+results from Web of Science Core Collection` on `body.innerText` | Also a second `Total results in ...` figure for the whole platform |
| Record container | `app-record` | One custom element per hit |
| Title + link | `app-record [data-ta="summary-record-title-link"]` | `href` is relative, prefix the origin |
| Authors | `app-record [data-ta$="MainDiv-author-en"]` | Already truncated by the site as `A; B; (...); Z` |
| Publication date | `app-record [data-ta="summary-record-pubdate"]` | e.g. `Jul 26 2018` |
| Journal | `app-record [data-ta="jcr-link-menu"]` | Contains a trailing `arrow_drop_down` icon label — strip it |
| Times cited | `app-record a[href*="citing-summary"]` | Inner text is the count |
| DOI | `app-record a[href*="KeyAID="]` | DOI is URL-encoded in the `KeyAID` query parameter |

Login indicator: the footer of the Smart Search page contains
`Sign in to access <Institution name>` when an institutional session is active.
Without it the page shows a bare `Sign In` link and searches return a paywall.

Submitting a query: focus the input, insert text, then dispatch an `Enter`
key event. The SPA navigates to a `summary/...` URL — wait for both that URL
pattern and a non-zero `app-record` count before parsing.

## ScienceDirect (`www.sciencedirect.com`)

Entry points:

| Purpose | URL |
|---|---|
| Search | `https://www.sciencedirect.com/search?qs=<query>&date=<from>-<to>&articleTypes=FLA&offset=<n>` |
| Article | `https://www.sciencedirect.com/science/article/pii/<PII>` |
| PDF | `https://www.sciencedirect.com/science/article/pii/<PII>/pdfft?pid=1-s2.0-<PII>-main.pdf` |
| Institutional login | `https://www.sciencedirect.com/user/institution/login?relogin=true` |

Query parameters:

- `date` — `YYYY-YYYY`, either bound may be blank (`2020-`)
- `articleTypes` — `FLA` research articles, `REV` reviews, `FLA,REV` both; omit for all
- `offset` — multiples of 25

Elements:

| Field | Selector | Notes |
|---|---|---|
| Result count | regex `([\d,]+)\s+results` on `body.innerText` | |
| Result item | `li.ResultItem` | Carries `data-doi` |
| Title + link | `li.ResultItem h2.result-list-title-heading a` | `id` is `title-<PII>` |
| Journal | `li.ResultItem a.subtype-srctitle-link` | |
| Date | `li.ResultItem .srctitle-date-fields > span` (2nd span) | 1st span is the journal link |
| Authors | `li.ResultItem ol.Authors li span.author` | |
| Article type | `li.ResultItem .article-type` | `Research article`, `Review article`, ... |
| Access status | `li.ResultItem .access-label` | `Full text access` = entitled |
| PDF link | `li.ResultItem a[href*="pdfft"]` | Present only when entitled |

Institutional banner: `Brought to you by: <Institution name>` appears in the
page header and in the account menu.

Anti-bot markers — treat any of these as a block, not as an empty result set:

- `CPE00001` reference number page → user-agent fingerprint rejection
- `Are you a robot?` / `captcha challenge` → rate-limit captcha
- `There was a problem providing the content you requested` → same family

## CARSI federation (`ds.carsi.edu.cn`)

| Field | Selector |
|---|---|
| Institution search | `#show` |
| Suggestion list | `ul.typeahead a.dropdown-item` |
| Proceed button | `#idpSkipButton` |
| Selected IdP (hidden) | `#hid-inp` → value is the `https://idp.<school>.edu.cn/idp/shibboleth` URL |

## University IdP (Shibboleth)

| Field | Selector |
|---|---|
| Account | `#username` (name `j_username`) |
| Password | `#password` (name `j_password`) |
| Submit | form submit on `#login` |

## Clarivate login (`access.clarivate.com`)

| Field | Selector |
|---|---|
| Institution dropdown | `#mat-select-0` (Angular Material, `aria-label="机构"`) |
| Dropdown options | `mat-option` — match `CHINA CERNET Federation` |
| Proceed button | button whose text is `转到机构` |
