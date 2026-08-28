// ==UserScript==
// @name         Torn Portfolio Tracker Hosted
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Track buy/sell transactions with market prices and potential income
// @author       Gheric
// @match        https://www.torn.com
// @match        https://www.torn.com/index.php
// @match        https://www.torn.com/page.php?sid=travel*
// @match        https://www.torn.com/gym.php
// @match        https://www.torn.com/hospitalview.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const BUY_LOG_TYPES  = [1103, 1112, 1220, 1225, 4201, 4200, 5010];
  const SELL_LOG_TYPES = [1104, 1113, 1221, 1226, 4210, 4220, 5011];
  const POINTS_LOG_TYPES = new Set([5010, 5011]);
  const TRADE_LOG_TYPES  = [4430, 4440, 4441, 4445, 4446, 4450, 4451];
  const LOG_TYPE_STORE = {
    1103: 'Item Market',  1104: 'Item Market',
    1112: 'Item Market',  1113: 'Item Market',
    1220: 'Bazaar',       1221: 'Bazaar',
    1225: 'Bazaar',       1226: 'Bazaar',
    4200: 'Shop',         4210: 'Shop',         4220: 'Shop',
    4201: 'Abroad',
    5010: 'Point Market', 5011: 'Point Market',
  };

  // ── Log type names (fallback when server omits the title) ──────────────
  const LOG_TYPE_NAMES = {
    1103: "Item market buy (old)",
    1104: "Item market sell (old)",
    1112: "Item market buy",
    1113: "Item market sell",
    1220: "Bazaar buy (legacy)",
    1221: "Bazaar sell (legacy)",
    1225: "Bazaar buy",
    1226: "Bazaar sell",
    1400: "Dump add (legacy)",
    1401: "Dump find (legacy)",
    1403: "Dump add",
    1404: "Dump find",
    2010: "Item use entertainment",
    2020: "Item use candy",
    2030: "Item use alcohol",
    2040: "Item use energy drink",
    2050: "Item use book",
    2060: "Item use morphine",
    2070: "Item use first aid kit",
    2080: "Item use small first aid kit",
    2090: "Item use neumune tablet",
    2100: "Item use blood bag",
    2101: "Item use blood bag wrong type",
    2102: "Item use blood bag irradiated",
    2105: "Item use ipecac syrup",
    2110: "Item use lawyer business card",
    2120: "Item use parachute",
    2130: "Item use skateboard",
    2140: "Item use boxing gloves",
    2150: "Item use dumbbells",
    2160: "Item use book of carols",
    2170: "Item use gift card",
    2180: "Item use erotic dvd",
    2190: "Item use feathery hotel coupon",
    2200: "Item use cannabis",
    2201: "Item use cannabis overdose",
    2210: "Item use ecstasy",
    2211: "Item use ecstasy overdose",
    2220: "Item use ketamine",
    2221: "Item use ketamine overdose",
    2230: "Item use LSD",
    2231: "Item use LSD overdose",
    2240: "Item use opium",
    2241: "Item use opium overdose",
    2250: "Item use PCP",
    2251: "Item use PCP overdose",
    2260: "Item use shrooms",
    2261: "Item use shrooms overdose",
    2270: "Item use speed",
    2271: "Item use speed overdose",
    2280: "Item use vicodin",
    2281: "Item use vicodin overdose",
    2290: "Item use xanax",
    2291: "Item use xanax overdose",
    2295: "Item use love juice",
    2300: "Item use dog poop success",
    2301: "Item use dog poop fail",
    2310: "Item use stink bombs success",
    2311: "Item use stink bombs fail",
    2320: "Item use toilet paper success",
    2321: "Item use toilet paper fail",
    2325: "Item use poison mistletoe",
    2330: "Item use donator pack",
    2340: "Item use empty blood bag",
    2350: "Item use box of grenades",
    2360: "Item use box of medical supplies",
    2370: "Item use lottery voucher",
    2380: "Item use piggy bank deposit",
    2381: "Item use piggy bank withdraw",
    2390: "Item use drug pack",
    2400: "Item use goodie bag",
    2405: "Item use wallet",
    2406: "Item use arca fortunae",
    2407: "Item use stash box",
    2410: "Item use box of tissues",
    2420: "Item use vanity mirror",
    2430: "Item use casino pass",
    2440: "Item use dirty bomb",
    2441: "Item use dirty bomb prime",
    2442: "Item use dirty bomb safe",
    2450: "Item use cake frosting / lock picking kit",
    2460: "Item use felovax",
    2470: "Item use zylkene",
    2480: "Item use dukes safe",
    2490: "Item use empty vial",
    2500: "Item use keg of beer",
    2501: "Item use keg of beer empty",
    2510: "Item use six pack of alcohol",
    2520: "Item use six pack of energy drink",
    2525: "Item use tin of treats",
    2530: "Item use halloween basket take candy (legacy)",
    2531: "Item use halloween basket decrease happiness (legacy)",
    2535: "Item use halloween basket",
    2536: "Halloween treat receive",
    2548: "Halloween basket receive item",
    2600: "Item use strippogram",
    2605: "Item use anniversary present",
    2610: "Item use christmas cracker user win",
    2611: "Item use christmas cracker target win",
    2612: "Item use christmas cracker user lose",
    2613: "Item use christmas cracker target lose",
    2615: "Item use cache",
    2620: "Item use relic",
    2621: "Relic wither",
    4000: "Parcel create",
    4001: "Parcel open",
    4100: "Item send (legacy)",
    4101: "Item receive (legacy)",
    4102: "Item send",
    4103: "Item receive",
    4104: "Item send (legacy 2)",
    4105: "Item receive (legacy 2)",
    4200: "Item shop buy",
    4201: "Item abroad buy",
    4210: "Item shop sell",
    4220: "Item shop sell points",
    4320: "Auction house item win",
    4430: "Trade completed",
    4440: "Trade money outgoing",
    4441: "Trade money incoming",
    4445: "Trade items outgoing",
    4446: "Trade items incoming",
    4450: "Trade property outgoing",
    4451: "Trade property incoming",
    5010: "Points market buy",
    5011: "Points market sell",
    5251: "Referral reward",
    5530: "Stock special item",
    5533: "Stock special ammo",
    5575: "Subscription reward",
    5580: "Subscription draw",
    5600: "Seasonal gift items",
    5725: "Crime success item gain",
    6401: "Job special gain item",
    6500: "Company special gain special ammo",
    6505: "Company special gain item",
    6525: "Company special gain items",
    6725: "Faction deposit item (legacy)",
    6728: "Faction deposit item",
    6731: "Faction give item receive (legacy)",
    6732: "Faction give item send",
    6733: "Faction give item receive",
    6745: "Faction loan item send",
    6746: "Faction loan item receive",
    6747: "Faction loan item return",
    6749: "Faction loan item retrieve receive",
    6750: "Faction loan item take ownership",
    6751: "Faction loan item receive ownership",
    6752: "Faction item receive ownership (legacy)",
    6753: "Faction item receive ownership",
    6768: "Faction organized crimes use items",
    6769: "Faction organized crimes lose items",
    6796: "Faction payout item send",
    6797: "Faction payout item receive",
    7000: "Museum exchange",
    7011: "City item find",
    8170: "Attack receive loot",
    8377: "Casino spin the wheel win item",
    8855: "Community event prize",
    8930: "Christmas town find item",
    8938: "Christmas town items",
    8945: "Christmas town coupon receive",
    8980: "Easter egg hunt pickup egg",
    8981: "Item use green easter egg",
    8982: "Item use red easter egg",
    8983: "Item use yellow easter egg",
    8984: "Item use purple easter egg",
    8985: "Item use black easter egg",
    8986: "Item use blue easter egg",
    8987: "Item use white easter egg",
    8988: "Item use brown easter egg",
    8989: "Item use gold easter egg",
    9020: "Crime success item gain (new)",
    9027: "Crime success ammo gain",
    9163: "Crime critical fail item loss",
    9190: "Crime critical fail lose card details",
    9191: "Crime critical fail lose online store",
    9300: "Crime item add blank DVDs",
    9301: "Crime item add spray can",
    9302: "Crime use items for skimming",
    9304: "Crime use items for disposal",
    9305: "Crime item add component",
    9309: "Crime item add for forgery",
    9310: "Crime use items for forgery",
    9361: "Crime use items for arson",
    15021: "Staff items remove receive",
  };

  const FREE_LOG_GROUPS = [
    [7011, 1401, 1404, 8930, 8938, 8980],
    [5725, 9020, 9027, 8170, 8377],
    [6401, 6505, 6525, 6500, 5530, 5533, 8855],
    [2548, 5600, 5251, 5575, 5580, 2536],
    [6731, 6733, 6746, 6751, 6752, 6753],
    [6797, 4101, 4103, 4105, 4001, 4320],
    [6749, 8945],
  ];
  const FREE_SOURCE_MAP = {
    1401: 'Dump',              1404: 'Dump',
    2548: 'Halloween Basket',
    4001: 'Parcel',
    4101: 'Player Send',       4103: 'Player Send',       4105: 'Player Send',
    5251: 'Referral',
    5530: 'Stock Dividend',
    5575: 'Subscriber',        5580: 'Subscriber',
    5600: 'Seasonal Gift',
    5725: 'Crime',             9020: 'Crime',             9027: 'Crime',
    6401: 'Job Special',
    6505: 'Company Special',   6525: 'Company Special',
    6731: 'Faction Armory',    6733: 'Faction Armory',
    6746: 'Faction Loan',      6751: 'Faction Loan',      6752: 'Faction Loan',
    6753: 'Faction Ownership', 6749: 'Faction Loan Retrieve',
    6797: 'Faction Payout',
    7011: 'City Find',
    8170: 'Attack Loot',
    8377: 'Casino Wheel',
    8855: 'Community Event',
    8930: 'Christmas Town',    8938: 'Christmas Town',
    8980: 'Easter Egg Hunt',
    4320: 'Auction Win',
    2536: 'Halloween Treat',
    8945: 'Christmas Coupon',
    5533: 'Stock Ammo',
    6500: 'Company Ammo',
  };

  const STORE_BADGE_CLASS = {
    'Item Market':  'bdg-blue',
    'Point Market': 'bdg-yellow',
    'Bazaar':       'bdg-orange',
    'Armoury':      'bdg-red',
    'Shop':         'bdg-green',
    'Abroad':       'bdg-teal',
    'Trade':        'bdg-purple',
  };

  const STORE_ICON = {
    'Item Market':  '🛒',
    'Point Market': '⭐',
    'Bazaar':       '🏪',
    'Armoury':      '⚔️',
    'Shop':         '🏬',
    'Abroad':       '✈️',
    'Trade':        '🤝',
  };

  const FREE_SOURCE_BADGE = {
    'City Find':         'bdg-teal',
    'Dump':              'bdg-gray',
    'Crime':             'bdg-red',
    'Job Special':       'bdg-blue',
    'Company Special':   'bdg-blue',
    'Stock Dividend':    'bdg-yellow',
    'Attack Loot':       'bdg-red',
    'Faction Armory':    'bdg-purple',
    'Faction Payout':    'bdg-purple',
    'Faction Loan':      'bdg-purple',
    'Faction Ownership': 'bdg-purple',
    'Player Send':       'bdg-orange',
    'Parcel':            'bdg-orange',
    'Casino Wheel':      'bdg-yellow',
    'Seasonal Gift':     'bdg-green',
    'Christmas Town':    'bdg-green',
    'Easter Egg Hunt':   'bdg-green',
    'Halloween Basket':  'bdg-orange',
    'Community Event':   'bdg-cyan',
    'Referral':          'bdg-pink',
    'Subscriber':        'bdg-yellow',
    'Auction Win':       'bdg-cyan',
    'Faction Loan Retrieve': 'bdg-purple',
    'Halloween Treat':   'bdg-orange',
    'Christmas Coupon':  'bdg-green',
    'Stock Ammo':        'bdg-yellow',
    'Company Ammo':      'bdg-blue',
  };

  const USAGE_LOG_GROUPS = [
    [2010, 2020, 2030, 2040, 2050, 2060],
    [2070, 2080, 2090, 2100, 2101, 2102],
    [2105, 2110, 2120, 2130, 2140, 2150],
    [2160, 2170, 2180, 2190, 2200, 2201],
    [2210, 2211, 2220, 2221, 2230, 2231],
    [2240, 2241, 2250, 2251, 2260, 2261],
    [2270, 2271, 2280, 2281, 2290, 2291],
    [2295, 2300, 2301, 2310, 2311, 2320],
    [2321, 2325, 2330, 2340, 2350, 2360],
    [2370, 2380, 2381, 2390, 2400, 2405],
    [2406, 2407, 2410, 2420, 2430, 2440],
    [2441, 2442, 2450, 2460, 2470, 2480],
    [2490, 2500, 2501, 2510, 2520, 2525],
    [2530, 2531, 2535, 2600, 2605, 2610],
    [2611, 2612, 2613, 2615, 2620, 2621],
    [8981, 8982, 8983, 8984, 8985, 8986],
    [8987, 8988, 8989],
    [1400, 1403, 4000, 4100, 4102, 4104],
    [6725, 6728, 6732, 6745, 6747, 6750, 6796],
    [6768, 6769, 7000, 9163, 9190, 9191],
    [9300, 9301, 9302, 9304, 9305, 9309],
    [9310, 9361, 15021],
  ];
  const ALL_FREE_LOG_TYPES  = FREE_LOG_GROUPS.flat();
  const ALL_USAGE_LOG_TYPES = USAGE_LOG_GROUPS.flat();
  const USAGE_SOURCE_MAP = {
    1400: 'Dumped',              1403: 'Dumped',
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
    4100: 'Sent',               4102: 'Sent',               4104: 'Sent',
    6725: 'Faction Armory',     6728: 'Faction Armory',
    6732: 'Faction Given',
    6745: 'Faction Loaned',     6747: 'Faction Loan Return',
    6750: 'Faction Claimed',
    6768: 'OC Spent',           6769: 'OC Spent',
    6796: 'Faction Payout',
    7000: 'Museum Swap',
    8981: 'Consumed', 8982: 'Consumed', 8983: 'Consumed', 8984: 'Consumed',
    8985: 'Consumed', 8986: 'Consumed', 8987: 'Consumed', 8988: 'Consumed',
    8989: 'Consumed',
    9163: 'Crime Loss',         9190: 'Crime Loss',         9191: 'Crime Loss',
    9300: 'Crime Spent', 9301: 'Crime Spent', 9302: 'Crime Spent',
    9304: 'Crime Spent', 9305: 'Crime Spent',
    9309: 'Crime Spent', 9310: 'Crime Spent', 9361: 'Crime Spent',
    15021: 'Staff Removal',
  };
  const USAGE_SOURCE_BADGE = {
    'Consumed':       'bdg-red',
    'Sent':           'bdg-orange',
    'Dumped':         'bdg-gray',
    'Faction Armory': 'bdg-purple',
    'Faction Used':   'bdg-purple',
    'Faction Given':  'bdg-purple',
    'Faction Loaned': 'bdg-purple',
    'Faction Loan Return': 'bdg-purple',
    'Faction Claimed':'bdg-purple',
    'Faction Payout': 'bdg-purple',
    'OC Spent':       'bdg-purple',
    'Parceled':       'bdg-orange',
    'Museum Swap':    'bdg-teal',
    'Relic Perish':   'bdg-gray',
    'Crime Loss':     'bdg-red',
    'Crime Spent':    'bdg-red',
    'Staff Removal':  'bdg-red',
  };

  // ── State ─────────────────────────────────────────────────────────────────
  let panelOpen        = false;
  let activeTab        = 'buy';
  let originalBuyData  = [];
  let originalSellData = [];
  let filteredBuyData  = [];
  let filteredSellData = [];
  let itemCatalog      = {};
  let valueChart       = null;
  let sortState        = { col: null, dir: 'asc' };
  let tradeData        = [];
  let freeItemsData    = [];
  let filteredFreeData = [];
  let usageData        = [];
  let filteredUsageData = [];
  let factionUsedData  = [];
  let filteredFactionUsedData = [];
  let apiCallCount     = 0;
  let loadedTabs       = new Set();
  let cooldownTimer    = null;
  let cooldownEnd      = 0;

  // ── Styles ────────────────────────────────────────────────────────────────
  GM_addStyle(`
    /* ═══════════════════════════════════════
       Torn Portfolio Tracker — Theme v1.1
       Palette: Torn dark-navy with gold accent
    ═══════════════════════════════════════ */

    /* ── Toggle tab ── */
    #pt-toggle {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      background: linear-gradient(180deg, #c9943a 0%, #a87428 100%);
      color: #fff;
      width: 18px;
      padding: 12px 0;
      border-radius: 6px 0 0 6px;
      cursor: pointer;
      z-index: 2147483639;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font: 700 8px/1 'Arial', sans-serif;
      letter-spacing: 2px;
      text-align: center;
      user-select: none;
      box-shadow: -3px 0 12px rgba(0,0,0,0.55);
      transition: opacity 0.2s, filter 0.15s;
      text-shadow: 0 1px 3px rgba(0,0,0,0.4);
      padding-right: 13px;
    }
    #pt-toggle:hover { filter: brightness(1.15); }
    #pt-toggle.open  { opacity: 0; pointer-events: none; }

    /* ── Panel shell ── */
    #pt-panel {
      position: fixed;
      top: 0;
      right: -920px;
      width: min(900px, 100vw);
      height: 100dvh;
      background: #12141f;
      color: #c8cde0;
      z-index: 2147483645;
      display: flex;
      flex-direction: column;
      box-shadow: -8px 0 40px rgba(0,0,0,0.75);
      transition: right 0.32s cubic-bezier(.4,0,.2,1);
      font-family: 'Arial', sans-serif;
      font-size: 13px;
      overflow: hidden;
    }
    #pt-panel.open { right: 0; }

    /* ── Header ── */
    #pt-hdr {
      background: linear-gradient(90deg, #1a1c2b 0%, #1d2035 100%);
      padding: 13px 18px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 2px solid #c9943a;
      flex-shrink: 0;
    }
    #pt-hdr-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #c9943a, #a87428);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    #pt-hdr h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      color: #e8c37a;
      letter-spacing: 0.3px;
      flex: 1;
    }
    #pt-hdr-sub {
      font-size: 10px;
      color: #4a5270;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .pt-api-badge {
      background: rgba(62,200,112,0.12);
      color: #3ec870;
      border: 1px solid rgba(62,200,112,0.25);
      border-radius: 10px;
      padding: 2px 10px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
      margin-right: 6px;
      transition: color 0.2s, background 0.2s;
    }
    .pt-api-badge.active { color: #e8c541; background: rgba(234,197,65,0.15); border-color: rgba(234,197,65,0.3); }
    #pt-close {
      background: #1f2340;
      border: 1px solid #2e3452;
      color: #4a5270;
      font-size: 16px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      width: 28px;
      height: 28px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s, background 0.15s;
    }
    #pt-close:hover { background: #2e3452; color: #c8cde0; }

    /* ── Controls ── */
    #pt-controls {
      background: #171929;
      border-bottom: 1px solid #222540;
      padding: 8px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .pt-ctrl-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .pt-ctrl-row.wrap { flex-wrap: wrap; }
    #pt-controls label {
      font-size: 10px;
      font-weight: 600;
      color: #4a5270;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #pt-controls input {
      background: #1c1f33;
      border: 1px solid #2a2f4a;
      color: #c8cde0;
      padding: 5px 9px;
      border-radius: 5px;
      font-size: 12px;
      outline: none;
      min-width: 0;
      transition: border-color 0.15s;
    }
    #pt-controls input:focus { border-color: #c9943a; }
    #pt-controls input::placeholder { color: #323656; }
    #pt-from,
    #pt-to     { flex: 1; min-width: 100px; max-width: 145px; }
    #pt-search { flex: 1; min-width: 80px; }
    #pt-tax    { width: 50px; text-align: center; flex-shrink: 0; }

    /* colour the date input calendar icon on Webkit */
    #pt-controls input[type="date"]::-webkit-calendar-picker-indicator {
      filter: invert(0.5) sepia(1) saturate(2) hue-rotate(10deg);
      cursor: pointer;
    }

    .pt-btn {
      background: linear-gradient(135deg, #c9943a, #a87428);
      color: #fff;
      border: none;
      padding: 0 16px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      height: 28px;
      letter-spacing: 0.3px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      transition: filter 0.15s, transform 0.1s;
    }
    .pt-btn:hover    { filter: brightness(1.12); transform: translateY(-1px); }
    .pt-btn:active   { transform: translateY(0); filter: brightness(0.95); }
    .pt-btn:disabled { opacity: .35; cursor: not-allowed; transform: none; }
    .pt-btn.blue  { background: linear-gradient(135deg, #3a6fd8, #2a55b0); }
    .pt-btn.gray  { background: linear-gradient(135deg, #2a2f4a, #1e2238); }

    #pt-status {
      font-size: 11px;
      color: #3d4466;
      flex: 1;
      min-width: 80px;
    }
    #pt-status.err { color: #d95858; }
    #pt-status.ok  { color: #3ec870; }

    /* ── Summary tiles ── */
    #pt-summary {
      display: flex;
      gap: 0;
      padding: 0;
      flex-shrink: 0;
      background: #171929;
      border-bottom: 1px solid #222540;
    }
    .pt-tile {
      flex: 1;
      padding: 11px 14px 10px;
      border-right: 1px solid #222540;
      position: relative;
    }
    .pt-tile:last-child { border-right: none; }
    .pt-tile::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
    }
    .pt-tile.blue::before   { background: #4d85f4; }
    .pt-tile.red::before    { background: #d95858; }
    .pt-tile.green::before  { background: #3ec870; }
    .pt-tile.purple::before { background: #9b6cf5; }
    .pt-tile-lbl {
      font-size: 10px;
      font-weight: 600;
      color: #3d4466;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .pt-tile-val {
      font-size: 16px;
      font-weight: 700;
      line-height: 1;
    }
    .pt-tile.blue   .pt-tile-val { color: #6aa0f7; }
    .pt-tile.red    .pt-tile-val { color: #e06a6a; }
    .pt-tile.green  .pt-tile-val { color: #3ec870; }
    .pt-tile.purple .pt-tile-val { color: #a87af6; }

    /* ── Tab bar ── */
    #pt-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 14px;
      background: #131620;
      border-bottom: 1px solid #1e2135;
      flex-shrink: 0;
    }
    .pt-tab {
      background: transparent;
      color: #3d4466;
      border: 1px solid transparent;
      padding: 5px 16px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
      letter-spacing: 0.2px;
    }
    .pt-tab:hover  { color: #c8cde0; background: #1c1f33; border-color: #2a2f4a; }
    .pt-tab.active {
      background: #1c2040;
      border-color: #c9943a;
      color: #e8c37a;
    }
    .pt-tab-n {
      font-size: 10px;
      font-weight: 700;
      background: rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 1px 6px;
      margin-left: 5px;
    }
    .pt-tab.active .pt-tab-n { background: rgba(201,148,58,0.2); color: #c9943a; }

    /* ── Date nav buttons ── */
    .pt-nav {
      background: #1c1f33;
      border: 1px solid #2a2f4a;
      color: #6b7494;
      width: 26px;
      height: 28px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    .pt-nav:hover { background: #2a2f4a; color: #c8cde0; border-color: #3d4466; }

    #pt-chart-btn {
      margin-left: auto;
      background: transparent;
      color: #3d4466;
      border: 1px solid #1e2135;
      padding: 4px 12px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    #pt-chart-btn:hover { color: #c8cde0; border-color: #2a2f4a; }

    /* ── Chart ── */
    #pt-chart-wrap {
      background: #131620;
      border-bottom: 1px solid #1e2135;
      flex-shrink: 0;
      overflow: hidden;
      max-height: 0;
      transition: max-height 0.3s ease, padding 0.3s ease;
      padding: 0 16px;
    }
    #pt-chart-wrap.show { max-height: 215px; padding: 12px 16px; }
    #pt-chart-wrap canvas { max-height: 190px; }

    /* ── Table scroll container ── */
    #pt-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      background: #12141f;
    }
    #pt-tbl-wrap { overflow-x: auto; }

    #pt-spinner {
      display: none;
      justify-content: center;
      align-items: center;
      padding: 56px;
    }
    #pt-spinner.show { display: flex; }
    .pt-spin {
      width: 30px; height: 30px;
      border: 3px solid #1e2135;
      border-top-color: #c9943a;
      border-radius: 50%;
      animation: pt-spin 0.75s linear infinite;
    }
    @keyframes pt-spin { to { transform: rotate(360deg); } }

    /* ── Table ── */
    #pt-panel table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    #pt-panel thead th {
      background: #171929;
      color: #4a5270;
      padding: 8px 12px;
      text-align: left;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 2;
      cursor: pointer;
      user-select: none;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #1e2135;
      transition: color 0.15s;
    }
    #pt-panel thead th:hover { color: #c8cde0; }
    #pt-panel thead th.r     { text-align: right; }
    #pt-panel thead th::after { content: " ↕"; font-size: 9px; opacity: .25; }
    #pt-panel thead th.s-asc::after  { content: " ↑"; opacity: 1; color: #c9943a; }
    #pt-panel thead th.s-desc::after { content: " ↓"; opacity: 1; color: #c9943a; }

    #pt-panel tbody td {
      padding: 7px 12px;
      border-bottom: 1px solid #1a1d2e;
      white-space: nowrap;
      color: #c8cde0 !important;
    }
    #pt-panel tbody tr { transition: background 0.1s; }
    #pt-panel tbody tr:hover td { background: #1a1d2e; }
    #pt-panel tbody tr:nth-child(even) td { background: #141725; }
    #pt-panel tbody tr:nth-child(even):hover td { background: #1a1d2e; }

    #pt-panel td.r     { text-align: right; }
    #pt-panel td.dim   { color: #6b7494 !important; font-size: 11px; }
    #pt-panel td.red   { text-align: right; color: #e06a6a !important; font-weight: 600; }
    #pt-panel td.green { text-align: right; color: #3ec870 !important; font-weight: 600; }
    #pt-panel td.gold  { text-align: right; color: #c9943a !important; font-weight: 600; }
    #pt-panel td.empty { text-align: center; color: #4a5270 !important; padding: 40px 0; font-size: 13px; }

    /* ── Usage log types ── */
    .pt-logtypes {
      color: #4a5270;
      font-size: 10px;
      font-weight: 400;
      line-height: 1.4;
      margin-top: 2px;
      white-space: normal;
    }

    /* ── Usage detail ── */
    .pt-ud-th {
      background: #171929; color: #4a5270; padding: 6px 12px;
      text-align: left; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
    }
    .pt-ud-th.r { text-align: right; }

    /* ── Store badges ── */
    .pt-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .bdg-blue   { background: rgba(77,133,244,0.15); color: #6aa0f7; border: 1px solid rgba(77,133,244,0.25); }
    .bdg-orange { background: rgba(201,148,58,0.15); color: #c9943a; border: 1px solid rgba(201,148,58,0.25); }
    .bdg-yellow { background: rgba(234,197,65,0.15); color: #e8c541; border: 1px solid rgba(234,197,65,0.25); }
    .bdg-red    { background: rgba(217,88,88,0.15);  color: #e06a6a; border: 1px solid rgba(217,88,88,0.25); }
    .bdg-purple { background: rgba(155,108,245,0.15);color: #a87af6; border: 1px solid rgba(155,108,245,0.25); }
    .bdg-teal   { background: rgba(56,200,180,0.15); color: #38c8b4; border: 1px solid rgba(56,200,180,0.25); }
    .bdg-green  { background: rgba(62,200,112,0.15); color: #3ec870; border: 1px solid rgba(62,200,112,0.25); }
    .bdg-cyan   { background: rgba(56,200,180,0.15); color: #38c8b4; border: 1px solid rgba(56,200,180,0.25); }
    .bdg-pink   { background: rgba(220,100,160,0.15); color: #dc64a0; border: 1px solid rgba(220,100,160,0.25); }
    .bdg-gray   { background: rgba(58,64,96,0.4);    color: #4a5270; border: 1px solid #2a2f4a; }

    /* item name cell */
    #pt-panel td.item-name { color: #c8cde0; font-weight: 500; }

    /* ── Scrollbar ── */
    #pt-panel ::-webkit-scrollbar { width: 5px; height: 5px; }
    #pt-panel ::-webkit-scrollbar-track { background: #12141f; }
    #pt-panel ::-webkit-scrollbar-thumb { background: #2a2f4a; border-radius: 3px; }
    #pt-panel ::-webkit-scrollbar-thumb:hover { background: #3d4466; }

    /* ── Store badge icon/text toggle ── */
    .bdg-icon { display: none; }
    .bdg-text { display: inline; }

    /* ── Mobile ── */
    @media (max-width: 600px) {
      #pt-panel   { width: 100vw; }
      #pt-toggle.open { right: 100vw; }
      .pt-col-date { display: none !important; }
      .pt-col-store { width: 28px; padding: 7px 4px !important; text-align: center; }
      .pt-col-store .pt-badge { padding: 3px 4px; font-size: 13px; border: none; background: transparent; }
      .bdg-text { display: none; }
      .bdg-icon { display: inline; }
      #pt-from, #pt-to { min-width: 0; }
      .pt-ctrl-row:nth-child(2) { gap: 4px; }
      .pt-tile-val { font-size: 14px; }
      .pt-tile-lbl { font-size: 9px; }
    }

    /* ── Trade detail ── */
    #pt-trade-wrap table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #pt-trade-wrap thead th {
      background: #171929; color: #4a5270; padding: 8px 12px; text-align: left;
      white-space: nowrap; position: sticky; top: 0; z-index: 2;
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid #1e2135;
    }
    #pt-trade-wrap thead th.r { text-align: right; }
    #pt-trade-wrap tbody td { padding: 7px 12px; border-bottom: 1px solid #1a1d2e; white-space: nowrap; color: #c8cde0; }
    #pt-trade-wrap tbody tr.pt-trade-row { cursor: pointer; transition: background 0.1s; }
    #pt-trade-wrap tbody tr.pt-trade-row:hover td { background: #1a1d2e; }
    #pt-trade-wrap tbody tr:nth-child(4n+3) td,
    #pt-trade-wrap tbody tr:nth-child(4n+4) td { background: #141725; }
    #pt-trade-wrap tbody tr.pt-trade-row:nth-child(4n+3):hover td,
    #pt-trade-wrap tbody tr.pt-trade-row:nth-child(4n+1):hover td { background: #1a1d2e; }
    #pt-trade-wrap td.red   { color: #e06a6a !important; }
    #pt-trade-wrap td.green { color: #3ec870 !important; }
    #pt-trade-wrap td.dim   { color: #6b7494 !important; font-size: 11px; }
    #pt-trade-wrap td.empty { text-align: center; color: #4a5270 !important; padding: 40px 0; font-size: 13px; }
    .pt-trade-arrow { color: #3d4466; font-size: 10px; text-align: right; width: 16px; }
    .pt-trade-link  { color: #c9943a; text-decoration: none; }
    .pt-trade-link:hover { text-decoration: underline; }
    .pt-trade-detail-cell { padding: 0 !important; background: #131620 !important; }
    .pt-trade-cols {
      display: flex; gap: 0; border-top: 1px solid #222540;
    }
    .pt-trade-col {
      flex: 1; padding: 10px 16px; border-right: 1px solid #1e2135;
    }
    .pt-trade-col:last-child { border-right: none; }
    .pt-trade-col-hdr {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 6px;
    }
    .pt-trade-col-hdr.red   { color: #e06a6a; }
    .pt-trade-col-hdr.green { color: #3ec870; }
    .pt-trade-item { font-size: 12px; color: #c8cde0; padding: 2px 0; display: flex; gap: 6px; align-items: baseline; }
    .pt-trade-item-qty   { color: #6b7494; font-size: 11px; min-width: 28px; }
    .pt-trade-item-price { color: #4a5270; font-size: 10px; }
  `);

  // ── Build panel ───────────────────────────────────────────────────────────
  function buildUI() {
    localStorage.removeItem('tornItemCatalog');
    localStorage.removeItem('tornItemCatalog_v2');
    localStorage.removeItem('tornItemCatalog_v3');

    const savedUrl = GM_getValue('serverUrl', '');
    const now  = new Date();
    const week = new Date(+now - 7 * 86400_000);

    const toggle = el('div', { id: 'pt-toggle', title: 'Portfolio Tracker' }, 'Portfolio');
    toggle.addEventListener('click', togglePanel);

    const panel = el('div', { id: 'pt-panel' });
    panel.innerHTML = `
      <div id="pt-hdr">
        <div id="pt-hdr-icon">&#x1F4B0;</div>
        <div style="flex:1;min-width:0">
          <h2>Portfolio Tracker</h2>
          <div id="pt-hdr-sub">Torn Transaction Analytics</div>
        </div>
        <span id="pt-api-badge" class="pt-api-badge" title="API calls this session">0</span>
        <button id="pt-close" title="Close">&#x2715;</button>
      </div>

      <div id="pt-controls">
        <div class="pt-ctrl-row">
          <button class="pt-nav" id="pt-prev" title="Previous period">&#x2039;</button>
          <label>From</label>
          <input id="pt-from" type="date" value="${isoDate(now)}">
          <label>To</label>
          <input id="pt-to" type="date" value="${isoDate(now)}">
          <button class="pt-nav" id="pt-next" title="Next period">&#x203A;</button>
        </div>
        <div class="pt-ctrl-row wrap">
          <label>Tax%</label>
          <input id="pt-tax" type="number" value="5" min="0" max="100" step="0.1">
          <input id="pt-search" type="text" placeholder="&#x1F50D; Search item...">
          <button class="pt-btn" id="pt-load">Load Data</button>
          <span id="pt-status"></span>
        </div>
      </div>

      <div id="pt-summary">
        <div class="pt-tile blue">
          <div class="pt-tile-lbl" id="pt-l-items">Total Items</div>
          <div class="pt-tile-val" id="pt-s-items">—</div>
        </div>
        <div class="pt-tile red">
          <div class="pt-tile-lbl" id="pt-l-spent">Total Spent</div>
          <div class="pt-tile-val" id="pt-s-spent">—</div>
        </div>
        <div class="pt-tile green">
          <div class="pt-tile-lbl" id="pt-l-sold">Total Sold</div>
          <div class="pt-tile-val" id="pt-s-sold">—</div>
        </div>
        <div class="pt-tile purple">
          <div class="pt-tile-lbl" id="pt-l-income">Est. Profit</div>
          <div class="pt-tile-val" id="pt-s-income">—</div>
        </div>
      </div>

      <div id="pt-tabs">
        <button class="pt-tab active" data-tab="buy">
          Purchased <span class="pt-tab-n" id="pt-n-buy">0</span>
        </button>
        <button class="pt-tab" data-tab="sell">
          Sold <span class="pt-tab-n" id="pt-n-sell">0</span>
        </button>
        <button class="pt-tab" data-tab="trades">
          Trades <span class="pt-tab-n" id="pt-n-trades">0</span>
        </button>
        <button class="pt-tab" data-tab="free">
          Free Items <span class="pt-tab-n" id="pt-n-free">0</span>
        </button>
        <button class="pt-tab" data-tab="usage">
          Item Usage <span class="pt-tab-n" id="pt-n-usage">0</span>
        </button>
        <button class="pt-tab" data-tab="usage-faction">
          Faction Used <span class="pt-tab-n" id="pt-n-usage-faction">0</span>
        </button>
        <button id="pt-chart-btn">&#x1F4C8; Chart</button>
      </div>

      <div id="pt-chart-wrap">
        <canvas id="pt-chart"></canvas>
      </div>

      <div id="pt-body">
        <div id="pt-spinner"><div class="pt-spin"></div></div>
        <div id="pt-trade-wrap" style="display:none;overflow-x:auto"></div>
        <div id="pt-tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th class="pt-col-store" title="Store"><span class="bdg-text">Store</span><span class="bdg-icon">🏪</span></th>
                <th class="r">Qty</th>
                <th class="r">Avg</th>
                <th class="r">Total</th>
                <th class="r">Mkt Price</th>
                <th class="r">Est. Profit</th>
                <th class="r">$/Unit</th>
                <th class="r pt-col-date">Last</th>
              </tr>
            </thead>
            <tbody id="pt-tbody">
              <tr><td colspan="9" class="empty">Select a date range and click Load Data.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    panel.querySelector('#pt-close')    .addEventListener('click', togglePanel);
    panel.querySelector('#pt-load')     .addEventListener('click', () => { loadedTabs = new Set(); loadData(); });
    panel.querySelector('#pt-prev')     .addEventListener('click', () => shiftDates(-1));
    panel.querySelector('#pt-next')     .addEventListener('click', () => shiftDates(1));
    panel.querySelector('#pt-tax')      .addEventListener('input', rerender);
    panel.querySelector('#pt-chart-btn').addEventListener('click', onChartToggle);

    let searchTimer;
    panel.querySelector('#pt-search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(rerender, 300);
    });

    panel.querySelectorAll('.pt-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        panel.querySelectorAll('.pt-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (!loadedTabs.has(activeTab)) { loadData(); return; }
        rerender();
      });
    });

    // Event delegation for sort — survives dynamic header replacement
    document.getElementById('pt-tbl-wrap').addEventListener('click', e => {
      const th = e.target.closest('th');
      if (!th) return;
      // Ignore headers inside expandable history tables (they sort themselves)
      if (th.closest('.pt-usage-detail')) return;
      const row  = th.closest('tr');
      const idx  = Array.from(row.children).indexOf(th);
      sortBy(Math.min(idx, (activeTab === 'free' || activeTab === 'usage' || activeTab === 'usage-faction') ? 4 : 8));
    });

    if (savedUrl) loadData();
  }

  function startCooldown() {
    // Cooldown temporarily disabled — buttons stay clickable
    cooldownEnd = Date.now() + 60 * 1000;
    const loadBtn = document.getElementById('pt-load');
    const prevBtn = document.getElementById('pt-prev');
    const nextBtn = document.getElementById('pt-next');
    if (loadBtn) loadBtn.disabled = false;
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
  }

  function shiftDates(direction) {
    const fromInput = document.getElementById('pt-from');
    const toInput   = document.getElementById('pt-to');
    if (!fromInput.value || !toInput.value) return;

    const fromMs  = new Date(fromInput.value + 'T00:00:00Z').getTime();
    const toMs    = new Date(toInput.value   + 'T00:00:00Z').getTime();
    const shiftMs = (toMs - fromMs) + 86400_000;   // range length in ms

    fromInput.value = isoDate(new Date(fromMs + direction * shiftMs));
    toInput.value   = isoDate(new Date(toMs   + direction * shiftMs));
    loadedTabs = new Set();
    startCooldown();
    loadData();
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    document.getElementById('pt-panel').classList.toggle('open', panelOpen);
    document.getElementById('pt-toggle').classList.toggle('open', panelOpen);
  }

  function onChartToggle() {
    const wrap = document.getElementById('pt-chart-wrap');
    const btn  = document.getElementById('pt-chart-btn');
    const show = wrap.classList.toggle('show');
    btn.textContent = show ? '✕ Chart' : '📈 Chart';
    if (show) renderChart();
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url,
        onload:    r => { try { resolve(JSON.parse(r.responseText)); } catch(e) { reject(new Error('Invalid JSON')); } },
        onerror:   () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // ── Load data ─────────────────────────────────────────────────────────────
  async function loadData() {
    const serverUrl = GM_getValue('serverUrl', '').replace(/\/+$/, '');
    const from = document.getElementById('pt-from').value;
    const to   = document.getElementById('pt-to').value;

    if (!serverUrl)    { setStatus('Server URL not set — use Tampermonkey menu to configure.', 'err'); return; }
    if (!from || !to){ setStatus('Select a date range.', 'err'); return; }

    startCooldown();

    showLoading(true);
    const badge = document.getElementById('pt-api-badge');
    if (badge) { badge.textContent = 'DB'; badge.classList.remove('active'); }

    try {
      if (!Object.keys(itemCatalog).length) {
        const cached = localStorage.getItem('tornItemCatalog_v3');
        if (cached) {
          itemCatalog = JSON.parse(cached);
        } else {
          setStatus('Fetching item catalog…');
          const data = await gmFetch(`${serverUrl}/api/portfolio/catalog`);
          if (data.error) throw new Error(data.error.error || data.error);
          itemCatalog = {};
          for (const [id, item] of Object.entries(data.items)) {
            itemCatalog[id] = { name: item.name, price: item.market_value ?? 0 };
          }
          localStorage.setItem('tornItemCatalog_v3', JSON.stringify(itemCatalog));
        }
      }

      const fromTs = toUnix(from, false);
      const toTs   = toUnix(to,   true);
      setStatus('Fetching all transaction logs…');

      // Fetch all log types in parallel — no Torn API rate limits anymore
      const [buyRaw, sellRaw, tradeRaw, freeRaw, usageRaw] = await Promise.all([
        gmFetch(`${serverUrl}/api/portfolio/logs?logTypes=${BUY_LOG_TYPES.join(',')}&from=${fromTs}&to=${toTs}&limit=5000`),
        gmFetch(`${serverUrl}/api/portfolio/logs?logTypes=${SELL_LOG_TYPES.join(',')}&from=${fromTs}&to=${toTs}&limit=5000`),
        gmFetch(`${serverUrl}/api/portfolio/logs?logTypes=${TRADE_LOG_TYPES.join(',')}&from=${fromTs}&to=${toTs}&limit=5000`),
        gmFetch(`${serverUrl}/api/portfolio/logs?logTypes=${ALL_FREE_LOG_TYPES.join(',')}&from=${fromTs}&to=${toTs}&limit=5000`),
        gmFetch(`${serverUrl}/api/portfolio/logs?logTypes=${ALL_USAGE_LOG_TYPES.join(',')}&from=${fromTs}&to=${toTs}&limit=5000`),
      ]);

      if (buyRaw.error)   throw new Error(buyRaw.error.error   || buyRaw.error);
      if (sellRaw.error)  throw new Error(sellRaw.error.error  || sellRaw.error);
      if (tradeRaw.error) throw new Error(tradeRaw.error.error || tradeRaw.error);
      if (freeRaw.error)  throw new Error(freeRaw.error.error  || freeRaw.error);
      if (usageRaw.error) throw new Error(usageRaw.error.error || usageRaw.error);

      originalBuyData  = processLogs(buyRaw.log || []);
      originalSellData = processLogs(sellRaw.log || []);
      tradeData        = processTrades(tradeRaw.log || []);
      freeItemsData    = processFreeItems(freeRaw.log || []);
      const usageRes   = processUsageItems(usageRaw.log || []);
      usageData        = usageRes.own;
      factionUsedData  = usageRes.faction;

      loadedTabs.add('buy').add('sell').add('trades').add('free').add('usage').add('usage-faction');

      setStatus(`${originalBuyData.length} buys · ${originalSellData.length} sells · ${tradeData.length} trades · ${freeItemsData.length} free · ${usageData.length} used · ${factionUsedData.length} faction-used`, 'ok');
      rerender();
    } catch (e) {
      if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
      cooldownEnd = 0;
      const loadBtn = document.getElementById('pt-load');
      if (loadBtn) { loadBtn.textContent = 'Load Data'; loadBtn.disabled = false; }
      const prevBtn = document.getElementById('pt-prev');
      const nextBtn = document.getElementById('pt-next');
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;
      setStatus('Error: ' + e.message, 'err');
    } finally {
      showLoading(false);
    }
  }

  // ── Process logs ──────────────────────────────────────────────────────────
  function storeFromTitle(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('bazaar'))                                    return 'Bazaar';
    if (t.includes('item market') || t.includes('city market')) return 'Item Market';
    if (t.includes('point market'))                              return 'Point Market';
    if (t.includes('armoury') || t.includes('armory'))          return 'Armoury';
    if (t.includes('abroad') || t.includes('foreign'))          return 'Abroad';
    if (t.includes('shop'))                                      return 'Shop';
    if (t.includes('trade'))                                     return 'Trade';
    return 'Unknown';
  }

  function processLogs(logs) {
    const map = new Map();
    logs.forEach(log => {
      const d       = log.data || {};
      const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
      let itemId    = (Array.isArray(d.item) ? d.item[0]?.id : d.item) ?? d.items?.[0]?.id;

      if (!itemId && POINTS_LOG_TYPES.has(logType)) itemId = '__points__';
      if (!itemId) return;

      const cat   = itemId === '__points__'
        ? { name: 'Torn Points', price: 0 }
        : (itemCatalog[itemId] || { name: `Item ${itemId}`, price: 0 });
      const store = LOG_TYPE_STORE[logType] || log.details?.category || log.category || storeFromTitle(log.details?.title ?? log.title);
      const qty   = d.quantity ?? d.items?.[0]?.qty ?? 1;
      const cost  = d.cost_total ?? d.cost ?? 0;
      const ts     = log.timestamp * 1000;
      const mapKey = `${itemId}:${store}`;

      if (!map.has(mapKey)) {
        map.set(mapKey, {
          item_id: itemId, item_name: cat.name, store_type: store,
          current_price: cat.price, total_quantity: 0, total_amount: 0, last_transaction: ts,
          no_tax: itemId === '__points__' || store === 'Bazaar',
          details: [],
          log_types: {},
        });
      }
      const e = map.get(mapKey);
      e.total_quantity += qty;
      e.total_amount   += cost;
      // Track which log types contributed to this item
      if (!e.log_types[logType]) {
        e.log_types[logType] = { title: log.details?.title || log.title || LOG_TYPE_NAMES[logType] || `Log ${logType}`, count: 0 };
      }
      e.log_types[logType].count += qty;
      if (ts > e.last_transaction) e.last_transaction = ts;
      // Store individual log entry for expandable rows (un-aggregated)
      e.details.push({
        timestamp: ts,
        quantity: qty,
        cost: cost,
        title: log.details?.title || log.title || LOG_TYPE_NAMES[logType] || `Log ${logType}`,
      });
    });

    return Array.from(map.values()).map(e => ({
      ...e,
      avg_cost: e.total_quantity > 0 ? e.total_amount / e.total_quantity : 0,
    }));
  }

  function extractFreeItems(data, logType) {
    // 9027 Crime ammo, 5533 Stock special ammo, 6500 Company special ammo
    // data.ammo_gained / data.ammo = {ammoType: {ammoSize: qty}} — also accept flat {ammoType: qty}
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

    // 9020 Crime success — data.items_gained = {"itemID": qty, ...}
    // 8938 Christmas town — data.items = {"itemID": qty, ...}
    if (data.items_gained && typeof data.items_gained === 'object' && !Array.isArray(data.items_gained)) {
      return Object.entries(data.items_gained).map(([id, qty]) => ({ id: parseInt(id), qty }));
    }
    if (data.items && typeof data.items === 'object' && !Array.isArray(data.items)) {
      return Object.entries(data.items).map(([id, qty]) => ({ id: parseInt(id), qty }));
    }

    // data.items = [{id, qty}] — Parcel open, Item receive
    if (Array.isArray(data.items)) {
      return data.items.map(i => ({ id: i.id, qty: i.qty || 1 }));
    }

    // data.item = [{id, qty}] — Dump find, Faction give/loan
    if (Array.isArray(data.item)) {
      return data.item.map(i => ({ id: i.id, qty: i.qty || 1 }));
    }

    // data.item = number (item ID) — City find, Job special, Company special
    // data.egg  = number (item ID) — Easter egg hunt
    if (typeof data.item === 'number') {
      return [{ id: data.item, qty: data.quantity || 1 }];
    }
    if (typeof data.egg === 'number') {
      return [{ id: data.egg, qty: 1 }];
    }

    // data.set = string (Museum exchange) — "Plushie Set", "Flower Set", etc.
    if (typeof data.set === 'string') {
      return [{ id: `__set__${data.set}`, qty: data.quantity || 1 }];
    }

    return [];
  }

  function processFreeItems(logs) {
    const map = new Map();
    logs.forEach(log => {
      const d       = log.data || {};
      const logType = log.details?.id ?? log.log ?? log.type;
      const source  = FREE_SOURCE_MAP[logType];
      if (!source) return;

      const entries = extractFreeItems(d, logType);
      const ts      = log.timestamp * 1000;

      entries.forEach(({ id: itemId, qty }) => {
        let cat;
        if (typeof itemId === 'string' && itemId.startsWith('__ammo__')) {
          const parts = itemId.split('__');
          cat = { name: `Ammo T${parts[2]} S${parts[3]}`, price: 0 };
        } else {
          cat = itemCatalog[itemId] || { name: `Item ${itemId}`, price: 0 };
        }
        const mapKey = `${itemId}:${source}`;

        if (!map.has(mapKey)) {
          map.set(mapKey, {
            item_id: itemId,
            item_name: cat.name,
            source: source,
            current_price: cat.price,
            total_quantity: 0,
            last_transaction: ts,
            details: [],
            log_types: {},
          });
        }
        const e = map.get(mapKey);
        e.total_quantity += qty;
        if (ts > e.last_transaction) e.last_transaction = ts;
        // Track which log types contributed to this item
        if (!e.log_types[logType]) {
          e.log_types[logType] = { title: log.details?.title || log.title || LOG_TYPE_NAMES[logType] || `Log ${logType}`, count: 0 };
        }
        e.log_types[logType].count += qty;
        // Store individual log entry for expandable rows (un-aggregated)
        e.details.push({
          timestamp: ts,
          quantity: qty,
          title: log.details?.title || LOG_TYPE_NAMES[logType] || `Log ${logType}`,
        });
      });
    });

    return Array.from(map.values());
  }

  function processUsageItems(logs) {
    const map  = new Map();   // own-inventory usage (item use with faction === 0)
    const fMap = new Map();   // faction-armory item use (item use with faction !== 0)
    logs.forEach(log => {
      const d       = log.data || {};
      const logType = log.details?.id ?? log.log ?? log.type;
      const source  = USAGE_SOURCE_MAP[logType];
      if (!source) return;
      // Item use with a faction set = used from the faction armory → its own tab
      const isFactionUse = source === 'Consumed' && d.faction;
      const target       = isFactionUse ? fMap : map;
      const srcLabel     = isFactionUse ? 'Faction Used' : source;

      const entries = extractFreeItems(d, logType);
      const ts      = log.timestamp * 1000;

      entries.forEach(({ id: itemId, qty }) => {
        let cat;
        if (typeof itemId === 'string' && itemId.startsWith('__set__')) {
          cat = { name: itemId.slice(7), price: 0 };
        } else if (typeof itemId === 'string' && itemId.startsWith('__ammo__')) {
          const parts = itemId.split('__');
          cat = { name: `Ammo T${parts[2]} S${parts[3]}`, price: 0 };
        } else {
          cat = itemCatalog[itemId] || { name: `Item ${itemId}`, price: 0 };
        }
        const mapKey = `${itemId}:${srcLabel}`;

        if (!target.has(mapKey)) {
          target.set(mapKey, {
            item_id: itemId,
            item_name: cat.name,
            source: srcLabel,
            current_price: cat.price,
            total_quantity: 0,
            last_transaction: ts,
            details: [],
            log_types: {},
          });
        }
        const e = target.get(mapKey);
        e.total_quantity += qty;
        if (ts > e.last_transaction) e.last_transaction = ts;
        // Track which log types contributed to this item
        if (!e.log_types[logType]) {
          e.log_types[logType] = { title: log.details?.title || LOG_TYPE_NAMES[logType] || `Log ${logType}`, count: 0 };
        }
        e.log_types[logType].count += qty;
        // Store individual log detail for expandable rows
        if (logType === 7000) {
          e.details.push({ timestamp: ts, quantity: qty, points: d.points_received || 0 });
        } else if (logType === 4100 || logType === 4102 || logType === 4104) {
          e.details.push({
            timestamp: ts,
            quantity: qty,
            receiver: d.receiver,
            message: d.message || '',
            items: (d.items || []).map(i => ({ id: i.id, name: itemCatalog[i.id]?.name || `Item ${i.id}`, qty: i.qty || 1 })),
          });
        } else if (logType === 1400 || logType === 1403) {
          e.details.push({
            timestamp: ts,
            quantity: qty,
            items: (d.items || (d.item ? [d.item] : [])).flat().map(i => typeof i === 'object' ? { id: i.id, name: itemCatalog[i.id]?.name || `Item ${i.id}`, qty: i.qty || 1 } : { id: i, name: itemCatalog[i]?.name || `Item ${i}`, qty: 1 }),
          });
        } else {
          e.details.push({ timestamp: ts, quantity: qty, title: log.details?.title || LOG_TYPE_NAMES[logType] || `Log ${logType}` });
        }
      });
    });

    return { own: Array.from(map.values()), faction: Array.from(fMap.values()) };
  }

  // ── Process trades ────────────────────────────────────────────────────────
  function processTrades(logs) {
    const map = new Map();

    logs.forEach(log => {
      const d       = log.data || {};
      const logType = log.log ?? log.log_type ?? log.type ?? log.details?.id;
      const tradeId = d.parsed_trade_id;
      if (!tradeId) return;

      if (!map.has(tradeId)) {
        map.set(tradeId, {
          trade_id:       tradeId,
          timestamp:      log.timestamp * 1000,
          counterpart_id: d.user,
          gave:     { money: 0, items: [], properties: [] },
          received: { money: 0, items: [], properties: [] },
        });
      }

      const trade = map.get(tradeId);
      if (log.timestamp * 1000 > trade.timestamp) trade.timestamp = log.timestamp * 1000;

      switch (logType) {
        case 4440:
          trade.gave.money += d.money || 0;
          break;
        case 4441:
          trade.received.money += d.money || 0;
          break;
        case 4445:
          (d.items || []).forEach(item => {
            const name = itemCatalog[item.id]?.name || `Item ${item.id}`;
            const ex   = trade.gave.items.find(i => i.id === item.id);
            if (ex) ex.qty += (item.qty || 1);
            else    trade.gave.items.push({ id: item.id, name, qty: item.qty || 1 });
          });
          break;
        case 4446:
          (d.items || []).forEach(item => {
            const name = itemCatalog[item.id]?.name || `Item ${item.id}`;
            const ex   = trade.received.items.find(i => i.id === item.id);
            if (ex) ex.qty += (item.qty || 1);
            else    trade.received.items.push({ id: item.id, name, qty: item.qty || 1 });
          });
          break;
        case 4450:
          trade.gave.properties.push(d);
          break;
        case 4451:
          trade.received.properties.push(d);
          break;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  function tradeSideValue(side) {
    let val = side.money;
    side.items.forEach(item => { val += (itemCatalog[item.id]?.price || 0) * item.qty; });
    return val;
  }

  function tradeSummary(side, search) {
    const parts = [];
    if (search) {
      // Search mode: show only the matched item(s) with exact quantities
      side.items
        .filter(i => (i.name || '').toLowerCase().includes(search))
        .forEach(i => parts.push(`${i.qty.toLocaleString()}x ${esc(i.name)}`));
      return parts.join(' + ') || '<span style="color:#2e3452">—</span>';
    }
    if (side.money > 0) parts.push(fmt$(side.money));
    if (side.items.length === 1) {
      parts.push(`${side.items[0].qty.toLocaleString()}x ${esc(side.items[0].name)}`);
    } else if (side.items.length > 1) {
      const total = side.items.reduce((s, i) => s + i.qty, 0);
      parts.push(`${total.toLocaleString()} items`);
    }
    if (side.properties.length > 0) parts.push(`${side.properties.length} prop.`);
    return parts.join(' + ') || '<span style="color:#2e3452">—</span>';
  }

  function tradeItemsList(side) {
    const lines = [];
    if (side.money > 0)
      lines.push(`<div class="pt-trade-item"><span class="pt-trade-item-qty">💰</span>${fmt$(side.money)}</div>`);
    side.items.forEach(item => {
      const mktPrice = itemCatalog[item.id]?.price;
      const priceStr = mktPrice ? ` <span class="pt-trade-item-price">@ ${fmt$(mktPrice)} ea</span>` : '';
      lines.push(`<div class="pt-trade-item"><span class="pt-trade-item-qty">${item.qty.toLocaleString()}x</span>${esc(item.name)}${priceStr}</div>`);
    });
    side.properties.forEach(() => {
      lines.push(`<div class="pt-trade-item"><span class="pt-trade-item-qty">🏠</span>Property</div>`);
    });
    return lines.join('') || '<div class="pt-trade-item" style="color:#4a5270">—</div>';
  }

  // ── Render trades ─────────────────────────────────────────────────────────
  function renderTrades(data, search) {
    const wrap = document.getElementById('pt-trade-wrap');

    if (!data.length) {
      wrap.innerHTML = '<table><tbody><tr><td colspan="6" class="empty">No trades found for this range.</td></tr></tbody></table>';
      return;
    }

    const rows = [];
    data.forEach((trade, i) => {
      rows.push(`
        <tr class="pt-trade-row" data-idx="${i}">
          <td class="dim">${fmtDate(trade.timestamp)}</td>
          <td><a class="pt-trade-link" href="/trade.php#step=view&amp;ID=${trade.trade_id}" target="_blank">#${trade.trade_id}</a></td>
          <td class="dim"><a class="pt-trade-link" href="/profiles.php?XID=${trade.counterpart_id}" target="_blank">Player #${trade.counterpart_id}</a></td>
          <td class="red">${tradeSummary(trade.gave, search)}</td>
          <td class="green">${tradeSummary(trade.received, search)}</td>
          <td class="pt-trade-arrow">&#x25B6;</td>
        </tr>
        <tr class="pt-trade-detail" id="pt-td-${i}" style="display:none">
          <td colspan="6" class="pt-trade-detail-cell">
            <div class="pt-trade-cols">
              <div class="pt-trade-col">
                <div class="pt-trade-col-hdr red">You Gave</div>
                ${tradeItemsList(trade.gave)}
              </div>
              <div class="pt-trade-col">
                <div class="pt-trade-col-hdr green">You Received</div>
                ${tradeItemsList(trade.received)}
              </div>
            </div>
          </td>
        </tr>
      `);
    });

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Trade #</th>
            <th>Counterpart</th>
            <th>You Gave</th>
            <th>You Received</th>
            <th style="width:20px"></th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;

    wrap.querySelectorAll('.pt-trade-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('a')) return; // don't expand when clicking links
        const idx    = row.dataset.idx;
        const detail = document.getElementById(`pt-td-${idx}`);
        const arrow  = row.querySelector('.pt-trade-arrow');
        const open   = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'table-row';
        if (arrow) arrow.innerHTML = open ? '&#x25B6;' : '&#x25BC;';
      });
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function rerender() {
    const search    = document.getElementById('pt-search').value.toLowerCase();
    filteredBuyData  = originalBuyData .filter(i => i.item_name.toLowerCase().includes(search));
    filteredSellData = originalSellData.filter(i => i.item_name.toLowerCase().includes(search));
    filteredFreeData = freeItemsData   .filter(i => i.item_name.toLowerCase().includes(search) || i.source.toLowerCase().includes(search));
    filteredUsageData = usageData       .filter(i => i.item_name.toLowerCase().includes(search) || i.source.toLowerCase().includes(search));
    filteredFactionUsedData = factionUsedData.filter(i => i.item_name.toLowerCase().includes(search) || i.source.toLowerCase().includes(search));
    const filteredTrades = search
      ? tradeData.filter(t => {
          const sideHas = side => side.items.some(i => (i.name || '').toLowerCase().includes(search));
          return String(t.trade_id).includes(search)
              || String(t.counterpart_id).includes(search)
              || sideHas(t.gave) || sideHas(t.received);
        })
      : tradeData;

    document.getElementById('pt-n-buy')   .textContent = filteredBuyData.length;
    document.getElementById('pt-n-sell')  .textContent = filteredSellData.length;
    document.getElementById('pt-n-trades').textContent = filteredTrades.length;
    document.getElementById('pt-n-free')  .textContent = filteredFreeData.length;
    document.getElementById('pt-n-usage') .textContent = filteredUsageData.length;
    document.getElementById('pt-n-usage-faction').textContent = filteredFactionUsedData.length;

    const isTrades = activeTab === 'trades';
    const isFree   = activeTab === 'free';
    const isUsage  = activeTab === 'usage';
    const isFactionUsed = activeTab === 'usage-faction';
    document.getElementById('pt-tbl-wrap')  .style.display = isTrades ? 'none' : '';
    document.getElementById('pt-trade-wrap').style.display = isTrades ? ''     : 'none';

    if (isTrades) {
      renderTrades(filteredTrades, search);
      updateSummary();
      return;
    }

    if (isFree) {
      renderFreeItems(filteredFreeData);
      updateSummary();
      return;
    }

    if (isUsage || isFactionUsed) {
      renderUsageItems(isUsage ? filteredUsageData : filteredFactionUsedData);
      updateSummary();
      return;
    }

    const data = activeTab === 'buy' ? filteredBuyData : filteredSellData;
    restoreBuySellHeader();
    renderTable(data);
    updateSummary();
    if (document.getElementById('pt-chart-wrap').classList.contains('show')) renderChart();
  }

  function badgeClass(store) {
    return STORE_BADGE_CLASS[store] || 'bdg-gray';
  }

  function storeBadge(store) {
    const cls  = badgeClass(store);
    const icon = STORE_ICON[store] || '❓';
    return `<span class="pt-badge ${cls}" title="${esc(store)}"><span class="bdg-text">${esc(store)}</span><span class="bdg-icon">${icon}</span></span>`;
  }

  function renderTable(data) {
    const taxRate = getTaxRate();
    const isBuy   = activeTab === 'buy';
    const amtClass = isBuy ? 'red' : 'green';
    const wrap    = document.getElementById('pt-tbl-wrap');
    const tbody   = document.getElementById('pt-tbody');

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No transactions found for this range.</td></tr>';
      return;
    }

    const rows = [];
    data.forEach((item, i) => {
      const taxMult   = item.no_tax ? 1 : (1 - taxRate / 100);
      let income, perUnit;
      if (isBuy) {
        // Purchased: Est. Profit = market value now − spent · $/Unit = avg cost (no purchase tax)
        income  = item.current_price > 0
          ? Math.round(item.current_price * item.total_quantity * taxMult - item.total_amount)
          : null;
        perUnit = Math.round(item.avg_cost);
      } else {
        // Sold: P/L vs Mkt = revenue − market value now (tax-adjusted) · $/Unit = avg sell price (tax already deducted in logs)
        income  = item.current_price > 0
          ? Math.round(item.total_amount - item.current_price * item.total_quantity * taxMult)
          : null;
        perUnit = Math.round(item.avg_cost);
      }
      // Only make rows expandable when there are 2+ individual records
      const hasDetails = item.details && item.details.length > 1;
      const logTypes = Object.entries(item.log_types || {})
        .map(([id, lt]) => `${esc(lt.title)} (${id})${lt.count > 1 ? ` ×${lt.count.toLocaleString()}` : ''}`)
        .join('<br>');

      rows.push(`<tr class="${hasDetails ? 'pt-usage-row' : ''}" data-idx="${i}"${hasDetails ? ' style="cursor:pointer"' : ''}>
        <td class="item-name">${esc(item.item_name)}${hasDetails ? ' <span class="pt-usage-arrow" style="color:#3d4466;font-size:10px">▶</span>' : ''}${logTypes ? `<div class="pt-logtypes" title="Log types">${logTypes}</div>` : ''}</td>
        <td class="pt-col-store">${storeBadge(item.store_type)}</td>
        <td class="r">${item.total_quantity.toLocaleString()}</td>
        <td class="${amtClass}">$${Math.round(item.avg_cost).toLocaleString()}</td>
        <td class="${amtClass}">$${item.total_amount.toLocaleString()}</td>
        <td class="gold">${item.current_price > 0 ? '$' + item.current_price.toLocaleString() : '<span style="color:#2e3452">—</span>'}</td>
        <td class="${income !== null ? (income >= 0 ? 'green' : 'red') : ''}">
          ${income !== null ? '$' + income.toLocaleString() : '<span style="color:#2e3452">—</span>'}
        </td>
        <td class="${perUnit !== null ? 'gold' : ''}">
          ${perUnit !== null ? '$' + perUnit.toLocaleString() : '<span style="color:#2e3452">—</span>'}
        </td>
        <td class="dim r pt-col-date">${fmtDate(item.last_transaction)}</td>
      </tr>`);
    });

    tbody.innerHTML = rows.join('');
    bindLazyExpand(wrap, data, 9, item => buySellDetailHTML(item, isBuy, amtClass));
  }

  function buySellDetailHTML(item, isBuy, amtClass) {
    const sorted = item.details.slice().sort((a, b) => b.timestamp - a.timestamp);
    return `
      <div class="pt-trade-col-hdr" style="color:#c9943a">${isBuy ? 'Purchase History' : 'Sale History'}</div>
      <table style="width:100%;font-size:12px">
        <thead><tr>
          <th class="pt-ud-th">Date</th>
          <th class="pt-ud-th">Log Type</th>
          <th class="pt-ud-th r">Qty</th>
          <th class="pt-ud-th r">Cost</th>
        </tr></thead>
        <tbody>${sorted.map(d => `<tr>
          <td class="dim" data-sort="${d.timestamp}">${fmtDateTime(d.timestamp)}</td>
          <td data-sort="${esc(d.title)}">${esc(d.title)}</td>
          <td class="r" data-sort="${d.quantity}">${d.quantity.toLocaleString()}</td>
          <td class="r ${amtClass}" data-sort="${d.cost}">$${d.cost.toLocaleString()}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  // Lazy expansion: the detail row is built only on the first click, not pre-rendered
  function bindLazyExpand(wrap, data, cols, detailHTMLFn) {
    wrap.querySelectorAll('.pt-usage-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx   = row.dataset.idx;
        const arrow = row.querySelector('.pt-usage-arrow');
        let detail  = document.getElementById(`pt-ud-${idx}`);
        if (!detail) {
          detail = document.createElement('tr');
          detail.id = `pt-ud-${idx}`;
          detail.className = 'pt-usage-detail';
          detail.style.display = 'table-row';   // first click = open immediately
          detail.innerHTML = `<td colspan="${cols}" class="pt-trade-detail-cell">
            <div class="pt-trade-cols">
              <div class="pt-trade-col" style="flex:1">${detailHTMLFn(data[idx])}</div>
            </div>
          </td>`;
          row.insertAdjacentElement('afterend', detail);
          const tbl = detail.querySelector('table');
          if (tbl) makeSortable(tbl);
          if (arrow) arrow.textContent = '▼';
          return;
        }
        const open = detail.style.display !== 'none';
        detail.style.display = open ? 'none' : 'table-row';
        if (arrow) arrow.textContent = open ? '▶' : '▼';
      });
    });
  }

  // Makes a history table's column headers sortable (numeric via data-sort, else text)
  function makeSortable(table) {
    const headers = table.querySelectorAll('thead th');
    headers.forEach((th, idx) => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        const rows  = Array.from(tbody.querySelectorAll('tr'));
        const dir   = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        headers.forEach(h => { delete h.dataset.dir; h.textContent = h.textContent.replace(/\s*[▲▼]$/, ''); });
        th.dataset.dir = dir;
        th.textContent += dir === 'asc' ? ' ▲' : ' ▼';
        rows.sort((a, b) => {
          const av = a.cells[idx].dataset.sort ?? a.cells[idx].textContent.trim();
          const bv = b.cells[idx].dataset.sort ?? b.cells[idx].textContent.trim();
          const an = Number(av), bn = Number(bv);
          const cmp = (!isNaN(an) && !isNaN(bn)) ? (an - bn) : String(av).localeCompare(String(bv));
          return dir === 'asc' ? cmp : -cmp;
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }

  function renderFreeItems(data) {
    const thead = document.querySelector('#pt-tbl-wrap thead tr');
    if (thead) {
      thead.innerHTML = `<th>Item</th><th>Source</th><th class="r">Qty</th><th class="r">Mkt Price</th><th class="r pt-col-date">Last Acquired</th>`;
    }

    const wrap  = document.getElementById('pt-tbl-wrap');
    const tbody = document.getElementById('pt-tbody');

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No free items found for this range.</td></tr>';
      return;
    }

    const rows = [];
    data.forEach((item, i) => {
      const badgeCls = FREE_SOURCE_BADGE[item.source] || 'bdg-gray';
      // Only make rows expandable when there are 2+ individual records
      const hasDetails = item.details && item.details.length > 1;
      const logTypes = Object.entries(item.log_types || {})
        .map(([id, lt]) => `${esc(lt.title)} (${id})${lt.count > 1 ? ` ×${lt.count.toLocaleString()}` : ''}`)
        .join('<br>');

      rows.push(`<tr class="${hasDetails ? 'pt-usage-row' : ''}" data-idx="${i}"${hasDetails ? ' style="cursor:pointer"' : ''}>
        <td class="item-name">
          ${esc(item.item_name)}${hasDetails ? ' <span class="pt-usage-arrow" style="color:#3d4466;font-size:10px">▶</span>' : ''}
          ${logTypes ? `<div class="pt-logtypes" title="Log types">${logTypes}</div>` : ''}
        </td>
        <td><span class="pt-badge ${badgeCls}">${esc(item.source)}</span></td>
        <td class="r">${item.total_quantity.toLocaleString()}</td>
        <td class="gold">${item.current_price > 0 ? '$' + item.current_price.toLocaleString() : '<span style="color:#2e3452">—</span>'}</td>
        <td class="dim r pt-col-date">${fmtDate(item.last_transaction)}</td>
      </tr>`);
    });

    tbody.innerHTML = rows.join('');
    // Lazy expansion of the un-aggregated acquisition history
    bindLazyExpand(wrap, data, 5, freeDetailHTML);
  }

  function freeDetailHTML(item) {
    const sorted = item.details.slice().sort((a, b) => b.timestamp - a.timestamp);
    return `
      <div class="pt-trade-col-hdr" style="color:#c9943a">Acquisition History</div>
      <table style="width:100%;font-size:12px">
        <thead><tr>
          <th class="pt-ud-th">Date</th>
          <th class="pt-ud-th">Log Type</th>
          <th class="pt-ud-th r">Qty</th>
        </tr></thead>
        <tbody>${sorted.map(d => `<tr>
          <td class="dim" data-sort="${d.timestamp}">${fmtDateTime(d.timestamp)}</td>
          <td data-sort="${esc(d.title)}">${esc(d.title)}</td>
          <td class="r" data-sort="${d.quantity}">${d.quantity.toLocaleString()}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  function renderUsageItems(data) {
    const thead = document.querySelector('#pt-tbl-wrap thead tr');
    if (thead) {
      thead.innerHTML = `<th>Item</th><th>${activeTab === 'usage-faction' ? 'Source' : 'Usage'}</th><th class="r">Qty</th><th class="r">Mkt Price</th><th class="r pt-col-date">Last Used</th>`;
    }

    const wrap = document.getElementById('pt-tbl-wrap');
    let tbody = document.getElementById('pt-tbody');

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">No item usage found for this range.</td></tr>';
      return;
    }

    const rows = [];
    data.forEach((item, i) => {
      const badgeCls = USAGE_SOURCE_BADGE[item.source] || 'bdg-gray';
      // Only make rows expandable when there are 2+ individual records
      const hasDetails = item.details && item.details.length > 1;
      const logTypes = Object.entries(item.log_types || {})
        .map(([id, lt]) => `${esc(lt.title)} (${id})${lt.count > 1 ? ` ×${lt.count.toLocaleString()}` : ''}`)
        .join('<br>');

      rows.push(`<tr class="${hasDetails ? 'pt-usage-row' : ''}" data-idx="${i}"${hasDetails ? ' style="cursor:pointer"' : ''}>
        <td class="item-name">
          ${esc(item.item_name)}${hasDetails ? ' <span class="pt-usage-arrow" style="color:#3d4466;font-size:10px">▶</span>' : ''}
          ${logTypes ? `<div class="pt-logtypes" title="Log types">${logTypes}</div>` : ''}
        </td>
        <td><span class="pt-badge ${badgeCls}">${esc(item.source)}</span></td>
        <td class="r">${item.total_quantity.toLocaleString()}</td>
        <td class="gold">${item.current_price > 0 ? '$' + item.current_price.toLocaleString() : '<span style="color:#2e3452">—</span>'}</td>
        <td class="dim r pt-col-date">${fmtDate(item.last_transaction)}</td>
      </tr>`);
    });

    tbody.innerHTML = rows.join('');
    // Lazy expansion of the individual (un-aggregated) history
    bindLazyExpand(wrap, data, 5, usageDetailHTML);
  }

  function usageDetailHTML(item) {
    const sorted = item.details.slice().sort((a, b) => b.timestamp - a.timestamp);
    let detailHTML;

    if (item.source === 'Museum Swap') {
      detailHTML = `
        <div class="pt-trade-col-hdr" style="color:#c9943a">Exchange History</div>
        <table style="width:100%;font-size:12px">
          <thead><tr>
            <th class="pt-ud-th">Date</th>
            <th class="pt-ud-th r">Sets</th>
            <th class="pt-ud-th r">Points</th>
          </tr></thead>
          <tbody>${sorted.map(d => `<tr>
            <td class="dim" data-sort="${d.timestamp}">${fmtDateTime(d.timestamp)}</td>
            <td class="r" data-sort="${d.quantity}">${d.quantity.toLocaleString()}</td>
            <td class="gold" data-sort="${d.points}">${d.points.toLocaleString()} pts</td>
          </tr>`).join('')}</tbody>
        </table>`;
    } else if (item.source === 'Sent') {
      detailHTML = `
        <div class="pt-trade-col-hdr" style="color:#c9943a">Send History</div>
        <table style="width:100%;font-size:12px">
          <thead><tr>
            <th class="pt-ud-th">Date</th>
            <th class="pt-ud-th">To Player</th>
            <th class="pt-ud-th">Item</th>
            <th class="pt-ud-th r">Qty</th>
            <th class="pt-ud-th">Message</th>
          </tr></thead>
          <tbody>${sorted.map(d => {
            const itemList = (d.items || []).map(i => `${i.qty}x ${esc(i.name)}`).join(', ') || '—';
            return `<tr>
              <td class="dim" data-sort="${d.timestamp}">${fmtDateTime(d.timestamp)}</td>
              <td data-sort="${d.receiver}"><a class="pt-trade-link" href="/profiles.php?XID=${d.receiver}" target="_blank">#${d.receiver}</a></td>
              <td data-sort="${esc(itemList)}">${itemList}</td>
              <td class="r" data-sort="${d.quantity}">${d.quantity.toLocaleString()}</td>
              <td class="dim" style="max-width:120px;overflow:hidden;text-overflow:ellipsis" data-sort="${esc(d.message || '—')}">${esc(d.message || '—')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;
    } else if (item.source === 'Dumped') {
      detailHTML = `
        <div class="pt-trade-col-hdr" style="color:#c9943a">Dump History</div>
        <table style="width:100%;font-size:12px">
          <thead><tr>
            <th class="pt-ud-th">Date</th>
            <th class="pt-ud-th">Items</th>
            <th class="pt-ud-th r">Qty</th>
          </tr></thead>
          <tbody>${sorted.map(d => {
            const itemList = (d.items || []).map(i => `${i.qty}x ${esc(i.name)}`).join(', ') || '—';
            return `<tr>
              <td class="dim" data-sort="${d.timestamp}">${fmtDateTime(d.timestamp)}</td>
              <td data-sort="${esc(itemList)}">${itemList}</td>
              <td class="r" data-sort="${d.quantity}">${d.quantity.toLocaleString()}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;
    } else {
      detailHTML = `
        <div class="pt-trade-col-hdr" style="color:#c9943a">History</div>
        <table style="width:100%;font-size:12px">
          <thead><tr>
            <th class="pt-ud-th">Date</th>
            <th class="pt-ud-th">Log Type</th>
            <th class="pt-ud-th r">Qty</th>
          </tr></thead>
          <tbody>${sorted.map(d => `<tr>
            <td class="dim" data-sort="${d.timestamp}">${fmtDateTime(d.timestamp)}</td>
            <td data-sort="${esc(d.title || '—')}">${esc(d.title || '—')}</td>
            <td class="r" data-sort="${d.quantity}">${d.quantity.toLocaleString()}</td>
          </tr>`).join('')}</tbody>
        </table>`;
    }
    return detailHTML;
  }

  function restoreBuySellHeader() {
    const thead = document.querySelector('#pt-tbl-wrap thead tr');
    if (thead) {
      thead.innerHTML = activeTab === 'sell'
        ? `<th>Item</th><th class="pt-col-store" title="Store"><span class="bdg-text">Store</span><span class="bdg-icon">🏪</span></th><th class="r">Qty</th><th class="r">Avg</th><th class="r">Revenue</th><th class="r">Mkt Price</th><th class="r">P/L vs Mkt</th><th class="r">$/Unit</th><th class="r pt-col-date">Last</th>`
        : `<th>Item</th><th class="pt-col-store" title="Store"><span class="bdg-text">Store</span><span class="bdg-icon">🏪</span></th><th class="r">Qty</th><th class="r">Avg</th><th class="r">Total</th><th class="r">Mkt Price</th><th class="r">Est. Profit</th><th class="r">$/Unit</th><th class="r pt-col-date">Last</th>`;
    }
  }

  function updateSummary() {
    const taxRate = getTaxRate();

    if (activeTab === 'trades') {
      const gaveVal = tradeData.reduce((s, t) => s + tradeSideValue(t.gave),     0);
      const recvVal = tradeData.reduce((s, t) => s + tradeSideValue(t.received), 0);
      document.getElementById('pt-l-items').textContent  = 'Total Trades';
      document.getElementById('pt-l-spent').textContent  = 'Value Given';
      document.getElementById('pt-l-sold').textContent   = 'Value Received';
      document.getElementById('pt-l-income').textContent = 'Net Value';
      document.getElementById('pt-s-items').textContent  = tradeData.length;
      document.getElementById('pt-s-spent').textContent  = fmt$(gaveVal);
      document.getElementById('pt-s-sold').textContent   = fmt$(recvVal);
      document.getElementById('pt-s-income').textContent = fmt$(recvVal - gaveVal);
      return;
    }

    if (activeTab === 'free') {
      const totalItems   = filteredFreeData.reduce((s, i) => s + i.total_quantity, 0);
      const totalValue   = filteredFreeData.reduce((s, i) => s + i.current_price * i.total_quantity, 0);
      document.getElementById('pt-l-items').textContent  = 'Unique Items';
      document.getElementById('pt-l-spent').textContent  = 'Total Qty';
      document.getElementById('pt-l-sold').textContent   = 'Est. Total Value';
      document.getElementById('pt-l-income').textContent = 'Sources';
      document.getElementById('pt-s-items').textContent  = filteredFreeData.length;
      document.getElementById('pt-s-spent').textContent  = totalItems.toLocaleString();
      document.getElementById('pt-s-sold').textContent   = fmt$(totalValue);
      const sources = new Set(filteredFreeData.map(i => i.source));
      document.getElementById('pt-s-income').textContent = sources.size;
      return;
    }

    if (activeTab === 'usage' || activeTab === 'usage-faction') {
      const srcData     = activeTab === 'usage' ? filteredUsageData : filteredFactionUsedData;
      const totalItems  = srcData.reduce((s, i) => s + i.total_quantity, 0);
      const totalValue  = srcData.reduce((s, i) => s + i.current_price * i.total_quantity, 0);
      document.getElementById('pt-l-items').textContent  = 'Unique Items';
      document.getElementById('pt-l-spent').textContent  = 'Total Qty';
      document.getElementById('pt-l-sold').textContent   = 'Est. Total Value';
      document.getElementById('pt-l-income').textContent = 'Usage Types';
      document.getElementById('pt-s-items').textContent  = srcData.length;
      document.getElementById('pt-s-spent').textContent  = totalItems.toLocaleString();
      document.getElementById('pt-s-sold').textContent   = fmt$(totalValue);
      const types = new Set(srcData.map(i => i.source));
      document.getElementById('pt-s-income').textContent = types.size;
      return;
    }

    document.getElementById('pt-l-items').textContent  = 'Total Items';
    document.getElementById('pt-l-spent').textContent  = 'Total Spent';
    document.getElementById('pt-l-sold').textContent   = 'Total Sold';
    document.getElementById('pt-l-income').textContent = 'Est. Profit';

    const buyTotal  = filteredBuyData .reduce((s, i) => s + i.total_amount, 0);
    const sellTotal = filteredSellData.reduce((s, i) => s + i.total_amount, 0);
    const income    = filteredBuyData.reduce((s, i) => {
      const taxMult = i.no_tax ? 1 : (1 - taxRate / 100);
      return s + (i.current_price * i.total_quantity * taxMult - i.total_amount);
    }, 0);

    document.getElementById('pt-s-items').textContent  = filteredBuyData.length + filteredSellData.length;
    document.getElementById('pt-s-spent').textContent  = fmt$(buyTotal);
    document.getElementById('pt-s-sold').textContent   = fmt$(sellTotal);
    document.getElementById('pt-s-income').textContent = fmt$(income);
  }

  function renderChart() {
    const ctx = document.getElementById('pt-chart').getContext('2d');
    const map = new Map();

    filteredBuyData.forEach(i => {
      if (!map.has(i.item_id)) map.set(i.item_id, { name: i.item_name, buy: 0, sell: 0 });
      map.get(i.item_id).buy += i.total_amount;
    });
    filteredSellData.forEach(i => {
      if (!map.has(i.item_id)) map.set(i.item_id, { name: i.item_name, buy: 0, sell: 0 });
      map.get(i.item_id).sell += i.total_amount;
    });

    const rows = [...map.values()]
      .filter(i => i.buy > 0 || i.sell > 0)
      .sort((a, b) => (b.buy + b.sell) - (a.buy + a.sell))
      .slice(0, 12);

    // Update existing chart in-place to avoid flicker; only create on first call
    if (valueChart) {
      valueChart.data.labels            = rows.map(i => i.name);
      valueChart.data.datasets[0].data  = rows.map(i => i.buy);
      valueChart.data.datasets[1].data  = rows.map(i => i.sell);
      valueChart.update('none');
      return;
    }

    valueChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(i => i.name),
        datasets: [
          { label: 'Bought', data: rows.map(i => i.buy),
            backgroundColor: 'rgba(217,88,88,0.65)', borderColor: '#e06a6a', borderWidth: 1, borderRadius: 3 },
          { label: 'Sold',   data: rows.map(i => i.sell),
            backgroundColor: 'rgba(62,200,112,0.65)', borderColor: '#3ec870', borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        animation: { duration: 300 },
        plugins: {
          legend: { labels: { color: '#4a5270', font: { size: 10 }, boxWidth: 10 } },
          tooltip: {
            backgroundColor: '#1a1d2e',
            borderColor: '#2a2f4a',
            borderWidth: 1,
            titleColor: '#c8cde0',
            bodyColor: '#8a90b0',
            callbacks: { label: c => ` ${c.dataset.label}: $${Math.round(c.parsed.y).toLocaleString()}` },
          },
        },
        scales: {
          x: { ticks: { color: '#3d4466', font: { size: 9 }, maxRotation: 40 }, grid: { color: '#1a1d2e' } },
          y: { ticks: { color: '#3d4466', font: { size: 9 },
               callback: v => v >= 1e6 ? '$'+(v/1e6).toFixed(1)+'M' : v >= 1e3 ? '$'+(v/1e3).toFixed(0)+'K' : '$'+v },
               grid: { color: '#1a1d2e' } },
        },
      },
    });
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  function sortBy(colIndex) {
    const isFree   = activeTab === 'free';
    const isUsage  = activeTab === 'usage';
    const isFactionUsed = activeTab === 'usage-faction';
    const isSimple = isFree || isUsage || isFactionUsed;
    const data     = isFactionUsed ? filteredFactionUsedData
                  : isFree ? filteredFreeData
                  : isUsage ? filteredUsageData
                  : (activeTab === 'buy' ? filteredBuyData : filteredSellData);
    const taxRate  = getTaxRate();
    const ths      = document.querySelectorAll('#pt-panel thead th');

    const dir = sortState.col === colIndex && sortState.dir === 'asc' ? 'desc' : 'asc';
    sortState = { col: colIndex, dir };

    ths.forEach(th => th.classList.remove('s-asc', 's-desc'));
    ths[colIndex].classList.add(dir === 'asc' ? 's-asc' : 's-desc');

    data.sort((a, b) => {
      let av, bv;
      if (isSimple) {
        switch (colIndex) {
          case 0: av = a.item_name.toLowerCase(); bv = b.item_name.toLowerCase(); break;
          case 1: av = a.source.toLowerCase();    bv = b.source.toLowerCase(); break;
          case 2: av = a.total_quantity;          bv = b.total_quantity; break;
          case 3: av = a.current_price;           bv = b.current_price; break;
          case 4: av = a.last_transaction;        bv = b.last_transaction; break;
          default: return 0;
        }
      } else {
        switch (colIndex) {
          case 0: av = a.item_name.toLowerCase();  bv = b.item_name.toLowerCase(); break;
          case 1: av = a.store_type.toLowerCase(); bv = b.store_type.toLowerCase(); break;
          case 2: av = a.total_quantity;   bv = b.total_quantity; break;
          case 3: av = a.avg_cost;         bv = b.avg_cost; break;
          case 4: av = a.total_amount;     bv = b.total_amount; break;
          case 5: av = a.current_price;    bv = b.current_price; break;
          case 6: if (activeTab === 'sell') {
                    av = a.total_amount - a.current_price * a.total_quantity * (a.no_tax ? 1 : (1 - taxRate / 100));
                    bv = b.total_amount - b.current_price * b.total_quantity * (b.no_tax ? 1 : (1 - taxRate / 100));
                  } else {
                    av = a.current_price * a.total_quantity * (a.no_tax ? 1 : (1 - taxRate / 100)) - a.total_amount;
                    bv = b.current_price * b.total_quantity * (b.no_tax ? 1 : (1 - taxRate / 100)) - b.total_amount;
                  } break;
          case 7: av = a.avg_cost;         bv = b.avg_cost; break;
          case 8: av = a.last_transaction; bv = b.last_transaction; break;
          default: return 0;
        }
      }
      return dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    if (isFactionUsed) filteredFactionUsedData = data;
    else if (isFree) filteredFreeData = data;
    else if (isUsage) filteredUsageData = data;
    else if (activeTab === 'buy') filteredBuyData = data;
    else filteredSellData = data;

    if (isFactionUsed) renderUsageItems(data);
    else if (isFree) renderFreeItems(data);
    else if (isUsage) renderUsageItems(data);
    else renderTable(data);
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportCSV() {
    const taxRate = getTaxRate();
    const rows = [
      ...filteredBuyData .map(i => ({ ...i, _type: 'Buy'  })),
      ...filteredSellData.map(i => ({ ...i, _type: 'Sell' })),
    ];
    if (!rows.length) { alert('No data to export.'); return; }

    let csv = 'Type,Item,Store,Qty,Avg Price,Total,Market Price,Potential Income,Last\n';
    rows.forEach(i => {
      let inc = '';
      if (i.current_price > 0) {
        const taxMult = i.no_tax ? 1 : (1 - taxRate / 100);
        inc = i._type === 'Sell'
          ? Math.round(i.total_amount - i.current_price * i.total_quantity * taxMult)
          : Math.round(i.current_price * i.total_quantity * taxMult - i.total_amount);
      }
      csv += `"${i._type}","${i.item_name}","${i.store_type}",${i.total_quantity},${Math.round(i.avg_cost)},${i.total_amount},${i.current_price || ''},${inc},"${fmtDate(i.last_transaction)}"\n`;
    });

    const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url; link.download = `torn_portfolio_${isoDate(new Date())}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getTaxRate() {
    const e = document.getElementById('pt-tax');
    return e ? Math.max(0, Math.min(100, parseFloat(e.value) || 0)) : 5;
  }
  function toUnix(dateStr, end) {
    return Math.floor(new Date(dateStr + (end ? 'T23:59:59Z' : 'T00:00:00Z')).getTime() / 1000);
  }
  function isoDate(d) { return d.toISOString().slice(0, 10); }
  function fmtDate(ts) {
    return ts ? new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
  }
  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
         + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function fmt$(n) {
    if (!n) return '$0';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return '$' + Math.round(n).toLocaleString();
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function setStatus(msg, cls = '') {
    const e = document.getElementById('pt-status');
    if (e) { e.textContent = msg; e.className = cls; }
  }
  function showLoading(show) {
    const sp  = document.getElementById('pt-spinner');
    const tw  = document.getElementById('pt-tbl-wrap');
    const trw = document.getElementById('pt-trade-wrap');
    if (sp)  sp.classList.toggle('show', show);
    if (tw)  tw.style.display  = show ? 'none' : '';
    if (trw) trw.style.display = show ? 'none' : (activeTab === 'trades' ? '' : 'none');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  GM_registerMenuCommand('Set Server URL', () => {
    const current = GM_getValue('serverUrl', '');
    const url = prompt('Enter your Torn Tracker server URL:', current);
    if (url === null) return; // cancelled
    const trimmed = url.trim().replace(/\/+$/, '');
    GM_setValue('serverUrl', trimmed);
    setStatus(trimmed ? 'Server URL saved.' : 'Server URL cleared.', 'ok');
  });

  buildUI();
})();
