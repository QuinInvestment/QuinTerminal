// Sanity checks for the maths in js/core/stats.js. Run: node tests/stats.test.js
import * as S from "../js/core/stats.js";
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("FAIL", msg); } else console.log("ok  ", msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

ok(near(S.normCdf(0), 0.5, 1e-7), "normCdf(0)=0.5");
ok(near(S.normCdf(1.96), 0.9750021, 1e-6), "normCdf(1.96)");
ok(near(S.normInv(0.975), 1.959964, 1e-5), "normInv(0.975)");
ok(near(S.normInv(S.normCdf(-2.3)), -2.3, 1e-6), "normInv∘normCdf");

// Black-76 put-call parity: C - P = e^{-rT}(F-K)
const F = 100, K = 105, T = 0.25, r = 0.04, v = 0.45;
const c = S.black76(F, K, T, r, v, "call"), p = S.black76(F, K, T, r, v, "put");
ok(near(c.price - p.price, Math.exp(-r * T) * (F - K), 1e-9), "Black-76 parity");
ok(near(S.impliedVolBlack76(c.price, F, K, T, r, "call"), v, 1e-6), "implied vol round trip");
// digital + vanilla consistency: call digital ≈ -dC/dK
const dK = 0.01;
const dig = -(S.black76(F, K + dK, T, r, v).price - S.black76(F, K - dK, T, r, v).price) / (2 * dK);
ok(near(dig, c.digital, 1e-5), "digital = -dC/dK");
// theta sign: long call loses value with time
ok(c.theta < 0, "call theta negative");

// touch probability vs Monte Carlo (driftless martingale)
{
  const R = S.rng(1);
  const n = 20000, steps = 252, Tm = 0.5, sig = 0.5, B = 120, F0 = 100;
  const dt = Tm / steps; let hit = 0;
  for (let i = 0; i < n; i++) {
    let lf = Math.log(F0), touched = false;
    for (let s = 0; s < steps; s++) { lf += -0.5 * sig * sig * dt + sig * Math.sqrt(dt) * R.n(); if (lf >= Math.log(B) - 0.5826 * sig * Math.sqrt(dt)) { touched = true; break; } }
    if (touched) hit++;
  }
  const mc = hit / n, cf = S.touchProb(F0, B, Tm, sig);
  ok(near(mc, cf, 0.02), `touchProb up closed-form ${cf.toFixed(4)} vs MC ${mc.toFixed(4)} (MC with Broadie-Glasserman barrier shift)`);
  const cfd = S.touchProb(F0, 85, Tm, sig);
  let hitd = 0; const R2 = S.rng(2);
  for (let i = 0; i < n; i++) {
    let lf = Math.log(F0), touched = false;
    for (let s = 0; s < steps; s++) { lf += -0.5 * sig * sig * dt + sig * Math.sqrt(dt) * R2.n(); if (lf <= Math.log(85) + 0.5826 * sig * Math.sqrt(dt)) { touched = true; break; } }
    if (touched) hitd++;
  }
  ok(near(hitd / n, cfd, 0.02), `touchProb down ${cfd.toFixed(4)} vs MC ${(hitd / n).toFixed(4)}`);
  const iv = S.impliedVolFromTouch(cf, F0, B, 0, Tm);
  ok(near(iv, sig, 1e-3), "implied vol from touch prob round trip");
  const w = S.touchProbWindow(F0, B, 0.1, Tm, sig);
  ok(w < cf && w > 0, "forward-start window touch < full window");
}

// GARCH recovers parameters from simulated data
{
  const R = S.rng(11);
  const om = 2e-6, al = 0.07, be = 0.91, n = 4000;
  let s2 = om / (1 - al - be), rr = [];
  for (let t = 0; t < n; t++) { const e = Math.sqrt(s2) * R.n(); rr.push(e); s2 = om + al * e * e + be * s2; }
  const g = S.garchFit(rr);
  ok(near(g.alpha, al, 0.03) && near(g.beta, be, 0.04), `GARCH fit alpha ${g.alpha.toFixed(3)} beta ${g.beta.toFixed(3)}`);
  const sim = S.fhsSimulate(g, 100, 21, { paths: 4000 });
  ok(sim.bands.length === 21 && sim.bands[20][0] < 100 && sim.bands[20][4] > 100, "FHS bands bracket spot");
  ok(S.garchHorizonVol(g, 21) > 0, "GARCH horizon vol positive");
}

// logistic regression on separable-ish data
{
  const R = S.rng(5); const X = [], y = [];
  for (let i = 0; i < 800; i++) { const a = R.n(), b = R.n(); X.push([a, b]); y.push(+(0.8 * a - 0.5 * b + 0.3 * R.n() > 0)); }
  const m = S.logistic(X, y, { lambda: 0.1 });
  ok(m.w[1] > 0 && m.w[2] < 0, "logistic signs");
  const sc = X.map(m.predict);
  ok(S.auc(sc, y) > 0.9, "AUC > 0.9 on informative features");
}
// mixture quantile monotone
{
  const comps = [{ w: 0.2, median: 80, sigma: 0.4 }, { w: 0.6, median: 108, sigma: 0.35 }, { w: 0.2, median: 140, sigma: 0.55 }];
  const q1 = S.mixQuantile(0.1, comps, 0.25), q5 = S.mixQuantile(0.5, comps, 0.25), q9 = S.mixQuantile(0.9, comps, 0.25);
  ok(q1 < q5 && q5 < q9, `mixture quantiles ${q1.toFixed(1)} < ${q5.toFixed(1)} < ${q9.toFixed(1)}`);
  ok(near(S.mixCdf(q5, comps, 0.25), 0.5, 1e-6), "mixture cdf at median");
}
const k = S.kupiec(13, 1000, 0.01);
ok(k.pValue > 0.3 && k.pValue < 0.4, `Kupiec p=${k.pValue.toFixed(3)} for 13/1000 at 1%`);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
