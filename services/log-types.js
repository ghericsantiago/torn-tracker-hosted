// Torn log type IDs — authoritative source: game inventory add/remove reference
// Adds to Inventory: items permanently enter your possession
// Removes from Inventory: items permanently leave your possession
// Display management (1300–1303) = items move between backpack and display case,
//   total holdings unchanged — NOT acquisition or disposal events.

// Item acquired by purchasing — unit_cost derived from cost_total / qty
const BUY_TYPES = [
  1103, 1112,  // Item market buy (old, new)
  1220, 1225,  // Bazaar buy (legacy, new)
  1501,        // Big Al's bunker buy
  4200,        // Item shop buy
  4201,        // Item abroad buy
  4320,        // Auction house item win
];

// Item sold — unit_revenue derived from cost_total * (1-TAX) / qty
const SELL_TYPES = [
  1104, 1113,  // Item market sell (old, new)
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
  4001,              // Parcel open (items awarded from parcel)
  4101, 4103, 4105,  // Item receive (legacy, new, legacy 2)
  1401, 1404,        // Dump find (legacy, new)
  2536,              // Halloween treat receive
  2548,              // Halloween basket receive item
  2615,              // Item use cache (result items from cache)
  5530,              // Stock special item dividend
  5600,              // Seasonal gift items
  5725,              // Crime success item gain (old)
  6401,              // Job special gain item
  6505, 6525,        // Company special gain item / items
  6733,              // Faction give item receive
  6746,              // Faction loan item receive
  6751,              // Faction loan item receive ownership
  6753,              // Faction item receive ownership
  6797,              // Faction payout item receive
  7011,              // City item find
  7900,              // Missions buy reward item
  8170,              // Attack receive loot
  8377,              // Casino spin the wheel win item
  8930, 8934, 8938,  // Christmas town find item / purchase item / items reward
  8980,              // Easter egg hunt pickup egg
  9020,              // Crime success item gain (new)
];

// Item sent out — reduces holdings, no revenue
const SEND_TYPES = [
  4100, 4102, 4104,  // Item send (legacy, new, legacy 2)
  1400, 1403,        // Dump add (legacy, new) — items discarded to city dump
  6725, 6728,        // Faction deposit item (legacy, new)
  6730, 6732,        // Faction give item send (legacy, new)
  6768, 6769,        // Faction organized crimes use / lose items
  7000,              // Museum exchange
  8936,              // Christmas town pot deposit item
  9163,              // Crime critical fail item loss
  9302, 9304,        // Crime use items for skimming / disposal
  9306,              // Crime item remove component
  9310,              // Crime use items for forgery
  9361,              // Crime use items for arson
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
  2100,        // Item use blood bag
  2110,        // Item use lawyer business card
  2120,        // Item use parachute
  2130,        // Item use skateboard
  2140,        // Item use boxing gloves
  2150,        // Item use dumbbells
  2160,        // Item use book of carols
  2170,        // Item use gift card
  2180,        // Item use erotic dvd
  2190,        // Item use feathery hotel coupon
  2200,        // Item use cannabis
  2210,        // Item use ecstasy
  2220,        // Item use ketamine
  2230,        // Item use LSD
  2240,        // Item use opium
  2250,        // Item use PCP
  2260,        // Item use shrooms
  2270,        // Item use speed
  2280,        // Item use vicodin
  2290,        // Item use xanax
  2295,        // Item use love juice
  2300,        // Item use dog poop
  2310,        // Item use stink bombs
  2320,        // Item use toilet paper
  2325,        // Item use poison mistletoe
  2330,        // Item use donator pack
  2340,        // Item use empty blood bag
  2350,        // Item use box of grenades
  2360,        // Item use box of medical supplies
  2370,        // Item use lottery voucher
  2380,        // Item use piggy bank deposit
  2390,        // Item use drug pack
  2400,        // Item use goodie bag
  2405,        // Item use wallet
  2406,        // Item use arca fortunae
  2407,        // Item use stash box
  2410,        // Item use box of tissues
  2420,        // Item use vanity mirror
  2430,        // Item use casino pass
  2440,        // Item use dirty bomb
  2450,        // Item use cake frosting / lock picking kit
  2460,        // Item use felovax
  2470,        // Item use zylkene
  2480,        // Item use dukes safe
  2490,        // Item use empty vial
  2500,        // Item use keg of beer
  2510,        // Item use six pack of alcohol
  2520,        // Item use six pack of energy drink
  2525,        // Item use tin of treats
  2535,        // Item use halloween basket
  2600,        // Item use strippogram
  2605,        // Item use anniversary present
  2610,        // Item use christmas cracker
  2620,        // Item use relic
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
  DUMP_TYPES: [],
  TRADE_IN_TYPES,
  TRADE_OUT_TYPES,
  BUY_TYPE_SET:       new Set(BUY_TYPES),
  SELL_TYPE_SET:      new Set(SELL_TYPES),
  RECEIVE_TYPE_SET:   new Set(RECEIVE_TYPES),
  SEND_TYPE_SET:      new Set(SEND_TYPES),
  USE_TYPE_SET:       new Set(USE_TYPES),
  DUMP_TYPE_SET:      new Set([]),
  TRADE_IN_TYPE_SET:  new Set(TRADE_IN_TYPES),
  TRADE_OUT_TYPE_SET: new Set(TRADE_OUT_TYPES),
};
