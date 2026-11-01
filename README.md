# Quinterminal

An open-data oil intelligence terminal. One static web page that pulls live
crude prices, the state of the Strait of Hormuz, tanker traffic, US
inventories, positioning, event odds and news from about twenty free sources,
and turns them into probabilistic forecasts for Brent and WTI that are scored
against what actually happened.

It runs in the browser with no build step and no server of its own: host it on
GitHub Pages, let a daily GitHub Action archive what free sources do not keep,
and, if you want the few sources that block browsers, add a free Cloudflare
Worker as an edge proxy.

> Open data, best effort. Not investment advice. Perpetual-futures prices are
> not exchange settlements.

## Functions

Type a mnemonic in the command line (Ctrl+K), press its key, or click it.

| Code | Key | What it answers |
|---|---|---|
| `OIL` | F1 | Cockpit: live WTI/Brent, Hormuz status, balance of risks, US weekly balance, event odds, a one-month Brent range from three lenses, spreads, alerts, event clock |
| `HRMZ` | F2 | Hormuz war room: daily transits against the pre-crisis range, stranded ships, war-risk premium, market odds of reopening by date, crisis index, supply-gap calculator, bypass pipelines, chokepoint board, incident log, carrier suspensions |
| `MAP` | F3 | Geo map (globe): trade routes coloured by 2026 status, pipelines, fields and terminals, chokepoint flows, live Baltic tankers, storms, port weather, satellite imagery, fires and military aircraft (proxy) |
| `CRV` | F4 | Prices and curve: 24/7 perp candles, order book, tape, NYMEX/ICE contract calendar, futures strip and calendar spreads (archive or proxy), Dated Brent premium, crisis analogues, Brent in local currencies, correlations, Brent since 1987 |
| `STK` | F6 | Inventories: EIA weekly stocks against the 5-year seasonal range, SPR, flows, weekly balance sheet, EIA's STEO price path and world stock change |
| `POS` | F7 | Positioning: CFTC managed money, trader groups, z-score heatmap, perp funding and open interest |
| `RISK` | F8 | Event risk: prediction-market board and history, barrier-implied volatility, Wikipedia attention, GDELT news intensity, theme matrix |
| `FCST` | F9 | Forecast lab: GARCH-FHS fan chart, scenario mixture with editable weights, probabilities at the horizon, volatility, VaR backtest (Kupiec, PIT), walk-forward signal lab, live track record, option pricer, supply-shock calculator |
| `SHIP` | Alt 9 | Maritime: Gulf of Finland tankers in real time (AIS), Russian Baltic export terminals, tanker list, daily export pulse (archive), sea state at loading terminals, storms near oil infrastructure, tanker equities (proxy) |
| `NEWS` | Alt 0 | News wire: incidents, GDELT and RSS, tagged by topic, region and supply-risk sign, with a 24-hour pressure gauge |
| `XAS` | | Cross-asset: every trade.xyz perp, TradingView reference charts, energy equities, macro calendar |
| `SYS` | | Data and settings: live status of every source, keys, edge proxy test, about |

Commands: `MAP HORMUZ`, `CHART WTI 15m`, `OPT 110 30 [vol] [call|put]`,
`SHOCK 5 60`, `ALERT BRENT > 120`, `POLY iran`, `KEY EIA <key>`,
`PROXY <url>`, `THEME DAY`, `EXPORT`, `HELP`. Any other text searches the news.

Panels carry a method note (ⓘ) with the formula and its caveats; data panels
add a table view, a CSV download and full screen. Every figure names its source.

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
| `eia` | `data/eia/{weekly,spot,steo}.json` | EIA mirror for visitors without a key |
| `curve` | `data/curve/latest.json`, `data/history/curve.csv` | the 12-month NYMEX WTI and Brent strips; no free API serves them to a browser |
| `baltic` | `data/history/baltic.csv` | daily tanker counts at Russian Baltic terminals, which AIS feeds do not keep |
| `forecast` | `data/history/forecasts.csv` | the terminal's own 1-week, 1-month and 3-month forecasts, scored later in `FCST` |

The pipeline imports the same data and maths modules as the app, so the
archive and the screen cannot disagree on parsing. One failing source never
blocks the others.

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
- `tests/worker.test.mjs`: the edge proxy (allow-list, redirects, key
  substitution, caching, stale-on-error).
- `tests/pipeline.test.mjs`: the daily pipeline end to end on a mocked network,
  re-runs, partial outages, and the app falling back to the EIA mirror.

`.github/workflows/test.yml` runs them on every push that touches code.

## Layout

```
index.html            shell: top bar, function list, status bar
css/                  tokens.css (night and day palettes), terminal.css
js/main.js            router, command line, ticker, status bar, settings
js/core/              fetcher (cache, pacing, stale-on-error, proxy), stats,
                      charts, health registry, contracts calendar, alerts
js/data/              one adapter per source, plus model.js (forecast inputs)
js/modules/           one file per function (cockpit, hormuz, map, ...)
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
- Some networks block Polymarket and Kalshi. The terminal falls back to the
  current odds relayed by straits.live, without their history.
- GDELT is slow and rate-limited (one call every 5 s) and sometimes refuses
  browsers; its panels are best effort.
- Futures strips and calendar spreads need the archive or the edge proxy.
- The balance of risks and the news classifier are transparent heuristics, not
  fitted models. The forecast lab holds the tested models.
- Data licences differ by source: see [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

The old Python requirements of the first version are not needed: version 3 is
pure browser JavaScript plus an optional Node pipeline.
