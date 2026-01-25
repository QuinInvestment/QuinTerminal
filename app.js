// ---------- Utils ----------
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, { timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
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

function clock() {
  const el = $("clock");
  const tick = () => el.textContent = new Date().toLocaleTimeString("fr-FR", { hour12:false });
  tick(); setInterval(tick, 1000);
}

// ---------- Open data sources (commercial-OK) ----------
/*
  GDELT: unlimited + unrestricted commercial use (see GDELT terms)   [oai_citation:3‡gdeltproject.org](https://www.gdeltproject.org/about.html?utm_source=chatgpt.com)
  Frankfurter: open-source MIT, public API, ECB reference rates        [oai_citation:4‡Frankfurter](https://frankfurter.dev/?utm_source=chatgpt.com)
  CoinGecko: commercial allowed w/ attribution + API ToS/limits        [oai_citation:5‡CoinGecko](https://www.coingecko.com/en/faq?utm_source=chatgpt.com)
*/

async function getFX() {
  // Frankfurter (EUR base by default; supports base & symbols)
  const url = "https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,JPY,CHF,CAD,AUD";
  return await fetchJson(url);
}

async function getCrypto() {
  const url = "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin,ethereum,solana,cardano,ripple" +
    "&vs_currencies=usd,eur&include_24hr_change=true";
  return await fetchJson(url);
}

async function getCryptoMarketChart(coinId, days = 30) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  return await fetchJson(url);
}

async function getNews(query) {
  // GDELT Doc 2.1
  const q = encodeURIComponent(query);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&maxrecords=10&sort=HybridRel`;
  return await fetchJson(url);
}

// ---------- Charts ----------
function drawSparkline(canvas, points, accent = "#3da9ff") {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // grid
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

  // area
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
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;

  // line
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xScale(i);
    const y = yScale(p[1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function realizedVol(prices) {
  // annualized realized vol from daily log returns
  const rets = [];
  for (let i=1;i<prices.length;i++){
    const r = Math.log(prices[i]/prices[i-1]);
    if (isFinite(r)) rets.push(r);
  }
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const varr = rets.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(rets.length-1 || 1);
  const dailyVol = Math.sqrt(varr);
  return dailyVol * Math.sqrt(365);
}

// ---------- Render helpers ----------
function setPanelTitles(t1,m1,t2,m2,t3,m3,t4,m4){
  $("p1t").textContent = t1; $("p1m").textContent = m1;
  $("p2t").textContent = t2; $("p2m").textContent = m2;
  $("p3t").textContent = t3; $("p3m").textContent = m3;
  $("p4t").textContent = t4; $("p4m").textContent = m4;
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

// ---------- Modules ----------
const TABS = {
  markets: { title:"Markets", sub:"Snapshot open-data (FX/Crypto/News)" },
  vol: { title:"Vol", sub:"Realized vol (crypto) · stress" },
  fx: { title:"FX", sub:"Frankfurter (ECB) rates · majors" },
  crypto: { title:"Crypto", sub:"CoinGecko spot · 24h change" },
  macro: { title:"Macro", sub:"GDELT signals · thematic counts" },
  news: { title:"News", sub:"GDELT top stories · queryable" },
  aviation: { title:"Aviation", sub:"GDELT aviation/airline news" },
  maritime: { title:"Maritime", sub:"Map chokepoints + shipping news (GDELT)" }
};

async function renderMarkets(){
  setTheme("markets");
  $("tabTitle").textContent = TABS.markets.title;
  $("tabSubtitle").textContent = TABS.markets.sub;

  setPanelTitles("Watchlist", "FX+Crypto", "Chart", "spark", "Signals", "computed", "News", "GDELT");

  const [fx, crypto, news] = await Promise.all([
    getFX(), getCrypto(), getNews("finance OR markets OR stocks")
  ]);

  // P1 watchlist
  const fxRows = Object.entries(fx.rates).map(([k,v]) => ([
    `EUR${k}`, v.toFixed(4), "—", "FX"
  ]));
  const c = crypto;
  const mapCrypto = [
    ["BTC", c.bitcoin.usd, c.bitcoin.usd_24h_change],
    ["ETH", c.ethereum.usd, c.ethereum.usd_24h_change],
    ["SOL", c.solana.usd, c.solana.usd_24h_change],
    ["XRP", c.ripple.usd, c.ripple.usd_24h_change],
    ["ADA", c.cardano.usd, c.cardano.usd_24h_change],
  ].map(([sym, px, ch]) => ([
    sym, `$${Math.round(px).toLocaleString("fr-FR")}`, fmtPct(ch), "Crypto"
  ]));

  $("p1b").innerHTML =
    `<div class="muted tiny" style="margin-bottom:8px">FX (Frankfurter) + Crypto (CoinGecko)</div>` +
    renderTable(["Sym", "Last", "Chg", "Class"], [...fxRows.slice(0,4), ...mapCrypto.slice(0,4)]);

  // P2 chart (BTC 30d)
  const mc = await getCryptoMarketChart("bitcoin", 30);
  const prices = mc.prices.slice(-90); // subset
  const canvas = `<div class="canvasWrap"><canvas id="c1" width="780" height="240"></canvas><div class="muted tiny" style="margin-top:6px">BTCUSD 30d (CoinGecko)</div></div>`;
  $("p2b").innerHTML = canvas;
  drawSparkline($("c1"), prices, getComputedStyle(document.body).getPropertyValue("--accent").trim() || "#3da9ff");

  // P3 signals
  const vol = realizedVol(prices.map(p=>p[1]));
  const volPct = (vol*100).toFixed(1) + "%";
  $("p3b").innerHTML = renderTable(
    ["Signal","Value","Comment"],
    [
      ["BTC Realized Vol (ann.)", `<span class="pos">${volPct}</span>`, "volatilité réalisée (log-returns)"],
      ["FX EURUSD", fx.rates.USD.toFixed(4), "taux ECB via Frankfurter"],
      ["News Pulse", "LIVE", "GDELT top stories"]
    ]
  );

  // P4 news
  const arts = (news.articles || []).slice(0,7);
  $("p4b").innerHTML = `<div class="news">` + arts.map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
      <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
    </div>
  `).join("") + `</div>`;

  setDataState(true, "ok");
}

async function renderFX(){
  setTheme("fx");
  $("tabTitle").textContent = TABS.fx.title;
  $("tabSubtitle").textContent = TABS.fx.sub;

  setPanelTitles("Majors", "Frankfurter", "Chart", "EURUSD", "Cross", "computed", "News", "GDELT");

  const [fx, news] = await Promise.all([
    getFX(),
    getNews("forex OR eurusd OR central bank")
  ]);

  const rows = Object.entries(fx.rates).map(([k,v]) => ([
    `EUR/${k}`, v.toFixed(4), "ECB ref.", "—"
  ]));
  $("p1b").innerHTML = renderTable(["Pair","Rate","Source","Note"], rows);

  // pseudo chart: synth series (Frankfurter fournit historique via /{date}..)
  // On fait un mini historique 14j en parallèle
  const end = fx.date;
  const urlHist = `https://api.frankfurter.app/` + end + `?from=EUR&to=USD&amount=1`;
  await fetchJson(urlHist); // warm
  const start = new Date(end);
  start.setDate(start.getDate()-14);
  const s = start.toISOString().slice(0,10);
  const hist = await fetchJson(`https://api.frankfurter.app/${s}..${end}?from=EUR&to=USD`);
  const pts = Object.entries(hist.rates).map(([d,obj]) => [d, obj.USD]).slice(-60);

  $("p2b").innerHTML = `<div class="canvasWrap"><canvas id="cfx" width="780" height="240"></canvas><div class="muted tiny" style="margin-top:6px">EURUSD 14j (Frankfurter)</div></div>`;
  drawSparkline($("cfx"), pts, getComputedStyle(document.body).getPropertyValue("--accent").trim());

  $("p3b").innerHTML = renderTable(
    ["Cross","Rate","Comment"],
    [
      ["EURUSD", fx.rates.USD.toFixed(4), "spot ref."],
      ["EURJPY", fx.rates.JPY.toFixed(2), "spot ref."],
      ["EURGBP", fx.rates.GBP.toFixed(4), "spot ref."]
    ]
  );

  const arts = (news.articles || []).slice(0,7);
  $("p4b").innerHTML = `<div class="news">` + arts.map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
      <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
    </div>
  `).join("") + `</div>`;

  setDataState(true, "ok");
}

async function renderCrypto(){
  setTheme("crypto");
  $("tabTitle").textContent = TABS.crypto.title;
  $("tabSubtitle").textContent = TABS.crypto.sub;

  setPanelTitles("Spot", "CoinGecko", "Chart", "BTCUSD", "Vol", "computed", "News", "GDELT");

  const [crypto, news, mc] = await Promise.all([
    getCrypto(),
    getNews("crypto OR bitcoin OR ethereum"),
    getCryptoMarketChart("bitcoin", 30)
  ]);

  const c = crypto;
  const rows = [
    ["BTC", `$${Math.round(c.bitcoin.usd).toLocaleString("fr-FR")}`, fmtPct(c.bitcoin.usd_24h_change)],
    ["ETH", `$${Math.round(c.ethereum.usd).toLocaleString("fr-FR")}`, fmtPct(c.ethereum.usd_24h_change)],
    ["SOL", `$${Math.round(c.solana.usd).toLocaleString("fr-FR")}`, fmtPct(c.solana.usd_24h_change)],
    ["XRP", `$${(c.ripple.usd).toFixed(3)}`, fmtPct(c.ripple.usd_24h_change)],
    ["ADA", `$${(c.cardano.usd).toFixed(3)}`, fmtPct(c.cardano.usd_24h_change)],
  ];
  $("p1b").innerHTML = renderTable(["Asset","Last","24h"], rows) +
    `<div class="muted tiny" style="margin-top:8px">Attribution recommandée: “Powered by CoinGecko API”.</div>`;

  const prices = mc.prices.slice(-90);
  $("p2b").innerHTML = `<div class="canvasWrap"><canvas id="cbtc" width="780" height="240"></canvas><div class="muted tiny" style="margin-top:6px">BTCUSD 30d (CoinGecko)</div></div>`;
  drawSparkline($("cbtc"), prices, getComputedStyle(document.body).getPropertyValue("--accent").trim());

  const vol = realizedVol(prices.map(p=>p[1]));
  $("p3b").innerHTML = renderTable(
    ["Metric","Value","Note"],
    [
      ["BTC Realized Vol (ann.)", `<span class="pos">${(vol*100).toFixed(1)}%</span>`, "log-returns"],
      ["Data", "CoinGecko", "rate-limit selon plan"],
      ["FX ref", "Frankfurter", "ECB reference"]
    ]
  );

  const arts = (news.articles || []).slice(0,7);
  $("p4b").innerHTML = `<div class="news">` + arts.map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
      <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
    </div>
  `).join("") + `</div>`;

  setDataState(true, "ok");
}

async function renderVol(){
  setTheme("vol");
  $("tabTitle").textContent = TABS.vol.title;
  $("tabSubtitle").textContent = TABS.vol.sub;

  setPanelTitles("Vol surface", "computed", "Chart", "BTC/ETH", "Stress", "rules", "News", "GDELT");

  const [btc, eth, news] = await Promise.all([
    getCryptoMarketChart("bitcoin", 30),
    getCryptoMarketChart("ethereum", 30),
    getNews("volatility OR risk-off OR selloff OR fear")
  ]);

  const b = btc.prices.slice(-90).map(p=>p[1]);
  const e = eth.prices.slice(-90).map(p=>p[1]);

  const vb = realizedVol(b);
  const ve = realizedVol(e);

  $("p1b").innerHTML = renderTable(
    ["Asset","Realized Vol (ann.)","Comment"],
    [
      ["BTC", `<span class="pos">${(vb*100).toFixed(1)}%</span>`, "30d realized"],
      ["ETH", `<span class="pos">${(ve*100).toFixed(1)}%</span>`, "30d realized"]
    ]
  );

  $("p2b").innerHTML = `<div class="canvasWrap"><canvas id="cvol" width="780" height="240"></canvas><div class="muted tiny" style="margin-top:6px">BTC vs ETH (spark)</div></div>`;
  // combine normalized series
  const pts = btc.prices.slice(-90).map((p,i)=>[p[0], p[1]/b[0]*100]);
  drawSparkline($("cvol"), pts, getComputedStyle(document.body).getPropertyValue("--accent").trim());

  const stress = (vb > 0.8 || ve > 0.9) ? "HIGH" : (vb > 0.6 ? "MED" : "LOW");
  const stressClass = stress === "HIGH" ? "neg" : "pos";
  $("p3b").innerHTML = renderTable(
    ["Rule","State","Note"],
    [
      ["Stress level", `<span class="${stressClass}">${stress}</span>`, "threshold-based"],
      ["Action", "Reduce leverage", "if HIGH"],
      ["Action", "Stick to plan", "if LOW/MED"]
    ]
  );

  const arts = (news.articles || []).slice(0,7);
  $("p4b").innerHTML = `<div class="news">` + arts.map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
      <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
    </div>
  `).join("") + `</div>`;

  setDataState(true, "ok");
}

async function renderNews(query="finance OR markets"){
  setTheme("news");
  $("tabTitle").textContent = TABS.news.title;
  $("tabSubtitle").textContent = `GDELT query: ${query}`;

  setPanelTitles("Query", "CMD", "Headlines", "GDELT", "Clusters", "basic", "Links", "open");

  $("p1b").innerHTML = `
    <div class="muted tiny">Tape une requête dans CMD puis Enter. Ex: <b>NEWS shipping</b> / <b>NEWS aviation</b></div>
    <div class="hr"></div>
    <div class="muted tiny">Exemples: finance, central bank, inflation, shipping, airline</div>
  `;

  const data = await getNews(query);
  const arts = (data.articles || []).slice(0,12);

  $("p2b").innerHTML = `<div class="news">` + arts.slice(0,6).map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
      <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
    </div>
  `).join("") + `</div>`;

  // Basic “clusters” by domain
  const domains = {};
  arts.forEach(a=>{
    try{
      const u = new URL(a.url);
      const d = u.hostname.replace(/^www\./,"");
      domains[d] = (domains[d]||0)+1;
    }catch{}
  });
  const top = Object.entries(domains).sort((a,b)=>b[1]-a[1]).slice(0,8);
  $("p3b").innerHTML = renderTable(["Domain","Count"], top.map(([d,c])=>[d, c]));

  $("p4b").innerHTML = `<div class="news">` + arts.slice(6,12).map(a => `
    <div class="newsItem">
      <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
      <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
    </div>
  `).join("") + `</div>`;

  setDataState(true, "ok");
}

async function renderMacro(){
  setTheme("macro");
  $("tabTitle").textContent = TABS.macro.title;
  $("tabSubtitle").textContent = TABS.macro.sub;

  setPanelTitles("Themes", "GDELT", "Inflation", "news", "Central Banks", "news", "Risk", "news");

  const [inf, cb, risk] = await Promise.all([
    getNews("inflation OR CPI OR prices OR disinflation"),
    getNews("central bank OR ECB OR Fed OR BoE OR BoJ"),
    getNews("risk-off OR recession OR credit spreads OR default")
  ]);

  const block = (data, title) => {
    const arts = (data.articles || []).slice(0,6);
    return `<div class="news">` + arts.map(a => `
      <div class="newsItem">
        <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
        <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
      </div>
    `).join("") + `</div>`;
  };

  $("p1b").innerHTML = `<div class="muted tiny">3 flux thématiques GDELT (macro).</div>`;
  $("p2b").innerHTML = block(inf);
  $("p3b").innerHTML = block(cb);
  $("p4b").innerHTML = block(risk);

  setDataState(true, "ok");
}

async function renderAviation(){
  setTheme("aviation");
  $("tabTitle").textContent = TABS.aviation.title;
  $("tabSubtitle").textContent = TABS.aviation.sub;

  setPanelTitles("Brief", "open", "Airline news", "GDELT", "Airport ops", "GDELT", "Links", "open");

  $("p1b").innerHTML = `
    <div class="muted tiny">
      Données “flight tracking” en temps réel = souvent sous licence. Ici: aviation news (open).
    </div>
  `;

  const [a1, a2] = await Promise.all([
    getNews("aviation OR airline OR airport"),
    getNews("air traffic control OR delays OR airport congestion")
  ]);

  const render = (data) => {
    const arts = (data.articles || []).slice(0,7);
    return `<div class="news">` + arts.map(a => `
      <div class="newsItem">
        <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
        <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
      </div>
    `).join("") + `</div>`;
  };

  $("p2b").innerHTML = render(a1);
  $("p3b").innerHTML = render(a2);
  $("p4b").innerHTML = `
    <div class="muted tiny">CMD exemples: <b>NEWS aviation</b>, <b>NEWS airport delays</b></div>
    <div class="hr"></div>
    <div class="muted tiny">Si tu veux du live flights commercial, il faut une API sous licence (à brancher).</div>
  `;

  setDataState(true, "ok");
}

let maritimeMap = null;
function initMaritimeMap(){
  if (maritimeMap) return;
  const el = document.createElement("div");
  el.id = "mapMaritime";
  $("p2b").innerHTML = "";
  $("p2b").appendChild(el);

  maritimeMap = L.map("mapMaritime", { zoomControl:true }).setView([20, 15], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(maritimeMap);

  const pts = [
    { n:"Suez", c:[30.0, 32.5] },
    { n:"Bab-el-Mandeb", c:[12.6, 43.3] },
    { n:"Hormuz", c:[26.6, 56.2] },
    { n:"Malacca", c:[2.5, 101.0] },
    { n:"Panama", c:[9.1, -79.7] },
    { n:"Gibraltar", c:[36.0, -5.6] }
  ];
  pts.forEach(p => L.circleMarker(p.c, { radius:8, weight:2, opacity:1, fillOpacity:.22 })
    .addTo(maritimeMap).bindPopup(p.n));
}

async function renderMaritime(){
  setTheme("maritime");
  $("tabTitle").textContent = TABS.maritime.title;
  $("tabSubtitle").textContent = TABS.maritime.sub;

  setPanelTitles("Shipping", "GDELT", "Map", "OSM", "Chokepoints", "static", "News", "GDELT");

  const [ship, geo] = await Promise.all([
    getNews("shipping OR maritime OR container OR freight rates"),
    getNews("suez OR hormuz OR malacca OR panama canal OR bab el mandeb")
  ]);

  const render = (data) => {
    const arts = (data.articles || []).slice(0,7);
    return `<div class="news">` + arts.map(a => `
      <div class="newsItem">
        <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
        <div class="meta"><span>${a.sourceCountry || "—"}</span><span>•</span><span>${a.seendate || ""}</span></div>
      </div>
    `).join("") + `</div>`;
  };

  $("p1b").innerHTML = render(ship);
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

  $("p4b").innerHTML = render(geo);

  setDataState(true, "ok");
}

// ---------- Router ----------
async function go(tab) {
  const titles = {
    markets: ["Markets", "Snapshot open-data (FX/Crypto/News)"],
    vol: ["Vol", "Realized vol (crypto) · stress"],
    fx: ["FX", "Frankfurter (ECB) rates · majors"],
    crypto: ["Crypto", "CoinGecko spot · 24h change"],
    macro: ["Macro", "GDELT signals · thematic"],
    news: ["News", "GDELT queryable"],
    aviation: ["Aviation", "GDELT aviation/airline"],
    maritime: ["Maritime", "Chokepoints + news (GDELT)"]
  };

  // nav state
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));

  $("tabTitle").textContent = titles[tab][0];
  $("tabSubtitle").textContent = titles[tab][1];

  try{
    setDataState(true, "loading…");
    if (tab === "markets") await renderMarkets();
    if (tab === "vol") await renderVol();
    if (tab === "fx") await renderFX();
    if (tab === "crypto") await renderCrypto();
    if (tab === "macro") await renderMacro();
    if (tab === "news") await renderNews("finance OR markets");
    if (tab === "aviation") await renderAviation();
    if (tab === "maritime") await renderMaritime();
  }catch(e){
    console.error(e);
    setDataState(false, "error");
    ["p1b","p2b","p3b","p4b"].forEach(id=>{
      $(id).innerHTML = `<div class="muted tiny">Erreur: ${String(e.message || e)}</div>`;
    });
  }
}

// ---------- Command input ----------
function parseCmd(s){
  const raw = s.trim();
  if (!raw) return null;
  const [cmd, ...rest] = raw.split(/\s+/);
  return { cmd: cmd.toUpperCase(), arg: rest.join(" ") };
}

function hookCmd(){
  const input = $("cmdInput");
  input.addEventListener("keydown", async (e)=>{
    if (e.key !== "Enter") return;
    const parsed = parseCmd(input.value);
    if (!parsed) return;

    if (parsed.cmd === "HELP"){
      input.value = "NEWS shipping";
      await go("news");
      return;
    }

    if (parsed.cmd === "NEWS"){
      await renderNews(parsed.arg || "finance OR markets");
      setTheme("news");
      document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === "news"));
      return;
    }

    if (parsed.cmd === "FX"){
      await go("fx");
      return;
    }

    if (parsed.cmd === "CRYPTO"){
      await go("crypto");
      return;
    }

    // fallback: treat as news query
    await renderNews(raw);
    setTheme("news");
  });
}

// ---------- Hotkeys ----------
function hotkeys(){
  document.addEventListener("keydown", (e)=>{
    const map = { F1:"markets", F2:"vol", F3:"fx", F4:"crypto", F5:"macro", F6:"news", F7:"aviation", F8:"maritime" };
    if (!map[e.key]) return;
    e.preventDefault();
    go(map[e.key]);
  });
}

// ---------- Boot ----------
function boot(){
  clock();
  hookCmd();
  hotkeys();

  $("refreshBtn").addEventListener("click", () => {
    const active = document.querySelector("#nav button.active")?.dataset.tab || "markets";
    go(active);
  });

  $("nav").addEventListener("click", (e)=>{
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    go(b.dataset.tab);
  });

  go("markets");
}

boot();
