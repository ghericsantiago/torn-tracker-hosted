'use strict';

/**
 * Reference catalog — Torn item catalog + Museum set compositions, loaded from the
 * repo-root JSON files. Wraps the raw Maps with name/value/resolve helpers so the
 * rest of the app never touches the files directly (SRP/ISP).
 */

const fs = require('fs');

function createCatalog(config) {
  const items  = new Map();   // item id → { name, market_price }
  const museum = new Map();   // set name → { points, items: [id…] }

  function load() {
    try {
      const catalog = JSON.parse(fs.readFileSync(config.itemsFile, 'utf8'));
      (catalog.items || []).forEach(i => items.set(i.id, {
        name: i.name,
        market_price: (i.value && i.value.market_price) || 0,
        category: i.type || '',
      }));
      console.log(`[init] item catalog: ${items.size} items`);
    } catch (e) {
      console.warn('[init] could not load torn_items.json — item names will fall back to "Item <id>".', e.message);
    }
    try {
      const mx = JSON.parse(fs.readFileSync(config.museumFile, 'utf8'));
      (mx.museum || []).forEach(s => museum.set(s.name, { points: s.points, items: s.items }));
      console.log(`[init] museum sets: ${museum.size}`);
    } catch (e) {
      console.warn('[init] could not load museum-exchange.json — museum swaps will show as __set__ pseudo-items.', e.message);
    }
  }

  function itemName(id) {
    if (typeof id === 'string') {
      if (id.startsWith('__points__')) return 'Torn Points';
      if (id.startsWith('__ammo__')) {
        const p = id.split('__');
        return `Ammo T${p[2]} S${p[3] || 0}`;
      }
      if (id.startsWith('__set__')) return id.slice(7);
    }
    const it = items.get(id) || items.get(Number(id));
    return it ? it.name : `Item ${id}`;
  }

  function itemValue(id) {
    const it = items.get(id) || items.get(Number(id));
    return it ? (it.market_price || 0) : 0;
  }

  function itemCategory(id) {
    const it = items.get(id) || items.get(Number(id));
    return it ? (it.category || '') : '';
  }

  // Resolve a manual-record item input (numeric id or item name) → item id
  // (string, matching state.items keys).
  function resolveItemId(input) {
    const s = String(input || '').trim();
    if (!s) return { error: 'Item is required (name or id).' };
    // Pseudo-items: accept both the display name and the raw id
    if (s === '__points__' || s.toLowerCase() === 'torn points') return { id: '__points__' };
    if (/^\d+$/.test(s)) {
      if (!items.has(Number(s))) return { error: `No item with id ${s} in the catalog.` };
      return { id: s };
    }
    const lower = s.toLowerCase();
    const entries = [...items.entries()];
    const exact = entries.find(([, it]) => (it.name || '').toLowerCase() === lower);
    if (exact) return { id: String(exact[0]) };
    const matches = entries.filter(([, it]) => (it.name || '').toLowerCase().includes(lower));
    if (matches.length === 1) return { id: String(matches[0][0]) };
    if (matches.length > 1) return { error: `Ambiguous — matches: ${matches.slice(0, 8).map(([, it]) => it.name).join(', ')}${matches.length > 8 ? '…' : ''}` };
    return { error: `No item named "${s}" found.` };
  }

  return { items, museum, load, itemName, itemValue, itemCategory, resolveItemId };
}

module.exports = { createCatalog };
