// ===================== Quinterminal MAX (static) =====================
const $ = (id) => document.getElementById(id);
const PROXY = "https://api.allorigins.win/raw?url=";
const CACHE_MS = 120000;

const DEF = {
  tab: "markets",
  layout: "quad",      // quad | hex | focus
  density: "compact",  // compact | comfort
  autoSec: 0,          // 0 off
  newsQuery: "finance OR markets",
  wlFx: ["EURUSD","EURGBP","EURJPY","EURCHF"],
  wlCrypto: ["bitcoin","ethereum","solana","ripple"],
  alerts: {
    crypto24hAbs: 8.0,     // toast si |24h| > x
    realizedVol: 0.90      // toast si vol > x (ann.)
  }
};

const SUG = [
  "HELP",
  "FX",
  "CRYPTO",
  "VOL",
  "MACRO",
  "MARITIME",
  "NEWS shipping",
  "NEWS inflation",
  "NEWS central bank",
  "LAYOUT quad",
  "LAYOUT hex",
  "AUTO 30",
  "AUTO 60",
  "AUTO off",
  "DENSITY compact",
  "DENSITY comfort",
  "EXPORT",
  "THEME markets",
  "THEME vol",
  "THEME fx",
  "THEME crypto",
  "THEME macro",
  "THEME news",
  "THEME maritime"
];

const state = {
  ...loadSettings(),
  timers: { auto: null },
  console: [],
  maritimeMap: null,
};

function logEvent(msg){
  const ts = new Date().toLocaleTimeString("fr-FR", { hour12:false });
  state.console.unshift({ ts, msg });
  state.console = state.console.slice(0, 50);
  renderConsole();
}

function saveSettings(){
  const s = {
    tab: state.tab,
    layout: state.layout,
    density: state.density,
    autoSec: state.autoSec,
    newsQuery: state.newsQuery,
    wlFx: state.wlFx,
    wlCrypto: state.wlCrypto,
    alerts: state.alerts
  };
  localStorage.setItem("qt:max", JSON.stringify(s));
}

function loadSettings(){
  try{
    const raw = localStorage.getItem("qt:max");
    if(!raw) return { ...DEF };
    const s = JSON.parse(raw);
    return {
      ...DEF,
      ...s,
      alerts: { ...DEF.alerts, ...(s.alerts || {}) },
      wlFx: Array.isArray(s.wlFx) ? s.wlFx : DEF.wlFx,
      wlCrypto: Array.isArray(s.wlCrypto) ? s.wlCrypto : DEF.wlCrypto
    };
  }catch{
    return { ...DEF };
  }
}

function cacheGet(key){
  try{
    const v = sessionStorage.getItem(key);
    if(!v) return null;
    const obj = JSON.parse(v);
    if(Date.now() - obj.t > CACHE_MS) return null;
    return obj.data;
  }catch{ return null; }
}
function cacheSet(key, data){
  try{
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data }));
  }catch{}
}

async function fetchJson(url, { timeoutMs = 9000, cacheKey = null } = {}) {
  if (cacheKey){
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try{
    // try direct
    const r = await fetch(url, { signal: ctrl.signal, cache:"no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (cacheKey) cacheSet(cacheKey, data);
    return data;
  }catch(e){
    // proxy fallback
    const r2 = await fetch(PROXY + encodeURIComponent(url), { cache:"no-store" });
    if (!r2.ok) throw new Error(`Proxy HTTP ${r2.status}`);
    const data2 = await r2.json();
    if (cacheKey) cacheSet(cacheKey, data2);
    return data2;
  }finally{
    clearTimeout(t);
  }
}

function setDataState(ok, text) {
  const dot = $("dot");
  dot.classList.toggle("ok", !!ok);
  $("dataState").textContent = text;
}

function setTheme(tab) {
  document.body.setAttribute("data-theme", tab);
}

function setLayout(layout){
  state.layout = layout;
  document.body.setAttribute("data-layout", layout);
  // focus reset
  if(layout !== "focus"){
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("focused"));
  }
  saveSettings();
}

function setDensity(d){
  state.density = d;
  document.body.setAttribute("data-density", d);
  saveSettings();
}

function clock() {
  const el = $("clock");
  const tick = () => el.textContent = new Date().toLocaleTimeString("fr-FR", { hour12:false });
  tick(); setInterval(tick, 1000);
}

function skel(msg="Loading…"){
  return `<div class="skel">${msg}</div>`;
}

function toast(title, sub){
  const wrap = $("toastWrap");
  const div = document.createElement("div");
  div.className = "toast";
  div.innerHTML = `<div class="t">${escapeHtml(title)}</div><div class="s">${escapeHtml(sub || "")}</div>`;
  wrap.appendChild(div);
  setTimeout(()=> div.style.opacity = "0.0", 3600);
  setTimeout(()=> div.remove(), 4200);
}

function openModal(title, html){
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = html;
  $("modal").classList.add("show");
}
function closeModal(){
  $("modal").classList.remove("show");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// ====== Sources open-data ======
async function getFXLatest() {
  const url = "https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,JPY,CHF,CAD,AUD";
  return await fetchJson(url, { cacheKey:"fx:latest" });
}
async function getFXHistEURUSD(days=14){
  const latest = await getFXLatest();
  const end = latest.date;
  const start = new Date(end); start.setDate(start.getDate()-days);
  const s = start.toISOString().slice(0,10);
  const url = `https://api.frankfurter.app/${s}..${end}?from=EUR&to=USD`;
  return await fetchJson(url, { cacheKey:`fx:hist:${s}:${end}` });
}
async function getCryptoSpot() {
  const url = "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum,solana,cardano,ripple,chainlink,polkadot" +
    "&vs_currencies=usd,eur&include_24hr_change=true";
  return await fetchJson(url, { cacheKey:"cg:spot" });
}
async function getCryptoChart(coinId, days = 30) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  return await fetchJson(url, { cacheKey:`cg:${coinId}:${days}` });
}
async function getNews(query) {
  const q = encodeURIComponent(query);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&maxrecords=14&sort=HybridRel`;
  return await fetchJson(url, { cacheKey:`gdelt:${query}` });
}

// ====== Charts ======
function drawSparkline(canvas, points, accentCss) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let i=1;i<=3;i++){
    ctx.beginPath();
    ctx.moveTo(0, (h*i)/4);
    ctx.lineTo(w, (h*i)/4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const ys = points.map(p => p[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 6;

  const xScale = (i) => pad + (i*(w-2*pad))/(points.length-1);
  const yScale = (y) => {
    if (maxY === minY) return h/2;
    return h - pad - ((y - minY) * (h - 2*pad)) / (maxY - minY);
  };

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xScale(i);
    const y = yScale(p[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xScale(points.length-1), h-pad);
  ctx.lineTo(xScale(0), h-pad);
  ctx.closePath();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = accentCss;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xScale(i);
    const y = yScale(p[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accentCss;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function realizedVol(prices) {
  const rets = [];
  for (let i=1;i<prices.length;i++){
    const r = Math.log(prices[i]/prices[i-1]);
    if (isFinite(r)) rets.push(r);
  }
  if (rets.length < 3) return 0;
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const varr = rets.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(rets.length-1);
  const dailyVol = Math.sqrt(Math.max(varr,0));
  return dailyVol * Math.sqrt(365);
}

function accentCss(){
  const st = getComputedStyle(document.body);
  const r = st.getPropertyValue("--accent-r").trim();
  const g = st.getPropertyValue("--accent-g").trim();
  const b = st.getPropertyValue("--accent-b").trim();
  return `rgb(${r}, ${g}, ${b})`;
}

// ====== Render helpers ======
function setPanelTitles(t1,m1,t2,m2,t3,m3,t4,m4){
  $("p1t").textContent = t1; $("p1m").textContent = m1;
  $("p2t").textContent = t2; $("p2m").textContent = m2;
  $("p3t").textContent = t3; $("p3m").textContent = m3;
  $("p4t").textContent = t4; $("p4m").textContent = m4;
  $("p5t").textContent = "Snapshot"; $("p5m").textContent = "KPIs";
  $("p6t").textContent = "Console"; $("p6m").textContent = "events";
}

function renderTable(headers, rows){
  const th = headers.map(h=>`<th>${h}</th>`).join("");
  const tr = rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table class="tbl"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function fmtPct(x){
  if (x == null || !isFinite(x)) return "—";
  const s = (x>=0?"+":"") + x.toFixed(2) + "%";
  return x>=0 ? `<span class="pos">${s}</span>` : `<span class="neg">${s}</span>`;
}

function renderNewsList(articles, limit=10){
  const arts = (articles || []).slice(0,limit);
  return `<div class="news">` + arts.map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>
      <div class="meta"><span>${escapeHtml(a.sourceCountry || "—")}</span><span>•</span><span>${escapeHtml(a.seendate || "")}</span></div>
    </div>
  `).join("") + `</div>`;
}

// ====== Watchlist ======
function renderWatchlist(){
  const box = $("wlBody");
  box.innerHTML = "";

  const fx = state.wlFx.map(p => ({ type:"FX", key:p }));
  const cr = state.wlCrypto.map(c => ({ type:"CRYPTO", key:c }));
  [...fx, ...cr].forEach(item => {
    const div = document.createElement("div");
    div.className = "wlItem";
    div.innerHTML = `<div><b>${item.type}</b> · ${escapeHtml(item.key)}</div><div class="x" title="Remove">×</div>`;
    div.querySelector(".x").addEventListener("click", ()=>{
      if(item.type==="FX") state.wlFx = state.wlFx.filter(x=>x!==item.key);
      else state.wlCrypto = state.wlCrypto.filter(x=>x!==item.key);
      saveSettings();
      renderWatchlist();
      toast("Watchlist", `Removed ${item.type} ${item.key}`);
    });
    box.appendChild(div);
  });
}

function addFxPrompt(){
  openModal("Add FX", `
    <div class="label">Pair (format: EURUSD, EURGBP, EURJPY…)</div>
    <input class="input" id="mFx" placeholder="EURUSD" />
    <div class="hr"></div>
    <button class="btn primary" id="mOk">Add</button>
  `);
  $("mOk").addEventListener("click", ()=>{
    const v = $("mFx").value.trim().toUpperCase();
    if(!/^[A-Z]{6}$/.test(v)) return toast("FX", "Format attendu: EURUSD");
    if(!state.wlFx.includes(v)) state.wlFx.unshift(v);
    state.wlFx = state.wlFx.slice(0,10);
    saveSettings();
    renderWatchlist();
    closeModal();
    toast("Watchlist", `Added FX ${v}`);
  });
}

function addCryptoPrompt(){
  openModal("Add Crypto", `
    <div class="label">CoinGecko id (ex: bitcoin, ethereum, solana, ripple…)</div>
    <input class="input" id="mC" placeholder="bitcoin" />
    <div class="hr"></div>
    <button class="btn primary" id="mOk">Add</button>
  `);
  $("mOk").addEventListener("click", ()=>{
    const v = $("mC").value.trim().toLowerCase();
    if(!/^[a-z0-9-]{3,}$/.test(v)) return toast("Crypto", "Id invalide");
    if(!state.wlCrypto.includes(v)) state.wlCrypto.unshift(v);
    state.wlCrypto = state.wlCrypto.slice(0,10);
    saveSettings();
    renderWatchlist();
    closeModal();
    toast("Watchlist", `Added Crypto ${v}`);
  });
}

// ====== Console panel ======
function renderConsole(){
  const b = $("p6b");
  const rows = state.console.slice(0,16).map(x => [x.ts, x.msg]);
  b.innerHTML = renderTable(["Time","Event"], rows);
}

// ====== Snapshot panel ======
function renderSnapshot({ fx, crypto, newsCount, vol }){
  const b = $("p5b");
  const rows = [
    ["FX", `EURUSD ${fx?.rates?.USD?.toFixed?.(4) ?? "—"}`, "Frankfurter"],
    ["Crypto", `BTC $${crypto?.bitcoin?.usd ? Math.round(crypto.bitcoin.usd).toLocaleString("fr-FR") : "—"}`, "CoinGecko"],
    ["News", `${newsCount ?? "—"} articles`, "GDELT"],
    ["Vol", `${vol ? (vol*100).toFixed(1)+"%" : "—"}`, "computed"]
  ];
  b.innerHTML = renderTable(["KPI","Value","Source"], rows);
}

// ====== Alerts ======
function checkAlerts(cryptoSpot, btcVol){
  try{
    const a = state.alerts;
    const list = [
      ["BTC", cryptoSpot?.bitcoin?.usd_24h_change],
      ["ETH", cryptoSpot?.ethereum?.usd_24h_change],
      ["SOL", cryptoSpot?.solana?.usd_24h_change],
    ];
    list.forEach(([name, ch])=>{
      if(ch == null) return;
      if(Math.abs(ch) >= a.crypto24hAbs){
        toast("Alert: 24h move", `${name} ${ch.toFixed(2)}%`);
        logEvent(`ALERT 24h ${name} ${ch.toFixed(2)}%`);
      }
    });
    if(btcVol && btcVol >= a.realizedVol){
      toast("Alert: volatility", `BTC vol ${(btcVol*100).toFixed(1)}%`);
      logEvent(`ALERT vol BTC ${(btcVol*100).toFixed(1)}%`);
    }
  }catch{}
}

function alertsModal(){
  openModal("Alerts", `
    <div class="formRow">
      <div>
        <div class="label">Crypto 24h abs threshold (%)</div>
        <input class="input" id="a1" value="${state.alerts.crypto24hAbs}" />
      </div>
      <div>
        <div class="label">Realized vol threshold (ann., ex 0.90 = 90%)</div>
        <input class="input" id="a2" value="${state.alerts.realizedVol}" />
      </div>
    </div>
    <div class="hr"></div>
    <button class="btn primary" id="aSave">Save</button>
  `);
  $("aSave").addEventListener("click", ()=>{
    const v1 = parseFloat($("a1").value);
    const v2 = parseFloat($("a2").value);
    if(!isFinite(v1) || !isFinite(v2)) return toast("Alerts", "Invalid values");
    state.alerts.crypto24hAbs = v1;
    state.alerts.realizedVol = v2;
    saveSettings();
    closeModal();
    toast("Alerts", "Saved");
    logEvent("Alerts updated");
  });
}

// ====== Export CSV ======
function download(filename, text){
  const blob = new Blob([text], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 5000);
}

function exportCSV(){
  // export watchlist + last news query as lightweight export
  const lines = [];
  lines.push(["type","key"].join(","));
  state.wlFx.forEach(x => lines.push(["FX", x].join(",")));
  state.wlCrypto.forEach(x => lines.push(["CRYPTO", x].join(",")));
  lines.push("");
  lines.push(["news_query", `"${state.newsQuery.replace(/"/g,'""')}"`].join(","));
  download("quinterminal_export.csv", lines.join("\n"));
  toast("Export", "CSV downloaded");
  logEvent("CSV exported");
}

// ====== Modules render ======
async function renderMarkets(){
  setTheme("markets");
  $("tabTitle").textContent = "Markets";
  $("tabSubtitle").textContent = "Snapshot open-data (FX/Crypto/News)";
  setPanelTitles("Watchlist", "FX+Crypto", "Chart", "BTC 30d", "Signals", "computed", "News", "GDELT");

  $("p1b").innerHTML = skel("Loading FX + Crypto…");
  $("p2b").innerHTML = skel("Loading chart…");
  $("p3b").innerHTML = skel("Computing signals…");
  $("p4b").innerHTML = skel("Loading news…");
  $("p5b").innerHTML = skel("Snapshot…");
  $("p6b").innerHTML = skel("Console…");

  const [fx, crypto, news, btc] = await Promise.all([
    getFXLatest(),
    getCryptoSpot(),
    getNews(state.newsQuery),
    getCryptoChart("bitcoin", 30)
  ]);

  // P1 watchlist display from API
  const fxRows = Object.entries(fx.rates).map(([k,v]) => ([`EUR${k}`, v.toFixed(4), "—", "FX"]));
  const c = crypto;
  const cryptoRows = [
    ["BTC", c.bitcoin?.usd, c.bitcoin?.usd_24h_change],
    ["ETH", c.ethereum?.usd, c.ethereum?.usd_24h_change],
    ["SOL", c.solana?.usd, c.solana?.usd_24h_change],
    ["XRP", c.ripple?.usd, c.ripple?.usd_24h_change],
    ["ADA", c.cardano?.usd, c.cardano?.usd_24h_change],
  ].map(([sym, px, ch]) => ([sym, px ? `$${Math.round(px).toLocaleString("fr-FR")}` : "—", fmtPct(ch ?? NaN), "Crypto"]));

  $("p1b").innerHTML =
    `<div class="muted tiny" style="margin-bottom:8px">FX (Frankfurter) + Crypto (CoinGecko)</div>` +
    renderTable(["Sym", "Last", "Chg", "Class"], [...fxRows.slice(0,4), ...cryptoRows.slice(0,4)]);

  // P2 chart BTC
  const prices = (btc.prices || []).slice(-120);
  $("p2b").innerHTML = `<div class="canvasWrap">
    <canvas id="c1" width="780" height="240"></canvas>
    <div class="muted tiny" style="margin-top:6px">BTCUSD 30d (CoinGecko)</div>
  </div>`;
  drawSparkline($("c1"), prices, accentCss());

  // P3 signals
  const vol = realizedVol(prices.map(p=>p[1]));
  $("p3b").innerHTML = renderTable(
    ["Signal","Value","Comment"],
    [
      ["BTC Realized Vol (ann.)", `<span class="pos">${(vol*100).toFixed(1)}%</span>`, "log-returns (30d)"],
      ["FX EURUSD", fx.rates.USD.toFixed(4), "ECB ref via Frankfurter"],
      ["News Query", escapeHtml(state.newsQuery), "GDELT"]
    ]
  );

  // P4 news
  $("p4b").innerHTML = renderNewsList(news.articles, 10);

  // P5 snapshot
  renderSnapshot({ fx, crypto, newsCount: (news.articles||[]).length, vol });

  // P6 console
  logEvent(`Markets refreshed · query="${state.newsQuery}"`);
  renderConsole();

  // alerts
  checkAlerts(crypto, vol);

  setDataState(true, "ok");
}

async function renderFX(){
  setTheme("fx");
  $("tabTitle").textContent = "FX";
  $("tabSubtitle").textContent = "Frankfurter (ECB) rates · majors";
  setPanelTitles("Majors", "Frankfurter", "Chart", "EURUSD 14d", "Cross", "computed", "News", "GDELT");

  ["p1b","p2b","p3b","p4b","p5b"].forEach(id => $(id).innerHTML = skel());

  const [fx, hist, news] = await Promise.all([
    getFXLatest(),
    getFXHistEURUSD(14),
    getNews("forex OR eurusd OR central bank")
  ]);

  const rows = Object.entries(fx.rates).map(([k,v]) => ([`EUR/${k}`, v.toFixed(4), "ECB ref.", "—"]));
  $("p1b").innerHTML = renderTable(["Pair","Rate","Source","Note"], rows);

  const pts = Object.entries(hist.rates).map(([d,obj]) => [d, obj.USD]).slice(-90);
  $("p2b").innerHTML = `<div class="canvasWrap">
    <canvas id="cfx" width="780" height="240"></canvas>
    <div class="muted tiny" style="margin-top:6px">EURUSD 14d (Frankfurter)</div>
  </div>`;
  drawSparkline($("cfx"), pts, accentCss());

  $("p3b").innerHTML = renderTable(
    ["Cross","Rate","Comment"],
    [
      ["EURUSD", fx.rates.USD.toFixed(4), "spot ref."],
      ["EURJPY", fx.rates.JPY.toFixed(2), "spot ref."],
      ["EURGBP", fx.rates.GBP.toFixed(4), "spot ref."]
    ]
  );

  $("p4b").innerHTML = renderNewsList(news.articles, 10);
  renderSnapshot({ fx, crypto:null, newsCount:(news.articles||[]).length, vol:null });

  logEvent("FX refreshed");
  setDataState(true, "ok");
}

async function renderCrypto(){
  setTheme("crypto");
  $("tabTitle").textContent = "Crypto";
  $("tabSubtitle").textContent = "CoinGecko spot · 24h change";
  setPanelTitles("Spot", "CoinGecko", "Chart", "BTC 30d", "Vol", "computed", "News", "GDELT");

  ["p1b","p2b","p3b","p4b","p5b"].forEach(id => $(id).innerHTML = skel());

  const [spot, btc, news] = await Promise.all([
    getCryptoSpot(),
    getCryptoChart("bitcoin", 30),
    getNews("crypto OR bitcoin OR ethereum")
  ]);

  const c = spot;
  const rows = [
    ["BTC", c.bitcoin?.usd, c.bitcoin?.usd_24h_change],
    ["ETH", c.ethereum?.usd, c.ethereum?.usd_24h_change],
    ["SOL", c.solana?.usd, c.solana?.usd_24h_change],
    ["XRP", c.ripple?.usd, c.ripple?.usd_24h_change],
    ["ADA", c.cardano?.usd, c.cardano?.usd_24h_change],
    ["LINK", c.chainlink?.usd, c.chainlink?.usd_24h_change],
    ["DOT", c.polkadot?.usd, c.polkadot?.usd_24h_change],
  ].map(([sym, px, ch]) => ([sym, px ? `$${Math.round(px).toLocaleString("fr-FR")}` : "—", fmtPct(ch ?? NaN)]));

  $("p1b").innerHTML = renderTable(["Asset","Last","24h"], rows) +
    `<div class="muted tiny" style="margin-top:8px">Powered by CoinGecko API (attribution recommandé).</div>`;

  const prices = (btc.prices||[]).slice(-120);
  $("p2b").innerHTML = `<div class="canvasWrap">
    <canvas id="cbtc" width="780" height="240"></canvas>
    <div class="muted tiny" style="margin-top:6px">BTCUSD 30d (CoinGecko)</div>
  </div>`;
  drawSparkline($("cbtc"), prices, accentCss());

  const vol = realizedVol(prices.map(p=>p[1]));
  $("p3b").innerHTML = renderTable(
    ["Metric","Value","Note"],
    [
      ["BTC Realized Vol (ann.)", `<span class="pos">${(vol*100).toFixed(1)}%</span>`, "log-returns (30d)"],
      ["Cache", `${(CACHE_MS/1000)|0}s`, "anti rate-limit"],
      ["CORS fallback", "auto proxy", "GitHub Pages friendly"]
    ]
  );

  $("p4b").innerHTML = renderNewsList(news.articles, 10);
  renderSnapshot({ fx:null, crypto:spot, newsCount:(news.articles||[]).length, vol });

  logEvent("Crypto refreshed");
  checkAlerts(spot, vol);
  setDataState(true, "ok");
}

async function renderVol(){
  setTheme("vol");
  $("tabTitle").textContent = "Vol";
  $("tabSubtitle").textContent = "Realized vol (crypto) · stress";
  setPanelTitles("Realized Vol", "computed", "Chart", "BTC spark", "Stress", "rules", "News", "GDELT");

  ["p1b","p2b","p3b","p4b","p5b"].forEach(id => $(id).innerHTML = skel());

  const [btc, eth, news, spot] = await Promise.all([
    getCryptoChart("bitcoin", 30),
    getCryptoChart("ethereum", 30),
    getNews("volatility OR risk-off OR selloff OR fear"),
    getCryptoSpot()
  ]);

  const b = btc.prices.slice(-120).map(p=>p[1]);
  const e = eth.prices.slice(-120).map(p=>p[1]);
  const vb = realizedVol(b);
  const ve = realizedVol(e);

  $("p1b").innerHTML = renderTable(
    ["Asset","Realized Vol (ann.)","Comment"],
    [
      ["BTC", `<span class="pos">${(vb*100).toFixed(1)}%</span>`, "30d realized"],
      ["ETH", `<span class="pos">${(ve*100).toFixed(1)}%</span>`, "30d realized"]
    ]
  );

  const pts = btc.prices.slice(-120).map(p=>[p[0], p[1]]);
  $("p2b").innerHTML = `<div class="canvasWrap">
    <canvas id="cvol" width="780" height="240"></canvas>
    <div class="muted tiny" style="margin-top:6px">BTC (spark)</div>
  </div>`;
  drawSparkline($("cvol"), pts, accentCss());

  const stress = (vb > 0.90 || ve > 1.00) ? "HIGH" : (vb > 0.70 ? "MED" : "LOW");
  const stressClass = stress === "HIGH" ? "neg" : "pos";
  $("p3b").innerHTML = renderTable(
    ["Rule","State","Note"],
    [
      ["Stress", `<span class="${stressClass}">${stress}</span>`, "threshold-based"],
      ["BTC 24h", fmtPct(spot.bitcoin?.usd_24h_change ?? NaN), "spot move"],
      ["ETH 24h", fmtPct(spot.ethereum?.usd_24h_change ?? NaN), "spot move"]
    ]
  );

  $("p4b").innerHTML = renderNewsList(news.articles, 10);
  renderSnapshot({ fx:null, crypto:spot, newsCount:(news.articles||[]).length, vol:vb });

  logEvent("Vol refreshed");
  checkAlerts(spot, vb);
  setDataState(true, "ok");
}

async function renderNews(query){
  setTheme("news");
  state.newsQuery = query || state.newsQuery || "finance OR markets";
  saveSettings();

  $("tabTitle").textContent = "News";
  $("tabSubtitle").textContent = `GDELT query: ${state.newsQuery}`;
  setPanelTitles("Query", "CMD", "Headlines", "GDELT", "Domains", "basic", "More", "open");

  $("p1b").innerHTML = `
    <div class="muted tiny">
      Requête active: <b>${escapeHtml(state.newsQuery)}</b>
    </div>
    <div class="hr"></div>
    <div class="muted tiny">CMD: <b>NEWS shipping</b> / <b>NEWS inflation</b> / <b>NEWS central bank</b></div>
  `;

  const data = await getNews(state.newsQuery);
  const arts = (data.articles || []).slice(0,14);

  $("p2b").innerHTML = renderNewsList(arts, 7);

  const domains = {};
  arts.forEach(a=>{
    try{
      const u = new URL(a.url);
      const d = u.hostname.replace(/^www\./,"");
      domains[d] = (domains[d]||0)+1;
    }catch{}
  });
  const top = Object.entries(domains).sort((a,b)=>b[1]-a[1]).slice(0,10);
  $("p3b").innerHTML = renderTable(["Domain","Count"], top.map(([d,c])=>[d, c]));

  $("p4b").innerHTML = renderNewsList(arts.slice(7), 7);

  renderSnapshot({ fx:await getFXLatest(), crypto:await getCryptoSpot(), newsCount:arts.length, vol:null });

  logEvent(`News refreshed · query="${state.newsQuery}"`);
  setDataState(true, "ok");
}

function initMaritimeMap(){
  if (state.maritimeMap) return;

  const el = document.createElement("div");
  el.id = "mapMaritime";
  $("p2b").innerHTML = "";
  $("p2b").appendChild(el);

  state.maritimeMap = L.map("mapMaritime", { zoomControl:true }).setView([20, 15], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.maritimeMap);

  const pts = [
    { n:"Suez", c:[30.0, 32.5] },
    { n:"Bab-el-Mandeb", c:[12.6, 43.3] },
    { n:"Hormuz", c:[26.6, 56.2] },
    { n:"Malacca", c:[2.5, 101.0] },
    { n:"Panama", c:[9.1, -79.7] },
    { n:"Gibraltar", c:[36.0, -5.6] }
  ];
  pts.forEach(p => L.circleMarker(p.c, { radius:8, weight:2, opacity:1, fillOpacity:.22 })
    .addTo(state.maritimeMap).bindPopup(p.n));
}

async function renderMaritime(){
  setTheme("maritime");
  $("tabTitle").textContent = "Maritime";
  $("tabSubtitle").textContent = "Chokepoints map + shipping news";
  setPanelTitles("Shipping", "GDELT", "Map", "OSM", "Chokepoints", "static", "Geo news", "GDELT");

  ["p1b","p2b","p3b","p4b","p5b"].forEach(id => $(id).innerHTML = skel());

  const [ship, geo] = await Promise.all([
    getNews("shipping OR maritime OR container OR freight rates"),
    getNews("suez OR hormuz OR malacca OR panama canal OR bab el mandeb")
  ]);

  $("p1b").innerHTML = renderNewsList(ship.articles, 10);
  initMaritimeMap();

  $("p3b").innerHTML = renderTable(
    ["Chokepoint","Impact"],
    [
      ["Suez", "Med/High"],
      ["Hormuz", "High"],
      ["Malacca", "High"],
      ["Panama", "Med"],
      ["Bab-el-Mandeb", "High"],
      ["Gibraltar", "Low/Med"]
    ]
  );

  $("p4b").innerHTML = renderNewsList(geo.articles, 10);
  renderSnapshot({ fx:await getFXLatest(), crypto:await getCryptoSpot(), newsCount:(ship.articles||[]).length + (geo.articles||[]).length, vol:null });

  logEvent("Maritime refreshed");
  setDataState(true, "ok");
}

// ====== Router ======
async function go(tab){
  state.tab = tab;
  saveSettings();
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));

  setDataState(true, "loading…");
  $("p6b").innerHTML = skel("Console…");
  renderConsole();

  try{
    if(tab==="markets") await renderMarkets();
    if(tab==="fx") await renderFX();
    if(tab==="crypto") await renderCrypto();
    if(tab==="vol") await renderVol();
    if(tab==="news") await renderNews(state.newsQuery);
    if(tab==="macro") await renderNews("inflation OR central bank OR recession"); // simple macro pack
    if(tab==="maritime") await renderMaritime();
  }catch(e){
    console.error(e);
    setDataState(false, "error");
    ["p1b","p2b","p3b","p4b","p5b","p6b"].forEach(id=>{
      const el = $(id);
      if(el) el.innerHTML = `<div class="skel">Erreur: ${escapeHtml(e.message || String(e))}</div>`;
    });
    logEvent(`ERROR: ${e.message || e}`);
    toast("Error", e.message || String(e));
  }
}

// ====== CMD palette ======
function showSug(list){
  const box = $("cmdSug");
  if (!list.length){ box.classList.remove("show"); return; }
  box.innerHTML = list.map(s=>`<button type="button" data-v="${escapeHtml(s)}"><span>${escapeHtml(s)}</span><span class="hint">↵</span></button>`).join("");
  box.classList.add("show");
  box.querySelectorAll("button").forEach(b=>{
    b.addEventListener("click", ()=>{
      $("cmdInput").value = b.dataset.v;
      $("cmdInput").focus();
      box.classList.remove("show");
    });
  });
}

function parseCmd(s){
  const raw = s.trim();
  if (!raw) return null;
  const [cmd, ...rest] = raw.split(/\s+/);
  return { cmd: cmd.toUpperCase(), arg: rest.join(" ") };
}

async function runCmd(raw){
  const p = parseCmd(raw);
  if(!p) return;

  const c = p.cmd;
  const a = p.arg;

  if(c==="HELP"){
    toast("Help", "Try: NEWS shipping · FX · CRYPTO · LAYOUT hex · AUTO 30");
    openModal("HELP", `
      <div class="skel">
        <b>Commands</b><br><br>
        <b>NEWS &lt;query&gt;</b> — change news query<br>
        <b>FX</b> — switch to FX<br>
        <b>CRYPTO</b> — switch to crypto<br>
        <b>VOL</b> — switch to volatility<br>
        <b>MARITIME</b> — maritime module<br><br>
        <b>LAYOUT quad|hex|focus</b><br>
        <b>DENSITY compact|comfort</b><br>
        <b>AUTO off|30|60|120</b><br>
        <b>EXPORT</b> — download CSV<br>
        <b>THEME markets|vol|fx|crypto|macro|news|maritime</b>
      </div>
    `);
    return;
  }

  if(c==="NEWS"){ await go("news"); await renderNews(a || "finance OR markets"); return; }
  if(c==="FX"){ await go("fx"); return; }
  if(c==="CRYPTO"){ await go("crypto"); return; }
  if(c==="VOL"){ await go("vol"); return; }
  if(c==="MARITIME"){ await go("maritime"); return; }
  if(c==="EXPORT"){ exportCSV(); return; }

  if(c==="LAYOUT"){
    const v = (a||"").trim().toLowerCase();
    if(["quad","hex","focus"].includes(v)){
      setLayout(v);
      toast("Layout", v);
      logEvent(`Layout -> ${v}`);
    } else {
      toast("Layout", "Use: quad | hex | focus");
    }
    return;
  }

  if(c==="DENSITY"){
    const v = (a||"").trim().toLowerCase();
    if(["compact","comfort"].includes(v)){
      setDensity(v);
      toast("Density", v);
      logEvent(`Density -> ${v}`);
    } else {
      toast("Density", "Use: compact | comfort");
    }
    return;
  }

  if(c==="AUTO"){
    const v = (a||"").trim().toLowerCase();
    if(v==="off"){ setAuto(0); return; }
    const n = parseInt(v,10);
    if([15,30,60,120,300].includes(n)){ setAuto(n); return; }
    toast("Auto", "Use: off | 30 | 60 | 120");
    return;
  }

  if(c==="THEME"){
    const v = (a||"").trim().toLowerCase();
    if(v){ setTheme(v); toast("Theme", v); }
    return;
  }

  // fallback -> treat as news query
  await go("news");
  await renderNews(raw);
}

function hookCmd(){
  const input = $("cmdInput");

  input.addEventListener("input", ()=>{
    const v = input.value.trim().toLowerCase();
    if(!v) return showSug([]);
    const list = SUG.filter(x => x.toLowerCase().includes(v)).slice(0,10);
    showSug(list);
  });

  input.addEventListener("keydown", async (e)=>{
    if (e.key !== "Enter") return;
    $("cmdSug").classList.remove("show");
    const v = input.value;
    input.value = "";
    await runCmd(v);
  });

  document.addEventListener("click", (e)=>{
    if (!e.target.closest(".cmd")) $("cmdSug").classList.remove("show");
  });

  // Ctrl+K focus palette
  document.addEventListener("keydown", (e)=>{
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="k"){
      e.preventDefault();
      input.focus();
      showSug(SUG.slice(0,10));
    }
  });
}

// ====== Auto refresh ======
function setAuto(sec){
  state.autoSec = sec;
  saveSettings();
  if(state.timers.auto){ clearInterval(state.timers.auto); state.timers.auto = null; }

  if(sec > 0){
    state.timers.auto = setInterval(()=>{
      // pause if tab hidden (avoid waste / rate-limit)
      if(document.hidden) return;
      go(state.tab);
      logEvent(`Auto refresh (${sec}s)`);
    }, sec*1000);
    toast("Auto refresh", `${sec}s`);
    logEvent(`Auto set to ${sec}s`);
  } else {
    toast("Auto refresh", "off");
    logEvent("Auto off");
  }
}

// ====== Settings modal ======
function settingsModal(){
  openModal("Settings", `
    <div class="formRow">
      <div>
        <div class="label">Auto-refresh (sec)</div>
        <input class="input" id="sAuto" value="${state.autoSec}" placeholder="0, 30, 60, 120" />
      </div>
      <div>
        <div class="label">Default news query</div>
        <input class="input" id="sNews" value="${escapeHtml(state.newsQuery)}" />
      </div>
    </div>
    <div class="hr"></div>
    <div class="formRow">
      <div>
        <div class="label">Layout</div>
        <input class="input" id="sLayout" value="${state.layout}" placeholder="quad|hex|focus" />
      </div>
      <div>
        <div class="label">Density</div>
        <input class="input" id="sDensity" value="${state.density}" placeholder="compact|comfort" />
      </div>
    </div>
    <div class="hr"></div>
    <button class="btn primary" id="sSave">Save</button>
  `);

  $("sSave").addEventListener("click", ()=>{
    const auto = parseInt($("sAuto").value, 10);
    const q = $("sNews").value.trim() || DEF.newsQuery;
    const layout = ($("sLayout").value.trim() || "quad").toLowerCase();
    const dens = ($("sDensity").value.trim() || "compact").toLowerCase();

    state.newsQuery = q;
    if(["quad","hex","focus"].includes(layout)) setLayout(layout);
    if(["compact","comfort"].includes(dens)) setDensity(dens);
    if(isFinite(auto) && auto >= 0) setAuto(auto);

    saveSettings();
    closeModal();
    toast("Settings", "Saved");
    logEvent("Settings saved");
  });
}

// ====== Focus buttons ======
function hookFocus(){
  document.querySelectorAll(".iconBtn[data-focus]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.focus;
      if(state.layout !== "focus"){
        setLayout("focus");
      }
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("focused"));
      const el = document.getElementById(id);
      if(el) el.classList.add("focused");
      toast("Focus", id.toUpperCase());
      logEvent(`Focus -> ${id}`);
    });
  });

  // Escape to exit focus
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape" && state.layout === "focus"){
      setLayout("quad");
      toast("Focus", "exit");
      logEvent("Focus exit");
    }
  });
}

// ====== Hotkeys ======
function hotkeys(){
  document.addEventListener("keydown", (e)=>{
    const map = { F1:"markets", F2:"vol", F3:"fx", F4:"crypto", F5:"macro", F6:"news", F8:"maritime" };
    if (!map[e.key]) return;
    e.preventDefault();
    go(map[e.key]);
  });

  // Ctrl+R refresh
  document.addEventListener("keydown", (e)=>{
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==="r"){
      e.preventDefault();
      go(state.tab);
      toast("Refresh", state.tab);
      logEvent("Manual refresh");
    }
  });
}

// ====== Boot ======
function boot(){
  clock();
  setLayout(state.layout);
  setDensity(state.density);

  // nav
  $("nav").addEventListener("click", (e)=>{
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    go(b.dataset.tab);
  });

  // buttons
  $("refreshBtn").addEventListener("click", ()=> go(state.tab));
  $("layoutBtn").addEventListener("click", ()=>{
    const next = state.layout === "quad" ? "hex" : (state.layout === "hex" ? "quad" : "quad");
    setLayout(next);
    toast("Layout", next);
  });
  $("densityBtn").addEventListener("click", ()=>{
    const next = state.density === "compact" ? "comfort" : "compact";
    setDensity(next);
    toast("Density", next);
  });
  $("settingsBtn").addEventListener("click", settingsModal);

  // modal
  $("modalClose").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e)=>{ if(e.target.id==="modal") closeModal(); });

  // watchlist buttons
  $("wlAddFx").addEventListener("click", addFxPrompt);
  $("wlAddCrypto").addEventListener("click", addCryptoPrompt);
  $("wlClear").addEventListener("click", ()=>{
    state.wlFx = [...DEF.wlFx];
    state.wlCrypto = [...DEF.wlCrypto];
    saveSettings();
    renderWatchlist();
    toast("Watchlist", "Reset");
    logEvent("Watchlist reset");
  });

  $("exportBtn").addEventListener("click", exportCSV);
  $("alertsBtn").addEventListener("click", alertsModal);

  hookCmd();
  hotkeys();
  hookFocus();

  renderWatchlist();
  showSug(SUG.slice(0,10));
  setTimeout(()=> $("cmdSug").classList.remove("show"), 2000);

  // auto-refresh
  if(state.autoSec > 0) setAuto(state.autoSec);

  // start tab
  go(state.tab || "markets");
}

document.addEventListener("DOMContentLoaded", boot);
