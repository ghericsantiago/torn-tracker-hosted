# Item Tracking — Log → Flow Definitions

The **spec layer** for the inventory management system: for every Torn log type we care
about, define the **item flows** (what leaves your inventory, what arrives, money/points
side effects), the **conditions** that decide which flows apply, and the **quantity**
expressions. Tools implement this spec — the portfolio tracker (see `ITEM_EXTRACTION.md`) and the
inventory monitor (`inventory-monitor/`, see `INVENTORY_MONITOR.md`) do today.

Game-rule background (transformations, museum, trades): see `GAME_MECHANICS.md`.

---

## Flow schema

Each log yields zero or more **flows**:

```json
{
  "logType": 2340,
  "title": "Item use empty blood bag",
  "conditions": [
    { "field": "data.faction", "op": "==", "value": 0 }
  ],
  "flows": [
    { "direction": "out", "item": "data.item",  "qty": "data.quantity || 1" },
    { "direction": "in",  "item": "data.blood_bag", "qty": 1 }
  ]
}
```

- `direction`: `in` = +qty to inventory · `out` = −qty from inventory.
- `item`: either a literal item id, a log field path (`data.blood_bag`), a synthetic
  pseudo-id (`__points__`, `__ammo__…`, `__set__…`), or a lookup (museum set → items).
- `qty`: a literal number or a path expression (`data.quantity || 1`).
- `money` / `points`: optional side-effect fields (not inventory items, tracked separately).

---

## 1. Buy / Sell — item flows with money

Buy log types: **1103, 1112, 1220, 1225, 4201, 4200, 5010** · store from `LOG_TYPE_STORE`.
Sell log types: **1104, 1113, 1221, 1226, 4210, 4220, 5011**.

| Log group | Flows |
|---|---|
| Buy | `in` item (`data.item[0].id` or `data.item` number), qty `data.quantity \|\| 1`, money `−data.cost_total` |
| Sell | `out` item, qty same, money `+data.cost_total` (already **net of market tax**) |
| Points (5010 buy / 5011 sell) | item = pseudo `__points__`, qty, money ∓ cost |

- `data.item` may be `[{id, qty}]` (take first), a number, or fall back to `data.items[0].id`.
- Buy from **Bazaar** and **Point Market** are tax-exempt; Item Market sells are taxed.

---

## 2. Free items — income (no money)

Log groups + source labels: see `ITEM_EXTRACTION.md` §5. Every one of them is a plain
**`in` flow** of item(s) at qty from the log data, resolved through the extractor shapes:

| `data` shape | Item id source | Qty |
|---|---|---|
| `ammo_gained` / `ammo` = `{type:{size:qty}}` | pseudo `__ammo__<type>__<size>` | value |
| `items_gained` = `{itemId: qty}` | each key | value |
| `items` object = `{itemId: qty}` | each key | value |
| `items` array = `[{id, qty}]` | each `id` | `qty \|\| 1` |
| `item` array = `[{id, qty}]` | each `id` | `qty \|\| 1` |
| `item` number | it | `data.quantity \|\| 1` |
| `egg` number | it | 1 |
| `set` string (log 7000 — see §4) | pseudo `__set__<name>` | `data.quantity \|\| 1` |

**8946 Christmas town coupon exchange** also lands here (source `Christmas Town`): its
`data.items = {itemId: qty}` is the items **received** for spending coupons — `in` each
entry. The coupon spend itself (a seasonal currency, `"5 coupons"` string, no item id) is
not an inventory flow.

---

## 3. Item use — consumption & transformations

Usage log groups + sources: see `ITEM_EXTRACTION.md` §6 (Consumed, Dumped, Parceled, Sent,
Faction…, OC Spent, Crime Spent/Loss, Relic Perish, Staff Removal).

### Base rule (pure consumption)

- Default: **`out`** of `data.item`, qty `data.quantity || 1` (e.g. the 2xxx Consumed ids in
  `USAGE_LOG_GROUPS` + easter eggs 8981–8989, Dumped 1400/1403, Sent 4100/4102/4104, …).

### Condition — faction armory use

- **If `data.faction != 0`** on a `Consumed` log: the item came from the faction armory →
  **no inventory flow** for the player (tracked separately as armory use).
- `faction == 0` (or absent) → normal `out` flow from own inventory.

### Transformations (net effect)

| Log | Condition | Flows |
|---|---|---|
| 2340 Item use empty blood bag | `faction == 0` | `out` `data.item` (empty bag) **+ `in` `data.blood_bag`** (filled bag, qty 1) |
| 2340 … | `faction != 0` | no player flow (armory) |
| 2340 … | `armory_deposit` set | `in` lands in the armory instead of the player inventory → **the player only sees the `out` flow** (decided; implemented in the inventory monitor) |
| 2390 Item use drug pack | `faction == 0` | `out` `data.item` (pack, qty 1) **+ `in` `data.item2`** × `data.quantity` (e.g. pack 370 → drug 205 × 10) |
| 2400 Item use goodie bag | `faction == 0` | `out` `data.item` (bag) **+ `in` each `data.items`** (array `[{id, qty}]`) |
| 2480 Item use dukes safe | `faction == 0` | `out` `data.item` (safe) **+ `in` `data.item2`** (empty safe, qty 1) |
| 2535 Item use halloween basket | `faction == 0` | `out` `data.item` (basket) **+ `in` each `data.items`** (object `{id: qty}`) |
| any container log | `faction != 0` | no player flow (armory) |

> Container-opening rule (`item2` / `items`): when a use log carries **`data.item2`** the
> `quantity` belongs to the **result** item, not the container — `out container ×1`,
> `in item2 × quantity`. When it carries an **`items`** array/object (goodie bag,
> halloween basket) each entry is received. Source label `Opened`.

> Implementation status: the **inventory monitor** implements the full transformation
> (out + in, incl. the `armory_deposit` rule and the `item2`/`items` container rule). The
> portfolio tracker still implements only the `out` half.

---

## 4. Museum exchange (log 7000)

- `out` **one of each** item in the set's composition (from `museum-exchange.json`),
  × `data.quantity`.
- `points` side-effect: `+data.points_received`.
- Item identity: synthetic `__set__<data.set>` for display; the real deduction is the
  composition list. Conditions: none (museum is always own inventory).
- The monitor records the reward as a **swap event** (`set`, `quantity`, `points_received`)
  for the **Museum** tab — see `INVENTORY_MONITOR.md` §4h.

---

## 5. Trades — grouped by trade id

Group all sub-logs by `data.parsed_trade_id` (anchor log 4430), then:

| Sub-log | Side | Flows |
|---|---|---|
| 4440 money outgoing | gave | money `−d.money` |
| 4441 money incoming | received | money `+d.money` |
| 4445 items outgoing | gave | `out` each `{id, qty}` |
| 4446 items incoming | received | `in` each `{id, qty}` |
| 4450 property outgoing | gave | property out (not an item flow) |
| 4451 property incoming | received | property in (not an item flow) |

- Item quantities **sum per item id** within the side.
- Ignore draft add/remove logs (4442/4443, 4447/4448) and share/NAP/faction/company
  trade logs — they don't represent completed item exchanges.
- Verified real Torn shape: trade sub-logs carry `details.id` (no top-level `log` field),
  `data.user` (counterpart), `data.parsed_trade_id` (numeric) and `data.items` as
  `[{ id, uid, qty }]` — all handled by the monitor's extraction.
- The monitor's main ledger applies 4445 as `out` and 4446 as `in` (both source `Trade`),
  so they appear in the Monitor IN/OUT tables. It also **groups the sub-logs by
  `parsed_trade_id`** (4430 anchor + 4440/4441 money + 4445/4446 items + 4450/4451
  property) into **You Gave / You Received** sides for the **Trading** tab (expandable
  detail rows, money + properties included) — see `INVENTORY_MONITOR.md` §4g.

---

## 6. Reference data files

| File | Use |
|---|---|
| `museum-exchange.json` | set name → item ids + base points (museum deductions) |
| `torn_items.json` | item id → name / type / market price (resolve names & value) |
| `log_types.json` | log type id → title (resolve log titles) |

---

## 6b. Inventory state model (current = baseline + flows)

Logs only record **movement** — they can't tell you what you held *before* the tracking
window. Any log-driven inventory therefore needs a **baseline** at the start point:

```
current = baseline(startTs) + Σ in flows − Σ out flows
```

Decisions (implemented in the inventory monitor, `INVENTORY_MONITOR.md` §4b):

- The monitor's baseline is **zero** (delta-only ledger): `current = net` per item.
  `net > 0` → in stock; `net < 0` → **overdrawn** (consumed pre-existing stock, true
  balance unknown). The ledger becomes a real inventory as activity accumulates.
- Alternative baselines (not implemented): one-time seed from a trusted snapshot, or a
  manual starting-quantity table.

---

## 6c. Bazaar stock flows (separate ledger)

The **Bazaar** is its own stock location (`GAME_MECHANICS.md` §5). Bazaar-scoped flows —
**relative to bazaar stock**, not the person inventory:

| Log | Bazaar direction | Notes |
|---|---|---|
| 1210 / 1222 Bazaar add | `in` | item stocked on the bazaar (also leaves the player inventory) |
| 1221 / 1226 Bazaar sell | `out` | another player bought it → money `+data.cost_total` (revenue) |
| 1211 / 1223 Bazaar remove | `out` | taken off the bazaar back to the player inventory |

- Implemented as a **separate ledger** in the inventory monitor (`state.bazaar`), but the
  main person-inventory ledger **stays aligned**: bazaar **add** → inventory `out`,
  bazaar **remove** → inventory `in`, bazaar **sell** → *no* inventory flow (the item
  already left inventory when it was stocked — so 1221/1226 are **not** treated as regular
  sells in the monitor's main ledger; the portfolio tracker still treats them as "Sell").
- Bazaar flows also appear in the shared activity feed tagged `Bazaar Sold` / `Bazaar
  Added` / `Bazaar Removed`; the inventory-side moves appear as `Bazaar Add` / `Bazaar
  Remove`. Every bazaar move is also recorded as a **transfer event** (location→location,
  e.g. `Inventory → Bazaar`, `Bazaar → Sold`) for the Transfers view.

---

## 6d. Display Case flows (separate ledger)

The **Display Case** is its own stock location (`GAME_MECHANICS.md` §6). Display-scoped
flows — **relative to display stock**, not the person inventory:

| Log | Display direction | Notes |
|---|---|---|
| 1300 / 1302 Display add | `in` | item placed on the display (also leaves the player inventory) |
| 1301 / 1303 Display remove | `out` | taken off the display back to the player inventory |

- Implemented as a **separate ledger** in the inventory monitor (`state.display`); no money
  is involved. The main person-inventory ledger stays aligned: display **add** → inventory
  `out`, display **remove** → inventory `in`.
- Display flows appear in the shared activity feed tagged `Display Added` / `Display
  Removed`; the inventory-side moves appear as `Display Add` / `Display Remove`. Each move
  is also recorded as a **transfer event** (`Inventory → Display`, `Display → Inventory`).

### 6e. Item Market listing ledger

The **Item Market listing** is a fourth location — items you list for sale to other players
(`GAME_MECHANICS.md` §7):

| Log | Direction | Meaning |
|---|---|---|
| 1100 / 1110 Item market add | listing `in` | item listed → moved **out of the player inventory** (`Inventory → Market`) |
| 1104 / 1113 Item market sell | listing `out` | another player bought the listing → money (`cost_total`, net of market tax); **no inventory flow** |
| 1101 / 1111 Item market remove | listing `out` | listing taken down → item **back into the player inventory** (`Market → Inventory`) |

- Implemented as a **separate ledger** in the inventory monitor (`state.market`, with
  `revenue` + `unitsSold` aggregates). The main person-inventory ledger stays aligned:
  market **add** → inventory `out`, market **remove** → inventory `in`, market **sell** →
  no inventory flow (the item already left inventory when listed). Consequently the monitor
  excludes 1104/1113 from its Sell group (the portfolio tracker still treats them as
  "Sell").
- Market flows appear in the shared activity feed tagged `Market Added` / `Market Sold` /
  `Market Removed`; the inventory-side moves appear as `Market Add` / `Market Remove`. Each
  move is also recorded as a **transfer event** (`Inventory → Market`, `Market → Inventory`,
  `Market → Sold`).

### 6f. Torn Points ledger (`__points__` pseudo-item)

Torn Points are tracked as the pseudo-item `__points__` ("Torn Points" in the UI), so their
balance behaves like any other item in the Monitor/Inventory ledger:

| Log | Direction | Source (activity / popup) |
|---|---|---|
| 5010 Points market buy | `in` | `Buy` |
| 5011 Points market sell | — | **no inventory flow** (points already left when listed, 5000) |
| 5000 Points market add (listing) | `out` | `Points Market Add` |
| 5001 Points market remove | `in` | `Points Market Remove` |
| 4900–4975 Points usage (refills, unlocks, merits) | `out` | `Points Used: <kind>` (qty = `data.points_used`; skipped when `data.faction` is set — faction-armory points) |
| 7000 Museum exchange | `in` | `Museum: <set>` (qty = `data.points_received`, alongside the set-item `out` flows) |

- Same alignment rule as the item/bazaar/market ledgers: **selling** points (5011) is not an
  inventory flow — the points left your wallet at listing time (5000 add → `out`, 5001 remove
  → `in`).
- `data.points_used` is the authoritative cost (e.g. `{"points_used": 30, "energy_increased": 150}`);
  if the refill was paid from faction points the log carries a `faction` value → no player flow.
- Museum conversions add the earned points as `in` **and** the set items as `out` in the same
  log (one swap → points in + items out).

### 6g. Virus programming (5802)

Programming a virus is time-based (nothing consumed) — **completion creates the virus**:

| Log | Direction | Source | Notes |
|---|---|---|---|
| 5802 Virus programming complete | `in` | `Virus Programming` | qty 1; the item is resolved **by name** from `data.virus` (`"a simple"` → item 69 Simple Virus, `"a firewalk"` → 103, `"a polymorphic"` → 70 — any catalog item ending in "Virus") |
| 5800 start / 5801 cancel | — | — | no item flow |

- The name→id map is built from the catalog (items whose name ends in "Virus"); an
  unresolvable type logs a warning and produces no flow.

### 6h. Racing — car enlist / unenlist (8700 / 8701)

The racing garage is a "location" for your cars (like bazaar/display/market for items):

| Log | Direction | Source | Notes |
|---|---|---|---|
| 8700 Racing enlist car | `out` | `Racing Enlist` | car (`data.car` item id) leaves inventory for the garage |
| 8701 Racing unenlist car | `in` | `Racing Unenlist` | car back in inventory |

---

## 7. Open questions / TODO

- [x] Transformation `in` half for log 2340 — implemented in the **inventory monitor**
      (`inventory-monitor/server.js`); still pending in the portfolio tracker (see §3 note).
- [x] `armory_deposit` semantics — decided: the transformation result lands in the armory,
      so the player only gets the `out` flow (§3).
- [ ] Decide how "created" items display in the portfolio tracker (source label vs
      `+qty` marker) — irrelevant for the inventory monitor (flows are the model).
- [x] Machine-readable flow spec — implemented as code in `inventory-monitor/server.js`
      (`logFlows()`), with extraction shapes documented in `INVENTORY_MONITOR.md` §4.
