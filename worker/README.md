# qt-edge: the optional edge proxy

QuinTerminal works without any server. A few sources refuse direct browser requests
because they do not send CORS headers, so they need a relay:

| Unlocks | Host |
|---|---|
| Full WTI and Brent futures strips, OVX, energy and tanker equities | query1/query2.finance.yahoo.com |
| Military and state aircraft over the Gulf, Red Sea, Black Sea, Baltic | api.adsb.lol |
| Satellite fire detections near fields, refineries and terminals | firms.modaps.eosdis.nasa.gov |
| Energy and shipping RSS (OilPrice, EIA, gCaptain, Maritime Executive, Rigzone, Splash247, Hellenic Shipping News) | their own hosts |
| GDELT fallback when the direct call fails | api.gdeltproject.org |

`qt-edge.js` is a Cloudflare Worker of about 150 lines. It only forwards `GET` requests
to the hosts listed in `ALLOW`, refuses redirects that leave that list, caps responses at
6 MB, caches each host for a fixed time (20 s for aircraft, 60 s for quotes, 10 to 15 min
for news and fires) and adds CORS headers. It stores nothing about you.

## Deploy from the dashboard (5 minutes, no tools)

1. Create a free account at <https://dash.cloudflare.com>.
2. Go to **Workers & Pages → Create → Create Worker**, name it `qt-edge`, press **Deploy**.
3. Press **Edit code**, replace everything with the contents of `qt-edge.js`, press **Deploy**.
4. Open `https://qt-edge.<your-subdomain>.workers.dev/health`. You should see `{"ok":true,…}`.
5. In QuinTerminal open **SYS** (or type `PROXY https://qt-edge.<your-subdomain>.workers.dev`
   in the GO bar) and press **Test proxy**.

## Deploy with Wrangler

```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put FIRMS_KEY        # optional
```

## Optional settings

| Name | Type | Effect |
|---|---|---|
| `FIRMS_KEY` | secret | NASA FIRMS map key (free at <https://firms.modaps.eosdis.nasa.gov/api/map_key/>). Requests whose path contains `/WORKER_KEY/` get it substituted, so the key never sits in the browser. |
| `ALLOWED_ORIGINS` | variable | Comma-separated origins allowed to call the proxy, for example `https://yourname.github.io,http://localhost:8000`. Leave empty for personal use. |

## Limits worth knowing

- The free plan allows 100,000 requests a day. The terminal's own polling uses a few
  thousand a day with every panel open.
- The Cache API does nothing on `*.workers.dev`, so the worker also keeps a small in-memory
  cache per isolate. On a custom domain the edge cache applies too.
- Yahoo Finance is an unofficial endpoint. It can rate-limit or change without notice;
  the terminal falls back to TradingView widgets and the free physical-premium view.
- Some news sites sit behind bot protection and may answer the worker with an error. Their
  feed then shows as failing in the NEWS feeds panel while the others keep working.

## Tests

`node ../tests/worker.test.mjs` runs the allow-list, CORS, origin, redirect, key-injection and
cache checks against a mocked upstream.
