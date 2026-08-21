# Game Mechanics — Torn Knowledge

Tool-agnostic notes on **how Torn behaves** — the source of truth for game rules.
For the **log → item flow definitions** (what each log means for inventory), see
`ITEM_TRACKING.md`. For how the portfolio tracker implements the extraction, see
`ITEM_EXTRACTION.md`.

---

## 1. Item transformations — "use" that isn't pure consumption

Some "Item use" logs don't just consume an item — they **transform** it into another item.
The **net effect** on inventory is: old item out, new item in.

### Empty Blood Bag → Blood Bag (log 2340)

When you **use an Empty Blood Bag** (`item: 731`):

- The **Empty Blood Bag is removed** from your inventory (it's the "used" item).
- A **filled Blood Bag is created** in your inventory instead — its item id comes from the
  `blood_bag` property of the log.
- Net effect: `-1 Empty Blood Bag (731)` **and** `+1 Blood Bag (<blood_bag id>)`.

Sample log:

```json
{
  "id": "wLOUx2JEGkw7RR3oYVKS",
  "timestamp": 1786539209,
  "details": { "id": 2340, "title": "Item use empty blood bag", "category": "Item use" },
  "data": {
    "item": 731,          // Empty Blood Bag that was used / removed
    "faction": 0,         // 0 = own inventory · <faction id> = used from faction armory
    "blood_bag": 738,     // Blood Bag item id that was created
    "life_decreased": 252,
    "armory_deposit": 0
  }
}
```

Key fields:

| Field | Meaning |
|---|---|
| `item` | the item consumed by the use (here: Empty Blood Bag, 731) |
| `blood_bag` | the item **created** by the transformation (here: Blood Bag, 738) |
| `faction` | `0` → from own inventory · non-zero → **used from the faction armory** |
| `armory_deposit` | if set, the transformation result goes into the armory, not your inventory |

> ⚠️ The **`faction` rule applies to all item-use logs**: when it's non-zero, the item
> came from the faction armory and **your inventory never changed** (no net flow for you).

### Container openings — drug pack, goodie bag, safe, basket

Other "use" logs **open a container**: the container is consumed and its **contents are
received**. Two data shapes (both implemented in the inventory monitor):

| Log | Shape | Net effect |
|---|---|---|
| 2390 Item use drug pack | `{item, item2, quantity}` | `-1 <item>` (pack) **+`quantity`× `<item2>`** (the drug) — **the `quantity` belongs to the result, not the container** |
| 2480 Item use dukes safe | `{item, item2}` | `-1 <item>` (safe) `+1 <item2>` (empty safe) |
| 2400 Item use goodie bag | `{item, items: [{id, qty}]}` | `-1 <item>` (bag) **+ each `items` entry** |
| 2535 Item use halloween basket | `{item, items: {id: qty}}` | `-1 <item>` (basket) **+ each `items` entry** |

Sample (user-verified): `{item: 370, faction: 0, item2: 205, quantity: 10}` → **drug pack 370
used (×1), drug 205 received (×10)**.

---

## 2. Museum Conversion (Museum Swap, log 7000)

At the Museum you can exchange **complete item sets** for **points**. The set's items
leave your inventory; the points are credited to you.

```
set (items)  ──Museum exchange──▶  points
   ↓
leaves your inventory (item OUTFLOW)
```

Log fields:

| Field | Meaning |
|---|---|
| `set` | set name, e.g. `"Plushie Set"` — which set was exchanged |
| `quantity` | how many sets were exchanged |
| `points_received` | points earned for the exchange (actual, after bonuses) |

### Set compositions — which items get deducted

Source of truth: **`museum-exchange.json`** (compositions) + **`torn_items.json`** (names).
Each set lists the **item ids** it is made of; exchanging **1 set** deducts **one of each**
listed item (× the set quantity).

> The inventory monitor tracks **both sides**: the item deduction (OUT, expanded to the set
> composition) **and** the reward — `points_received` is accumulated per swap and shown in
> the **Museum** tab (`INVENTORY_MONITOR.md` §4h).

| Set (`data.set`) | Points | Items deducted (1 of each per set) |
|---|---|---|
| Plushie Set | 10 | Sheep Plushie (186), Teddy Bear Plushie (187), Kitten Plushie (215), Jaguar Plushie (258), Wolverine Plushie (261), Nessie Plushie (266), Red Fox Plushie (268), Monkey Plushie (269), Chamois Plushie (273), Panda Plushie (274), Lion Plushie (281), Camel Plushie (384), Stingray Plushie (618) |
| Exotic Flower Set | 10 | Dahlia (260), Orchid (264), African Violet (282), Cherry Blossom (277), Peony (276), Ceibo Flower (271), Edelweiss (272), Crocus (263), Heather (267), Tribulus Omanense (385), Banana Orchid (617) |
| Meteorite Fragment | 15 | Meteorite Fragment (1488) |
| Patagonian Fossil | 20 | Patagonian Fossil (1487) |
| Arrowhead Set | 25 | Obsidian Point (1499), Quartzite Point (1500), Chert Point (1501), Basalt Point (1502), Chalcedony Point (1503), Quartz Point (1504) |
| Medieval Coin Set | 100 | Leopard Coin (450), Florin Coin (451), Gold Noble Coin (452) |
| Vairocana Buddha | 100 | Vairocana Buddha Sculpture (454) |
| Ganesha Sculpture | 250 | Ganesha Sculpture (453) |
| Shabti Sculpture | 500 | Shabti Sculpture (458) |
| Companion Scripts | 1000 | Companion Script : Abdullah (455), Companion Script : Ubay (456), Companion Script : Ali (457) |
| Senet Game Set | 2000 | Senet Board (462), White Senet Pawn (460), Black Senet Pawn (461) |
| Egyptian Amulet | 10000 | Egyptian Amulet (459) |

Example: exchanging **2 × Plushie Set** deducts `2× Sheep Plushie, 2× Teddy Bear Plushie, … 2× Stingray Plushie`.

> ⚠️ The `points` column is the **base value** per set. Actual earnings are
> `points_received` from the log (museum bonuses change them).

### Notes / gaps

- Set-to-points values change with museum events/bonuses — the raw `points_received` in the
  log is the source of truth, not a computed table.
- The log names the **set**, not the individual items consumed — the composition table is
  the only way to know which specific items left.

---

## 3. Trades

Torn logs a completed trade as a **set of sub-logs** sharing one trade id
(`parsed_trade_id`), split by side and content type:

```
4430 Trade completed    → trade id anchor
4440 / 4441             → money outgoing / incoming
4445 / 4446             → items outgoing / incoming
4450 / 4451             → properties outgoing / incoming
```

Mechanic facts:

- A trade has two sides: **You Gave** and **You Received** — each can carry money, items
  and/or properties, all exchanged at once when accepted.
- All sub-logs of the same trade id describe **one** completed trade (money summed, item
  quantities summed per item id). `d.user` identifies the counterpart.
- Trade log types also exist for things we **don't treat as item trades**: shares
  (legacy 4455–4458), NAPs / peace treaties (4460–4467), faction / company trades
  (4470–4478), and draft add/remove edits (4442/4443, 4447/4448) which never complete.

Valuation note: trade **value** is only an estimate — money + market price × qty.
Market price is not the agreed price; property values are not priced at all.

> The inventory monitor groups the sub-logs by `parsed_trade_id` into **You Gave / You
> Received** sides (money + items + properties) and shows them as expandable rows in the
> **Trading** tab (`INVENTORY_MONITOR.md` §4g). Only the item sides (4445/4446) move the
> player inventory ledger.

---

## 4. General field conventions

| Field | Meaning |
|---|---|
| `item` | item id (number) or `[{id, qty}]` (array) |
| `items` | `[{id, qty}]` array or `{itemId: qty}` object |
| `items_gained` | `{itemId: qty}` object (income) |
| `quantity` | count for the current item |
| `cost_total` / `cost` | money amount (buys: paid · sells: received, **already net of market tax**) |
| `faction` | on item-use logs: `0` = own inventory, else faction armory use |
| `ammo_gained` / `ammo` | `{type: {size: qty}}` ammo income |
| `set` | museum set name (log 7000) |

---

## 5. Bazaar stock

Your **Bazaar** is a separate stock location from your person inventory:

- **Adding** items to your bazaar (log 1210/1222 "Bazaar add") moves them **out of your
  inventory and into your bazaar** — you no longer hold them, they're listed for sale.
- **Selling** (log 1221/1226 "Bazaar sell") happens when **another player buys** from your
  bazaar: the item leaves your bazaar stock and you receive money (`cost_total`).
- **Removing** (log 1211/1223 "Bazaar remove") takes items off your bazaar and **back into
  your inventory**.
- On narrow/mobile layouts, Bazaar manage rows initially expose item identity plus
  **Info** / **Manage** actions; price controls are kept out of the collapsed row. Desktop
  manage rows expose the price control directly. Bazaar UI helpers must therefore attach
  item-level actions to the mobile action group rather than assuming a visible price cell,
  and must expand **Manage** before writing a new per-unit price. The Bazaar Pricer helper
  collapses that temporary mobile Manage panel again after populating Torn's pending
  per-unit value; **SAVE CHANGES** remains a separate user action.
- On the mobile Bazaar **Add Items** view, limited horizontal space is concentrated in the
  item-name cell. Item-level helper actions can share that cell when the name is allowed to
  truncate with an ellipsis; desktop helpers remain beside the price input. Real mobile
  detection cannot rely only on viewport width because Torn may retain a desktop-sized
  layout viewport; coarse-pointer and physical-screen checks are also needed. Controls
  inserted into the mobile name cell must contain pointer, touch, mouse, and click events
  because the surrounding Torn item row also opens item details.
- Item Market **Add Listing** rows expose separate React money-input pairs for quantity and
  per-unit price on both desktop and mobile. The Bazaar & Item Market Pricer can attach a
  chart action beside the price input, populate both React-facing price inputs, and use the
  amount input's available maximum when filling listing quantity. Submitting the listing
  remains a separate user action.
- **Bazaar buy** (1220/1225) is the *opposite* direction — *you* buying from another
  player's bazaar → items go to **your inventory** (this is a regular "Buy" flow, not a
  bazaar-stock flow).
- Logs 1200/1201/1202/1205/1206 (name/description/open/close/favorite) and 1212/1224
  (price edits) don't change stock.

Bazaar **revenue** = Σ `cost_total` of sell logs (net of nothing — bazaar sells aren't
market-taxed).

---

## 6. Display Case

Your **Display Case** is a third stock location — a small vanity shelf (unlocked via the
"Display Case" item / points) where you can show off items:

- **Adding** an item to the display (log 1300/1302 "Display add") moves it **out of your
  inventory onto the display case**.
- **Removing** an item (log 1301/1303 "Display remove") takes it off the display and **back
  into your inventory**.
- Items on display never sell or move on their own — only add/remove change stock. There's
  no money involved (display is purely for show).
- Log 4940 "Points display case unlock" isn't a stock change.

## 7. Item Market listings

The **Item Market** is a fourth stock location — items you list for sale to other players:

- **Adding/listing** an item (log 1100/1110 "Item market add") moves it **out of your
  inventory and onto the market** as a listing.
- **Selling** (log 1104/1113 "Item market sell") happens when another player buys your
  listing: the item leaves your listing permanently and you receive money (`cost_total`,
  already net of the market tax).
- **Removing** (log 1101/1111 "Item market remove") takes a listing down and the item
  returns **back into your inventory**.
- **Item market buy** (1103/1112) is the *opposite* direction — *you* buying from the
  market → items go to **your inventory** (a regular "Buy" flow, not a listing-stock flow).
- Logs 1102/1115/1116 (price / anonymity edits) don't change stock.

## 8. Torn Points

Torn Points are both a currency and a stock: you earn them, hold them, and spend them.

- **Earn**: Museum exchanges (log 7000) reward `points_received` (see §2); points also come
  from donations/subscriptions, crime successes, stocks etc. (not tracked as item flows).
- **Hold / trade**: the **Point Market** works like the item market — you can **add** a points
  listing (log 5000, points leave your wallet), **remove** it (5001, points return), **buy**
  points (5010) or have someone buy your listing (**sell**, 5011 — the points already left at
  add time, so a sell is a money event only).
- **Spend** (logs 4900–4975): energy/nerve/casino-token refills, unlockable features
  (bazaar, display case, stock ticker, racing license, city watch, friend/enemy/target/
  loadout capacity, Big Al's bunker, honors, hairstyles, backdrops) and merit buy/reset.
  Each log carries the exact cost as `data.points_used`. If the log has a `faction` value the
  points came from the **faction armory**, not the player.
- The inventory monitor tracks all of the above on the **Torn Points** pseudo-item
  (`__points__`), so the points balance (in − out since start) is visible like any item
  (`ITEM_TRACKING.md` §6f).

## 9. Christmas Town coupons

The seasonal **Christmas Town** event has its own currency: **coupons**.

- **Earning** coupons: log 8945 "Christmas town coupon receive" — completing minigames
  (`data.minigame`); the log carries no item id, so the monitor doesn't track the coupon
  itself (it's a seasonal currency, not a catalogued item).
- **Spending** coupons: log 8946 "Christmas town coupon exchange" — spend `"5 coupons"`
  (a string in `data.coupons`, no item id) and receive items from `data.items = {itemId: qty}`.
  The monitor tracks the **items received** as `in` flows (source `Christmas Town`); the
  coupon spend itself is not an inventory flow (`ITEM_TRACKING.md` §2).

## 10. Virus programming

The **Viruses** category covers writing computer viruses — a time-based skill action:

- **5800 Virus programming start** / **5801 cancel** — no item flow (nothing consumed or created).
- **5802 Virus programming complete** — a **virus item is created** in your inventory. The log
  carries only the virus **type by name** (`data.virus`, e.g. `"a simple"`), not an item id:
  `"a simple"` → **Simple Virus (69)**, `"a firewalk"` → **Firewalk Virus (103)**,
  `"a polymorphic"` → **Polymorphic Virus (70)**, etc.
- The monitor resolves the name against the catalog (items ending in "Virus") → `in` ×1,
  source `Virus Programming` (`ITEM_TRACKING.md` §6g).

## 11. Faction loans

Faction loans let members borrow items **from the faction armory** (not from any individual
member's personal inventory). Two log types fire when a loan is created:

| Log | Title | Who sees it | Personal inventory flow |
|-----|-------|-------------|-------------------------|
| **6745** | Faction loan item send | The member who *initiated* the loan (may be the same as the recipient) | **None** — item left the faction armory, not personal inventory |
| **6746** | Faction loan item receive | The member who *receives* the loaned item | **IN** — item enters personal inventory |

When a member loans an item to themselves (they initiate and receive the same loan), **both
6745 and 6746 appear on their own log**. Only 6746 is an `in` flow; 6745 is ignored because
it does not represent a personal-inventory outflow.

Loan lifecycle:

- **6749** "Faction loan item retrieve" — loan returned by the member: `out` from personal inventory, item goes back to faction armory.
- **6747** "Faction loan item return" (alternative return log) — same effect: `out`.

> ⚠️ Do NOT count 6745 as an `out`. The item came from the faction armory, not the player.

---

## 13. Ammo market

You can buy and sell ammo directly from the Torn Ammo Market:

- **4500 Ammo buy** — rounds enter your ammo supply: `{ ammo: <typeId>, quantity: <rounds>, value: <$> }`.
- **4510 Ammo sell** — rounds leave your ammo supply: same shape.
- **4520 Ammo priority** — sets which ammo type is used first in combat; **no inventory flow**.

Data shape note: the `ammo` field here is a plain integer (the ammo type id, e.g. `1`), not
the nested `{type:{size:qty}}` object used in crime / stock / company ammo logs. Both formats
map to the same `__ammo__<typeId>__0` pseudo-item in the inventory monitor.

⚠️ **Ammo consumed during fights has no Torn log type.** Rounds fired in attacks, defences,
faction wars, etc. are not logged — the only way to observe bullet drain is to compare
ammo totals between polls (snapshot-based). The inventory monitor therefore **cannot track
in-combat ammo consumption**.

Similarly, **temporary / booster items used mid-fight** (items consumed during a fight turn,
not from the inventory screen) produce no log entry. Attack logs (8100–8180) record fight
*outcomes* only (lost, stalemate, hospitalize, mug, loot…), not what was consumed during it.

## 14. Piggy Bank

The **Piggy Bank** (item 820) is a savings container. Two log types cover it:

| Log | Title | Inventory effect |
|---|---|---|
| **2380** | Item use piggy bank deposit | `out` item 820 (treated as consumed — the pig stays in your inventory in-game, but the log fires as a standard "Item use" event) |
| **2381** | Item use piggy bank withdraw | `out` item 820 (the pig is smashed — it is actually consumed) |

The deposit log (2380) fires for each money deposit into the pig; the pig is **not actually
consumed** then (it stays in inventory), but the Torn log API surfaces it as an "Item use"
event. The inventory monitor treats both 2380 and 2381 as `out` flows (source `Consumed`)
because that is the data Torn provides — this means deposit events create phantom `out`
records. Only 2381 (withdraw/smash) truly removes the pig from inventory.

## 12. Racing — car enlist / unenlist

Racing requires you to **enlist a car** (from your inventory) and lets you **unenlist** it
back:

- **8700 Racing enlist car** — the car (`data.car` = item id) leaves your inventory for the
  racing garage → `out`.
- **8701 Racing unenlist car** — the car returns to your inventory → `in`.
- Same alignment rule as the bazaar/display/market ledgers: the inventory ledger moves with
  the car (`ITEM_TRACKING.md` §6h).
