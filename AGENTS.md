# Project Instructions (AGENTS.md)

## Standing rule — documentation must stay in sync

**Whenever you change `portfolio-tracker.user-v2.js` (or any tracker/script behavior),
you MUST update `ITEM_EXTRACTION.md` in the same change** so the doc always reflects
how the code actually works.

- This includes: new/removed log types, changes to extraction rules, new tabs,
  changed aggregations, new detail/history views, renamed sources/badges,
  changes to fetch groups, or any behavioral change covered by the doc.
- Before finishing a task that touched the tracker, re-check `ITEM_EXTRACTION.md`
  for every section that could be affected and update it.
- The doc must stay accurate even if the user doesn't ask for it — keeping it
  current is part of the task, not optional.

**Whenever we DISCUSS anything related to items, logs, or inventory** — even without a
code change — update the relevant layer(s) so the docs capture the new understanding:

- Game rules / mechanics discussions → `GAME_MECHANICS.md`
- Log → item-flow / inventory-system discussions → `ITEM_TRACKING.md`
- Extraction implementation changes → `ITEM_EXTRACTION.md`
- Inventory-monitor implementation changes → `INVENTORY_MONITOR.md` (`inventory-monitor/`)

A single discussion can touch all three (e.g. a new log type: rules in `GAME_MECHANICS.md`,
flow in `ITEM_TRACKING.md`, implementation in `ITEM_EXTRACTION.md`). When in doubt, update
the doc — the docs are the shared memory of this project.

## Project context

- Main userscript: `portfolio-tracker.user-v2.js` (Torn portfolio tracker, runs in Tampermonkey).
- Doc layers: `GAME_MECHANICS.md` (Torn rules, tool-agnostic) → `ITEM_TRACKING.md`
  (declarative log→item-flow spec, the model for the inventory system) →
  `ITEM_EXTRACTION.md` (how the portfolio tracker implements the spec) +
  `INVENTORY_MONITOR.md` (how the inventory monitor implements it). Keep them in sync.
- `museum-exchange.json` = fixed Museum set compositions (set name → item ids + base points);
  source of truth for what a Museum exchange deducts.
- `torn_items.json` = Torn item catalog (id → name, type, market price) — use it to resolve
  item names/prices when needed (e.g. museum set item names).
- `log_types.json` = Torn log type id → title list (used to regenerate `LOG_TYPE_NAMES`).
- `inventory-monitor/` persists its derived state to **PostgreSQL** (`torn_tracker_v2`,
  creds in `inventory-monitor/.env`; schema in `inventory-monitor/schema.sql`, auto-applied at
  startup). Logs remain the source of truth.
- Server logs come from `${serverUrl}/api/portfolio/*` (hosted separately, not in this repo).
