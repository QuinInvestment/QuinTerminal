// Statistics and pricing library used by the forecast lab, the risk board and
// the fundamentals panels. Pure functions, no DOM. Every formula is written out
// so it can be defended line by line.

export const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);
const clean = (a) => a.filter(isFiniteNum);

export const sum = (a) => a.reduce((s, v) => s + v, 0);
export const mean = (a) => { const c = clean(a); return c.length ? sum(c) / c.length : NaN; };
export function variance(a) {
  const c = clean(a);
  if (c.length < 2) return NaN;
  const m = sum(c) / c.length;
  return c.reduce((s, v) => s + (v - m) ** 2, 0) / (c.length - 1);
}
export const std = (a) => Math.sqrt(variance(a));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function quantile(a, p) {
  const s = clean(a).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
/** quantiles of a typed/plain array that is already sorted ascending */
export function qSorted(s, p) {
  if (!s.length) return NaN;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (a) => quantile(a, 0.5);

export function zscore(x, a) {
  const m = mean(a), s = std(a);
  return isFiniteNum(x) && s > 0 ? (x - m) / s : NaN;
}
/** share of observations strictly below x, ties counted half */
export function percentileRank(x, a) {
  const c = clean(a);
  if (!c.length || !isFiniteNum(x)) return NaN;
  let below = 0, eq = 0;
  for (const v of c) { if (v < x) below++; else if (v === x) eq++; }
  return (below + eq / 2) / c.length;
}

export function logReturns(prices) {
  const r = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  return r;
}
export const annualise = (dailyStd, periods = 252) => dailyStd * Math.sqrt(periods);
export const realizedVol = (returns, periods = 252) => annualise(std(returns), periods);

export function rolling(a, w, fn) {
  const out = new Array(a.length).fill(NaN);
  for (let i = w - 1; i < a.length; i++) out[i] = fn(a.slice(i - w + 1, i + 1));
  return out;
}

/** RiskMetrics EWMA variance series (lambda = 0.94 for daily data) */
export function ewmaVariance(returns, lambda = 0.94) {
  const out = [];
  let v = variance(returns.slice(0, Math.min(30, returns.length)));
  if (!isFiniteNum(v)) v = returns[0] ** 2 || 1e-4;
  for (const r of returns) { v = lambda * v + (1 - lambda) * r * r; out.push(v); }
  return out;
}

export function corr(a, b) {
  const n = Math.min(a.length, b.length);
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) if (isFiniteNum(a[i]) && isFiniteNum(b[i])) { xs.push(a[i]); ys.push(b[i]); }
  if (xs.length < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** ordinary least squares y = a + b x */
export function ols(x, y) {
  const n = Math.min(x.length, y.length);
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) if (isFiniteNum(x[i]) && isFiniteNum(y[i])) { xs.push(x[i]); ys.push(y[i]); }
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx > 0 ? sxy / sxx : NaN;
  return { a: my - b * mx, b, n: xs.length };
}

// ---------------------------------------------------------------- normal distribution
const SQRT2PI = Math.sqrt(2 * Math.PI);
export const normPdf = (x) => Math.exp(-0.5 * x * x) / SQRT2PI;

/** erf via W. J. Cody-style rational approximation (|error| < 1.2e-7) */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const normCdf = (x) => 0.5 * erfc(-x / Math.SQRT2);

/** inverse normal CDF — Acklam (relative error < 1.15e-9) */
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------- random numbers
export function rng(seed = 42) {
  let s = seed >>> 0;
  const u = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const n = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let x, y, r2;
    do { x = 2 * u() - 1; y = 2 * u() - 1; r2 = x * x + y * y; } while (r2 >= 1 || r2 === 0);
    const k = Math.sqrt(-2 * Math.log(r2) / r2);
    spare = y * k;
    return x * k;
  };
  return { u, n };
}

// ---------------------------------------------------------------- optimisation
/** Nelder–Mead simplex minimiser. f: (x: number[]) => number */
export function nelderMead(f, x0, { step = 0.5, maxIter = 600, tol = 1e-9 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; simplex.push(x); }
  let vals = simplex.map(f);
  for (let it = 0; it < maxIter; it++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = idx.map((i) => simplex[i]); vals = idx.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol * (Math.abs(vals[0]) + tol)) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const xr = c.map((v, j) => v + (v - simplex[n][j]));
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((v, j) => v + 2 * (v - simplex[n][j]));
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr; vals[n] = fr;
    } else {
      const xc = c.map((v, j) => v + 0.5 * (simplex[n][j] - v));
      const fc = f(xc);
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); vals[i] = f(simplex[i]); }
      }
    }
  }
  return { x: simplex[0], f: vals[0] };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

// ---------------------------------------------------------------- GARCH(1,1)
/**
 * Gaussian quasi-maximum-likelihood GARCH(1,1) with variance targeting:
 *   eps_t = r_t - mu,  s2_t = omega + alpha*eps_{t-1}^2 + beta*s2_{t-1},
 *   omega = vbar * (1 - alpha - beta),  vbar = sample variance.
 * alpha and beta are fitted through a smooth reparametrisation that keeps
 * alpha, beta >= 0 and alpha + beta < 1.
 */
export function garchFit(returns) {
  const r = clean(returns);
  const n = r.length;
  if (n < 120) throw new Error("GARCH needs at least 120 returns");
  const mu = mean(r);
  const e = r.map((v) => v - mu);
  const vbar = variance(r);
  const unpack = ([u, v]) => {
    const pers = 0.9995 * sigmoid(u);
    const share = sigmoid(v);
    return { alpha: pers * share, beta: pers * (1 - share) };
  };
  const nll = (theta) => {
    const { alpha, beta } = unpack(theta);
    const omega = vbar * (1 - alpha - beta);
    let s2 = vbar, ll = 0;
    for (let t = 0; t < n; t++) {
      if (t > 0) s2 = omega + alpha * e[t - 1] * e[t - 1] + beta * s2;
      if (!(s2 > 0)) return 1e12;
      ll += Math.log(s2) + (e[t] * e[t]) / s2;
    }
    return 0.5 * ll;
  };
  // start from alpha 0.08, beta 0.90
  const start = [logit(0.98 / 0.9995), logit(0.08 / 0.98)];
  const best = nelderMead(nll, start, { step: 0.6, maxIter: 800 });
  const { alpha, beta } = unpack(best.x);
  const omega = vbar * (1 - alpha - beta);
  const s2 = new Array(n);
  s2[0] = vbar;
  for (let t = 1; t < n; t++) s2[t] = omega + alpha * e[t - 1] * e[t - 1] + beta * s2[t - 1];
  const z = e.map((v, t) => v / Math.sqrt(s2[t]));
  const next = omega + alpha * e[n - 1] * e[n - 1] + beta * s2[n - 1];
  const pers = alpha + beta;
  return {
    mu, omega, alpha, beta, vbar, persistence: pers,
    halfLife: pers > 0 && pers < 1 ? Math.log(0.5) / Math.log(pers) : Infinity,
    sigma2: s2, z, nextSigma2: next, nll: best.f + 0.5 * n * Math.log(2 * Math.PI), n,
  };
}

/** expected daily variance h steps ahead (h >= 1) */
export function garchTermVar(g, h) {
  const p = g.alpha + g.beta;
  return g.vbar + Math.pow(p, h - 1) * (g.nextSigma2 - g.vbar);
}
/** annualised vol for the average variance over the next H days */
export function garchHorizonVol(g, H, periods = 252) {
  let s = 0;
  for (let h = 1; h <= H; h++) s += garchTermVar(g, h);
  return Math.sqrt((s / H) * periods);
}

/**
 * Filtered historical simulation: GARCH variance recursion driven by
 * standardised residuals drawn with replacement from history (keeps fat tails
 * and skew the normal model would miss).
 * Returns per-step quantile bands, terminal distribution and path extrema.
 */
export function fhsSimulate(g, S0, H, { paths = 8000, seed = 7, quantiles = [0.05, 0.25, 0.5, 0.75, 0.95], drift = 0 } = {}) {
  const R = rng(seed);
  const Z = g.z.filter(isFiniteNum);
  const nz = Z.length;
  const steps = Array.from({ length: H }, () => new Float64Array(paths));
  const maxs = new Float64Array(paths);
  const mins = new Float64Array(paths);
  const lastE = g.sigma2.length ? 0 : 0;
  for (let p = 0; p < paths; p++) {
    let s2 = g.nextSigma2;
    let lp = Math.log(S0), mx = S0, mn = S0;
    for (let t = 0; t < H; t++) {
      const z = Z[Math.floor(R.u() * nz)];
      const eps = Math.sqrt(s2) * z;
      lp += drift + eps;
      const S = Math.exp(lp);
      steps[t][p] = S;
      if (S > mx) mx = S;
      if (S < mn) mn = S;
      s2 = g.omega + g.alpha * eps * eps + g.beta * s2;
    }
    maxs[p] = mx; mins[p] = mn;
  }
  void lastE;
  const bands = steps.map((arr) => {
    const s = Float64Array.from(arr).sort();
    return quantiles.map((q) => qSorted(s, q));
  });
  const terminal = Float64Array.from(steps[H - 1]).sort();
  return { bands, quantiles, terminal, maxs, mins, paths };
}

/** probability that a simulated path touched a level within the horizon */
export function touchProbSim(sim, level, S0) {
  let c = 0;
  if (level >= S0) { for (const m of sim.maxs) if (m >= level) c++; }
  else { for (const m of sim.mins) if (m <= level) c++; }
  return c / sim.paths;
}
export function probAboveSorted(sorted, level) {
  // binary search for first index >= level
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < level) lo = mid + 1; else hi = mid; }
  return 1 - lo / sorted.length;
}

// ---------------------------------------------------------------- lognormal & mixtures
/** lognormal with median m and annual vol sigma over T years */
export function lnQuantile(median, sigma, T, p) {
  return median * Math.exp(sigma * Math.sqrt(T) * normInv(p));
}
export function lnCdf(x, median, sigma, T) {
  if (x <= 0) return 0;
  return normCdf(Math.log(x / median) / (sigma * Math.sqrt(T)));
}
export function lnPdf(x, median, sigma, T) {
  if (x <= 0) return 0;
  const s = sigma * Math.sqrt(T);
  return normPdf(Math.log(x / median) / s) / (x * s);
}
/** components: [{w, median, sigma}] (weights sum to 1), T in years */
export function mixCdf(x, comps, T) {
  return comps.reduce((acc, c) => acc + c.w * lnCdf(x, c.median, c.sigma, T), 0);
}
export function mixPdf(x, comps, T) {
  return comps.reduce((acc, c) => acc + c.w * lnPdf(x, c.median, c.sigma, T), 0);
}
export function mixQuantile(p, comps, T) {
  let lo = 1e-6, hi = Math.max(...comps.map((c) => c.median)) * 20;
  for (let i = 0; i < 100; i++) {
    const mid = 0.5 * (lo + hi);
    if (mixCdf(mid, comps, T) < p) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}
export function mixMean(comps, T) {
  // E[X] for lognormal with median m: m * exp(s^2/2)
  return comps.reduce((acc, c) => acc + c.w * c.median * Math.exp(0.5 * c.sigma * c.sigma * T), 0);
}

// ---------------------------------------------------------------- Black-76
/**
 * European option on a futures price F, strike K, T years, rate r, vol sigma.
 * Returns price, greeks (vega per 1 vol point, theta per calendar day) and
 * the cash-or-nothing digital price.
 */
export function black76(F, K, T, r, sigma, type = "call") {
  const df = Math.exp(-r * T);
  if (!(T > 0) || !(sigma > 0)) {
    const intr = type === "call" ? Math.max(F - K, 0) : Math.max(K - F, 0);
    return { price: df * intr, delta: type === "call" ? (F > K ? df : 0) : (F < K ? -df : 0), gamma: 0, vega: 0, theta: 0, digital: df * (type === "call" ? +(F > K) : +(F < K)), d1: NaN, d2: NaN, probITM: type === "call" ? +(F > K) : +(F < K) };
  }
  const sT = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / sT;
  const d2 = d1 - sT;
  const nd1 = normPdf(d1);
  let price, delta, digital, probITM;
  if (type === "call") {
    price = df * (F * normCdf(d1) - K * normCdf(d2));
    delta = df * normCdf(d1);
    digital = df * normCdf(d2);
    probITM = normCdf(d2);
  } else {
    price = df * (K * normCdf(-d2) - F * normCdf(-d1));
    delta = -df * normCdf(-d1);
    digital = df * normCdf(-d2);
    probITM = normCdf(-d2);
  }
  const gamma = (df * nd1) / (F * sT);
  const vega = (df * F * nd1 * Math.sqrt(T)) / 100;
  const theta = (r * price - (df * F * nd1 * sigma) / (2 * Math.sqrt(T))) / 365;
  return { price, delta, gamma, vega, theta, digital, d1, d2, probITM };
}

export function impliedVolBlack76(price, F, K, T, r, type = "call") {
  let lo = 0.001, hi = 6;
  for (let i = 0; i < 120; i++) {
    const mid = 0.5 * (lo + hi);
    if (black76(F, K, T, r, mid, type).price < price) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------- barrier / touch probabilities
/**
 * Probability that a driftless futures price (martingale: ln F has drift
 * -sigma^2/2) touches level B before T (years). Reflection-principle formula
 * for Brownian motion with drift.
 */
export function touchProb(F0, B, T, sigma) {
  if (!(T > 0) || !(sigma > 0)) return B >= F0 ? +(F0 >= B) : +(F0 <= B);
  const sT = sigma * Math.sqrt(T);
  const half = 0.5 * sigma * sigma * T;
  const a = Math.log(B / F0);
  if (B >= F0) {
    return clamp(normCdf((-a - half) / sT) + (F0 / B) * normCdf((-a + half) / sT), 0, 1);
  }
  return clamp(normCdf((a + half) / sT) + (F0 / B) * normCdf((a - half) / sT), 0, 1);
}

/** touch probability over a window that starts t1 years from now and ends t2 */
export function touchProbWindow(F0, B, t1, t2, sigma, n = 160) {
  if (t1 <= 1e-6) return touchProb(F0, B, t2, sigma);
  const s1 = sigma * Math.sqrt(t1);
  const up = B >= F0;
  let acc = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const zq = normInv((i + 0.5) / n);
    const F1 = F0 * Math.exp(-0.5 * s1 * s1 + s1 * zq);
    const already = up ? F1 >= B : F1 <= B;
    acc += already ? 1 : touchProb(F1, B, t2 - t1, sigma);
    wsum += 1;
  }
  return acc / wsum;
}

/** invert touch probability to an implied volatility (bisection) */
export function impliedVolFromTouch(p, F0, B, t1, t2) {
  if (!(p > 0.0005 && p < 0.9995)) return NaN;
  let lo = 0.02, hi = 4;
  const f = (s) => touchProbWindow(F0, B, t1, t2, s);
  if (f(lo) > p || f(hi) < p) return NaN;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < p) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------- tests & scores
/** Kupiec proportion-of-failures test. x exceptions out of n at level p. */
export function kupiec(x, n, p) {
  if (!(n > 0)) return { lr: NaN, pValue: NaN };
  const ph = x / n;
  const ll0 = (n - x) * Math.log(1 - p) + x * Math.log(p);
  const ll1 = (x > 0 ? x * Math.log(ph) : 0) + (n - x > 0 ? (n - x) * Math.log(1 - ph) : 0);
  const lr = -2 * (ll0 - ll1);
  const pValue = 2 * (1 - normCdf(Math.sqrt(Math.max(lr, 0))));
  return { lr, pValue, rate: ph };
}

/** area under the ROC curve (Mann–Whitney) */
export function auc(scores, labels) {
  const pts = scores.map((s, i) => [s, labels[i]]).filter((p) => isFiniteNum(p[0]));
  pts.sort((a, b) => a[0] - b[0]);
  let rankSum = 0, nPos = 0, nNeg = 0;
  for (let i = 0; i < pts.length; ) {
    let j = i;
    while (j < pts.length && pts[j][0] === pts[i][0]) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) { if (pts[k][1]) { rankSum += avgRank; nPos++; } else nNeg++; }
    i = j;
  }
  if (!nPos || !nNeg) return NaN;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

/** solve A x = b (Gaussian elimination with partial pivoting) */
export function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-14) return null;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * L2-regularised logistic regression by Newton–Raphson (IRLS).
 * X: rows of features (no intercept column — added here), y: 0/1.
 * The intercept is not penalised.
 */
export function logistic(X, y, { lambda = 1, iters = 30 } = {}) {
  const n = X.length, k = X[0].length + 1;
  const Z = X.map((r) => [1, ...r]);
  let w = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += Z[i][j] * w[j];
      const p = 1 / (1 + Math.exp(-s));
      const d = p - y[i];
      const wt = Math.max(p * (1 - p), 1e-9);
      for (let j = 0; j < k; j++) {
        g[j] += Z[i][j] * d;
        for (let l = j; l < k; l++) H[j][l] += wt * Z[i][j] * Z[i][l];
      }
    }
    for (let j = 0; j < k; j++) for (let l = 0; l < j; l++) H[j][l] = H[l][j];
    for (let j = 1; j < k; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; }
    const step = solve(H, g);
    if (!step) break;
    let delta = 0;
    w = w.map((v, j) => { delta = Math.max(delta, Math.abs(step[j])); return v - step[j]; });
    if (delta < 1e-8) break;
  }
  const predict = (row) => 1 / (1 + Math.exp(-(w[0] + row.reduce((s, v, j) => s + v * w[j + 1], 0))));
  return { w, predict };
}

/** standardise columns using means/stds from a training slice */
export function standardiser(rows) {
  const k = rows[0].length;
  const mu = [], sd = [];
  for (let j = 0; j < k; j++) {
    const col = rows.map((r) => r[j]);
    mu.push(mean(col));
    sd.push(std(col) || 1);
  }
  return (r) => r.map((v, j) => (v - mu[j]) / sd[j]);
}

// ---------------------------------------------------------------- misc
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** align several {t,v} series on common keys; returns {keys, cols} */
export function align(seriesMap) {
  const names = Object.keys(seriesMap);
  const maps = names.map((n) => new Map(seriesMap[n].map((p) => [p.t, p.v])));
  const keys = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const cols = Object.fromEntries(names.map((n, i) => [n, keys.map((k) => maps[i].get(k))]));
  return { keys, cols };
}
