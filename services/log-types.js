// Torn log type IDs — authoritative source: game inventory add/remove reference
// Adds to Inventory: items permanently enter your possession
// Removes from Inventory: items permanently leave your possession
// Display management (1300–1303) = items move between backpack and display case,
//   total holdings unchanged — NOT acquisition or disposal events.

// Item acquired by purchasing — unit_cost derived from cost_total / qty
const BUY_TYPES = [
  1100, 1101,  // Item market buy (oldest variants, uses data.item array)
  1103, 1112,  // Item market buy (old, new)
  1111, 1115,  // Item market buy (variants, no cost data)
  1210, 1211,  // Bazaar buy (legacy — older variants)
  1220, 1225,  // Bazaar buy (legacy, new)
  1223, 1224,  // Bazaar buy (variants, no cost data)
  1501,        // Big Al's bunker buy
  4200,        // Item shop buy
  4201,        // Item abroad buy
  4320,        // Auction house item win
];

// Item sold — unit_revenue derived from cost_total * (1-TAX) / qty
const SELL_TYPES = [
  1104, 1113,  // Item market sell (old, new)
  1110,        // Item market sell (uses data.price instead of cost_total)
  1212,        // Bazaar sell (legacy — older variant)
  1221, 1226,  // Bazaar sell (legacy, new)
  1500,        // Big Al's bunker sell
  4210,        // Item shop sell
  4220,        // Item shop sell points
  4322,        // Auction house item sold
];
// NOTE: Display case sales (1303) are NOT in this list — 1303 = display management
// (taking items back from display), not a sale. Display sales have no item-removal log.

// Item received for free — unit_cost = 0
const RECEIVE_TYPES = [
  1401, 1404,        // Dump find (legacy, new)
  2536,              // Halloween treat receive
  2548,              // Halloween basket receive item
  2615,              // Item use cache (result items from cache)
  4001,              // Parcel open (items awarded from parcel)
  4101, 4103, 4105,  // Item receive (legacy, new, legacy 2)
  5251,              // Referral item reward
  5530,              // Stock special item dividend
  5575, 5580,        // Subscriber item reward
  5600,              // Seasonal gift items
  5725,              // Crime success item gain (old)
  6401,              // Job special gain item
  6505, 6525,        // Company special gain item / items
  4700,              // Item receive (old variant, data.item array)
  6731,              // Faction armory item receive
  6733,              // Faction give item receive
  6746,              // Faction loan item receive
  6747, 6749,        // Faction item receive (variants)
  6751,              // Faction loan item receive ownership
  6752,              // Faction loan item receive (additional)
  6753,              // Faction item receive ownership
  6797,              // Faction payout item receive
  7011,              // City item find
  7900,              // Missions buy reward item
  8170,              // Attack receive loot
  8377,              // Casino spin the wheel win item
  8855,              // Community event item reward
  8930, 8934, 8938,  // Christmas town find item / purchase item / items reward
  8980,              // Easter egg hunt pickup egg
  9020,              // Crime success item gain (new)
  9027,              // Crime ammo gain
];

// Item sent out — reduces holdings, no revenue
const SEND_TYPES = [
  4000,              // Parcel send items
  4100, 4102, 4104,  // Item send (legacy, new, legacy 2)
  6725, 6728,        // Faction deposit item (legacy, new)
  6730, 6732,        // Faction give item send (legacy, new)
  6745,              // Faction loan item send (you loan to faction)
  6750,              // Faction claim loaned items back
  6768, 6769,        // Faction organized crimes use / lose items
  6796,              // Faction payout item send
  8936,              // Christmas town pot deposit item
  9163,              // Crime critical fail item loss
  9190, 9191,        // Crime item loss (additional)
  9300, 9301,        // Crime use items (additional)
  9302, 9304,        // Crime use items for skimming / disposal
  9305, 9306,        // Crime item remove component / crime use items
  9309, 9310,        // Crime use items / crime use items for forgery
  9361,              // Crime use items for arson
  15021,             // Staff removal item loss
  4710,              // Item send (old variant, data.item array)
];

// Item dumped — items discarded to city dump, reduces holdings, no revenue
const DUMP_TYPES = [
  1400, 1403,        // Dump add (legacy, new) — items discarded to city dump
];

// Museum exchange sets — maps set name to constituent items {item_id, qty}.
// When a set is exchanged for points, ALL items in the set are removed at once.
// Source: Torn Wiki museum page — https://wiki.torn.com/wiki/Museum
const MUSEUM_SETS = {
  "Plushie Set": [
    { item_id: 186, qty: 1 }, { item_id: 187, qty: 1 },
    { item_id: 215, qty: 1 }, { item_id: 258, qty: 1 },
    { item_id: 261, qty: 1 }, { item_id: 266, qty: 1 },
    { item_id: 268, qty: 1 }, { item_id: 269, qty: 1 },
    { item_id: 273, qty: 1 }, { item_id: 274, qty: 1 },
    { item_id: 281, qty: 1 }, { item_id: 384, qty: 1 },
    { item_id: 618, qty: 1 },
  ],
  "Exotic Flower Set": [
    { item_id: 260, qty: 1 }, { item_id: 264, qty: 1 },
    { item_id: 282, qty: 1 }, { item_id: 277, qty: 1 },
    { item_id: 276, qty: 1 }, { item_id: 271, qty: 1 },
    { item_id: 272, qty: 1 }, { item_id: 263, qty: 1 },
    { item_id: 267, qty: 1 }, { item_id: 385, qty: 1 },
    { item_id: 617, qty: 1 },
  ],
  "Meteorite Fragment":  [{ item_id: 1488, qty: 1 }],
  "Patagonian Fossil":   [{ item_id: 1487, qty: 1 }],
  "Arrowhead Set": [
    { item_id: 1499, qty: 1 }, { item_id: 1500, qty: 1 },
    { item_id: 1501, qty: 1 }, { item_id: 1502, qty: 1 },
    { item_id: 1503, qty: 1 }, { item_id: 1504, qty: 1 },
  ],
  "Medieval Coin Set": [
    { item_id: 450, qty: 1 }, { item_id: 451, qty: 1 },
    { item_id: 452, qty: 1 },
  ],
  "Vairocana Buddha":     [{ item_id: 454, qty: 1 }],
  "Ganesha Sculpture":    [{ item_id: 453, qty: 1 }],
  "Shabti Sculpture":     [{ item_id: 458, qty: 1 }],
  "Companion Scripts": [
    { item_id: 455, qty: 1 }, { item_id: 456, qty: 1 },
    { item_id: 457, qty: 1 },
  ],
  "Senet Game Set": [
    { item_id: 462, qty: 1 }, { item_id: 460, qty: 1 },
    { item_id: 461, qty: 1 },
  ],
  "Egyptian Amulet":      [{ item_id: 459, qty: 1 }],
};

// Museum exchange — items given to museum for points (reduces holdings, no revenue)
const MUSEUM_EXCHANGE_TYPES = [
  7000,              // Museum exchange (set conversion to points)
];

// Item used / consumed — no revenue, reduces holdings
// data.item = integer item ID (qty 1 per log); or data.items array for sets
const USE_TYPES = [
  2010,        // Item use entertainment
  2020,        // Item use candy
  2030,        // Item use alcohol
  2040,        // Item use energy drink
  2050,        // Item use book
  2060,        // Item use morphine
  2070,        // Item use first aid kit
  2080,        // Item use small first aid kit
  2090,        // Item use neumune tablet
  2100, 2101, 2102,  // Item use blood bag (variants)
  2105,        // Item use blood bag (additional)
  2110,        // Item use lawyer business card
  2120,        // Item use parachute
  2130,        // Item use skateboard
  2140,        // Item use boxing gloves
  2150,        // Item use dumbbells
  2160,        // Item use book of carols
  2170,        // Item use gift card
  2180,        // Item use erotic dvd
  2190,        // Item use feathery hotel coupon
  2200, 2201,  // Item use cannabis (variants)
  2210, 2211,  // Item use ecstasy (variants)
  2220, 2221,  // Item use ketamine (variants)
  2230, 2231,  // Item use LSD (variants)
  2240, 2241,  // Item use opium (variants)
  2250, 2251,  // Item use PCP (variants)
  2260, 2261,  // Item use shrooms (variants)
  2270, 2271,  // Item use speed (variants)
  2280, 2281,  // Item use vicodin (variants)
  2290, 2291,  // Item use xanax (variants)
  2295,        // Item use love juice
  2300, 2301, 2302,  // Item use dog poop (variants)
  2310, 2311,  // Item use stink bombs (variants)
  2320, 2321, 2322,  // Item use toilet paper (variants)
  2325,        // Item use poison mistletoe
  2330,        // Item use donator pack
  2340,        // Item use empty blood bag
  2350,        // Item use box of grenades
  2360,        // Item use box of medical supplies
  2370,        // Item use lottery voucher
  2380, 2381,  // Item use piggy bank deposit (variants)
  2390,        // Item use drug pack
  2400,        // Item use goodie bag
  2405,        // Item use wallet
  2406,        // Item use arca fortunae
  2407,        // Item use stash box
  2410,        // Item use box of tissues
  2420,        // Item use vanity mirror
  2430,        // Item use casino pass
  2440, 2441, 2442,  // Item use dirty bomb (variants)
  2450,        // Item use cake frosting / lock picking kit
  2460,        // Item use felovax
  2470,        // Item use zylkene
  2480,        // Item use dukes safe
  2490,        // Item use empty vial
  2500, 2501,  // Item use keg of beer (variants)
  2510,        // Item use six pack of alcohol
  2520,        // Item use six pack of energy drink
  2525,        // Item use tin of treats
  2530, 2531,  // Item use Halloween basket (variants)
  2535,        // Item use halloween basket (open)
  2600,        // Item use strippogram
  2605,        // Item use anniversary present
  2610, 2611, 2612, 2613,  // Item use christmas cracker (variants)
  2620,        // Item use relic
  2621,        // Item use relic (perished)
  8981, 8982, 8983, 8984, 8985,  // Item use easter eggs (consumed)
  8986, 8987, 8988, 8989,
];

// Trade completed — items you received (creates lots at cost=0)
const TRADE_IN_TYPES = [
  4446,  // Trade items incoming (trade completed, items delivered to you)
];

// Trade completed — items you sent out (consumes lots)
const TRADE_OUT_TYPES = [
  4445,  // Trade items outgoing (trade completed, items left your inventory)
];

// NOTE: 4447 (Trade items add), 4448 (Trade items remove), 4482 (Trade items add other user),
//   4483 (Trade items remove other user) are staging events — items added to/removed from
//   the pending trade window. No real inventory movement yet; correctly ignored here.

module.exports = {
  BUY_TYPES,
  SELL_TYPES,
  RECEIVE_TYPES,
  SEND_TYPES,
  USE_TYPES,
  DUMP_TYPES,
  MUSEUM_SETS,
  MUSEUM_EXCHANGE_TYPES,
  TRADE_IN_TYPES,
  TRADE_OUT_TYPES,
  BUY_TYPE_SET:             new Set(BUY_TYPES),
  SELL_TYPE_SET:            new Set(SELL_TYPES),
  RECEIVE_TYPE_SET:         new Set(RECEIVE_TYPES),
  SEND_TYPE_SET:            new Set(SEND_TYPES),
  USE_TYPE_SET:             new Set(USE_TYPES),
  DUMP_TYPE_SET:            new Set(DUMP_TYPES),
  MUSEUM_EXCHANGE_TYPE_SET: new Set(MUSEUM_EXCHANGE_TYPES),
  TRADE_IN_TYPE_SET:        new Set(TRADE_IN_TYPES),
  TRADE_OUT_TYPE_SET:       new Set(TRADE_OUT_TYPES),
};
