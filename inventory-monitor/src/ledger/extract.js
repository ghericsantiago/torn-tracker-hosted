'use strict';

/**
 * Data-shape parsers — reads the different `data` shapes Torn uses into a uniform
 * `[{ id, qty }]` list. Pure functions (no state); check order mirrors
 * ITEM_EXTRACTION.md §2.
 */

function extractFreeItems(data, logType) {
  const ammo = data.ammo_gained || data.ammo;
  if ((logType === 9027 || logType === 5533 || logType === 6500) && ammo && typeof ammo === 'object') {
    const entries = [];
    for (const [typeId, sizes] of Object.entries(ammo)) {
      if (sizes && typeof sizes === 'object') {
        for (const [sizeId, qty] of Object.entries(sizes)) {
          entries.push({ id: `__ammo__${typeId}__${sizeId}`, qty });
        }
      } else {
        entries.push({ id: `__ammo__${typeId}__0`, qty: sizes });
      }
    }
    return entries;
  }
  if (data.items_gained && typeof data.items_gained === 'object' && !Array.isArray(data.items_gained)) {
    return Object.entries(data.items_gained).map(([id, qty]) => ({ id: parseInt(id), qty }));
  }
  if (data.items && typeof data.items === 'object' && !Array.isArray(data.items)) {
    return Object.entries(data.items).map(([id, qty]) => ({ id: parseInt(id), qty }));
  }
  if (Array.isArray(data.items)) {
    return data.items.map(i => ({ id: i.id, qty: i.qty || 1 }));
  }
  if (Array.isArray(data.item)) {
    return data.item.map(i => ({ id: i.id, qty: i.qty || 1 }));
  }
  if (typeof data.item === 'number') {
    return [{ id: data.item, qty: data.quantity || 1 }];
  }
  if (typeof data.egg === 'number') {
    return [{ id: data.egg, qty: 1 }];
  }
  if (typeof data.set === 'string') {
    return [{ id: `__set__${data.set}`, qty: data.quantity || 1 }];
  }
  return [];
}

// Bazaar logs use `data.item` (number), `data.item_id`, or the generic shapes.
function extractBazaarItems(data) {
  if (typeof data.item === 'number') return [{ id: data.item, qty: data.quantity || 1 }];
  if (typeof data.item_id === 'number') return [{ id: data.item_id, qty: data.quantity || 1 }];
  if (data.item && typeof data.item === 'object' && !Array.isArray(data.item) && data.item.id !== undefined) {
    return [{ id: data.item.id, qty: data.item.qty || data.quantity || 1 }];
  }
  return extractFreeItems(data, 0);
}

module.exports = { extractFreeItems, extractBazaarItems };
