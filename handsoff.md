# Torn Portfolio Tracker — Handoff Prompt

## Context

Building a full-stack portfolio tracker for Torn City (a browser game) on my Oracle Cloud A1 instance (Ubuntu 24.04). The instance already runs:

- Express app at `gvsantiago.com` managed by PM2
- Nginx with SSL
- **Postgres already running** — used by a separate `torn-tracker` app built previously. Reuse this instance, do not install a new one.

Local project is at `c:\workspace\personal-site`. **Start by exploring the project structure** — read `package.json`, find the main entry point (`server.js` / `app.js` / `index.js`), any existing `.env` or database config, and any existing torn-related files/routes — before writing any code.

---

## What to Build (in this order)

### Step 1 — Database Schema + Sync Worker

Create a migration file and a `torn-portfolio/sync.js` worker script.

**Sync worker behavior:**
- Reads the Torn API key from env (`TORN_API_KEY`)
- First run: fetches ALL available buy/sell logs via pagination (slow, one-time)
- Subsequent runs (every 15 min via node-cron): fetches only new entries since last sync timestamp
- Every sync cycle: re-snapshots current inventory (all 21 categories), bazaar, and display case
- Every sync cycle: updates the item catalog and live Points price

---

## Torn API Reference

**Base URL:** `https://api.torn.com`

| Endpoint | Purpose |
|---|---|
| `v2/user/log?log=TYPES&limit=100&sort=desc&key=KEY` | Buy/sell log entries |
| `v2/user/inventory?cat=CATEGORY&key=KEY` | Inventory per category |
| `user/?selections=bazaar&key=KEY` | Bazaar listings |
| `user/?selections=display&key=KEY` | Display case |
| `torn/?selections=items&key=KEY` | Full item catalog |
| `market/points?selections=pointsmarket&limit=1&key=KEY` | Live Points price |

**Log type IDs:**

- Buy types: `1103, 1112, 1220, 1225, 4201, 4200`
- Sell types: `1104, 1113, 1221, 1226, 4210, 4220`

**Log entry field extraction:**

```js
entry.timestamp           // unix seconds
entry.data.items[0].id    // item ID
entry.data.items[0].qty   // quantity
entry.data.cost_total     // total amount paid/received
entry.details.id          // log type number (e.g. 1112)
```

**Pagination:**
- Response: `{ log: [...], _metadata: { links: { prev: "cursor-url", next: null } } }`
- `log` is an array (not an object)
- Loop while `_metadata.links.prev !== null`, use the full `prev` URL as the next request
- **Critical:** Torn drops `key=` from `prev` URLs — re-append it: `if (!prevUrl.includes('key=')) prevUrl += '&key=' + apiKey`

**Inventory categories (all 21):**

```
Alcohol, Artifact, Booster, Candy, Clothing, Defensive,
Drug, Enhancer, Energy Drink, Flower, Jewelry, Material,
Medical, Melee, Other, Primary, Secondary, Special,
Supply Pack, Temporary, Tool
```

Inventory response format:
```json
{
  "inventory": {
    "items": [{ "id": 894, "amount": 1, "name": "Cosmetics Case" }]
  }
}
```

**Points sentinel:** item_id `999999999`, price = `Object.values(data.pointsmarket)[0].cost`

---

## Database Schema (Postgres)

```sql
-- Item catalog from Torn
CREATE TABLE IF NOT EXISTS torn_items (
  id           INT PRIMARY KEY,
  name         TEXT,
  type         TEXT,
  market_price BIGINT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Every buy/sell event; torn_log_id prevents duplicates on re-sync
CREATE TABLE IF NOT EXISTS torn_transactions (
  id           SERIAL PRIMARY KEY,
  torn_log_id  TEXT UNIQUE,
  happened_at  TIMESTAMPTZ,
  type         TEXT,         -- 'buy' | 'sell'
  item_id      INT,
  qty          INT,
  unit_price   NUMERIC,
  total_amount NUMERIC,
  source       TEXT          -- e.g. 'item_market', 'points_market', 'bazaar'
);

-- Periodic snapshot of holdings across all three locations
CREATE TABLE IF NOT EXISTS torn_inventory_snapshots (
  id         SERIAL PRIMARY KEY,
  taken_at   TIMESTAMPTZ DEFAULT now(),
  item_id    INT,
  location   TEXT,           -- 'inventory' | 'bazaar' | 'display'
  qty        INT,
  list_price BIGINT          -- bazaar listing price per unit, null otherwise
);

-- Sync cursor state
CREATE TABLE IF NOT EXISTS torn_sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Keys used: 'last_buy_ts', 'last_sell_ts', 'last_snapshot_ts'
```

---

## Step 2 — Express Routes + Dashboard UI

After the sync worker is solid, add routes under `/torn/`:

| Route | Purpose |
|---|---|
| `GET /torn/` | Main dashboard HTML |
| `GET /torn/api/portfolio` | Per-item aggregates (avg cost, remaining qty, unrealized P&L, realized P&L) |
| `GET /torn/api/history` | Historical portfolio value over time (for chart, from snapshots) |
| `POST /torn/api/sync` | Trigger a manual sync |

---

## P&L Formulas

```
avg_cost       = sum(total_amount for buys) / sum(qty for buys)
break_even     = avg_cost / (1 - tax_rate)     -- default tax 5%
remaining      = sum(buy_qty) - sum(sell_qty)
realized_pnl   = sum(sell_amount * (1-tax)) - qty_sold * avg_cost
unrealized_pnl = remaining * (market_price * (1-tax) - avg_cost)
total_pnl      = realized_pnl + unrealized_pnl
```

Uses **weighted average cost** (not FIFO) — simpler and appropriate for a single trader.

---

## Dashboard UI Design

Dark glassmorphism — same language as the existing Tampermonkey userscripts:

| Token | Value |
|---|---|
| Background | `#07080f` |
| Glass panels | `rgba(255,255,255,0.035)` with `1px solid rgba(255,255,255,0.07)` border |
| Accent (cyan) | `#6ee7f7` |
| Positive P&L | `#4ade80` (green) |
| Negative P&L | `#f87171` (red) |
| Warning | `#fbbf24` (amber) |
| Heading font | Space Grotesk |
| Number font | JetBrains Mono |
| Body font | Inter |

**Dashboard layout:**
- Summary tiles: Total Value · Cost Basis · Realized P&L · Unrealized P&L
- Main table: one row per item, sortable columns — Item, Location breakdown (Inv/Baz/Disp), Total Held, Avg Cost, Break Even, Mkt Price, Unrealized P&L, Realized P&L, Total P&L
- P&L over time: line chart (Chart.js) using daily snapshots
- Last sync timestamp + manual sync button

---

## Environment Variables

```
TORN_API_KEY     — full-access Torn API key
DATABASE_URL     — existing Postgres connection string (already in .env from torn-tracker)
```

---

## Implementation Notes

- Use `pg` (node-postgres) — check if it's already in `package.json` before installing
- Add the sync worker as a **separate PM2 process** (e.g. `ecosystem.config.js` entry) so it runs independently of the web server
- Or use `node-cron` inside the existing app if simpler
- No mock data — sync worker must call the real Torn API
- The `torn_log_id` unique constraint is the safety net against double-counting — always `INSERT ... ON CONFLICT (torn_log_id) DO NOTHING`
