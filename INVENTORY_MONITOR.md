# Inventory Monitor — Torn IN/OUT Tracker

The **implementation** layer of the inventory system: a small Node.js server that watches
your recent Torn logs and answers **what came IN, what went OUT, and what you currently hold**
since a start time (default: **14:00 ET, 12 Aug 2026** — Torn City time).

> **Time zone:** Torn City runs on **New York time** (`America/New_York`, ET/EDT). All
> dashboard times (activity feed, popups, table timestamps) and the console poll windows
> are shown in that zone. Timestamps themselves are stored as unix epochs (UTC-based);
> only the *display* is converted to ET.

- Doc layers: `GAME_MECHANICS.md` (game rules) → `ITEM_TRACKING.md` (log→flow spec,
  **the model this tool implements**) → this doc (how the monitor implements it).

## Code structure

The backend follows SOLID: modules with one job (SRP), log-type behavior that is data-driven
(OCP — add a log type by editing `src/constants.js`, not the flow logic), uniform flow
contracts across ledgers (LSP), narrow injected dependencies (ISP) and a composition root
that wires everything (DIP).

```
inventory-monitor/
├── server.js              thin entry — delegates to src/app.js (`npm start` unchanged)
├── schema.sql             PostgreSQL schema (applied idempotently at startup)
├── reset-db.js            one-shot TRUNCATE script (`npm run reset-db`)
├── public/
│   ├── index.html         markup only
│   ├── style.css          all styles
│   └── app.js             all dashboard JS
└── src/
    ├── app.js             composition root: config → catalog/pool/state → db/ledger/
    │                      poller/summary/routes → express app + poll loop
    ├── config.js          env/.env → frozen config object (DIP — nothing reads env directly)
    ├── constants.js       log type groups + source maps + LOCATION_LEDGER_SOURCES
    ├── catalog.js         torn_items.json + museum-exchange.json → itemName/itemValue/resolveItemId
    ├── state.js           createState() factory
    ├── db/                index (pool + migrations) · load (DB→memory) · persist · clear
    ├── ledger/            extract (data-shape parsers) · extractors/ (one file per log
    │                      group, registered in extractors/index.js) · locations
    │                      (bazaar/display/market) · trade · museum · apply (orchestrator)
    ├── logserver.js       hosted-server client: throttle/retry, windowed fetch, logKey
    ├── poller.js          fetch→apply→persist loop; owns the dedupe buffer
    ├── summary.js         /api/state read-model (replays manual adjustments on top)
    └── routes.js          HTTP API (thin adapters over the injected deps)
```
- Related implementation: `ITEM_EXTRACTION.md` covers the portfolio tracker userscript
  (`portfolio-tracker.user-v2.js`), which shares the same log-type groups but renders
  per-tab analytics instead of a running inventory.

---

## 1. What it does

```
Torn API (user log selection)  ──poll 60s──▶  flow extraction  ──▶  aggregated state (PostgreSQL)
                                                     │
                                                     ▼
                              Express server ──▶ dashboard (/) + JSON API (/api/state)
```

- Polls the **hosted log server** (`${LOGS_SERVER}/api/portfolio/logs?logTypes=…&from=…&to=…&limit=5000`
  — the same server the portfolio-tracker userscript uses, default
  `https://torn-imarket-tracker.gvsantiago.com`) every `POLL_INTERVAL` (default 60 s), starting
  from the monitor start time. The hosted server handles Torn API auth + rate limits, so no
  API key is needed here.
- Turns each relevant log into **item flows** (`in`/`out` + qty + source) using the rules in
  `ITEM_TRACKING.md` (implemented by `logFlows()` in `server.js`).
- Aggregates flows per item (running `in` / `out` / `net` totals) and keeps a **recent
  activity feed** (newest first, capped at 500 entries).
- Derives the **current inventory** as a ledger: `baseline (zero at startTs) + net flows`
  (see §4b) — logs are the only source of truth, no live inventory API.
- Persists the derived state to **PostgreSQL** (schema in `schema.sql`, applied automatically
  at startup) so restarts continue where they left off.
- Serves a dark **dashboard** with eight tabs — **Monitor** (summary tiles + IN table + OUT
  table + activity feed), **Inventory** (person-inventory ledger), **Bazaar**, **Display**,
  **Market** (item market listings), **Trading** (player trades), **Museum** (exchange
  rewards) and **Transfers** (location→location moves) — plus a small **JSON API**.

## 2. Requirements

- **Node.js 22+** (uses global `fetch`; Node 24 tested).
- Access to the **hosted log server** (`LOGS_SERVER` env, default
  `https://torn-imarket-tracker.gvsantiago.com`) — no Torn API key required.
- Repo data files (read from the repo root, no network needed):
  `torn_items.json` (item names + market prices), `museum-exchange.json` (set compositions).

## 3. Setup & run

**Database:** create it once (the schema itself is applied automatically at startup):

```bash
createdb -U torn_user torn_tracker_v2     # or: psql -U torn_user -c 'CREATE DATABASE torn_tracker_v2'
```

**Run:**

```bash
cd inventory-monitor
npm install
cp .env.example .env        # then edit: set DB_* (LOGS_SERVER / PORT / MONITOR_START / POLL_INTERVAL optional)
npm start                   # → http://localhost:3001
```

| Env var | Default | Meaning |
|---|---|---|
| `LOGS_SERVER` | `https://torn-imarket-tracker.gvsantiago.com` | Hosted log server (`/api/portfolio/logs`). No Torn API key needed — it handles auth + rate limits |
| `PORT` | `3001` | Dashboard/API port |
| `MONITOR_START` | `2026-08-12T14:00:00-04:00` | When to begin tracking — any ISO 8601 instant (the offset is irrelevant to the stored unix timestamp; the dashboard then displays it in **Torn time**, ET). Used only when `monitor_meta` doesn't exist yet (fresh DB) |
| `POLL_INTERVAL` | `60000` | Poll interval in ms |
| `API_RATE_INTERVAL` | `0` | Optional pacing (ms) between log-server requests; default 0 since the hosted server handles Torn's limits |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | PostgreSQL host/port |
| `DB_NAME` | — | **Required.** Database name (e.g. `torn_tracker_v2`) |
| `DB_USER` / `DB_PASS` | — | **Required.** PostgreSQL credentials |

The schema (`schema.sql`) is applied idempotently on every startup. The server exits at
startup if PostgreSQL is unreachable or the `DB_*` vars are missing (persistence is required
— the dedupe buffer must survive restarts to avoid double-counting).

**Start fresh:** `npm run reset-db` (i.e. `node reset-db.js`) clears every table — ledgers,
dedupe buffer, monitor meta — so the next poll starts from `MONITOR_START`. Stop the server
first (a running server re-writes its in-memory state on the next poll). Set
`MONITOR_START` to the current time in `.env` first if you want the ledger to start truly
empty from now instead of re-processing since 02:00 AM.

> **Changing `MONITOR_START` on an existing DB:** the stored `monitor_meta.start_ts` wins on
> every restart — the env value is only used when the DB has no start yet. So to apply a new
> start date you must **stop → `npm run reset-db` → start** (the server re-fetches every log
> since the new start from Torn, so no history is lost). The startup log warns if the
> configured `MONITOR_START` differs from the stored DB start.

## 4. Flow rules implemented (extractor registry)

Each log type maps to IN and/or OUT flows via a **per-group extractor** in
`src/ledger/extractors/` (registered in `extractors/index.js` — adding a log type is
dropping in a new extractor file, no dispatcher changes). Group ids are the **same source
of truth** as the portfolio tracker (`ITEM_EXTRACTION.md` §1/§5/§6).

| Log group | Log types | Direction | Notes |
|---|---|---|---|
| Buy | 1103, 1112, 1220, 1225, 4201, 4200, 5010 | `in` | 5010 (point market buy) with no item id → pseudo-item `__points__` (Torn Points) |
| Sell | 4210, 4220 | `out` | **1221/1226 bazaar sells, 1104/1113 market sells and 5011 point-market sells are excluded** — the item/points already left inventory when stocked/listed (§4c/§4e/§4f) |
| Trade items | 4445 outgoing / 4446 incoming | `out` / `in` | each `{id, qty}` from `data.items`; no grouping needed for a running total |
| Free items | 7011, 1401, 1404, 8930, 8938, 8980, 5725, 9020, 9027, 8170, 8377, 6401, 6505, 6525, 6500, 5530, 5533, 8855, 2548, 5600, 5251, 5575, 5580, 2536, 6731, 6733, 6746, 6751, 6752, 6753, 6797, 4101, 4103, 4105, 4001, 4320, 6749, 8945, 8946 | `in` | source label per type (City Find, Crime, Player Send, Faction Armory…); 8946 Christmas town coupon exchange → `in` each `data.items` entry |
| Item usage | 2xxx Consumed ids + easter eggs 8981–8989, 2621, 1400/1403 Dumped, 4000 Parceled, 4100/4102/4104 Sent, 6725/6728/6732/6745/6747/6750/6796 Faction…, 6768/6769 OC Spent, 9163/9190/9191 Crime Loss, 9300–9361 Crime Spent, 15021 Staff Removal | `out` | |
| Museum swap | 7000 | `out` (+`in` for points) | **expanded** to the real set composition from `museum-exchange.json` × quantity (not a `__set__` pseudo-item); `points_received` earned → `__points__` `in` |
| Blood bag transform | 2340 | `out` + `in` | `out` `data.item` (empty bag) **and** `in` `data.blood_bag` (filled bag) — the transformation spec from `ITEM_TRACKING.md` §3 |
| Container opening | 2390 (drug pack) · 2400 (goodie bag) · 2480 (dukes safe) · 2535 (halloween basket) | `out` + `in` | `out` `data.item` ×1 (container) **and** `in` `data.item2` × `quantity` (2390/2480) or each `data.items` entry (2400/2535); source `Opened`; skipped when `data.faction` set (`ITEM_TRACKING.md` §3) |
| Virus programming | 5802 complete | `in` | `data.virus` is the virus **name** (e.g. `"a simple"`) → resolved to the catalog virus item (69 Simple, 103 Firewalk, 70 Polymorphic…); qty 1, source `Virus Programming`; 5800/5801 no flow (`ITEM_TRACKING.md` §6g) |
| Racing cars | 8700 enlist · 8701 unenlist | `out` / `in` | car (`data.car` item id) leaves/returns to inventory; sources `Racing Enlist` / `Racing Unenlist` (`ITEM_TRACKING.md` §6h) |
| Bazaar stock (inv side) | 1210/1222 add · 1211/1223 remove | `out` / `in` | keeps the person ledger aligned with the bazaar ledger (§4c, `ITEM_TRACKING.md` §6c) |
| Display stock (inv side) | 1300/1302 add · 1301/1303 remove | `out` / `in` | keeps the person ledger aligned with the display ledger (§4d, `ITEM_TRACKING.md` §6d) |
| Torn Points | 5000 add · 5001 remove · 4900–4975 usage | `out` / `in` / `out` | pseudo-item `__points__`; usage qty = `data.points_used` (skipped when `data.faction` set — faction-armory points); museum points earned as `in` (`ITEM_TRACKING.md` §6f) |

**Condition — faction armory use:** on `Consumed` item-use logs (e.g. 2340), `data.faction != 0`
means the item came from the faction armory → **no player flow** (your inventory never
changed). On 2340, `data.armory_deposit` set means the filled bag lands in the armory → the
player only sees the `out` flow. (`GAME_MECHANICS.md` §1)

**Data shapes:** `extractFreeItems()` mirrors `ITEM_EXTRACTION.md` §2 (`ammo_gained`/`ammo`
nested object, `items_gained`/`items` object, `items`/`item` arrays, `item` number, `egg`
number, `set` string fallback).

## 4b. Current inventory view (the ledger)

The **Inventory** tab answers "what do I currently hold" — derived **entirely from the logs**
(no live inventory API). Each item's position is:

```
current = baseline (zero at startTs) + IN − OUT   →   i.e. current = net
```

- Baseline is **zero** (delta-only ledger, per project decision). Items with `net > 0` are
  in stock; items with `net < 0` are **overdrawn** — they were used more than acquired since
  start, so they drew from pre-existing (unknown) stock and their true balance is unknown.
- The ledger becomes a real inventory as log activity accumulates: reset the monitor when
  your inventory is empty (or from a known point) and it will track holdings from there.
- `/api/state` exposes it as `current`:
  ```json
  { "baseline": "zero", "stockItems": 3, "stockQty": 12,
    "stockValue": 5928, "overdrawnItems": 2 }
  ```
  plus each `items[]` entry carries `net` for the per-item view (Item | In | Out | Net |
  Value | Last moved).

## 4c. Bazaar inventory view (separate ledger)

The **Bazaar** tab tracks your bazaar stock — what went **in** (added) and **out** (sold /
removed). Same zero-baseline ledger model as §4b, but scoped to bazaar stock only
(`ITEM_TRACKING.md` §6c):

| Log | Flow |
|---|---|
| 1210 / 1222 Bazaar add | bazaar `in` |
| 1221 / 1226 Bazaar sell | bazaar `out` + revenue (`data.cost_total`) |
| 1211 / 1223 Bazaar remove | bazaar `out` |

- Columns per item: **Added · Sold · Removed · Net · Value · Last**.
- Tiles: **Bazaar Revenue** (Σ sell money), **Units Sold**, **In Stock (items)** (net > 0),
  **Net Units** (added − sold − removed).
- `/api/state` exposes it as `bazaar`: `{ revenue, unitsSold, unitsIn, unitsOut, netUnits,
  stockItems, items[] }`.
- **Aligned with the Inventory tab:** bazaar add → inventory `out`, bazaar remove →
  inventory `in`, bazaar sell → no inventory flow (the item already left inventory when
  stocked — 1221/1226 are excluded from the main Sell group; `ITEM_TRACKING.md` §6c).

## 4d. Display Case view (separate ledger)

The **Display** tab tracks your Display Case stock — what went **in** (added) and **out**
(removed). Same zero-baseline ledger model, scoped to the display case only
(`ITEM_TRACKING.md` §6d):

| Log | Flow |
|---|---|
| 1300 / 1302 Display add | display `in` |
| 1301 / 1303 Display remove | display `out` |

- Columns per item: **Added · Removed · Net · Value · Last**.
- Tiles: **On Display (items)** (net > 0), **Net Units**, **Units Added**, **Units Removed**.
- `/api/state` exposes it as `display`: `{ unitsIn, unitsOut, netUnits, stockItems,
  items[] }`.
- **Aligned with the Inventory tab:** display add → inventory `out`, display remove →
  inventory `in` (`ITEM_TRACKING.md` §6d); no money is involved.

## 4e. Transfers view (location→location moves)

The **Transfers** tab shows every item move between your locations — the "clear picture"
of where items went:

| Log | Transfer |
|---|---|
| 1210 / 1222 Bazaar add | `Inventory → Bazaar` |
| 1211 / 1223 Bazaar remove | `Bazaar → Inventory` |
| 1221 / 1226 Bazaar sell | `Bazaar → Sold` |
| 1300 / 1302 Display add | `Inventory → Display` |
| 1301 / 1303 Display remove | `Display → Inventory` |
| 1100 / 1110 Item market add | `Inventory → Market` |
| 1101 / 1111 Item market remove | `Market → Inventory` |
| 1104 / 1113 Item market sell | `Market → Sold` |

- Tiles: units moved per direction (Inventory↔Bazaar, Inventory↔Display, Inventory↔Market,
  plus Bazaar→Sold and Market→Sold).
- Table: Date · Item · From → To · Qty · Log (newest first, search-filtered).
- `/api/state` exposes it as `transfers`: `{ counts: { "Inventory → Bazaar": n, … },
  items[] }` (capped at 1000 events).
- Every transfer is also visible in the Monitor tab's IN/OUT tables and the activity feed.

## 4f. Item Market view (listing ledger)

The **Market** tab tracks your Item Market listings — what went **in** (listed) and **out**
(sold or removed). Same zero-baseline ledger model, scoped to the market only
(`ITEM_TRACKING.md` §6e):

| Log | Flow |
|---|---|
| 1100 / 1110 Item market add | market `in` (listed) |
| 1104 / 1113 Item market sell | market `out` (sold, earns revenue) |
| 1101 / 1111 Item market remove | market `out` (removed) |

- Columns per item: **Listed · Sold · Removed · Net · Value · Last**.
- Tiles: **Revenue** (from sales, net of market tax), **Listed (items)** (net > 0), **Net
  Units**, **Units Listed**, **Units Sold**, **Units Removed**.
- `/api/state` exposes it as `market`: `{ revenue, unitsSold, unitsIn, unitsOut, netUnits,
  stockItems, items[] }`.
- **Aligned with the Inventory tab:** market add → inventory `out`, market remove →
  inventory `in`, market sell → no inventory flow (the item already left inventory when
  listed — 1104/1113 are excluded from the main Sell group; `ITEM_TRACKING.md` §6e).

## 4g. Trading view (player trades)

The **Trading** tab shows each **completed trade** — sub-logs grouped by `parsed_trade_id`
(anchor 4430, money 4440/4441, items 4445/4446, property 4450/4451) into **You Gave** and
**You Received** sides, mirroring the portfolio tracker (`GAME_MECHANICS.md` §3,
`ITEM_TRACKING.md` §5). Only the item sides move the main ledger (`Trade` flows).

- Tiles: **Trades Out / Trades In** (counts), **Items Sent / Items Received**, **Money
  Sent / Money Received** (cash part of each side, incl. 4440/4441).
- Table: Date · **Trade #** (links to torn.com trade view) · **Counterpart** (links to the
  player profile) · **You Gave** · **You Received** · expandable arrow. Click a row to open
  the full item-by-item detail (qty, market price, money, properties).
- Trade totals per item: **Received · Sent · Net · Value · Last** — derived from the main
  ledger's `Trade` sources, so it always matches the Inventory tab.
- `/api/state` exposes it as `trades`: `{ countOut, countIn, sentQty, receivedQty, moneyOut,
  moneyIn, items[], trades[] }` (trades capped at 1000; each entry has `{tradeId, ts,
  counterpartId, gave, received}` with `gave/received = {money, items[], properties}`).

## 4h. Museum view (exchange rewards)

The **Museum** tab tracks the **reward side** of Museum exchanges (log **7000**) — the
deduction side already lives in the main ledger (OUT, expanded to the set composition).
Each swap logs `data.points_received` (museum points earned, e.g. 1000× Plushie Set =
10,000 points):

- Tiles: **Museum Points** (total received), **Swaps** (sets converted), **Items Spent**
  (set composition × quantity, removed from inventory).
- Table: Date · Set · Qty · Points Received · Log.
- `/api/state` exposes it as `museum`: `{ pointsReceived, swapCount, unitsSpent, swaps[] }`
  (swaps capped at 1000).

## 5. Persistence — PostgreSQL (`schema.sql`)

The derived state lives in Postgres (logs remain the source of truth; the DB is the derived
view, rebuilt continuously from polls). Schema applied idempotently at startup:

| Table | Contents | Notes |
|---|---|---|
| `monitor_meta` | single row: `start_ts`, `last_ts`, last poll status | `last_ts` = highest processed log timestamp |
| `processed_logs` | `log_id` dedupe buffer | pruned to newest 5000 — prevents double-counting across restarts |
| `item_totals` | per item: `name`, `value`, `in_qty`, `out_qty`, `last_ts` | `net = in_qty − out_qty` (baseline zero) |
| `item_sources` | per item per source per direction: qty (`dir` = in/out) | FK → `item_totals` (cascade delete) — sources are **direction-split** so the IN table shows only sources that added, the OUT table only sources that removed |
| `activity` | recent activity feed (incl. log `category` + `log_type` for the popups) | pruned to newest 20000 |
| `bazaar_totals` | bazaar stock per item: `in_qty`, `sold_qty`, `removed_qty` | `net = in − sold − removed` (§4c) |
| `bazaar_meta` | single row: bazaar `revenue`, `units_sold` | Σ sell money |
| `display_totals` | display stock per item: `in_qty`, `removed_qty` | `net = in − removed` (§4d) |
| `transfers` | location→location moves (from_loc, to_loc, qty) | pruned to newest 1000 (§4e) |
| `location_events` | per-scope per-item event history (bazaar/display/market: ts, kind Added/Sold/Removed, qty) — powers the location-tab popups; **separate from the capped activity feed** so old location events are never trimmed away | pruned to newest 50000 per scope |
| `market_totals` | item market listing stock per item: `in_qty`, `sold_qty`, `removed_qty` | `net = in − sold − removed` (§4f) |
| `market_meta` | single row: market `revenue`, `units_sold` | Σ sell money (net of market tax) |
| `trade_events` | completed trades (grouped by `parsed_trade_id`): trade_id, counterpart_id, gave_json, received_json | pruned to newest 1000 (§4g) |
| `museum_swaps` | museum exchanges (7000): set_name, quantity, points_received | pruned to newest 1000 (§4h) |
| `museum_meta` | single row: total `points_received` | Σ swap points |
| `manual_adjustments` | manual reconcile records (item_id, dir, qty, label, note) — separate layer, replayed at read time, never merged into item totals | user-added only |

How it's written (all in one transaction per poll):

- `monitor_meta` → upserted **every** poll (poll status survives restarts).
- `item_totals` / `item_sources` / `activity` / `bazaar_totals` / `bazaar_meta` /
  `display_totals` → rewritten only when new flows were applied (scale is small — a few
  hundred rows).
- `processed_logs` → appended incrementally, then pruned.

> ⚠️ node-postgres returns `bigint` columns as strings — the DB load in `dbInit()` coerces
> them back to numbers so in-memory arithmetic stays correct.

## 6. API

| Endpoint | Description |
|---|---|
| `GET /` | Dashboard — eight tabs: **Monitor** (IN/OUT + activity), **Inventory** (person ledger), **Bazaar**, **Display**, **Market**, **Trading** (player trades), **Museum** (exchange rewards), **Transfers** (location moves) |
| `GET /api/state` | Full JSON: counts, `current` (inventory ledger), `bazaar`, `display`, `market`, `trades`, `museum`, `transfers`, items, activity, poll status |
| `GET /api/item-events?itemId=&dir=in\|out\|both&source=` | Per-item event breakdown for the **click popups** — newest 100 activity entries for that item as `{events:[{ts, source, qty, dir}]}`. `dir=both` returns the **full chronological history** (oldest first) used by the **Net** column popup. When `source` is a location source (`Bazaar Added`, `Market Sold`, …) the events come from the dedicated `location_events` history (50k/scope) instead of the capped activity feed — so the Bazaar/Display/Market popups never go empty for old items. Without `source`: inventory-ledger flows only. |
| `POST /api/adjust` | Add a **manual adjustment** (reconciliation): `{item, dir:'in'\|'out', qty, label?, note?}` or `{item, balance, label?, note?}` (reconcile to a target current balance; the server computes the in/out delta). `item` = name or numeric id (resolved against `torn_items.json`). Persisted in `manual_adjustments`, applied on top of the ledger at read time |
| `DELETE /api/adjust/:id` | Remove a manual adjustment (reverts its effect) |
| `POST /api/poll` | Trigger an immediate poll (returns `{ok, processed, state}`) |
| `POST /api/reset` | Clear tracked data (incl. manual adjustments) and restart from the monitor start time |

> **Manual adjustments (reconcile):** the **＋ Adjust** button (header) opens a modal with two
> modes — *Add in/out record* (direction + qty + label) or *Reconcile to balance* (set the
> item's current inventory to a target; the server computes the delta). Every item row in the
> Monitor IN/OUT, Inventory, Bazaar, Display, Market and Trading tables also has a **⚖
> Reconcile** button that opens the modal **pre-filled** with that item and its current
> inventory balance (reconcile mode) — just type the actual count and save. Adjustments are a
> **separate layer**: they're never written into `item_totals`/`item_sources` (so restarts and
> re-polls can't double-count them), are applied on top of the log ledger in `/api/state` and
> the click popups, appear in Recent Activity as `Manual: <label>`, and are fully reversible
> (delete from the modal's recent list).

> **Click popups:** in the **Monitor** IN/OUT tables and the **Inventory** tab, clicking an
> IN/OUT number opens (and clicking again / pressing × / clicking elsewhere closes) a small
> scrollable table — **When · Source · Category · Qty** — showing exactly which events
> produced that number, incl. the log **category** and **log type id** (e.g. `Trade ·
> Trades #4445`, `Museum: Plushie Set · Museum #7000`). Clicking a **Net** cell (Inventory
> + Trading tabs) opens the item's **History**: both directions merged, **chronological
> order** (oldest first), each row signed **+ in / − out** (e.g. `+100 Buy`, `−10 Trade`).
> Backed by `/api/item-events`; the activity feed (memory + DB) holds the newest **20000**
> entries so the popups keep history across full backfills (an item's events are never
> trimmed out by other items' activity).
>
> **Sortable columns:** every table column is sortable — click a header to sort by it
> (click again to reverse; an arrow shows the active sort). Value columns sort by the
> computed value (qty × market price). Works on Monitor, Inventory, Bazaar, Display, Market,
> Trading, Museum, Transfers and the Adjust modal's recent list.

Counts in `/api/state`:

```json
{ "uniqueIn": 3, "uniqueOut": 2, "inQty": 12, "outQty": 9,
  "netQty": 3, "valueIn": 5928, "valueOut": 4410 }
```

`valueIn`/`valueOut` use each item's current market price from `torn_items.json`.

## 7. Reliability notes

- The Torn log API caps logs per request (~1000); `fetchLogsRange()` bisects any window that
  returns a full page, and the poll loop walks ≤6 h chunks — so the first (catch-up) poll
  never misses logs and no single request exceeds the API cap.
- **Progress visibility:** while a poll runs, the server rewrites a **single-line ASCII
  progress bar** on the console (carriage-return updates — one line for all fetch windows,
  one for the apply phase, then a `done — applied N logs` summary; the line is cleared
  before any warning so output stays readable), and exposes `poll.inProgress` +
  `poll.progress {phase, current, total, label}` via `/api/state` — the dashboard shows a
  live progress bar under the header (fetching windows → applying logs) and fast-refreshes
  (1.5 s) until the poll completes.
- **Rate limits:** logs come from the hosted server, which handles Torn API auth + rate
  limits itself — no API key or throttling needed on our side. All requests still go through
  `fetchWithRetry()` for resilience: **429 / 5xx / "Too many requests" responses retry with
  exponential backoff** (1s, 2s, 4s, honoring `Retry-After`), up to `REQUEST_RETRIES` (4)
  attempts. Optional pacing via `API_RATE_INTERVAL` (default 0). After retries are exhausted
  the poll marks `lastOk: false` and tries again next interval — nothing is lost (fetching
  resumes from the stored `lastTs`).
- **Response shapes:** the hosted server returns `{ log: [ { id, timestamp, details:{id,
  title, category}, data, params }, … ] }` (details-style, no top-level `log` field).
  `fetchLogsRange()` normalizes array / `{log: array}` / object-keyed shapes into entries
  with `id` attached, and `logFlows`/`applyLog` resolve the type via `details.id`. Truly
  unrecognized shapes log a warning (`[poll] unexpected log response …`) instead of crashing
  the poll loop.
- Persistence is transactional: each poll commits `monitor_meta` + (when flows were applied)
  `item_totals` / `item_sources` / `activity` + new `processed_logs` ids in one DB
  transaction — a crash loses at most the last <60 s of polls, never a partial write.
- Startup requires PostgreSQL (`DB_*` env vars); the server exits with a clear message if the
  DB is unreachable — the dedupe buffer must survive restarts to avoid double-counting.
- Item names/prices are a **snapshot** from `torn_items.json` (local file, not live API).
