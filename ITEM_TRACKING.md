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
- **FIFO cost capture:** for buy logs, `data.cost_total` is stored as the FIFO lot `unit_cost`
  (cost per unit = `cost_total / qty`). Free items (`FREE_LOG_TYPES`) receive `unit_cost = 0`;
  trade items receive a proportional cost share using market-value weights (post-batch).

### 1b. Ammo market — buy (4500) / sell (4510)

Ammo uses a **flat data shape** (not `data.item`) and maps to the `__ammo__` pseudo-item namespace:

| Log | Direction | Source | Data shape |
|---|---|---|---|
| 4500 Ammo buy | `in` | `Ammo Buy` | `{ ammo: <typeId>, quantity: <rounds>, value: <$> }` |
| 4510 Ammo sell | `out` | `Ammo Sell` | same |

- Item id: pseudo `__ammo__<typeId>__0` — same namespace as ammo received from crimes/stocks
  (which use a nested `{type:{size:qty}}` shape), but size is always `0` in the buy/sell log.
- `data.value` is the total money paid/received — not tracked as an inventory flow.
- **4520 Ammo priority** — preference setting only, no inventory flow.
- ⚠️ Ammo **consumed during fights** has no Torn log type — it cannot be tracked via logs.
  See `GAME_MECHANICS.md` §13.

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

**7900 Missions buy reward item** (source `Missions`) — purchasing a reward item from the
Missions shop using mission credits. Shape: `data.item = <id>` (number), `data.quantity`,
`data.credits_spent`. The `credits_spent` field is not an inventory flow — only the item
arriving is tracked as `in`.

**Faction loan receive (6746)** — item enters personal inventory from the faction armory → `in`.
The companion log 6745 "Faction loan item send" is **not** an inventory flow (see below).

---

## 2b. Faction loan send (6745) — no inventory flow

When a faction loan is created, **two log entries** appear on the initiating member's log:

- **6746** Faction loan item receive → `in` (item enters personal inventory from faction armory)
- **6745** Faction loan item send → **no flow** (item left the faction armory, never personal inventory)

When a member loans an item to themselves, both appear on the same log. Only 6746 generates
a flow. 6745 is excluded from `USAGE_LOG_TYPES` to prevent a false `out` on personal inventory.

Loan return flows (item leaves personal inventory back to faction armory):
- **6749** Faction loan item retrieve → `out` (source: `Faction Loan Retrieve`)
- **6747** Faction loan item return → `out` (source: `Faction Loan Return`)

See `GAME_MECHANICS.md` §11 for the full loan lifecycle.

---

## 3. Item use — consumption & transformations

Usage log groups + sources: see `ITEM_EXTRACTION.md` §6 (Consumed, Dumped, Parceled, Sent,
Faction…, OC Spent, Crime Spent/Loss, Relic Perish, Staff Removal).

**Ledger tracking:** all `USAGE_LOG_TYPES` now also emit `side: 'use'` transaction records
in the Ledger tab (via `logUsageTransactionEvents` in `src/ledger/transactions.js`). Channel
is derived from `USAGE_SOURCE_TO_CHANNEL` in `src/constants.js`:
- `usage` — Consumed, Dumped, Crime Loss/Spent, Relic Perish, Staff Removal
- `gift` — Sent (4100/4102/4104), Parceled (4000), Faction Given (6732), Faction Payout (6796)
- `faction` — Faction Armory deposit/claim (6725/6728/6750), Loan Return (6747), OC Spent (6768/6769)
- `museum` — Museum Swap (7000)

These rows carry `total_price = null` (no monetary value) and do not affect the running balance.

### Base rule (pure consumption)

- Default: **`out`** of `data.item`, qty `data.quantity || 1` (e.g. the 2xxx Consumed ids in
  `USAGE_LOG_GROUPS` + easter eggs 8981–8989, Dumped 1400/1403, Sent 4100/4102/4104, …).

### Condition — faction armory use

- **If `data.faction != 0`** on a `Consumed` log: the item came from the faction armory →
  **no inventory flow** for the player (tracked separately as armory use).
- Same exclusion applies in `logUsageTransactionEvents` — no ledger row is emitted for
  armory-consumed items.
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
- **5011 now fetched:** log type 5011 (points market sell) is included in `ALL_LOG_TYPES` and
  `NO_FLOW_TYPES` — it triggers no inventory flow but emits a **transaction record** in the
  ledger (channel `points_market`, side `sell`), so revenue from point sales appears in the
  Ledger tab.
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

---

## 8. Trade-page pricing automation

`tampermonkey/trade-automation.user.js` is an operational companion to the
receipt tool. It does not infer inventory movements or replace Torn logs as the
source of truth. When explicitly enabled, it processes the current-trade queue
oldest-expiring first, tells the counterpart to add their items, and waits for
the configurable timeout (60 seconds by default). Chat replies
and confirmation keywords do not gate pricing. At the deadline it requests a
server preview of the current trade contents. If the preview contains one or
more items, it creates a receipt using the server catalog's effective prices,
posts the receipt URL and total, adds that total as the local side's trade
money, posts a thank-you comment after the money form returns, and then returns
to the current-trade list. If the preview contains no items,
the job enters a resumable `waiting_for_items` stage: no receipt is created, no
total is posted, and no money is added. The selected reactive trade remains
under observation across refreshes. Once an item appears, the job returns to a
ten-second quiet-period wait and then retries pricing. **Skip Trade** remains
available if the operator wants to stop waiting and continue the queue.

The waiting deadline adapts to Torn's reactive item updates. With no detected
counterpart item, the configured default deadline is retained. When the
counterpart item area or a counterpart "added Nx ... to the trade" log entry
first indicates an item, the remaining wait becomes a ten-second quiet period.
Every subsequent item-signature change restarts that ten-second period, capped
by the original default deadline. This refreshes the timer only; it does not
refresh the Torn page.

The active trade and each transition are persisted before comments, form
submissions, and navigation. This makes page reloads and Torn's hash-based
redirects resumable. A trade id enters persistent completed history only after
the second manual acceptance reaches `step=accept2`; those completed ids are
skipped by both DOM and API discovery on later runs and expire after 30 days.
Empty, timed-out, interrupted, reset, or partially processed trades never enter
that history. Only a manual **Skip Trade** uses a five-minute trade-id cooldown
to prevent immediate reselection loops. All
three outgoing comment templates (item request, receipt, and thank-you) are
managed in the userscript settings. The receipt
comment supports
`{url}`, `{total}`, and `{tradeId}` placeholders; Torn comments remain limited
to 155 characters. Incoming-trade discovery watches the reactive global status
icon whose `/trade.php` link has an `aria-label` beginning with `Trade pending:`.
The userscript therefore runs on all Torn pages. A newly appearing alert opens
the trade page; if it appears while an already-open trade list is stale, that
list is refreshed exactly once. The alert label is persisted as a latch so the
same notification cannot create a reload loop. No background trade-list
requests are made. Movement between the list, selected-trade, and add-money
views uses Torn's hash routes only. A missing alert must remain absent for five
seconds before the latch resets, covering transient header rebuilds; selected
trade and add-money routes are never refreshed by the alert listener.
As an optional discovery source, the userscript polls Torn API v2
`GET /user/trades?cat=ongoing` while enabled and idle. It requires a
limited-access Torn API key configured in Settings, defaults to a 30-second
interval (minimum 15 seconds), and selects the ongoing trade with the earliest
`expires_at`. This API poller supplements the status-icon/list discovery and
does not cache returned trade ids. Every poll includes a Unix-millisecond `_`
query parameter so browsers and intermediary caches see a unique request URL;
this does not override caching intentionally enforced by Torn's API servers.
The Settings dialog also provides **Reset Automation**. After confirmation it
restores the default timeout and messages, disables automation, and clears the
active job, completed-trade history, pending-alert/navigation latches, and
locked-trade cooldowns. The Tampermonkey menu also exposes **Clear Completed
Trade History** independently for retesting.

Completed-history and lock handling are both keyed by Torn **trade id**, never
by counterpart user id. If the selected page reports "This trade is currently
locked. Please wait" before pricing/payment is complete, that trade id receives
a separate five-minute cooldown. DOM and API discovery ignore it during the
cooldown, after which it is eligible for retry; it is not marked completed.
The cooldown can be cleared from the Tampermonkey menu with **Clear Locked Trade
Cooldowns**. Lock detection scans the selected trade container's complete
visible text rather than depending on a specific alert class. While any job is
active, the floating panel also exposes **Skip Trade**, which manually applies
the same trade-id-specific five-minute cooldown and clears the active job.
The floating automation status and settings panel is anchored at the top-right
of the viewport.
While a trade is in the waiting stage, that panel displays **Price Now**. A
manual click moves the stored deadline to the current time, causing the next
tick to check for items and advance immediately instead of waiting for the
remaining countdown.
The intended hash target is persisted before navigation and guarded for 60
seconds, preventing a document startup from repeatedly issuing the same route
transition if Torn rebuilds or reloads the page.
Comment submission accepts Torn's historical `#postTradeMessage` field as well
as current `name="post"`, inserter-form, and comment-panel input/textarea
variants. Native value setters and bubbled input/change events are applied for
the actual control type before the form is submitted. The comment submit
control has its disabled property, attribute, and disabled styling removed,
then the actual Torn `ADD` control is clicked (rather than using the browser's
`requestSubmit()` shortcut). Because Torn renders
these route controls asynchronously, DOM-dependent stages wait without error
until their comment, add-money link, or money form exists. Receipt creation is
also deferred until the comment form is present, avoiding duplicate receipts
caused by render-timing retries.
Before any item-request, receipt, or thank-you comment is submitted, the script
normalizes the intended 155-character message and compares it with comments in
the visible trade log. When Torn exposes the current player id, the comparison
is restricted to that player's comments. An exact existing match advances the
persisted job stage without filling or clicking ADD again, making comment
submission idempotent across unexpected page refreshes.
On the add-money route, the amount is filled first and the intended submission
time is persisted. The actual Torn Change/Add control is clicked no earlier
than one second later.
After Torn returns to the selected trade, the persisted `returning` stage waits
for the asynchronously rendered comment form, posts the editable thank-you
message, and records `thank_posted`. It then enters `awaiting_accept`, visibly
highlights Torn's acceptance control, and pauses for the player's manual input.
The first manual ACCEPT moves Torn into reconfirmation; when its legitimate
second ACCEPT becomes enabled, that control is highlighted for a second manual
click. The script neither removes the countdown nor clicks either control.
After Torn reaches `step=accept2`, the receipt is marked complete and the
automation returns to the queue.
