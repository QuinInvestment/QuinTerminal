# Methodology

How each number on screen is made, what it assumes and where it breaks. The
same notes, shorter, sit behind the ⓘ button of each panel. Code references
point to the functions that implement them.

Three rules run through the terminal:

1. **Say where a number comes from.** Every panel names its sources and shows
   when it last updated; a cached or archived copy is labelled as such.
2. **Keep heuristics and models apart.** Scorecards and classifiers are
   labelled as heuristics. Forecasts are models with out-of-sample tests.
3. **Score the forecasts.** The terminal archives its own forecasts every
   weekday and grades them when their target dates pass.

---

## 1. Prices

**Live prices** are the trade.xyz HIP-3 perpetuals on Hyperliquid:
`xyz:CL` (WTI), `xyz:BRENTOIL` (Brent), `xyz:HO` (NY Harbor ULSD) and others.
They trade 24/7 against an oracle built from CME/ICE futures and roll from the
expiring contract to the next one in steps, roughly 10 to 5 business days
before expiry. When exchanges are closed the oracle freezes and the perp trades
in a bounded band, so weekend prices are an early read on Monday's open.
Basis = mark − oracle; funding is the hourly rate annualised.

**Daily history for the models** (`model.dailyHistory`): EIA daily spot (Europe
Brent `RBRTE`, Cushing WTI `RWTC`) up to EIA's last print, which lags about a
week, then extended with perp returns:

  P_t = P_eia_last × (perp_t / perp_anchor), anchor = perp close on EIA's last date

so the models see roughly ten years of returns and today's level. The gap
between EIA Dated Brent and the perp on the anchor date is reported as the
**physical premium**: in a seaborne supply shock the physical cargo trades well
above the futures-linked perp.

**Contract calendar** (`core/contracts.js`): NYMEX CL stops trading three
business days before the 25th of the month before delivery (counted from the
last business day before the 25th when the 25th is not one); ICE Brent stops on
the last business day of the second month before delivery. US holidays apply to
CL and UK holidays to Brent.

---

## 2. Forecast lab (`FCST`) and the cockpit outlook

The lab gives three lenses on the distribution of Brent (or WTI) at 1 week,
1 month or 3 months. They answer different questions and are shown side by
side, never averaged.

### 2.1 Statistical lens: GARCH(1,1) with filtered historical simulation

  σ²_t = ω + α ε²_{t−1} + β σ²_{t−1},  ε_t = r_t − μ

- Fitted by Gaussian quasi-maximum likelihood on up to 2,600 daily log returns
  (`stats.garchFit`), with **variance targeting**: ω = σ̄²(1 − α − β), σ̄² the
  sample variance. α and β are reparametrised so that α, β ≥ 0 and
  α + β < 0.9995, and the likelihood is maximised with Nelder–Mead.
- **Filtered historical simulation** (`stats.fhsSimulate`): standardised
  residuals z_t = ε_t / σ_t from the fit are resampled with replacement and
  pushed through the GARCH recursion from today's conditional variance. This
  keeps the fat tails and skew of oil returns that a normal model would miss.
  Log prices are driftless, so the median stays near today's price.
- 8,000 paths in the lab, 6,000 in the cockpit, 20,000 with a fixed seed in the
  daily archive.
- Average expected volatility to the horizon (`stats.garchHorizonVol`) uses the
  GARCH term structure of variance, which mean-reverts to σ̄² at speed α + β.

**When it is weak.** If the EIA history is unavailable the fit runs on the perp
alone (about 240 daily returns for Brent since March 2026). Persistence then
tends to sit at its cap and α near zero: the panel says so. The EIA mirror
written by the daily workflow removes the problem.

### 2.2 Scenario lens: a mixture of three lognormal regimes

| Scenario | Weight | Median target | Volatility |
|---|---|---|---|
| Deal and reopening | Polymarket, "Hormuz traffic returns to normal by …", interpolated to the horizon | max(1.25 × pre-war price, 0.7 × spot), capped at 0.95 × spot | 45% |
| Grinding blockade | 1 − the other two | spot (futures are a martingale under the pricing measure) | max(30%, GARCH) |
| Escalation | Polymarket, "US invades Iran before 2027", hazard-scaled to the horizon | 1.3 × spot | 70% |

- **Term-structure interpolation** (`model.reopenProbAt`): between two deadlines,
  linear in probability; before the first deadline, a constant hazard
  λ = −ln(1 − p₁)/T₁ from today; after the last, the last implied hazard.
- **Hazard scaling** (`model.hazardToHorizon`): a probability p by a date T
  becomes 1 − exp(−λh) over a horizon h, with λ = −ln(1 − p)/T.
- Weights are clipped (deal 1–90%, escalation 1–60%, blockade at least 5%) and
  renormalised. Without markets, stated defaults are used (12% and 8%) and the
  panel says "assumption".
- Mixture quantiles are found by bisection on the mixture CDF
  (`stats.mixQuantile`). Every slider can override a market input.

The targets are assumptions, not estimates. Their job is to make the scenario
view explicit and editable.

### 2.3 Market lens: barrier-implied volatility

Polymarket lists "Will WTI hit (HIGH) $X in <month>?" ladders. For a driftless
futures price with volatility σ, the probability of touching a barrier B above
F within T is, by the reflection principle,

  P = N((−a − σ²T/2)/(σ√T)) + (F/B)·N((−a + σ²T/2)/(σ√T)),  a = ln(B/F)

(`stats.touchProb`, mirrored for barriers below). Windows that start in the
future are integrated over the distribution of the price at the window start
(`stats.touchProbWindow`). Inverting P for σ on each market
(`stats.impliedVolFromTouch`) gives a crowd-implied volatility; the median over
the ladder defines a lognormal around spot. Differences with the model reflect
different measures (subjective odds versus a risk-neutral model), fees and
liquidity: they are not arbitrage.

### 2.4 Probabilities at the horizon

"Above" is the share of simulated paths ending above a level; "Touch" is the
share that trade through it at any time before the horizon. The scenario column
is 1 − mixture CDF. For WTI, live Polymarket prices are shown next to them when
a market's window ends within 20 days of the horizon.

### 2.5 Is the statistical model calibrated?

- **VaR backtest**: parameters are estimated on the first part of the sample and
  frozen; one-day 95% and 99% VaR is then forecast every day of the evaluation
  window. **Kupiec's proportion-of-failures test** (`stats.kupiec`) compares the
  exception count x out of n with the nominal rate p:
  LR = −2 ln[(1−p)^{n−x} p^x] + 2 ln[(1−x/n)^{n−x} (x/n)^x] ~ χ²(1).
  A constant-volatility VaR is shown as the benchmark.
- **PIT histogram**: the 21-day probability integral transform of realised
  prices under the forecast distribution should be uniform. A U shape means the
  tails are too thin; a hump, too fat. Windows overlap, so it is a diagnostic,
  not a formal test.

### 2.6 Signal lab: can fundamentals call next week?

A weekly ridge-penalised logistic regression (λ = 2, standardised features)
predicts the sign of Brent's next weekly return from six features known at the
time: the EIA crude stock surprise against the seasonal norm, Cushing stocks
against their 5-year average, 4- and 12-week momentum, the 4-week change in
managed-money net length (% of open interest) and the Brent–WTI spread.

Walk-forward: train on the first 104 weeks, refit every 4 weeks on all data
available at that date, score only the following weeks. Results are compared
with always predicting the more frequent outcome; returns ignore costs and use
spot, not tradable futures. An honest result here is usually "barely better
than the base rate", and that is the point of showing it.

### 2.7 Track record (live, out of sample)

Every weekday after the settlement, `pipeline/snapshot.mjs` stores both lenses'
5/25/50/75/95% quantiles at 5, 21 and 63 trading days in
`data/history/forecasts.csv`. When a target date passes the forecast is scored
against the perp's daily close (UTC) on that date (`archive.score`):

- **Coverage** of the 90% and 50% intervals (target: 90% and 50%).
- **Pinball loss** averaged over the five quantiles, in dollars:
  L_q(y, ŷ) = max(q(y − ŷ), (q − 1)(y − ŷ)).
- **Skill** = 1 − loss / naive loss, the naive forecast being a driftless
  lognormal at the 20-day realised volatility of the forecast day.

Consecutive scores overlap and are dependent: dozens of matured forecasts are
needed before differences between the lenses mean much.

### 2.8 Tools

- **`OPT K days [vol] [call|put]`**: Black-76 on futures,
  C = e^{−rT}[F N(d₁) − K N(d₂)], d₁ = [ln(F/K) + σ²T/2]/(σ√T), d₂ = d₁ − σ√T,
  with Greeks (vega per vol point, theta per calendar day) and the digital
  price −∂C/∂K. Default σ is the GARCH average expected volatility to expiry.
  Real WTI and Brent options are American on futures: this is a European
  approximation.
- **`SHOCK mb/d days`**: a market-clearing sensitivity,
  ΔP/P ≈ (supply lost − emergency draws) / world demand / |short-run demand
  elasticity|, with elasticities of −0.05 to −0.10. It ignores supply
  response and storage: an order of magnitude, not a forecast.

---

## 3. Balance of risks (cockpit)

An equal-weight scorecard. Each factor is turned into a z-score signed so that
positive means upward pressure on crude, clipped to ±3, then averaged:

| Factor | Transformation |
|---|---|
| Hormuz flow loss | 3 × share of pre-crisis transits missing |
| Bab el-Mandeb flow | 3 × max(0, 1 − transits / pre-crisis median) |
| US crude and distillate stocks | −(level − 5-year same-week mean) / 5-year same-week SD |
| SPR buffer | −(level − 2018–2025 mean) / SD |
| Speculators (WTI) | −z of managed-money net length as % of open interest over 3 years (crowded longs are a downside risk) |
| 1-month momentum | 21-day log return / (daily SD × √21) |
| Escalation index | (straits.live escalation − 50) / 20 |
| Brent–WTI spread | (spread − $4) / $2.5 |

The weights are deliberately naive. The panel organises the evidence; it is
not a fitted model.

---

## 4. Inventories (`STK`)

- **Seasonal range** (`eia.seasonal`): for each week, the minimum, maximum and
  mean of the same ISO week over the five previous years, the convention of
  EIA's own range charts. Week 53 falls back to week 52.
- **Surprise**: this week's change minus the usual change for this week
  (difference of the 5-year means), the number markets react to.
- **STEO**: EIA's monthly Short-Term Energy Outlook. World balance = production
  − consumption, shown as stock build (surplus) or draw (deficit); levels and
  balance are not put on one axis.

---

## 5. Positioning (`POS`)

CFTC disaggregated Commitments of Traders, futures only, weekly (Tuesday data,
released Friday). Net length = long − short; % of open interest normalises for
market size. Percentile and z-score are against the last 156 weeks
(`cftc.positioning`). Above the 85th percentile speculators are crowded long, a
source of downside if the news turns. The heatmap shows the weekly z of net
length per contract.

---

## 6. Hormuz (`HRMZ`)

- **Throughput** = latest daily transit count / pre-crisis median
  (28 Feb 2025 – 27 Feb 2026), IMF PortWatch via straits.live. AIS misses ships
  that sail dark, so other counts can be higher.
- **Odds term structure**: the Yes prices of "traffic returns to normal by
  <date>" markets; the gap between consecutive bars is the implied chance of a
  reopening in that window.
- **Supply-gap calculator**: pre-war Hormuz oil flow (20.9 mb/d, EIA 1H 2025)
  − oil still crossing − bypass pipeline flow above pre-war use = seaborne
  loss, offset by emergency draws, demand destruction and spare capacity
  outside the Gulf. The price range divides the uncovered shortfall by world
  demand (~104 mb/d) and an elasticity of −0.05 to −0.10.

---

## 7. Event risk and attention (`RISK`)

- **Wikipedia attention**: z = (mean of log(1 + views) over the last 7 days −
  mean over the 90 days before) / SD over those 90 days.
- **GDELT news intensity**: raw daily article counts (`timelinevolraw`) per
  theme over three months, today's partial day excluded; z of the last 7 days'
  mean against the earlier days.
- **Theme matrix**: attention z, news z, physical disruption (share of transits
  missing) and the lead market per theme. Amber above 1σ, red above 2σ.

Attention measures how much the world is looking, not which way prices go.

---

## 8. News classifier (`NEWS`)

Transparent rules, no machine learning (`news.classify`):

- **Topic tags** from keyword rules: supply risk (+1: attack, strike, mine,
  closure, outage, seizure…), supply relief (−1: reopen, ceasefire, deal,
  release of stocks…; −2 for phrases like "cleared of mines" where a risk word
  appears in a relief context), demand, inventories, shipping, policy.
- **Score** = sum of signs, clipped to [−1, 1].
- **Region**: strong cues (waterways, ports, fields) win over weak ones
  (countries, companies), so "Saudi Red Sea ports" files under the Red Sea.
- **Pressure gauge**: mean score of tagged headlines over the last 24 hours.

Headlines are de-duplicated on their first eight significant words. Rules miss
irony, negation and context: read the gauge as a summary of the wire, not as
sentiment analysis.

---

## 9. Maritime (`SHIP`)

- **Laden or ballast** from AIS draught over hull length: ≥ 4.5% laden,
  ≤ 3.6% ballast, in between "part". Crews update draught by hand, so it lags.
- **Terminal counts**: tankers within 20 km of each Russian Baltic terminal.
- **Laden westbound departures**: laden tankers east of 26.5°E moving faster
  than 4 knots on a course of 200–300°, excluding Finnish and Estonian
  destinations.
- **Sea state**: hourly significant wave height and wind gusts at a sea point
  next to each loading terminal (Open-Meteo). Limits are typical operating
  cut-offs, not the terminals' own rules: single-point moorings usually suspend
  loading somewhere around 2–3 m of sea.
- **Hazards**: GDACS and NASA EONET events matched to the nearest asset,
  flagged within 400 km of a storm, 150 km of other events, 40 km of a fire.

---

## 10. What this terminal does not do

- No order routing, no exchange settlements, no options chain: the free,
  browser-reachable data does not include them.
- No fitted weights in the scorecard or the classifier.
- No claim that the forecasts beat the market. The track record exists to find
  out, and it needs months of matured forecasts before it says anything.
