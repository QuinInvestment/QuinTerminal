// Loads third-party libraries on first use, trying several CDNs in order.
// Versions are pinned.

const LIBS = {
  echarts: {
    global: "echarts",
    js: [
      "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js",
      "https://unpkg.com/echarts@5.6.0/dist/echarts.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.6.0/echarts.min.js",
    ],
  },
  maplibre: {
    global: "maplibregl",
    js: [
      "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js",
      "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js",
    ],
    css: [
      "https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css",
      "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css",
    ],
  },
};

const loading = new Map();

function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error("failed " + src)); };
    document.head.appendChild(s);
  });
}

function addCss(href) {
  return new Promise((resolve, reject) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = () => resolve();
    l.onerror = () => { l.remove(); reject(new Error("failed " + href)); };
    document.head.appendChild(l);
  });
}

async function firstOk(urls, add) {
  let last;
  for (const u of urls) {
    try { await add(u); return u; } catch (e) { last = e; }
  }
  throw last || new Error("no source");
}

export function loadLib(name) {
  const spec = LIBS[name];
  if (!spec) return Promise.reject(new Error("unknown lib " + name));
  if (window[spec.global]) return Promise.resolve(window[spec.global]);
  if (loading.has(name)) return loading.get(name);
  const p = (async () => {
    if (spec.css) firstOk(spec.css, addCss).catch(() => {});
    await firstOk(spec.js, addScript);
    if (!window[spec.global]) throw new Error(name + " did not initialise");
    return window[spec.global];
  })();
  loading.set(name, p);
  p.catch(() => loading.delete(name));
  return p;
}
