# Item Extraction Guide — Torn Portfolio Tracker

How the tracker pulls individual items out of Torn log entries and groups them into the tabs.
File: `portfolio-tracker.user-v2.js`

> This is the **implementation** layer. The declarative log→flow spec (what each log means
> for inventory) lives in `ITEM_TRACKING.md`; the game rules in `GAME_MECHANICS.md`.

---

## 1. The tabs and their log sources

| Tab | Data | Log types (IDs) | Processing fn |
|---|---|---|---|
| **Purchased** | Items you bought | `BUY_LOG_TYPES` = 1103, 1112, 1220, 1225, 4201, 4200, 5010 | `processLogs()` |
| **Sold** | Items you sold | `SELL_LOG_TYPES` = 1104, 1113, 1221, 1226, 4210, 4220, 5011 | `processLogs()` |
| **Trades** | Player trades | `TRADE_LOG_TYPES` = 4430, 4440, 4441, 4445, 4446, 4450, 4451 | `processTrades()` |
| **Free Items** | Items gained (no $) | `FREE_LOG_GROUPS` (see §5) | `processFreeItems()` |
| **Item Usage** | Items lost/consumed (own inventory) | `USAGE_LOG_GROUPS` (see §6) | `processUsageItems()` |
| **Faction Used** | Item uses from the faction armory | same `USAGE_LOG_GROUPS` fetch (see §6) | `processUsageItems()` |

All tabs share the same pipeline:

```
server logs  →  extract items  →  aggregate by (item, source)  →  render table  →  lazy expandable history
```

---

## 2. The core extractor: `extractFreeItems(data, logType)`

This single function knows how to read the different `data` shapes Torn uses. It always
returns an array of `{ id, qty }` entries. The checks run **in this order**:

| Priority | Shape in `log.data` | Example log types | Result |
|---|---|---|---|
| 1 | `ammo_gained` / `ammo` = `{type: {size: qty}}` or flat `{type: qty}` | 9027 Crime ammo, 5533 Stock special ammo, 6500 Company special ammo | synthetic `__ammo__` ids (§4) |
| 2 | `items_gained` = `{itemID: qty, ...}` (object) | 9020 Crime success item gain | one entry per item |
| 3 | `items` = `{itemID: qty, ...}` (object) | 8938 Christmas town items | one entry per item |
| 4 | `items` = `[{id, qty}]` (array) | 4001 Parcel open, 4101/4103/4105 Item receive | one entry per item |
| 5 | `item` = `[{id, qty}]` (array) | 1401/1404 Dump find, 6731/6733 Faction give, 6746 Faction loan | one entry per item |
| 6 | `item` = number (single item id) | 7011 City find, 6401 Job special, 6505/6525 Company special | `{id, qty: data.quantity \|\| 1}` |
| 7 | `egg` = number | 8980 Easter egg hunt | `{id, qty: 1}` |
| 8 | `set` = string | 7000 Museum exchange (`"Plushie Set"`…) | synthetic `__set__` id (§4) |
| — | none of the above | — | `[]` (ignored) |

> Order matters: object-shaped `items` (priority 3) is handled **before** array-shaped
> `items` (priority 4), because the shapes are checked separately.

---

## 3. Purchased / Sold: `processLogs()`

For buy & sell logs the extraction is **not** done through `extractFreeItems` — the shape
is more consistent, so it's inlined:

```js
let itemId = (Array.isArray(d.item) ? d.item[0]?.id : d.item) ?? d.items?.[0]?.id;
if (!itemId && POINTS_LOG_TYPES.has(logType)) itemId = '__points__';
const qty  = d.quantity ?? d.items?.[0]?.qty ?? 1;
const cost = d.cost_total ?? d.cost ?? 0;
```

- `d.item` array → first item's id; `d.item` number → that number; fallback `d.items[0].id`.
- **Points special case** (5010/5011 Point Market): no item id in the log → synthetic id `__points__` so points show as their own "item".
- Store (Item Market / Bazaar / Shop / Abroad / Point Market) comes from `LOG_TYPE_STORE`, falling back to `details.category` / `category` / title sniffing (`storeFromTitle`).
- `no_tax` (tax exemption) = true for **Torn Points** and **Bazaar** — used by the P/L and $/Unit math.
- Each log also records an entry in `details[]` (`{timestamp, quantity, cost, title}`) → powers the expandable **Purchase/Sale History**.

Aggregated by key `` `${itemId}:${store}` `` with `total_quantity`, `total_amount`, `avg_cost = total_amount / total_quantity`.

---

## 4. Synthetic item ids

Not everything in Torn is a numbered item. These pseudo-ids are used so non-item things
still appear in the tables:

| Id | Meaning | Display name |
|---|---|---|
| `__points__` | Torn Points (5010/5011) | "Torn Points" |
| `__ammo__<type>__<size>` | Ammo (9027/5533/6500) | `Ammo T<type> S<size>` |
| `__set__<name>` | Museum set exchange (7000) | the set name itself |

They get `price: 0` (no market value) and are grouped exactly like real items.

---

## 5. Free Items: `processFreeItems()`

**Source categories** (`FREE_SOURCE_MAP` maps log id → label):

| Source | Log ids |
|---|---|
| City Find | 7011 |
| Dump | 1401, 1404 |
| Christmas Town | 8930, 8938 |
| Easter Egg Hunt | 8980 |
| Crime | 5725, 9020, 9027 (item + ammo) |
| Attack Loot | 8170 |
| Casino Wheel | 8377 |
| Job Special | 6401 |
| Company Special | 6505, 6525, 6500 (ammo) |
| Stock Dividend / Stock Ammo | 5530, 5533 |
| Community Event | 8855 |
| Halloween Basket / Treat | 2548, 2536 |
| Seasonal Gift | 5600 |
| Referral | 5251 |
| Subscriber | 5575, 5580 |
| Faction Armory / Give / Loan / Ownership / Loan Retrieve / Payout | 6731, 6733, 6746, 6751, 6752, 6753, 6749, 6797 |
| Player Send | 4101, 4103, 4105 |
| Parcel | 4001 |
| Auction Win | 4320 |
| Christmas Coupon | 8945 |
| Missions | 7900 |

Each log runs through `extractFreeItems`, then is aggregated by `` `${itemId}:${source}` ``
and every individual log is kept in `details[]` → **Acquisition History** (Date · Log Type · Qty).

---

## 6. Item Usage: `processUsageItems()`

**Sources** (`USAGE_SOURCE_MAP`): Consumed (the 2xxx "Item use" ids in `USAGE_LOG_GROUPS` +
easter eggs 8981–8989; 2621 → Relic Perish), Dumped (1400/1403), Parceled (4000),
Sent (4100/4102/4104), Faction Armory/Given/Claimed/Payout/Loan Return
(6725/6728/6732/6747/6750/6796), OC Spent (6768/6769), Museum Swap (7000),
Crime Loss (9163/9190/9191), Crime Spent (9300/9301/9302/9304/9305/9309/9310/9361),
Staff Removal (15021).

### ⚠️ Faction armory item use → own tab

Item-use logs (e.g. 2340 "Item use empty blood bag") carry a `faction` field. `processUsageItems`
returns **two** datasets, so faction-armory uses get their own **"Faction Used"** tab instead of
being dropped:

```js
const isFactionUse = source === 'Consumed' && d.faction;
const target       = isFactionUse ? fMap : map;          // fMap → "Faction Used" tab
const srcLabel     = isFactionUse ? 'Faction Used' : source;
```

- `faction: 0` → used the item **from your own inventory** → Item Usage tab (`source: Consumed`)
- `faction: <id>` → used the item **from the faction armory** → Faction Used tab (`source: Faction Used`)

Both tabs show the same columns (Item · Source · Qty · Mkt Price · Last Used) and share the
expandable history + lazy rendering.

### Special detail layouts

Depending on the source, each log records a **richer** `details[]` entry (shown in the
expandable history instead of the generic Date · Log Type · Qty):

| Source | Log ids | Stored extra fields | History view |
|---|---|---|---|
| Museum Swap | 7000 | `points` | Date · Sets · Points |
| Sent | 4100, 4102, 4104 | `receiver`, `message`, `items[]` | Date · To Player · Item · Qty · Message |
| Dumped | 1400, 1403 | `items[]` | Date · Items · Qty |
| everything else | — | `title` | Date · Log Type · Qty (generic) |

> The `data.set` string (priority 8 in §2) is what makes Museum Swap work: the log says
> which **set** was exchanged, so it becomes a `__set__` item with a `points` detail.

---

## 7. Trades: `processTrades()`

Trades are **not** aggregated per item — they're grouped per **trade**.

```
4430 Trade completed   → parsed_trade_id becomes the grouping key
4440 / 4441            → money outgoing / incoming
4445 / 4446            → items outgoing / incoming (summed per item id)
4450 / 4451            → properties outgoing / incoming
```

- A trade id groups all related sub-logs (money + items + props) into one record.
- Both sides are kept: `gave` and `received`, each with `money`, `items[]`, `properties[]`.
- Item values use the catalog's current market price (`tradeSideValue`).
- Trade rows are sorted newest-first and the search box matches item names on either side
  (plus trade id / player id).
- **Search mode**: when a search term is active, the **You Gave / You Receive** columns show
  only the matched item(s) with exact quantity (e.g. `1,093x Lollipop`) instead of the
  condensed summary; with no search they keep the normal summary (`5x Xanax`, `3 items`, …).

---

## 8. Aggregation + expandable history (all tabs)

- Rows are grouped (that's why the sum column shows totals, not individual logs).
- Every individual log is preserved in `details[]` in memory.
- Rows with **2+ records** get a **▶** arrow; clicking expands a history table:
  - built **lazily** on first click (nothing pre-rendered → fast with 5,000+ logs),
  - column headers are **sortable** (numeric-aware via `data-sort`),
  - Date column shows date + short time (`28 Jun 26 14:05`).
- Rows with a single record are not expandable (the aggregate already shows the same info).
- Tab badge numbers (Purchased, Sold, Trades, Free, Usage, Faction Used) reflect the
  **search-filtered** counts, so they update as you type in the search box.

---

## 9. Item names & prices

- The catalog (id → name, market value) is fetched from `${serverUrl}/api/portfolio/catalog`,
  cached in `localStorage` (`tornItemCatalog_v3`).
- Unknown ids display as `Item <id>` with price 0.
- Log type titles fall back through: server `details.title` → `log.title` → embedded
  `LOG_TYPE_NAMES` map (generated from `log_types.json`) → `Log <id>`.

---

## 10. Adding a new log type

1. Put the id in the right group (`BUY_LOG_TYPES` / `SELL_LOG_TYPES` / `TRADE_LOG_TYPES` /
   `FREE_LOG_GROUPS` / `USAGE_LOG_GROUPS`) — fetch batches are derived from these.
2. Map the id to a store (buy/sell) or source label (free/usage).
3. If the `data` shape isn't covered by `extractFreeItems` (§2), add a new branch at the top.
4. If it needs a special history view (like Museum Swap), add a branch in `usageDetailHTML`
   (or the matching detail builder) and record the extra fields in `details[]`.
5. Optionally add a badge color in `FREE_SOURCE_BADGE` / `USAGE_SOURCE_BADGE`.
6. Regenerate `LOG_TYPE_NAMES` from `log_types.json` if the title isn't in the script.
