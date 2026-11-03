# Data sources

Every source QuinTerminal reads, how it is reached and on what terms. The live
status of each one (last success, latency, errors) is in `SYS`.

Access: **direct** = the browser calls the source; **proxy** = needs the
optional edge proxy (`worker/`) because the source sends no CORS headers;
**archive** = read from `data/`, written by the daily workflow.

Licences change: check each provider's current terms before any commercial or
public redistribution. Summaries below are as understood at the time of writing,
not legal advice.

## Market data

| Source | Used for | Access | Key | Terms and attribution |
|---|---|---|---|---|
| [Hyperliquid API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api) (`api.hyperliquid.xyz`, REST and WebSocket) | 24/7 perps on the trade.xyz dex: WTI, Brent, ULSD, gas, gold, indices, FX; trades, book, candles, funding | direct | none | Public API under Hyperliquid's terms; weight-based rate limits per IP |
| [U.S. EIA API v2](https://www.eia.gov/opendata/) (`api.eia.gov`) | Weekly Petroleum Status Report; daily crude spot prices since 1987; weekly refined product spot prices since 2018 (NY Harbor gasoline, ULSD and heating oil, Gulf Coast gasoline, ULSD and jet); Short-Term Energy Outlook (world supply and demand, OPEC capacity and spare capacity, unplanned outages, production by bloc and country, price path) | direct, then archive | free key; `DEMO_KEY` works with low limits | U.S. government data, generally public domain; cite "U.S. Energy Information Administration" |
| [CFTC Commitments of Traders](https://publicreporting.cftc.gov/) (Socrata) | Disaggregated futures positioning | direct | none | U.S. government data; cite the CFTC |
| Yahoo Finance chart API (`query1/2.finance.yahoo.com`) | NYMEX WTI and Brent strips, OVX, tanker equities | proxy (live), archive (daily strip) | none | Unofficial endpoint with no public licence: personal, non-commercial use; may change without notice |
| [Frankfurter](https://frankfurter.dev/) | ECB reference FX rates (Brent in local currency) | direct | none | Open-source service over ECB data; cite the ECB |
| [TradingView widgets](https://www.tradingview.com/widget/) | Reference charts, quotes, macro calendar in `XAS` | direct (iframe) | none | Free embeds; keep TradingView's branding and links |

## Chokepoints, shipping and the physical market

| Source | Used for | Access | Key | Terms and attribution |
|---|---|---|---|---|
| [IMF PortWatch](https://portwatch.imf.org/) (`Daily_Chokepoints_Data` ArcGIS feature service on `services9.arcgis.com`) | Daily ship and tanker transits and tanker deadweight through twelve oil chokepoints, two years | direct (edge proxy as fallback) | none | IMF terms of use (imf.org/external/terms.htm); cite "Sources: UN Global Platform; IMF PortWatch (portwatch.imf.org)" |
| [straits.live](https://straits.live/data) (status JSON, transits, events and index CSVs) | Hormuz status, daily transits, stranded vessels, insurance, bypass pipelines, incidents, carrier suspensions, crisis index, relayed prediction markets | direct | none | Computed metrics published CC0; transit counts come from IMF PortWatch (cite "IMF PortWatch") |
| [GitHub mirror of the straits.live data](https://github.com/jasonhjohnson/strait-of-hormuz-data) | Same files when straits.live is slow, and the daily index history | direct | none | Same terms as the source |
| [Digitraffic marine AIS](https://www.digitraffic.fi/en/marine-traffic/) (`meri.digitraffic.fi`, Fintraffic) | Live tankers in the Gulf of Finland, Russian Baltic terminals | direct, archive (daily counts) | none | CC BY 4.0: "Source: Fintraffic / digitraffic.fi" |
| [Open-Meteo](https://open-meteo.com/) (marine and forecast APIs) | Wave height and wind gusts at loading terminals | direct | none | Free for non-commercial use, data CC BY 4.0: "Weather data by Open-Meteo.com" |
| [GDACS](https://www.gdacs.org/) | Cyclones, earthquakes, floods, volcanoes with alert levels | direct | none | Cite GDACS (European Commission JRC and UN OCHA) |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Storms, wildfires, volcanoes | direct | none | NASA open data; cite NASA EONET |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/) | VIIRS fire detections near refineries and terminals | proxy | free MAP_KEY | NASA open data; cite NASA FIRMS |
| [adsb.lol](https://api.adsb.lol/docs) | Military and state aircraft | proxy | none | Open data (Open Database License per adsb.lol at the time of writing) |
| Static reference layer (`js/data/static/`) | Fields, refineries, terminals, pipelines, chokepoint flows, routes | bundled | — | Compiled from public sources (EIA chokepoint figures, company and government publications); capacities are nameplate and positions approximate |

## News, attention and event markets

| Source | Used for | Access | Key | Terms and attribution |
|---|---|---|---|---|
| [Polymarket](https://docs.polymarket.com/) (gamma and CLOB APIs) | Event probabilities, history, WTI barrier ladders | direct; relay via straits.live when blocked | none | Public APIs under Polymarket's terms; probabilities are market prices, not forecasts |
| [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | Article search, coverage timelines by theme | direct, best effort | none | Free and open; cite "The GDELT Project"; one request every 5 seconds |
| [Wikimedia pageviews](https://wikimedia.org/api/rest_v1/) | Attention on chokepoints and oil topics | direct | none | Pageview data released CC0 |
| RSS: OilPrice, EIA Today in Energy, gCaptain, Maritime Executive, Rigzone, Splash247, Hellenic Shipping News | Headlines in the news wire | proxy | none | Publishers' copyright: headlines and links only, articles open on the publisher's site |

## Maps

| Source | Used for | Terms and attribution |
|---|---|---|
| [CARTO basemaps](https://carto.com/basemaps) (dark and light vector styles) | Base map | "© CARTO, © OpenStreetMap contributors"; free use within CARTO's limits, check terms for commercial use. OpenStreetMap data is ODbL |
| [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | Optional satellite layer | "Imagery © Esri, Maxar, Earthstar Geographics"; subject to Esri's terms of use |
| [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) | Yesterday's VIIRS true colour, Black Marble night lights | NASA open data; cite NASA GIBS |

## Software

| Library | Version | Licence |
|---|---|---|
| [Apache ECharts](https://echarts.apache.org/) | 5.6.0 (CDN) | Apache-2.0 |
| [MapLibre GL JS](https://maplibre.org/) | 5.24.0 (CDN) | BSD-3-Clause |
| Hanken Grotesk, IBM Plex Mono (self-hosted in `assets/fonts/`, from the fontsource packages 5.3.0) | — | SIL Open Font License 1.1 (`assets/fonts/OFL-*.txt`) |

The terminal's own code has no third-party runtime dependency beyond these.
