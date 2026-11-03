# data/

Written by the **Daily snapshot** workflow (`.github/workflows/snapshot.yml`,
`pipeline/snapshot.mjs`) each weekday at 21:40 UTC, and read by the terminal
from its own origin. Until the workflow's first run this folder holds only
this file, and the panels that need it say so.

```
manifest.json            last run of each job: ok, time, counts, error if any
eia/weekly.json          EIA weekly balances since 2018      (job eia, needs the EIA_KEY secret)
eia/spot.json            EIA daily Brent and WTI spot since 1987
eia/steo.json            EIA Short-Term Energy Outlook, monthly (world balance, OPEC capacity, outages, producers)
eia/products.json        EIA weekly refined product spot prices with WTI and Brent, since 2018
curve/latest.json        12 NYMEX WTI (CL) and Brent (BZ) contracts, last snapshot
history/curve.csv        date, root, code, label, last_trade, price, quote_date
history/baltic.csv       daily tanker counts in the Gulf of Finland and near each Russian terminal
history/forecasts.csv    the terminal's own quantile forecasts, scored in FCST > Track record
```

The EIA files hold one `[date, value]` point per line, so a daily update is a
small git diff, and they are rewritten only when the data changed.

Do not edit these files by hand: the next run upserts rows by key (date and
contract, or date and horizon) and would overwrite manual changes.
