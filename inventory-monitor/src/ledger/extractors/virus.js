'use strict';

/**
 * Extractor: Virus programming complete (5802) — the log carries the virus **type by
 * name** (`data.virus`, e.g. `"a simple"`), not an item id. We resolve it against the
 * catalog: every item whose name ends in "Virus" becomes a keyword map
 * (e.g. "Simple Virus" → keyword "simple" → item 69), so `"a simple"` → Simple Virus `in`.
 *
 *   data.virus = "a simple"      → in 69 (Simple Virus)
 *   data.virus = "a firewalk"    → in 103 (Firewalk Virus)
 *   data.virus = "a polymorphic" → in 70 (Polymorphic Virus)
 *
 * Programming consumes only time (no source item) — a completed virus is pure `in`.
 * 5800 (start) / 5801 (cancel) produce no item flow.
 */

const types = [5802];

const SOURCE = 'Virus Programming';
let keywordMap = null;   // lazily built from the catalog: keyword → itemId

function buildMap(catalog) {
  keywordMap = new Map();
  for (const [id, it] of catalog.items) {
    const name = (it.name || '').toLowerCase();
    if (!name.endsWith('virus')) continue;
    const keyword = name.replace(/ virus$/, '').trim();
    if (keyword) keywordMap.set(keyword, id);
  }
}

function extract(log, ctx) {
  if (!keywordMap) buildMap(ctx.catalog);
  const d = log.data || {};
  const raw = String(d.virus || '').toLowerCase().trim();
  if (!raw) return [];

  // Accept "a simple", "simple", "simple virus" → keyword "simple"
  const stripped = raw.replace(/^(a|an) /, '');
  const keyword = keywordMap.has(stripped) ? stripped
    : keywordMap.has(raw) ? raw
    : keywordMap.has(raw + ' virus') ? raw + ' virus'
    : null;

  if (keyword == null) {
    console.warn(`[ledger] unknown virus type "${d.virus}" — no flow`);
    return [];
  }
  return [{ dir: 'in', itemId: keywordMap.get(keyword), qty: 1, source: SOURCE }];
}

module.exports = { types, extract };
