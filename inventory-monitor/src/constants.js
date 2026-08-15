'use strict';

/**
 * Log type groups — the single source of truth for which Torn log types produce
 * which flows. Same groups as the portfolio tracker (portfolio-tracker.user-v2.js /
 * ITEM_EXTRACTION.md) and documented in ITEM_TRACKING.md.
 *
 * OCP: adding a new log type is a data change here (new set entry / map entry),
 * not a change to the flow logic.
 */

// ── Inventory buy / sell ─────────────────────────────────────
const BUY_LOG_TYPES  = new Set([1103, 1112, 1220, 1225, 4201, 4200, 5010]);
// 1221/1226 (bazaar sells), 1104/1113 (item market sells) and 5011 (point market sells)
// are NOT inventory flows — the item/points already left inventory when it was
// stocked/listed (ITEM_TRACKING.md §6c/§6e). Handled as bazaar/market-only flows.
const SELL_LOG_TYPES = new Set([4210, 4220]);
const POINTS_LOG_TYPES = new Set([5010]);        // point market BUY only (sell → no inventory flow)

// ── Torn Points market listing + usage ───────────────────────
// Listing moves points out of your wallet, removing the listing moves them back.
const POINTS_MARKET_ADD_LOG_TYPES    = new Set([5000]);
const POINTS_MARKET_REMOVE_LOG_TYPES = new Set([5001]);
// Points spent on refills / unlocks / merits (qty from data.points_used; skipped
// when data.faction is set = points came from the faction armory).
const POINT_USAGE_LOG_TYPES = new Set([4900, 4905, 4910, 4915, 4920, 4925, 4926, 4927,
                                       4930, 4935, 4940, 4945, 4950, 4955, 4960, 4965, 4970, 4975]);
const POINT_USAGE_SOURCE = {
  4900: 'Points Used: Energy Refill', 4905: 'Points Used: Nerve Refill',
  4910: 'Points Used: Casino Token Refill', 4915: 'Points Used: Stock Ticker',
  4920: 'Points Used: Friend Capacity', 4925: 'Points Used: Enemy Capacity',
  4926: 'Points Used: Target Capacity', 4927: 'Points Used: Loadout Capacity',
  4930: 'Points Used: Racing License', 4935: 'Points Used: City Watch',
  4940: 'Points Used: Display Case', 4945: 'Points Used: Bazaar',
  4950: 'Points Used: Merit Buy', 4955: 'Points Used: Merit Reset',
  4960: 'Points Used: Big Al\'s Bunker', 4965: 'Points Used: Honor',
  4970: 'Points Used: Hairstyle', 4975: 'Points Used: Backdrop',
};

// ── Trades ───────────────────────────────────────────────────
const TRADE_OUT_LOG_TYPES = new Set([4445]);   // items outgoing
const TRADE_IN_LOG_TYPES  = new Set([4446]);   // items incoming
// All trade sub-logs used to group a completed trade by parsed_trade_id
// (anchor 4430 + money 4440/4441 + items 4445/4446 + property 4450/4451)
const TRADE_SUB_LOG_TYPES = new Set([4430, 4440, 4441, 4445, 4446, 4450, 4451]);
const MUSEUM_LOG_TYPE = 7000;
const BLOOD_BAG_LOG_TYPE = 2340;
const VIRUS_COMPLETE_LOG_TYPE = 5802;   // Virus programming complete → `in` the programmed virus
// Racing car enlist/unenlist — the car leaves/returns to inventory (data.car = item id)
const RACING_ENLIST_LOG_TYPE   = 8700;
const RACING_UNENLIST_LOG_TYPE = 8701;

// ── Free items — income (ITEM_TRACKING.md §2) ────────────────
const FREE_LOG_TYPES = new Set([
  7011, 1401, 1404, 8930, 8938, 8980,
  5725, 9020, 9027, 8170, 8377,
  6401, 6505, 6525, 6500, 5530, 5533, 8855,
  2548, 5600, 5251, 5575, 5580, 2536,
  6731, 6733, 6746, 6751, 6752, 6753,
  6797, 4101, 4103, 4105, 4001, 4320,
  6749, 8945, 8946,
]);
const FREE_SOURCE_MAP = {
  1401: 'Dump', 1404: 'Dump',
  2548: 'Halloween Basket',
  4001: 'Parcel',
  4101: 'Player Send', 4103: 'Player Send', 4105: 'Player Send',
  5251: 'Referral',
  5530: 'Stock Dividend',
  5575: 'Subscriber', 5580: 'Subscriber',
  5600: 'Seasonal Gift',
  5725: 'Crime', 9020: 'Crime', 9027: 'Crime',
  6401: 'Job Special',
  6505: 'Company Special', 6525: 'Company Special',
  6731: 'Faction Armory', 6733: 'Faction Armory',
  6746: 'Faction Loan', 6751: 'Faction Loan', 6752: 'Faction Loan',
  6753: 'Faction Ownership', 6749: 'Faction Loan Retrieve',
  6797: 'Faction Payout',
  7011: 'City Find',
  8170: 'Attack Loot',
  8377: 'Casino Wheel',
  8855: 'Community Event',
  8930: 'Christmas Town', 8938: 'Christmas Town',
  8980: 'Easter Egg Hunt',
  4320: 'Auction Win',
  2536: 'Halloween Treat',
  8945: 'Christmas Coupon',
  8946: 'Christmas Town',   // coupon exchange → `in` each data.items entry
  5533: 'Stock Ammo',
  6500: 'Company Ammo',
};

// ── Item usage — consumption / loss (ITEM_TRACKING.md §3) ─────
const USAGE_LOG_TYPES = new Set([
  2010, 2020, 2030, 2040, 2050, 2060,
  2070, 2080, 2090, 2100, 2101, 2102,
  2105, 2110, 2120, 2130, 2140, 2150,
  2160, 2170, 2180, 2190, 2200, 2201,
  2210, 2211, 2220, 2221, 2230, 2231,
  2240, 2241, 2250, 2251, 2260, 2261,
  2270, 2271, 2280, 2281, 2290, 2291,
  2295, 2300, 2301, 2310, 2311, 2320,
  2321, 2325, 2330, 2340, 2350, 2360,
  2370, 2380, 2381, 2390, 2400, 2405,
  2406, 2407, 2410, 2420, 2430, 2440,
  2441, 2442, 2450, 2460, 2470, 2480,
  2490, 2500, 2501, 2510, 2520, 2525,
  2530, 2531, 2535, 2600, 2605, 2610,
  2611, 2612, 2613, 2615, 2620, 2621,
  8981, 8982, 8983, 8984, 8985, 8986, 8987, 8988, 8989,
  1400, 1403, 4000, 4100, 4102, 4104,
  6725, 6728, 6732, 6745, 6747, 6750, 6796,
  6768, 6769, 7000, 9163, 9190, 9191,
  9300, 9301, 9302, 9304, 9305, 9309, 9310, 9361, 15021,
]);
const USAGE_SOURCE_MAP = {
  1400: 'Dumped', 1403: 'Dumped',
  2010: 'Consumed', 2020: 'Consumed', 2030: 'Consumed', 2040: 'Consumed',
  2050: 'Consumed', 2060: 'Consumed', 2070: 'Consumed', 2080: 'Consumed',
  2090: 'Consumed', 2100: 'Consumed', 2101: 'Consumed', 2102: 'Consumed',
  2105: 'Consumed', 2110: 'Consumed', 2120: 'Consumed', 2130: 'Consumed',
  2140: 'Consumed', 2150: 'Consumed', 2160: 'Consumed', 2170: 'Consumed',
  2180: 'Consumed', 2190: 'Consumed', 2200: 'Consumed', 2201: 'Consumed',
  2210: 'Consumed', 2211: 'Consumed', 2220: 'Consumed', 2221: 'Consumed',
  2230: 'Consumed', 2231: 'Consumed', 2240: 'Consumed', 2241: 'Consumed',
  2250: 'Consumed', 2251: 'Consumed', 2260: 'Consumed', 2261: 'Consumed',
  2270: 'Consumed', 2271: 'Consumed', 2280: 'Consumed', 2281: 'Consumed',
  2290: 'Consumed', 2291: 'Consumed', 2295: 'Consumed',
  2300: 'Consumed', 2301: 'Consumed', 2310: 'Consumed', 2311: 'Consumed',
  2320: 'Consumed', 2321: 'Consumed', 2325: 'Consumed',
  2330: 'Consumed', 2340: 'Consumed', 2350: 'Consumed', 2360: 'Consumed',
  2370: 'Consumed', 2380: 'Consumed', 2381: 'Consumed', 2390: 'Consumed',
  2400: 'Consumed', 2405: 'Consumed', 2406: 'Consumed', 2407: 'Consumed',
  2410: 'Consumed', 2420: 'Consumed', 2430: 'Consumed',
  2440: 'Consumed', 2441: 'Consumed', 2442: 'Consumed',
  2450: 'Consumed', 2460: 'Consumed', 2470: 'Consumed', 2480: 'Consumed',
  2490: 'Consumed', 2500: 'Consumed', 2501: 'Consumed',
  2510: 'Consumed', 2520: 'Consumed', 2525: 'Consumed',
  2530: 'Consumed', 2531: 'Consumed', 2535: 'Consumed',
  2600: 'Consumed', 2605: 'Consumed',
  2610: 'Consumed', 2611: 'Consumed', 2612: 'Consumed', 2613: 'Consumed',
  2615: 'Consumed', 2620: 'Consumed', 2621: 'Relic Perish',
  4000: 'Parceled',
  4100: 'Sent', 4102: 'Sent', 4104: 'Sent',
  6725: 'Faction Armory', 6728: 'Faction Armory',
  6732: 'Faction Given',
  6745: 'Faction Loaned', 6747: 'Faction Loan Return',
  6750: 'Faction Claimed',
  6768: 'OC Spent', 6769: 'OC Spent',
  6796: 'Faction Payout',
  7000: 'Museum Swap',
  8981: 'Consumed', 8982: 'Consumed', 8983: 'Consumed', 8984: 'Consumed',
  8985: 'Consumed', 8986: 'Consumed', 8987: 'Consumed', 8988: 'Consumed',
  8989: 'Consumed',
  9163: 'Crime Loss', 9190: 'Crime Loss', 9191: 'Crime Loss',
  9300: 'Crime Spent', 9301: 'Crime Spent', 9302: 'Crime Spent',
  9304: 'Crime Spent', 9305: 'Crime Spent',
  9309: 'Crime Spent', 9310: 'Crime Spent', 9361: 'Crime Spent',
  15021: 'Staff Removal',
};

// ── Location stock groups (separate ledgers) ──────────────────
// Bazaar: IN = item added to your bazaar (1210/1222) · OUT = sold from your bazaar
// (1221/1226, earns revenue) · OUT = removed back to inventory (1211/1223)
const BAZAAR_ADD_LOG_TYPES    = new Set([1210, 1222]);
const BAZAAR_REMOVE_LOG_TYPES = new Set([1211, 1223]);
const BAZAAR_SELL_LOG_TYPES   = new Set([1221, 1226]);

// Display Case: IN = placed on display (1300/1302) · OUT = taken off (1301/1303)
const DISPLAY_ADD_LOG_TYPES    = new Set([1300, 1302]);
const DISPLAY_REMOVE_LOG_TYPES = new Set([1301, 1303]);

// Item Market listing: IN = listed (1100/1110) · OUT = sold (1104/1113, revenue) + removed (1101/1111)
const MARKET_ADD_LOG_TYPES    = new Set([1100, 1110]);
const MARKET_REMOVE_LOG_TYPES = new Set([1101, 1111]);
const MARKET_SELL_LOG_TYPES   = new Set([1104, 1113]);

// ── Aggregates ───────────────────────────────────────────────
// Every log type the monitor cares about — requested from the hosted log server
// (the server filters by these types, so all flows stay complete).
const ALL_LOG_TYPES = new Set();
[BUY_LOG_TYPES, SELL_LOG_TYPES, POINTS_LOG_TYPES, POINTS_MARKET_ADD_LOG_TYPES, POINTS_MARKET_REMOVE_LOG_TYPES,
 POINT_USAGE_LOG_TYPES, TRADE_SUB_LOG_TYPES, FREE_LOG_TYPES, USAGE_LOG_TYPES,
 BAZAAR_ADD_LOG_TYPES, BAZAAR_REMOVE_LOG_TYPES, BAZAAR_SELL_LOG_TYPES,
 DISPLAY_ADD_LOG_TYPES, DISPLAY_REMOVE_LOG_TYPES,
 MARKET_ADD_LOG_TYPES, MARKET_REMOVE_LOG_TYPES, MARKET_SELL_LOG_TYPES]
  .forEach(s => s.forEach(t => ALL_LOG_TYPES.add(t)));
ALL_LOG_TYPES.add(MUSEUM_LOG_TYPE).add(BLOOD_BAG_LOG_TYPE).add(VIRUS_COMPLETE_LOG_TYPE)
  .add(RACING_ENLIST_LOG_TYPE).add(RACING_UNENLIST_LOG_TYPE);
const LOG_TYPES_PARAM = Array.from(ALL_LOG_TYPES).join(',');

// Activity sources that belong to the *location* ledgers (Bazaar/Display/Market tabs)
// — excluded from the inventory-level hover popups (Monitor IN/OUT + Inventory numbers).
const LOCATION_LEDGER_SOURCES = new Set([
  'Bazaar Added', 'Bazaar Sold', 'Bazaar Removed',
  'Display Added', 'Display Removed',
  'Market Added', 'Market Sold', 'Market Removed',
]);

module.exports = {
  BUY_LOG_TYPES, SELL_LOG_TYPES, POINTS_LOG_TYPES,
  POINTS_MARKET_ADD_LOG_TYPES, POINTS_MARKET_REMOVE_LOG_TYPES,
  POINT_USAGE_LOG_TYPES, POINT_USAGE_SOURCE,
  TRADE_OUT_LOG_TYPES, TRADE_IN_LOG_TYPES, TRADE_SUB_LOG_TYPES,
  MUSEUM_LOG_TYPE, BLOOD_BAG_LOG_TYPE, VIRUS_COMPLETE_LOG_TYPE,
  RACING_ENLIST_LOG_TYPE, RACING_UNENLIST_LOG_TYPE,
  FREE_LOG_TYPES, FREE_SOURCE_MAP,
  USAGE_LOG_TYPES, USAGE_SOURCE_MAP,
  BAZAAR_ADD_LOG_TYPES, BAZAAR_REMOVE_LOG_TYPES, BAZAAR_SELL_LOG_TYPES,
  DISPLAY_ADD_LOG_TYPES, DISPLAY_REMOVE_LOG_TYPES,
  MARKET_ADD_LOG_TYPES, MARKET_REMOVE_LOG_TYPES, MARKET_SELL_LOG_TYPES,
  ALL_LOG_TYPES, LOG_TYPES_PARAM,
  LOCATION_LEDGER_SOURCES,
};
