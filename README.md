# QuinTerminal

An open-data terminal for the global oil market. One static web page that
pulls live crude prices, the world supply and demand balance, tanker traffic
through the main chokepoints, refining margins, inventories, positioning,
event odds and news from about twenty free sources, and turns them into
probabilistic forecasts for Brent and WTI that are scored against what
actually happened.

It runs in the browser with no build step and no server of its own: host it on
GitHub Pages, let a daily GitHub Action archive what free sources do not keep,
and, if you want the few sources that block browsers, add a free Cloudflare
Worker as an edge proxy.

> Open data, best effort. Not investment advice. Perpetual-futures prices are
> not exchange settlements.

## Functions

Type a code in the command line (Ctrl+K), press its key, or click it.

| Code | Key | What it answers |
|---|---|---|
| `OIL` | F1 | Cockpit: live Brent and WTI, the world balance and the six main chokepoints, a balance of risks, US weekly stocks, event odds, a one-month Brent range from three lenses, spreads, alerts and the event clock |
| `MAP` | F3 | World oil map (globe): trade routes coloured by 2026 status, pipelines, fields, refineries and terminals, chokepoint flows, live Baltic tankers, storms, port weather, satellite imagery, fires and military aircraft (proxy) |
| `NEWS` | Alt 0 | News wire: incidents, GDELT and RSS, tagged by topic, region and supply-risk sign, with a 24-hour pressure gauge |
| `CAL` | | Calendar: EIA, API, CFTC and rig-count releases with holiday shifts, EIA STEO and OPEC report dates, OPEC+ meetings, WTI and Brent expiries; month grid and agenda in local time |
| `BAL` | F2 | World balance (EIA STEO): supply against demand, implied stock change, OPEC spare capacity against Brent, unplanned outages, supply and demand by bloc, crude production by country |
| `STK` | F6 | US inventories: EIA weekly stocks against the 5-year seasonal range, Cushing, SPR, flows, weekly balance sheet |
| `REF` | | Refining: live diesel crack, weekly 3-2-1, diesel, gasoline and jet cracks since 2018, US refinery utilisation and runs, product demand against the 5-year range, product prices |
| `FLOW` | | Chokepoints: daily tanker transits through twelve straits (IMF PortWatch) against the same weeks a year earlier, one chart per strait, daily detail, EIA oil-flow estimates |
| `SHIP` | Alt 9 | Tankers: Gulf of Finland tankers in real time (AIS), Russian Baltic export terminals, daily export pulse (archive), sea state at loading terminals, storms near oil infrastructure, tanker equities (proxy) |
| `CRV` | F4 | Prices and curve: 24/7 perp candles, order book, tape, NYMEX/ICE contract calendar, futures strip and calendar spreads (archive or proxy), Dated Brent premium, crisis analogues, Brent in importers' currencies, correlations, Brent since 1987 |
| `FCST` | F9 | Forecast lab: GARCH-FHS fan chart, scenario mixture with editable weights, probabilities at the horizon, volatility, VaR backtest (Kupiec, PIT), walk-forward signal lab, live track record, option pricer, supply-shock calculator |
| `RISK` | F8 | Event risk: prediction-market board and history, barrier-implied volatility, Wikipedia attention, GDELT news intensity, theme matrix |
| `POS` | F7 | Positioning: CFTC managed money, trader groups, z-score heatmap, perp funding and open interest |
| `XAS` | | Cross-asset: every trade.xyz perp, TradingView reference charts, energy equities, macro calendar |
| `HRMZ` | Alt 2 | Strait of Hormuz in depth: daily transits against the pre-crisis range, stranded ships, war-risk premium, market odds of reopening by date, crisis index, supply-gap calculator, bypass pipelines, incident log |
| `SYS` | | Data and settings: live status of every source, keys, edge proxy test, palette, about |

Commands: `MAP MALACCA`, `FLOW BAB`, `CHART WTI 15m`, `OPT 110 30 [vol] [call|put]`,
`SHOCK 5 60`, `ALERT BRENT > 120`, `POLY iran`, `KEY EIA <key>`,
`PROXY <url>`, `THEME DAY`, `EXPORT`, `HELP`. Any other text searches the news.

Panels carry a method note (ⓘ) with the formula and its caveats; data panels
add a table view, a CSV download and full screen. Every figure names its source
and its age, and the top bar sums the state of the data in one word: Live,
Delayed or Offline.

## Design

Night first, with the terminal's own palette: deep blue-black surfaces, sodium
amber for the accent and the active function, chart magenta for hazards. In
version 3.1 those colours are about a fifth less saturated than before, and the
categorical chart palette still passes the colour-blind separation checks.
Square corners, 1 px rules, no gradients, glows or shadows; at most a handful
of series per chart, with grey context lines rather than extra colours. Type is
Hanken Grotesk for the interface and IBM Plex Mono for live prices, the tape,
the clocks, the command line and numeric columns, both self-hosted under the
SIL Open Font License. `THEME DAY` switches to the light palette.

The mark is the QuinInvestment Q, its tail rising into an arrow, on the same
navy disc (`assets/quinterminal-mark.svg`).

## Run it

```bash
python3 -m http.server 8080      # or: npm run serve
# open http://localhost:8080
```

ES modules need a web server; opening `index.html` from disk will not work.
Node 20+ is needed only for the tests and the daily pipeline.

## Deploy on GitHub Pages

1. Push this folder to a repository and enable Pages (Settings > Pages >
   Deploy from branch, root). The empty `.nojekyll` file makes Pages serve the
   files as they are.
2. Settings > Actions > General > Workflow permissions: **Read and write**, so
   the daily workflow can commit `data/`.
3. Add a free EIA key (https://www.eia.gov/opendata/, one minute) as the
   repository secret **`EIA_KEY`**. The workflow then mirrors the EIA data into
   `data/eia/`, and every visitor without a key reads that mirror instead of
   the shared `DEMO_KEY`, which runs out after a few dozen calls an hour.
4. Run the **Daily snapshot** workflow once by hand (Actions > Daily snapshot >
   Run workflow). After that it runs each weekday at 21:40 UTC.

Visitors can also paste their own EIA key in `SYS`; it stays in their browser.

## What the daily workflow keeps

`pipeline/snapshot.mjs` runs four independent jobs and records each outcome in
`data/manifest.json`:

| Job | Output | Why |
|---|---|---|
| `eia` | `data/eia/{weekly,spot,steo,products}.json` | EIA mirror for visitors without a key |
| `curve` | `data/curve/latest.json`, `data/history/curve.csv` | the 12-month NYMEX WTI and Brent strips; no free API serves them to a browser |
| `baltic` | `data/history/baltic.csv` | daily tanker counts at Russian Baltic terminals, which AIS feeds do not keep |
| `forecast` | `data/history/forecasts.csv` | the terminal's own 1-week, 1-month and 3-month forecasts, scored later in `FCST` |

The pipeline imports the same data and maths modules as the app, so the
archive and the screen cannot disagree on parsing. One failing source never
blocks the others. IMF PortWatch keeps its own history, so it needs no archive.

## Edge proxy (optional)

A few useful sources send no CORS headers (Yahoo Finance, adsb.lol, energy and
shipping RSS feeds, NASA FIRMS). `worker/qt-edge.js` is a small Cloudflare
Worker that forwards GET requests to an allow-list of hosts only, caches them
at the edge and adds the headers. Deploy steps are in
[`worker/README.md`](worker/README.md); paste the Worker URL in `SYS`.
Without it, those panels say what they need instead of failing silently.

## Tests

```bash
npm test
```

- `tests/stats.test.js`: the maths (GARCH recovery, FHS, Black-76 and implied
  vol, touch probabilities, mixture quantiles, Kupiec, logistic AUC).
- `tests/global.test.mjs`: chokepoint statistics (7-day means, year-on-year
  alignment, gaps), the calendar (release schedules, holiday shifts, expiries,
  dated events) and the crack spreads.
- `tests/worker.test.mjs`: the edge proxy (allow-list, redirects, key
  substitution, caching, stale-on-error).
- `tests/pipeline.test.mjs`: the daily pipeline end to end on a mocked network,
  re-runs, partial outages, the app falling back to the EIA mirror, and the
  cracks from the mirrored product prices.

`.github/workflows/test.yml` runs them on every push that touches code.

## Layout

```
index.html            shell: top bar, function list, status bar
css/                  fonts.css, tokens.css (night and day palettes), terminal.css
assets/               favicon and mark, fonts with their OFL licences
js/main.js            router, command line, tape, status, settings
js/core/              fetcher (cache, pacing, stale-on-error, proxy), stats,
                      charts, calendar, contracts, health registry, alerts
js/data/              one adapter per source (eia, portwatch, hyperliquid, ...),
                      plus model.js (forecast inputs)
js/modules/           one file per function (cockpit, balance, flows, ...)
pipeline/             daily snapshot job (Node, no dependencies)
worker/               optional Cloudflare edge proxy
tests/                node tests, no dependencies
docs/                 METHODOLOGY.md, DATA_SOURCES.md
data/                 written by the workflow (absent until its first run)
```

Libraries come from CDNs at fixed versions: ECharts 5.6.0 and MapLibre GL
5.24.0. There is no package to install.

## Known limits

- The live prices are trade.xyz perpetuals on Hyperliquid. They track CME and
  ICE futures through an oracle and keep trading when exchanges are closed, but
  they are not settlements, and the ULSD perp is thin.
- Without the EIA mirror or a personal key, `DEMO_KEY` runs out quickly. The
  forecast lab then fits GARCH on the perp history alone (since March 2026 for
  Brent): it says so on screen, and the parameters are rough.
- PortWatch publishes weekly: chokepoint data is three to nine days old, and
  AIS misses ships that sail dark. The first load of `FLOW` reads about two
  years of daily rows (several requests), then works from the browser cache.
- The STEO country series (`COPR_SA` and the like) follow EIA's naming but were
  not all checked against the live API: `BAL` shows whichever come back and
  falls back to the blocs. The same goes for the ULSD and jet spot series in
  `REF` (heating oil stands in for ULSD when needed).
- Some networks block Polymarket and Kalshi. The terminal falls back to the
  current odds relayed by straits.live, without their history.
- GDELT is slow and rate-limited (one call every 5 s) and sometimes refuses
  browsers; its panels are best effort.
- Futures strips and calendar spreads need the archive or the edge proxy.
- The base map's own place names keep CARTO's font (map glyph servers carry
  only their own); the terminal's labels use the interface typeface.
- The balance of risks and the news classifier are transparent heuristics, not
  fitted models. The forecast lab holds the tested models.
- Data licences differ by source: see [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).
