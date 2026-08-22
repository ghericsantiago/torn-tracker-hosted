// ==UserScript==
// @name         Bazaars in Item Market 
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @author       Gheric
// @description  Displays bazaar listings and optional trader buy prices on the Torn item market
// @license      MIT
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/bazaar.php*
// @connect      weav3r.dev
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// @downloadURL https://update.greasyfork.org/scripts/527616/Bazaars%20in%20Item%20Market%20Powered%20by%20TornW3B.user.js
// @updateURL https://update.greasyfork.org/scripts/527616/Bazaars%20in%20Item%20Market%20Powered%20by%20TornW3B.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const css = ':root{--bim-radius: 3px;--bim-font: "Segoe UI", system-ui, sans-serif;--bim-accent: #3b82c4;--bim-accent-soft: rgba(59, 130, 196, .1);--bim-success: #2e7d32;--bim-danger: #c62828;--bim-bg: #f3f4f6;--bim-bg-elevated: #fff;--bim-bg-muted: #e8eaed;--bim-border: #cfd3d8;--bim-text: #222;--bim-text-muted: #6b7280}.dark-mode{--bim-accent: #6ea8d8;--bim-accent-soft: rgba(110, 168, 216, .12);--bim-success: #81c784;--bim-danger: #e57373;--bim-bg: #2a2a2a;--bim-bg-elevated: #1f1f1f;--bim-bg-muted: #333;--bim-border: #444;--bim-text: #ddd;--bim-text-muted: #999}.bazaar-info-container{font-family:var(--bim-font);font-size:12px;line-height:1.35;border-radius:var(--bim-radius);margin:4px 0;padding:6px 8px;display:flex;flex-direction:column;gap:4px;background:var(--bim-bg);color:var(--bim-text);border:1px solid var(--bim-border);box-sizing:border-box;width:100%;overflow:hidden}.bazaar-info-header{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}.bazaar-info-title{font-size:13px;font-weight:600;color:var(--bim-text)}.bazaar-info-stats{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;color:var(--bim-text-muted);font-size:11px}.bazaar-stat b{font-weight:600;color:var(--bim-text);font-variant-numeric:tabular-nums}.bazaar-stat--buy b{color:var(--bim-accent)}.bazaar-stat-link{color:inherit;text-decoration:none;font-weight:600}.bazaar-stat-link:hover{text-decoration:underline}.bazaar-sort-controls{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 4px;background:var(--bim-bg-muted);border-radius:var(--bim-radius);border:1px solid var(--bim-border)}.bazaar-controls-divider{width:1px;height:16px;background:var(--bim-border);margin:0 2px}.bazaar-sort-select,.bazaar-filter,.bazaar-button{height:22px;box-sizing:border-box;border:1px solid var(--bim-border);border-radius:2px;background:var(--bim-bg-elevated);color:var(--bim-text);font-size:11px;font-family:inherit}.bazaar-sort-select{padding:0 18px 0 5px;-webkit-appearance:none;-moz-appearance:none;appearance:none;background-image:url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOCIgaGVpZ2h0PSI1IiB2aWV3Qm94PSIwIDAgOCA1IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDBsNCA1IDQtNXoiIGZpbGw9IiM2NjYiLz48L3N2Zz4=);background-repeat:no-repeat;background-position:right 5px center;background-size:8px 5px;cursor:pointer}.dark-mode .bazaar-sort-select{background-image:url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOCIgaGVpZ2h0PSI1IiB2aWV3Qm94PSIwIDAgOCA1IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDBsNCA1IDQtNXoiIGZpbGw9IiNjY2MiLz48L3N2Zz4=)}.bazaar-filter{width:58px;padding:0 4px}.bazaar-filter[data-filter=limit]{width:42px}.bazaar-button{padding:0 6px;cursor:pointer}.bazaar-button:hover,.bazaar-sort-select:focus,.bazaar-filter:focus{border-color:var(--bim-accent);outline:none}.bazaar-scroll-container{display:flex;align-items:stretch;width:100%}.bazaar-scroll-wrapper{flex:1;overflow-x:auto;overflow-y:hidden;height:78px;border-radius:var(--bim-radius);border:1px solid var(--bim-border);max-width:calc(100% - 24px);background:var(--bim-bg-elevated)}.bazaar-scroll-arrow{display:flex;align-items:center;justify-content:center;width:10px;flex-shrink:0;cursor:pointer;opacity:.45}.bazaar-scroll-arrow:hover{opacity:.9}.bazaar-scroll-arrow svg{width:12px!important;height:12px!important;color:var(--bim-text-muted)}.bazaar-scroll-wrapper::-webkit-scrollbar{height:5px}.bazaar-scroll-wrapper::-webkit-scrollbar-thumb{background:var(--bim-border);border-radius:3px}.bazaar-card-container{display:flex;align-items:stretch;gap:5px;height:100%;width:max-content;padding:4px;box-sizing:border-box}.bazaar-listing-card{flex:0 0 128px;width:128px;display:flex;flex-direction:column;gap:2px;padding:5px 6px;border-radius:var(--bim-radius);border:1px solid var(--bim-border);background:var(--bim-bg);box-sizing:border-box;overflow:hidden}.bazaar-listing-card:hover{border-color:var(--bim-accent)}.bazaar-player-link{font-size:11px;font-weight:600;color:var(--bim-accent);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bazaar-player-link:hover{text-decoration:underline}.bazaar-player-link:visited{color:#9b6bce}.bazaar-card-price{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}.bazaar-card-qty{font-weight:400;color:var(--bim-text-muted);font-size:11px}.bazaar-card-row{display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:auto}.bazaar-listing-footnote{font-size:10px;color:var(--bim-text-muted)}.bazaar-price-comparison{font-size:10px;font-weight:600;cursor:help;white-space:nowrap;color:var(--bim-text-muted)}.bazaar-price-comparison--good{color:var(--bim-success)}.bazaar-price-comparison--bad{color:var(--bim-danger)}.bazaar-empty-state,.bazaar-empty-note{padding:10px;text-align:center;width:100%;color:var(--bim-text-muted);font-size:11px}.bazaar-footer-container{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;color:var(--bim-text-muted)}.bazaar-footer-container a{color:inherit;text-decoration:underline}.bazaar-profit-tooltip{position:fixed;background:var(--bim-bg-elevated);color:var(--bim-text);border:1px solid var(--bim-border);padding:8px 10px;border-radius:3px;box-shadow:0 2px 8px #0003;z-index:99999;min-width:160px;max-width:240px;pointer-events:none;font-size:12px;line-height:1.35;font-family:var(--bim-font)}.bazaar-tooltip-title{font-weight:600;margin-bottom:4px;text-align:center}.bazaar-tooltip-body{display:grid;gap:2px;color:var(--bim-text-muted)}.bazaar-tooltip-emphasis{margin-top:3px;font-weight:600;color:var(--bim-text)}.bazaar-traders-panel{border:1px solid var(--bim-border);border-radius:var(--bim-radius);overflow:hidden}.bazaar-traders-toggle{width:100%;display:flex;align-items:center;gap:6px;padding:4px 6px;border:none;background:var(--bim-bg-muted);color:var(--bim-text);cursor:pointer;font:inherit;font-size:11px;font-weight:500;text-align:left}.bazaar-traders-toggle svg{width:11px;height:11px;color:var(--bim-accent)}.bazaar-traders-toggle .chevron{margin-left:auto;opacity:.6;transition:transform .15s ease}.bazaar-traders-panel.open .bazaar-traders-toggle .chevron{transform:rotate(90deg)}.bazaar-traders-count{color:var(--bim-text-muted);font-weight:400}.bazaar-traders-body{display:none;max-height:160px;overflow-y:auto}.bazaar-traders-panel.open .bazaar-traders-body{display:block}.bazaar-trader-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px 8px;align-items:center;padding:3px 6px;border-bottom:1px solid var(--bim-border);font-size:11px}.bazaar-trader-row:last-child{border-bottom:none}.bazaar-trader-name{color:var(--bim-accent);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bazaar-trader-name:hover{text-decoration:underline}.bazaar-trader-price{font-variant-numeric:tabular-nums}.bazaar-trader-meta{color:var(--bim-text-muted);font-size:10px;text-align:right}.bazaar-modal-overlay{position:fixed;top:0;right:0;bottom:0;left:0;background:#0000008c;display:flex;justify-content:center;align-items:center;z-index:99999;padding:12px;box-sizing:border-box}.bazaar-settings-modal{background:var(--bim-bg-elevated);color:var(--bim-text);border-radius:6px;padding:14px;width:420px;max-width:95vw;max-height:90vh;overflow-y:auto;border:1px solid var(--bim-border);font-family:var(--bim-font);z-index:100000}.bazaar-settings-title{font-size:15px;font-weight:600;margin-bottom:10px}.bazaar-tabs{display:flex;border-bottom:1px solid var(--bim-border);margin-bottom:10px;gap:2px}.bazaar-tab{padding:5px 10px;cursor:pointer;border:1px solid transparent;border-bottom:none;border-radius:3px 3px 0 0;background:var(--bim-bg-muted);color:var(--bim-text-muted);font-size:12px;position:relative;bottom:-1px}.bazaar-tab.active{background:var(--bim-bg-elevated);color:var(--bim-text);border-color:var(--bim-border);font-weight:600}.bazaar-tab-content{display:none}.bazaar-tab-content.active{display:block}.bazaar-settings-item{margin-bottom:10px}.bazaar-settings-item label{display:block;margin-bottom:3px;font-size:12px;font-weight:500}.bazaar-settings-item input[type=text],.bazaar-settings-item input[type=number],.bazaar-settings-item select,.bazaar-number-input{width:100%;max-width:180px;padding:4px 6px;border:1px solid var(--bim-border);border-radius:2px;font-size:12px;background:var(--bim-bg);color:var(--bim-text);box-sizing:border-box}.bazaar-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}.bazaar-api-note{font-size:11px;margin-top:3px;color:var(--bim-text-muted);line-height:1.35}.bazaar-settings-buttons{display:flex;justify-content:flex-end;gap:6px;margin-top:14px}.bazaar-settings-save,.bazaar-settings-cancel{padding:5px 12px;border-radius:3px;font-size:12px;cursor:pointer;font-weight:600}.bazaar-settings-save{background:#2e8b57;color:#fff;border:none}.bazaar-settings-cancel{background:var(--bim-bg-muted);color:var(--bim-text);border:1px solid var(--bim-border)}.bazaar-settings-footer{margin-top:12px;font-size:11px;color:var(--bim-text-muted);text-align:center;padding-top:8px;border-top:1px solid var(--bim-border)}.bazaar-settings-footer a{color:var(--bim-accent);text-decoration:none}.bazaar-checkbox-row{display:flex;align-items:center;gap:6px}.bazaar-checkbox-row input{width:auto}@keyframes popAndFlash{0%{transform:scale(1);background-color:#00ff0073}50%{transform:scale(1.03)}to{transform:scale(1);background-color:inherit}}.pop-flash{animation:popAndFlash .8s ease-in-out forwards}.green-outline{outline:2px solid #22c55e!important;outline-offset:2px;box-shadow:0 0 0 2px #22c55e59!important}.red-outline{outline:2px solid #dc2626!important;outline-offset:2px;box-shadow:0 0 0 2px #dc262659!important}.bim-highlight-toast{position:fixed;top:16px;left:50%;z-index:100000;transform:translate(-50%);max-width:min(520px,calc(100vw - 24px));padding:10px 14px;border-radius:4px;font-family:var(--bim-font);font-size:13px;line-height:1.35;color:#fff;box-shadow:0 8px 24px #00000047;pointer-events:none;opacity:1;transition:opacity .2s ease,transform .2s ease}.bim-highlight-toast.is-leaving{opacity:0;transform:translate(-50%) translateY(-6px)}.bim-highlight-toast--warning{background:#b45309}.bim-highlight-toast--danger{background:#b91c1c}.bim-highlight-toast--info{background:#1d4ed8}.bazaar-info-container.compact-layout .bazaar-scroll-arrow{display:none}.bazaar-info-container.compact-layout .bazaar-scroll-wrapper{overflow-x:hidden;overflow-y:auto;max-height:180px;height:auto;max-width:100%}.bazaar-info-container.compact-layout .bazaar-card-container{flex-direction:column;width:100%;gap:3px;padding:3px}.bazaar-info-container.compact-layout .bazaar-listing-card{flex:none;width:100%;flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;padding:4px 6px}.bazaar-info-container.compact-layout .bazaar-player-link{max-width:140px}.bazaar-info-container.compact-layout .bazaar-listing-footnote{margin-left:auto}@media(max-width:600px){.bazaar-settings-modal{width:100%;border-radius:0;max-height:100vh}.bazaar-settings-grid{grid-template-columns:1fr}.bazaar-filter{width:52px}}';
  var _GM_addStyle = /* @__PURE__ */ (() => typeof GM_addStyle != "undefined" ? GM_addStyle : void 0)();
  var _GM_deleteValue = /* @__PURE__ */ (() => typeof GM_deleteValue != "undefined" ? GM_deleteValue : void 0)();
  var _GM_getValue = /* @__PURE__ */ (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
  var _GM_listValues = /* @__PURE__ */ (() => typeof GM_listValues != "undefined" ? GM_listValues : void 0)();
  var _GM_setValue = /* @__PURE__ */ (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
  var _GM_xmlhttpRequest = /* @__PURE__ */ (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
  function gmGetValue(key, defaultValue) {
    try {
      return _GM_getValue(key, defaultValue);
    } catch {
      try {
        const item = localStorage.getItem("GM_" + key);
        return item !== null ? JSON.parse(item) : defaultValue;
      } catch {
        return defaultValue;
      }
    }
  }
  function gmSetValue(key, value) {
    try {
      _GM_setValue(key, value);
      return;
    } catch {
    }
    try {
      if (value === void 0 || value === null) {
        localStorage.removeItem("GM_" + key);
      } else {
        localStorage.setItem("GM_" + key, JSON.stringify(value));
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith("GM_"));
        const first = keys[0];
        if (first) localStorage.removeItem(first);
        localStorage.setItem("GM_" + key, JSON.stringify(value));
      }
    }
  }
  function gmDeleteValue(key) {
    try {
      _GM_deleteValue(key);
    } catch {
      localStorage.removeItem("GM_" + key);
    }
  }
  function gmListValues() {
    try {
      return _GM_listValues();
    } catch {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key == null ? void 0 : key.startsWith("GM_")) keys.push(key.slice(3));
      }
      return keys;
    }
  }
  function gmAddStyle(css2) {
    try {
      _GM_addStyle(css2);
    } catch {
      const style = document.createElement("style");
      style.textContent = css2;
      (document.head || document.documentElement).appendChild(style);
    }
  }
  function gmXmlhttpRequest(options) {
    try {
      return _GM_xmlhttpRequest(options);
    } catch {
      return fetchFallback(options);
    }
  }
  function fetchFallback(options) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let aborted = false;
    const method = options.method ?? "GET";
    const headers = { ...options.headers ?? {} };
    const fetchOptions = { method, headers };
    if (controller) fetchOptions.signal = controller.signal;
    if (options.data && method !== "GET") {
      fetchOptions.body = options.data;
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }
    fetch(options.url, fetchOptions).then(
      (response) => response.text().then((text) => {
        var _a, _b;
        if (aborted) return;
        const result = {
          status: response.status,
          statusText: response.statusText,
          responseText: text,
          response: text,
          readyState: 4,
          responseHeaders: Object.fromEntries(response.headers.entries())
        };
        if (response.ok) (_a = options.onload) == null ? void 0 : _a.call(options, result);
        else (_b = options.onerror) == null ? void 0 : _b.call(options, result);
      })
    ).catch((error) => {
      var _a;
      if (aborted) return;
      (_a = options.onerror) == null ? void 0 : _a.call(options, {
        status: 0,
        statusText: error instanceof Error ? error.message : "Network error",
        responseText: "",
        response: "",
        readyState: 4
      });
    });
    if (options.timeout) {
      setTimeout(() => {
        var _a;
        if (aborted) return;
        aborted = true;
        controller == null ? void 0 : controller.abort();
        (_a = options.ontimeout) == null ? void 0 : _a.call(options, {
          status: 0,
          statusText: "Request timeout",
          responseText: "",
          response: "",
          readyState: 4
        });
      }, options.timeout);
    }
    return {
      abort: () => {
        aborted = true;
        controller == null ? void 0 : controller.abort();
      }
    };
  }
  const CONFIG = {
    API_BASE: "https://weav3r.dev/api/",
    REQUEST_TIMEOUT_MS: 1e4,
    REQUEST_MAX_RETRIES: 2,
    REQUEST_RETRY_DELAY_MS: 2e3,
    LISTINGS_LOAD_TIMEOUT_MS: 15e3,
    MARKETPLACE_LIMIT_MAX: 100,
    TRADERS_LIMIT_MAX: 100,
    TRADED_WITHIN_HOURS_MAX: 168
  };
  const STORAGE_KEYS = {
    settings: "bazaarsSettings",
    /** Set after one-shot purge of old cache / visited / Torn API keys. */
    storagePurged: "bimStoragePurged"
  };
  const EPHEMERAL_PREFIXES = [
    "visited_",
    "tornBazaarCache_",
    "tornBazaarTraders_"
  ];
  const EPHEMERAL_KEYS = [
    "bazaarApiKey",
    "tornItems",
    "lastTornItemsUpdate",
    "lastDailyCleanup"
  ];
  function purgeLegacyStorage() {
    if (gmGetValue(STORAGE_KEYS.storagePurged)) return;
    try {
      for (const key of gmListValues()) {
        if (!key) continue;
        if (EPHEMERAL_KEYS.includes(key) || EPHEMERAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          gmDeleteValue(key);
        }
      }
    } catch (e) {
      console.error("[bazaars-in-im] Legacy storage purge failed:", e);
    }
    gmSetValue(STORAGE_KEYS.storagePurged, "1");
  }
  const DEFAULT_SETTINGS = {
    defaultSort: "price",
    defaultOrder: "asc",
    listingFee: 0,
    defaultDisplayMode: "percentage",
    linkBehavior: "new_tab",
    layoutMode: "default",
    marketplace: {
      limit: 100
    },
    showTraders: false,
    traders: {
      limit: 25,
      sort: "price"
    }
  };
  function clampInt(value, min, max, fallback) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function optionalNonNegInt(value) {
    if (value === null || value === void 0 || value === "") return void 0;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return void 0;
    return Math.round(n);
  }
  function sanitizeMarketplace(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const params = {
      limit: clampInt(src.limit, 1, CONFIG.MARKETPLACE_LIMIT_MAX, 100)
    };
    const minQty = optionalNonNegInt(src.minQty);
    const maxQty = optionalNonNegInt(src.maxQty);
    const minPrice = optionalNonNegInt(src.minPrice);
    const maxPrice = optionalNonNegInt(src.maxPrice);
    if (minQty !== void 0) params.minQty = minQty;
    if (maxQty !== void 0) params.maxQty = maxQty;
    if (minPrice !== void 0) params.minPrice = minPrice;
    if (maxPrice !== void 0) params.maxPrice = maxPrice;
    return params;
  }
  function sanitizeTraders(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const sort = src.sort === "fast" ? "fast" : "price";
    const params = {
      limit: clampInt(src.limit, 1, CONFIG.TRADERS_LIMIT_MAX, 25),
      sort
    };
    const hours = optionalNonNegInt(src.tradedWithinHours);
    if (hours !== void 0 && hours >= 1 && hours <= CONFIG.TRADED_WITHIN_HOURS_MAX) {
      params.tradedWithinHours = hours;
    }
    return params;
  }
  const SORT_KEYS = ["price", "quantity", "profit", "updated"];
  const ORDERS = ["asc", "desc"];
  const DISPLAY = ["percentage", "profit"];
  const LINKS = ["new_tab", "new_window", "same_tab"];
  const LAYOUTS = ["default", "compact"];
  function pick(value, allowed, fallback) {
    return typeof value === "string" && allowed.includes(value) ? value : fallback;
  }
  function normalizeSettings(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      defaultSort: pick(src.defaultSort, SORT_KEYS, DEFAULT_SETTINGS.defaultSort),
      defaultOrder: pick(src.defaultOrder, ORDERS, DEFAULT_SETTINGS.defaultOrder),
      listingFee: clampInt(src.listingFee, 0, 100, 0),
      defaultDisplayMode: pick(
        src.defaultDisplayMode,
        DISPLAY,
        DEFAULT_SETTINGS.defaultDisplayMode
      ),
      linkBehavior: pick(src.linkBehavior, LINKS, DEFAULT_SETTINGS.linkBehavior),
      layoutMode: pick(src.layoutMode, LAYOUTS, DEFAULT_SETTINGS.layoutMode),
      marketplace: sanitizeMarketplace(src.marketplace),
      showTraders: Boolean(src.showTraders),
      traders: sanitizeTraders(src.traders)
    };
  }
  function loadSettings() {
    try {
      const saved = gmGetValue(STORAGE_KEYS.settings);
      if (!saved) {
        return {
          ...DEFAULT_SETTINGS,
          marketplace: { ...DEFAULT_SETTINGS.marketplace },
          traders: { ...DEFAULT_SETTINGS.traders }
        };
      }
      const parsed = typeof saved === "string" ? JSON.parse(saved) : saved;
      const src = parsed && typeof parsed === "object" ? parsed : {};
      if (src.listingFee === void 0) {
        const legacyFee = gmGetValue("bazaarListingFee");
        if (legacyFee !== void 0) src.listingFee = Number(legacyFee);
      }
      if (src.linkBehavior === void 0) {
        const legacyLink = gmGetValue("bazaarLinkBehavior");
        if (legacyLink !== void 0) src.linkBehavior = legacyLink;
      }
      return normalizeSettings(src);
    } catch (e) {
      console.error("[bazaars-in-im] Failed to load settings:", e);
      return normalizeSettings({});
    }
  }
  function saveSettings(settings2) {
    try {
      gmSetValue(STORAGE_KEYS.settings, JSON.stringify(settings2));
      gmSetValue("bazaarDefaultSort", settings2.defaultSort);
      gmSetValue("bazaarDefaultOrder", settings2.defaultOrder);
      gmSetValue("bazaarListingFee", settings2.listingFee);
      gmSetValue("bazaarDefaultDisplayMode", settings2.defaultDisplayMode);
      gmSetValue("bazaarLinkBehavior", settings2.linkBehavior);
      gmSetValue("bazaarLayoutMode", settings2.layoutMode);
    } catch (e) {
      console.error("[bazaars-in-im] Failed to save settings:", e);
    }
  }
  let settings = loadSettings();
  const session = {
    sortKey: settings.defaultSort,
    sortOrder: settings.defaultOrder,
    displayMode: settings.defaultDisplayMode,
    mobileView: window.innerWidth < 784,
    currentItemName: "",
    currentMarketPrice: null,
    listings: []
  };
  function getSettings() {
    return settings;
  }
  function setSettings(next) {
    settings = next;
  }
  function defaultSortOrderForKey(key) {
    return key === "price" ? "asc" : "desc";
  }
  function sortListings(listings, sortKey = session.sortKey, sortOrder = session.sortOrder, marketPrice = session.currentMarketPrice, listingFee = settings.listingFee) {
    return listings.slice().sort((a, b) => {
      let diff;
      if (sortKey === "profit" && marketPrice != null && marketPrice > 0) {
        const fee = listingFee || 0;
        const aProfit = marketPrice * a.quantity - a.price * a.quantity - Math.ceil(marketPrice * a.quantity * (fee / 100));
        const bProfit = marketPrice * b.quantity - b.price * b.quantity - Math.ceil(marketPrice * b.quantity * (fee / 100));
        diff = aProfit - bProfit;
      } else if (sortKey === "quantity") {
        diff = a.quantity - b.quantity;
      } else if (sortKey === "updated") {
        diff = a.updated - b.updated;
      } else {
        diff = a.price - b.price;
      }
      return sortOrder === "asc" ? diff : -diff;
    });
  }
  function fetchJson(path, query) {
    const url = new URL(path.replace(/^\//, ""), CONFIG.API_BASE);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === void 0 || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    return new Promise((resolve) => {
      let retryCount = 0;
      const attempt = () => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          if (retryCount < CONFIG.REQUEST_MAX_RETRIES) {
            retryCount++;
            window.setTimeout(attempt, CONFIG.REQUEST_RETRY_DELAY_MS);
          } else {
            resolve(null);
          }
        }, CONFIG.REQUEST_TIMEOUT_MS);
        gmXmlhttpRequest({
          method: "GET",
          url: url.toString(),
          timeout: CONFIG.REQUEST_TIMEOUT_MS,
          onload: (res) => {
            if (settled) return;
            window.clearTimeout(timeoutId);
            settled = true;
            try {
              if (res.status >= 200 && res.status < 300) {
                resolve(JSON.parse(res.responseText));
                return;
              }
              if (retryCount < CONFIG.REQUEST_MAX_RETRIES) {
                retryCount++;
                window.setTimeout(attempt, CONFIG.REQUEST_RETRY_DELAY_MS);
              } else {
                resolve(null);
              }
            } catch (e) {
              console.error(`[bazaars-in-im] Parse error for ${url}:`, e);
              resolve(null);
            }
          },
          onerror: () => {
            if (settled) return;
            window.clearTimeout(timeoutId);
            settled = true;
            if (retryCount < CONFIG.REQUEST_MAX_RETRIES) {
              retryCount++;
              window.setTimeout(attempt, CONFIG.REQUEST_RETRY_DELAY_MS);
            } else {
              resolve(null);
            }
          },
          ontimeout: () => {
            if (settled) return;
            window.clearTimeout(timeoutId);
            settled = true;
            if (retryCount < CONFIG.REQUEST_MAX_RETRIES) {
              retryCount++;
              window.setTimeout(attempt, CONFIG.REQUEST_RETRY_DELAY_MS);
            } else {
              resolve(null);
            }
          }
        });
      };
      attempt();
    });
  }
  function toListing(raw) {
    if (raw.player_id == null) return null;
    return {
      item_id: raw.item_id,
      player_id: raw.player_id,
      player_name: raw.player_name ?? null,
      quantity: raw.quantity,
      price: raw.price,
      updated: raw.last_checked ?? raw.content_updated ?? 0,
      uid: raw.uid ?? null
    };
  }
  function marketplaceQuery(params) {
    return {
      minQty: params.minQty,
      maxQty: params.maxQty,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      limit: params.limit
    };
  }
  function tradersQuery(params) {
    return {
      limit: params.limit,
      sort: params.sort,
      tradedWithinHours: params.tradedWithinHours
    };
  }
  async function fetchMarketplaceItem(itemId, params) {
    const data = await fetchJson(
      `marketplace/${itemId}`,
      marketplaceQuery(params)
    );
    if (!data || !Array.isArray(data.listings)) return null;
    const listings = data.listings.map(toListing).filter((l) => l !== null);
    return {
      item_id: data.item_id,
      item_name: data.item_name,
      market_price: data.market_price,
      bazaar_average: data.bazaar_average,
      generated_at: data.generated_at,
      listings
    };
  }
  async function fetchItemTraders(itemId, params) {
    const data = await fetchJson(
      `marketplace/${itemId}/traders`,
      tradersQuery(params)
    );
    if (!data || !Array.isArray(data.traders)) return null;
    return {
      item_id: data.item_id,
      item_name: data.item_name,
      total_count: data.total_count,
      traders: data.traders,
      generated_at: data.generated_at
    };
  }
  function getRelativeTime(unixSeconds) {
    const diffSec = Math.floor((Date.now() - unixSeconds * 1e3) / 1e3);
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }
  function abbreviateMoney(amount) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1).replace(/\.0$/, "")}m`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
    return `${sign}$${abs}`;
  }
  function formatMoney(amount) {
    return `$${Math.round(amount).toLocaleString()}`;
  }
  function calculateProfit(listingPrice, quantity, marketValue, listingFeePercent) {
    const priceDiff = listingPrice - marketValue;
    const percentDiff = marketValue > 0 ? (listingPrice / marketValue - 1) * 100 : 0;
    const totalCost = listingPrice * quantity;
    const potentialRevenue = marketValue * quantity;
    const feeAmount = Math.ceil(potentialRevenue * (listingFeePercent / 100));
    const potentialProfit = potentialRevenue - totalCost - feeAmount;
    const minResellPrice = listingFeePercent > 0 && listingFeePercent < 100 ? Math.ceil(listingPrice / (1 - listingFeePercent / 100)) : listingPrice;
    return {
      marketValue,
      priceDiff,
      percentDiff,
      totalCost,
      potentialRevenue,
      feeAmount,
      potentialProfit,
      minResellPrice
    };
  }
  function escapeHtml$2(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function attachTooltip(anchor, html) {
    const tooltip = document.createElement("div");
    tooltip.className = "bazaar-profit-tooltip";
    tooltip.style.display = "none";
    tooltip.style.opacity = "0";
    tooltip.innerHTML = html;
    anchor.addEventListener("mouseenter", (e) => {
      document.body.appendChild(tooltip);
      tooltip.style.display = "block";
      tooltip.style.left = "0";
      tooltip.style.top = "0";
      const target = e.target;
      const rect = target.getBoundingClientRect();
      const tipRect = tooltip.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 5;
      if (left + tipRect.width > window.innerWidth) {
        left = Math.max(5, window.innerWidth - tipRect.width - 5);
      }
      if (top + tipRect.height > window.innerHeight) {
        top = Math.max(5, rect.top - tipRect.height - 5);
      }
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      requestAnimationFrame(() => {
        tooltip.style.opacity = "1";
      });
    });
    anchor.addEventListener("mouseleave", () => {
      tooltip.style.opacity = "0";
      setTimeout(() => tooltip.remove(), 200);
    });
  }
  function createPriceComparison(listingPrice, quantity) {
    const marketValue = session.currentMarketPrice;
    if (marketValue == null || marketValue <= 0) return null;
    const settings2 = getSettings();
    const breakdown = calculateProfit(
      listingPrice,
      quantity,
      marketValue,
      settings2.listingFee || 0
    );
    const { potentialProfit, percentDiff, totalCost, feeAmount, minResellPrice } = breakdown;
    let tone = "neutral";
    let text;
    if (potentialProfit > 0) {
      tone = "good";
      text = session.displayMode === "percentage" ? `${percentDiff.toFixed(1)}%` : abbreviateMoney(potentialProfit);
    } else if (potentialProfit < 0) {
      tone = "bad";
      text = session.displayMode === "percentage" ? `+${percentDiff.toFixed(1)}%` : abbreviateMoney(potentialProfit);
    } else {
      text = session.displayMode === "percentage" ? "0%" : "$0";
    }
    const feeLine = settings2.listingFee > 0 ? `<div>Resale fee: ${settings2.listingFee}% (${formatMoney(feeAmount)})</div>
         <div class="bazaar-tooltip-emphasis">Min resell: ${formatMoney(minResellPrice)}</div>` : "";
    const tooltipContent = `
    <div class="bazaar-tooltip-title">${potentialProfit >= 0 ? "Profit" : "Loss"}: ${potentialProfit >= 0 ? "" : "-"}${formatMoney(Math.abs(potentialProfit))}</div>
    <div class="bazaar-tooltip-body">
      <div>Market ${formatMoney(marketValue)}</div>
      <div>Cost ${formatMoney(totalCost)} × ${quantity}</div>
      ${feeLine}
    </div>
  `;
    const span = document.createElement("span");
    span.className = `bazaar-price-comparison bazaar-price-comparison--${tone}`;
    span.textContent = text;
    attachTooltip(span, tooltipContent);
    return span;
  }
  function listingHistoryHref(listing) {
    return `https://www.torn.com/bazaar.php?userId=${listing.player_id}&itemId=${listing.item_id}&v=${listing.updated}#/`;
  }
  function listingOpenHref(listing) {
    return `https://www.torn.com/bazaar.php?userId=${listing.player_id}&itemId=${listing.item_id}&v=${listing.updated}&price=${listing.price}&highlight=1#/`;
  }
  function createListingCard(listing, index) {
    const settings2 = getSettings();
    const card = document.createElement("div");
    card.className = "bazaar-listing-card";
    card.dataset.index = String(index);
    card.dataset.listingKey = `${listing.player_id}-${listing.price}-${listing.quantity}`;
    const displayName = listing.player_name || `ID ${listing.player_id}`;
    const historyHref = listingHistoryHref(listing);
    const openHref = listingOpenHref(listing);
    const targetAttrs = settings2.linkBehavior === "new_tab" ? 'target="_blank" rel="noopener noreferrer"' : "";
    const comparison = createPriceComparison(listing.price, listing.quantity);
    if (settings2.layoutMode === "compact") {
      card.innerHTML = `
      <a href="${historyHref}" ${targetAttrs} class="bazaar-player-link">${escapeHtml$2(displayName)}</a>
      <span class="bazaar-card-price">${formatMoney(listing.price)}</span>
      <span class="bazaar-card-qty">×${listing.quantity}</span>
      <span data-comparison-slot></span>
      <span class="bazaar-listing-footnote">${getRelativeTime(listing.updated)}</span>
    `;
    } else {
      card.innerHTML = `
      <a href="${historyHref}" ${targetAttrs} class="bazaar-player-link">${escapeHtml$2(displayName)}</a>
      <div class="bazaar-card-price">${formatMoney(listing.price)} <span class="bazaar-card-qty">×${listing.quantity}</span></div>
      <div class="bazaar-card-row">
        <span data-comparison-slot></span>
        <span class="bazaar-listing-footnote">${getRelativeTime(listing.updated)}</span>
      </div>
    `;
    }
    const slot = card.querySelector("[data-comparison-slot]");
    if (slot && comparison) slot.replaceWith(comparison);
    else slot == null ? void 0 : slot.remove();
    const playerLink = card.querySelector("a");
    playerLink == null ? void 0 : playerLink.addEventListener("click", (e) => {
      const behavior = settings2.linkBehavior || "new_tab";
      if (behavior === "same_tab") {
        e.preventDefault();
        window.location.assign(openHref);
        return;
      }
      e.preventDefault();
      if (behavior === "new_window") {
        window.open(openHref, "_blank", "noopener,noreferrer,width=1200,height=800");
      } else {
        window.open(openHref, "_blank", "noopener,noreferrer");
      }
    });
    return card;
  }
  const SVG = {
    rightArrow: `<svg viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L242.7 256 73.4 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z"/></svg>`,
    leftArrow: `<svg viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l192 192c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256 246.6 86.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-192 192z"/></svg>`,
    infoIcon: `<path fill="currentColor" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/>`,
    tradersIcon: `<path fill="currentColor" d="M96 128a128 128 0 1 1 256 0A128 128 0 1 1 96 128zM0 482.3C0 383.8 79.8 304 178.3 304h91.4C368.2 304 448 383.8 448 482.3c0 16.4-13.3 29.7-29.7 29.7H29.7C13.3 512 0 498.7 0 482.3zM504 312V248H440c-13.3 0-24-10.7-24-24s10.7-24 24-24h64V136c0-13.3 10.7-24 24-24s24 10.7 24 24v64h64c13.3 0 24 10.7 24 24s-10.7 24-24 24H552v64c0 13.3-10.7 24-24 24s-24-10.7-24-24z"/>`
  };
  function pickBestBuyTrader(traders, minUpvotes = 5) {
    var _a;
    let best = null;
    for (const trader of traders) {
      if ((((_a = trader.rating) == null ? void 0 : _a.upvotes) ?? 0) < minUpvotes || trader.price <= 0) continue;
      if (!best || trader.price > best.price) best = trader;
    }
    return best;
  }
  function escapeHtml$1(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  async function loadTradersData(itemId) {
    return fetchItemTraders(itemId, getSettings().traders);
  }
  function traderRow(trader) {
    const rating = trader.rating && trader.rating.total > 0 ? ` · ${trader.rating.upvotes}↑/${trader.rating.downvotes}↓` : "";
    const last = trader.last_trade != null ? getRelativeTime(trader.last_trade) : trader.last_action != null ? getRelativeTime(trader.last_action) : "—";
    const href = `https://www.torn.com/profiles.php?XID=${trader.player_id}`;
    return `
    <div class="bazaar-trader-row">
      <a class="bazaar-trader-name" href="${href}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml$1(trader.player_name)}
      </a>
      <div class="bazaar-trader-price">${formatMoney(trader.price)}</div>
      <div class="bazaar-trader-meta">${last}${rating}</div>
    </div>
  `;
  }
  function createTradersPanel(itemId) {
    const panel = document.createElement("div");
    panel.className = "bazaar-traders-panel";
    panel.dataset.itemid = itemId;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bazaar-traders-toggle";
    toggle.innerHTML = `
    <svg viewBox="0 0 640 512" aria-hidden="true">${SVG.tradersIcon}</svg>
    <span>Traders buying this item</span>
    <span class="bazaar-traders-count"></span>
    <span class="chevron" aria-hidden="true">▸</span>
  `;
    const body = document.createElement("div");
    body.className = "bazaar-traders-body";
    body.innerHTML = `<div class="bazaar-empty-note">Loading traders…</div>`;
    toggle.addEventListener("click", () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open") && !panel.dataset.loaded) {
        void fillTradersPanel(panel, itemId);
      }
    });
    panel.appendChild(toggle);
    panel.appendChild(body);
    return panel;
  }
  async function fillTradersPanel(panel, itemId) {
    const body = panel.querySelector(".bazaar-traders-body");
    const countEl = panel.querySelector(".bazaar-traders-count");
    if (!body) return;
    body.innerHTML = `<div class="bazaar-empty-note">Loading traders…</div>`;
    const data = await loadTradersData(itemId);
    if (!data) {
      body.innerHTML = `<div class="bazaar-empty-note">Could not load traders. Try again later.</div>`;
      if (countEl) countEl.textContent = "";
      return;
    }
    renderTraders(panel, data.traders, data.total_count);
    panel.dataset.loaded = "1";
  }
  function renderTraders(panel, traders, totalCount) {
    const body = panel.querySelector(".bazaar-traders-body");
    const countEl = panel.querySelector(".bazaar-traders-count");
    if (!body) return;
    if (countEl) {
      countEl.textContent = totalCount > traders.length ? `(${traders.length} of ${totalCount})` : `(${traders.length})`;
    }
    if (traders.length === 0) {
      body.innerHTML = `<div class="bazaar-empty-note">No active traders found for this item.</div>`;
      return;
    }
    body.innerHTML = traders.map(traderRow).join("");
  }
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function numAttr(value) {
    return value === void 0 ? "" : String(value);
  }
  function createScrollArrow(direction, scrollWrapper) {
    const arrow = document.createElement("div");
    arrow.className = `bazaar-scroll-arrow ${direction}`;
    arrow.innerHTML = SVG[direction === "left" ? "leftArrow" : "rightArrow"];
    let isScrolling = false;
    let scrollAnimationId = null;
    let startTime = 0;
    let isClickAction = false;
    const ACTION_THRESHOLD = 200;
    const smoothScroll = () => {
      if (!isScrolling) return;
      scrollWrapper.scrollLeft += direction === "left" ? -1.5 : 1.5;
      scrollAnimationId = requestAnimationFrame(smoothScroll);
    };
    const startScrolling = (e) => {
      e.preventDefault();
      startTime = Date.now();
      isClickAction = false;
      setTimeout(() => {
        if (startTime && Date.now() - startTime >= ACTION_THRESHOLD) {
          isScrolling = true;
          smoothScroll();
        }
      }, ACTION_THRESHOLD);
    };
    const stopScrolling = () => {
      const holdDuration = Date.now() - startTime;
      isScrolling = false;
      if (scrollAnimationId) {
        cancelAnimationFrame(scrollAnimationId);
        scrollAnimationId = null;
      }
      if (holdDuration < ACTION_THRESHOLD && !isClickAction) {
        isClickAction = true;
        scrollWrapper.scrollBy({
          left: direction === "left" ? -200 : 200,
          behavior: "smooth"
        });
      }
      startTime = 0;
    };
    arrow.addEventListener("mousedown", startScrolling);
    arrow.addEventListener("mouseup", stopScrolling);
    arrow.addEventListener("mouseleave", stopScrolling);
    arrow.addEventListener("touchstart", startScrolling, { passive: false });
    arrow.addEventListener("touchend", stopScrolling);
    arrow.addEventListener("touchcancel", stopScrolling);
    return arrow;
  }
  function renderMessageInContainer(container, isApiError) {
    container.innerHTML = "";
    const messageContainer = document.createElement("div");
    messageContainer.className = "bazaar-empty-state";
    messageContainer.textContent = isApiError ? "API error — try again later" : "No bazaar listings for this item.";
    container.appendChild(messageContainer);
  }
  function createInfoContainer(itemName, itemId) {
    const settings2 = getSettings();
    const mp = settings2.marketplace;
    const container = document.createElement("div");
    container.className = "bazaar-info-container";
    container.dataset.itemid = itemId;
    session.currentItemName = itemName;
    const header = document.createElement("div");
    header.className = "bazaar-info-header";
    header.innerHTML = `
    <span class="bazaar-info-title">${escapeHtml(itemName)}</span>
    <span class="bazaar-info-stats" data-role="stats">
      <span class="bazaar-stat" data-stat="market">Mkt <b>…</b></span>
      <span class="bazaar-stat" data-stat="avg">Avg <b>…</b></span>
      <span class="bazaar-stat bazaar-stat--buy" data-stat="buy">Buy≥5↑ <b>…</b></span>
    </span>
  `;
    container.appendChild(header);
    const sortControls = document.createElement("div");
    sortControls.className = "bazaar-sort-controls";
    sortControls.innerHTML = `
    <select class="bazaar-sort-select" aria-label="Sort">
      <option value="price" ${session.sortKey === "price" ? "selected" : ""}>Price</option>
      <option value="quantity" ${session.sortKey === "quantity" ? "selected" : ""}>Qty</option>
      <option value="profit" ${session.sortKey === "profit" ? "selected" : ""}>Profit</option>
      <option value="updated" ${session.sortKey === "updated" ? "selected" : ""}>Updated</option>
    </select>
    <button type="button" class="bazaar-button bazaar-order-toggle" title="Sort order">${session.sortOrder === "asc" ? "Asc" : "Desc"}</button>
    <button type="button" class="bazaar-button bazaar-display-toggle" title="% vs profit">${session.displayMode === "percentage" ? "%" : "$"}</button>
    <button type="button" class="bazaar-button bazaar-layout-toggle" title="Layout">${settings2.layoutMode === "compact" ? "List" : "Cards"}</button>
    <span class="bazaar-controls-divider" aria-hidden="true"></span>
    <input type="number" class="bazaar-filter" data-filter="minQty" min="0" placeholder="qty≥" title="minQty" value="${numAttr(mp.minQty)}">
    <input type="number" class="bazaar-filter" data-filter="maxQty" min="0" placeholder="qty≤" title="maxQty" value="${numAttr(mp.maxQty)}">
    <input type="number" class="bazaar-filter" data-filter="minPrice" min="0" placeholder="$≥" title="minPrice" value="${numAttr(mp.minPrice)}">
    <input type="number" class="bazaar-filter" data-filter="maxPrice" min="0" placeholder="$≤" title="maxPrice" value="${numAttr(mp.maxPrice)}">
    <input type="number" class="bazaar-filter" data-filter="limit" min="1" max="100" placeholder="lim" title="limit (1–100)" value="${mp.limit ?? 100}">
  `;
    container.appendChild(sortControls);
    const scrollContainer = document.createElement("div");
    scrollContainer.className = "bazaar-scroll-container";
    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "bazaar-scroll-wrapper";
    const cardContainer = document.createElement("div");
    cardContainer.className = "bazaar-card-container";
    scrollWrapper.appendChild(cardContainer);
    scrollContainer.appendChild(createScrollArrow("left", scrollWrapper));
    scrollContainer.appendChild(scrollWrapper);
    scrollContainer.appendChild(createScrollArrow("right", scrollWrapper));
    container.appendChild(scrollContainer);
    if (settings2.showTraders) {
      container.appendChild(createTradersPanel(itemId));
    }
    const footer = document.createElement("div");
    footer.className = "bazaar-footer-container";
    footer.innerHTML = `
    <div class="bazaar-listings-count">Loading…</div>
    <a href="https://weav3r.dev/" target="_blank" rel="noopener noreferrer">weav3r.dev</a>
  `;
    container.appendChild(footer);
    return container;
  }
  function setStatValue(container, stat, valueHtml) {
    const el = container.querySelector(`[data-stat="${stat}"] b`);
    if (el) el.innerHTML = valueHtml;
  }
  function updateHeaderMeta(container, data) {
    const title = container.querySelector(".bazaar-info-title");
    if (title) title.textContent = data.item_name;
    setStatValue(container, "market", formatMoney(data.market_price));
    setStatValue(container, "avg", formatMoney(data.bazaar_average));
  }
  async function updateBestBuyStat(container, itemId) {
    setStatValue(container, "buy", "…");
    const data = await loadTradersData(itemId);
    if (!container.isConnected) return;
    if (!data) {
      setStatValue(container, "buy", "—");
      return;
    }
    const best = pickBestBuyTrader(data.traders);
    if (!best) {
      setStatValue(container, "buy", "—");
      return;
    }
    const href = `https://www.torn.com/profiles.php?XID=${best.player_id}`;
    setStatValue(
      container,
      "buy",
      `<a class="bazaar-stat-link" href="${href}" target="_blank" rel="noopener noreferrer">${formatMoney(best.price)} ${escapeHtml(best.player_name)}</a>`
    );
  }
  function readMarketplaceFilters(container) {
    const read = (key) => {
      const input = container.querySelector(`[data-filter="${key}"]`);
      if (!input || input.value.trim() === "") return void 0;
      const n = Number(input.value);
      if (!Number.isFinite(n) || n < 0) return void 0;
      return Math.round(n);
    };
    const params = {};
    const minQty = read("minQty");
    const maxQty = read("maxQty");
    const minPrice = read("minPrice");
    const maxPrice = read("maxPrice");
    const limit = read("limit");
    if (minQty !== void 0) params.minQty = minQty;
    if (maxQty !== void 0) params.maxQty = maxQty;
    if (minPrice !== void 0) params.minPrice = minPrice;
    if (maxPrice !== void 0) params.maxPrice = maxPrice;
    params.limit = limit ?? 100;
    return params;
  }
  async function applyMarketplaceFilters(container) {
    const marketplace = readMarketplaceFilters(container);
    const next = normalizeSettings({ ...getSettings(), marketplace });
    setSettings(next);
    saveSettings(next);
    await refetchListings(container);
  }
  function previewMarketplaceFilters(container) {
    renderListings(container);
  }
  async function refetchListings(container) {
    var _a, _b;
    const itemId = container.dataset.itemid;
    if (!itemId) return;
    ((_b = (_a = container.querySelector(".bazaar-info-title")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim()) || session.currentItemName || "Item";
    await loadListings(container, itemId);
  }
  function applyLocalFilters(listings, params) {
    return listings.filter((listing) => {
      if (params.minQty !== void 0 && listing.quantity < params.minQty) return false;
      if (params.maxQty !== void 0 && listing.quantity > params.maxQty) return false;
      if (params.minPrice !== void 0 && listing.price < params.minPrice) return false;
      if (params.maxPrice !== void 0 && listing.price > params.maxPrice) return false;
      return true;
    });
  }
  function renderListings(infoContainer) {
    const cardContainer = infoContainer.querySelector(
      ".bazaar-card-container"
    );
    if (!cardContainer || !infoContainer.isConnected) return;
    try {
      const settings2 = getSettings();
      const params = readMarketplaceFilters(infoContainer);
      if (!infoContainer.originalListings && session.listings.length > 0) {
        infoContainer.originalListings = [...session.listings];
      }
      if (session.listings.length === 0 && infoContainer.originalListings) {
        session.listings = [...infoContainer.originalListings];
      }
      const visible = applyLocalFilters(session.listings, params);
      infoContainer.classList.toggle("compact-layout", settings2.layoutMode === "compact");
      cardContainer.innerHTML = "";
      if (visible.length === 0) {
        renderMessageInContainer(cardContainer, false);
        const empty = cardContainer.querySelector(".bazaar-empty-state");
        if (empty && session.listings.length > 0) {
          empty.textContent = "No listings match the current filters.";
        }
        updateCount(infoContainer, visible);
        return;
      }
      const fragment = document.createDocumentFragment();
      visible.forEach((listing, index) => {
        fragment.appendChild(createListingCard(listing, index));
      });
      cardContainer.appendChild(fragment);
      updateCount(infoContainer, visible);
    } catch (error) {
      console.error("[bazaars-in-im] render error:", error);
    }
  }
  function updateCount(infoContainer, listings) {
    const countEl = infoContainer.querySelector(".bazaar-listings-count");
    if (!countEl) return;
    const totalQuantity = listings.reduce((sum, l) => sum + l.quantity, 0);
    countEl.textContent = `${listings.length} · ${totalQuantity.toLocaleString()} items`;
  }
  function applyListingsData(container, data) {
    session.currentMarketPrice = data.market_price;
    session.currentItemName = data.item_name;
    updateHeaderMeta(container, data);
    void updateBestBuyStat(container, String(data.item_id));
    container.originalListings = [...data.listings];
    session.listings = sortListings(data.listings);
    const cardContainer = container.querySelector(".bazaar-card-container");
    if (!cardContainer) return;
    if (session.listings.length === 0) {
      cardContainer.innerHTML = "";
      renderMessageInContainer(cardContainer, false);
      const countEl = container.querySelector(".bazaar-listings-count");
      if (countEl) countEl.textContent = "0 listings";
      return;
    }
    renderListings(container);
  }
  async function loadListings(infoContainer, itemId, itemName) {
    const cardContainer = infoContainer.querySelector(".bazaar-card-container");
    const countElement = infoContainer.querySelector(".bazaar-listings-count");
    const settings2 = getSettings();
    const showEmptyState = (isError) => {
      if (cardContainer) {
        cardContainer.innerHTML = "";
        renderMessageInContainer(cardContainer, isError);
      }
      if (countElement) countElement.textContent = "API error";
    };
    if (cardContainer) {
      cardContainer.innerHTML = '<div class="bazaar-empty-note">Loading…</div>';
    }
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      showEmptyState(true);
    }, CONFIG.LISTINGS_LOAD_TIMEOUT_MS);
    const data = await fetchMarketplaceItem(itemId, settings2.marketplace);
    window.clearTimeout(timeoutId);
    if (timedOut) return;
    if (!data) {
      showEmptyState(true);
      return;
    }
    applyListingsData(infoContainer, data);
  }
  async function updateInfoContainer(wrapper, itemId, itemName) {
    let infoContainer;
    if (wrapper.classList.contains("bazaar-info-container")) {
      infoContainer = wrapper;
    } else {
      if (wrapper.hasAttribute("data-has-bazaar-info") && wrapper.querySelector(".bazaar-info-container")) {
        return;
      }
      const existing = document.querySelector(
        `.bazaar-info-container[data-itemid="${CSS.escape(itemId)}"]`
      );
      if (existing && wrapper.contains(existing)) {
        infoContainer = existing;
      } else {
        infoContainer = createInfoContainer(itemName, itemId);
        wrapper.insertBefore(infoContainer, wrapper.firstChild);
        wrapper.setAttribute("data-has-bazaar-info", "true");
      }
    }
    await loadListings(infoContainer, itemId);
  }
  function performSort(container) {
    session.listings = sortListings(session.listings);
    const scrollWrapper = container.querySelector(".bazaar-scroll-wrapper");
    if (scrollWrapper) scrollWrapper.scrollLeft = 0;
    renderListings(container);
  }
  function refreshAllContainers() {
    document.querySelectorAll(".bazaar-info-container").forEach((node) => {
      renderListings(node);
    });
  }
  function bindContainerEvents() {
    document.body.addEventListener("click", (event) => {
      const target = event.target;
      if (!target) return;
      const container = target.closest(".bazaar-info-container");
      if (!container) return;
      if (target.matches(".bazaar-order-toggle")) {
        session.sortOrder = session.sortOrder === "asc" ? "desc" : "asc";
        target.textContent = session.sortOrder === "asc" ? "Asc" : "Desc";
        performSort(container);
        return;
      }
      if (target.matches(".bazaar-display-toggle")) {
        session.displayMode = session.displayMode === "percentage" ? "profit" : "percentage";
        target.textContent = session.displayMode === "percentage" ? "%" : "$";
        const settings2 = getSettings();
        settings2.defaultDisplayMode = session.displayMode;
        setSettings(settings2);
        saveSettings(settings2);
        refreshAllContainers();
        return;
      }
      if (target.matches(".bazaar-layout-toggle")) {
        const settings2 = getSettings();
        settings2.layoutMode = settings2.layoutMode === "default" ? "compact" : "default";
        setSettings(settings2);
        saveSettings(settings2);
        target.textContent = settings2.layoutMode === "compact" ? "List" : "Cards";
        performSort(container);
      }
    });
    document.body.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target == null ? void 0 : target.matches(".bazaar-filter"))) return;
      const container = target.closest(".bazaar-info-container");
      if (!container) return;
      previewMarketplaceFilters(container);
      window.clearTimeout(target.debounceTimer);
      target.debounceTimer = window.setTimeout(
        () => {
          void applyMarketplaceFilters(container);
        },
        450
      );
    });
    document.body.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target == null ? void 0 : target.matches(".bazaar-sort-select"))) return;
      const container = target.closest(".bazaar-info-container");
      if (!container) return;
      const newSortKey = target.value;
      if (newSortKey !== session.sortKey) {
        session.sortKey = newSortKey;
        session.sortOrder = defaultSortOrderForKey(session.sortKey);
        const orderToggle = container.querySelector(".bazaar-order-toggle");
        if (orderToggle) {
          orderToggle.textContent = session.sortOrder === "asc" ? "Asc" : "Desc";
        }
      } else {
        session.sortKey = newSortKey;
      }
      performSort(container);
    });
  }
  function buildPriceDiffMessage(expectedPrice, actualPrice, itemName) {
    if (!Number.isFinite(expectedPrice) || !Number.isFinite(actualPrice)) return null;
    if (actualPrice === expectedPrice) return null;
    const from = formatMoney(expectedPrice);
    const to = formatMoney(actualPrice);
    const name = itemName.trim() || "this item";
    if (actualPrice > expectedPrice) {
      return {
        kind: "increased",
        text: `Careful! Price increased from ${from} to ${to} for ${name}`
      };
    }
    return {
      kind: "decreased",
      text: `Price decreased from ${from} to ${to} for ${name}`
    };
  }
  function parseBazaarCardPrice(card) {
    var _a, _b;
    const priceEl = card.querySelector('[data-testid="price"]');
    if (!priceEl) return null;
    for (const node of priceEl.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const match2 = (_a = node.textContent) == null ? void 0 : _a.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
      if (match2) return Number(match2[1]);
    }
    const match = (_b = priceEl.textContent) == null ? void 0 : _b.match(/^\$?\s*([\d,]+)/);
    if (!(match == null ? void 0 : match[1])) return null;
    return Number(match[1].replace(/,/g, ""));
  }
  function readBazaarCardName(card) {
    var _a, _b;
    const nameEl = card.querySelector('[data-testid="name"]');
    const name = (_a = nameEl == null ? void 0 : nameEl.textContent) == null ? void 0 : _a.trim();
    if (name) return name;
    const labeled = card.querySelector("[aria-label]");
    return ((_b = labeled == null ? void 0 : labeled.getAttribute("aria-label")) == null ? void 0 : _b.trim()) || "this item";
  }
  function showHighlightToast(message, tone) {
    document.querySelectorAll(".bim-highlight-toast").forEach((el) => el.remove());
    const toast = document.createElement("div");
    toast.className = `bim-highlight-toast bim-highlight-toast--${tone}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 250);
    }, 8e3);
  }
  function handleBazaarHighlight() {
    if (!window.location.href.includes("bazaar.php")) return;
    const params = new URLSearchParams(window.location.search);
    const targetItemId = params.get("itemId");
    const highlight = params.get("highlight");
    if (!targetItemId || highlight !== "1") return;
    const expectedPriceRaw = params.get("price");
    const expectedPrice = expectedPriceRaw != null && expectedPriceRaw !== "" ? Number(expectedPriceRaw) : null;
    params.delete("highlight");
    params.delete("price");
    const query = params.toString();
    const cleaned = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    history.replaceState({}, "", cleaned);
    let done = false;
    let itemObserver = null;
    let rootObserver = null;
    let timeoutId = null;
    const startedAt = Date.now();
    const MAX_WAIT_MS = 2e4;
    const cleanup = () => {
      itemObserver == null ? void 0 : itemObserver.disconnect();
      rootObserver == null ? void 0 : rootObserver.disconnect();
      itemObserver = null;
      rootObserver = null;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    const failNotFound = () => {
      if (done) return;
      done = true;
      cleanup();
      showHighlightToast(
        `Couldn't find that item (#${targetItemId}) in this bazaar.`,
        "danger"
      );
    };
    const findItemCard = () => {
      const needles = [
        `img[src*="/images/items/${CSS.escape(targetItemId)}/"]`,
        `img[srcset*="/images/items/${CSS.escape(targetItemId)}/"]`
      ];
      for (const sel of needles) {
        const img = document.querySelector(sel);
        if (!img) continue;
        const card = img.closest('[data-testid="item"]') ?? img.closest('[class*="item___"]');
        if (card) return card;
      }
      return null;
    };
    const highlightItem = () => {
      if (done) return true;
      const card = findItemCard();
      if (!card) return false;
      done = true;
      const itemName = readBazaarCardName(card);
      const actualPrice = parseBazaarCardPrice(card);
      const diff = expectedPrice != null && Number.isFinite(expectedPrice) && actualPrice != null ? buildPriceDiffMessage(expectedPrice, actualPrice, itemName) : null;
      if ((diff == null ? void 0 : diff.kind) === "increased") {
        card.classList.add("red-outline", "pop-flash");
        showHighlightToast(diff.text, "warning");
      } else {
        card.classList.add("green-outline", "pop-flash");
        if ((diff == null ? void 0 : diff.kind) === "decreased") {
          showHighlightToast(diff.text, "info");
        }
      }
      window.setTimeout(() => card.classList.remove("pop-flash"), 800);
      cleanup();
      return true;
    };
    const watchContainer = (container) => {
      if (highlightItem()) return;
      itemObserver = new MutationObserver(() => {
        if (highlightItem()) return;
        if (Date.now() - startedAt > MAX_WAIT_MS) failNotFound();
      });
      itemObserver.observe(container, { childList: true, subtree: true });
    };
    timeoutId = window.setTimeout(failNotFound, MAX_WAIT_MS);
    const existing = document.querySelector('[data-testid="bazaar-items"]');
    if (existing) {
      watchContainer(existing);
      return;
    }
    rootObserver = new MutationObserver(() => {
      if (done) return;
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        failNotFound();
        return;
      }
      const container = document.querySelector('[data-testid="bazaar-items"]');
      if (!container) return;
      rootObserver == null ? void 0 : rootObserver.disconnect();
      rootObserver = null;
      watchContainer(container);
    });
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  function tornCssModuleSelector(localName) {
    const p = `${localName}___`;
    return `[class^="${p}"], [class*=" ${p}"]`;
  }
  function tornUlCssModuleSelector(localName) {
    const p = `${localName}___`;
    return `ul[class^="${p}"], ul[class*=" ${p}"]`;
  }
  function tornScopedDescendant(ancestorContains, localName) {
    const p = `${localName}___`;
    const a = `[class*="${ancestorContains}"]`;
    return `${a} [class^="${p}"], ${a} [class*=" ${p}"]`;
  }
  function checkMobileView() {
    session.mobileView = window.innerWidth < 784;
    return session.mobileView;
  }
  function processSellerWrapper(wrapper) {
    var _a, _b;
    if (!(wrapper instanceof HTMLElement) || wrapper.classList.contains("bazaar-info-container") || wrapper.hasAttribute("data-bazaar-processed")) {
      return;
    }
    if (wrapper.querySelector(":scope > .bazaar-info-container")) return;
    const itemTile = wrapper.previousElementSibling;
    if (!itemTile) return;
    const nameEl = itemTile.querySelector(tornCssModuleSelector("name"));
    const btn = ((_a = nameEl == null ? void 0 : nameEl.closest(tornCssModuleSelector("item"))) == null ? void 0 : _a.querySelector('button[aria-controls^="wai-itemInfo-"]')) ?? itemTile.querySelector('button[aria-controls^="wai-itemInfo-"]');
    if (!nameEl || !btn) return;
    const itemName = ((_b = nameEl.textContent) == null ? void 0 : _b.trim()) ?? "";
    const idParts = (btn.getAttribute("aria-controls") ?? "").split("-");
    const itemId = idParts[idParts.length - 1] ?? "";
    if (!itemId) return;
    wrapper.setAttribute("data-bazaar-processed", "true");
    void updateInfoContainer(wrapper, itemId, itemName);
  }
  function processMobileSellerList() {
    var _a, _b;
    if (!checkMobileView()) return;
    const sellerList = document.querySelector(tornUlCssModuleSelector("sellerList"));
    if (!sellerList) {
      const existing = document.querySelector(".bazaar-info-container");
      if (existing && existing.parentNode && !document.contains(existing.parentNode)) {
        existing.remove();
      }
      return;
    }
    if (sellerList.hasAttribute("data-has-bazaar-container")) return;
    const headerEl = document.querySelector(tornScopedDescendant("itemsHeader___", "title"));
    const itemName = ((_a = headerEl == null ? void 0 : headerEl.textContent) == null ? void 0 : _a.trim()) ?? "Unknown";
    const itemsHeaderSel = tornCssModuleSelector("itemsHeader");
    const btn = ((_b = headerEl == null ? void 0 : headerEl.closest(itemsHeaderSel)) == null ? void 0 : _b.querySelector('button[aria-controls^="wai-itemInfo-"]')) ?? document.querySelector(`${itemsHeaderSel} button[aria-controls^="wai-itemInfo-"]`);
    let itemId = "unknown";
    if (btn) {
      const parts = (btn.getAttribute("aria-controls") ?? "").split("-");
      itemId = parts.length > 2 ? parts[parts.length - 2] ?? "unknown" : parts[parts.length - 1] ?? "unknown";
    }
    const existingContainer = document.querySelector(
      `.bazaar-info-container[data-itemid="${itemId}"]`
    );
    if (existingContainer && sellerList.parentNode) {
      if (existingContainer.parentNode !== sellerList.parentNode || existingContainer.nextSibling !== sellerList) {
        sellerList.parentNode.insertBefore(existingContainer, sellerList);
      }
      return;
    }
    if (!sellerList.parentNode) return;
    const infoContainer = createInfoContainer(itemName, itemId);
    sellerList.parentNode.insertBefore(infoContainer, sellerList);
    sellerList.setAttribute("data-has-bazaar-container", "true");
    void updateInfoContainer(infoContainer, itemId, itemName);
  }
  function processAllSellerWrappers(root = document.body) {
    if (checkMobileView()) return;
    root.querySelectorAll(tornCssModuleSelector("sellerListWrapper")).forEach((wrapper) => {
      processSellerWrapper(wrapper);
    });
  }
  function startDomObserver() {
    const observeTarget = document.querySelector("#root") || document.body;
    let isProcessing = false;
    let processingTimeout = null;
    const observer = new MutationObserver((mutations) => {
      var _a;
      if (isProcessing) return;
      let needsProcessing = false;
      for (const mutation of mutations) {
        const isOurMutation = Array.from(mutation.addedNodes).some(
          (node) => node instanceof HTMLElement && (node.classList.contains("bazaar-info-container") || !!node.querySelector(".bazaar-info-container"))
        );
        if (isOurMutation) continue;
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) needsProcessing = true;
        }
        for (const node of mutation.removedNodes) {
          if (node instanceof HTMLElement && node.matches(tornUlCssModuleSelector("sellerList")) && checkMobileView()) {
            (_a = document.querySelector(".bazaar-info-container")) == null ? void 0 : _a.remove();
          }
        }
      }
      if (!needsProcessing) return;
      if (processingTimeout) window.clearTimeout(processingTimeout);
      processingTimeout = window.setTimeout(() => {
        try {
          isProcessing = true;
          if (checkMobileView()) processMobileSellerList();
          else processAllSellerWrappers();
        } finally {
          isProcessing = false;
          processingTimeout = null;
        }
      }, 100);
    });
    observer.observe(observeTarget, { childList: true, subtree: true });
    return observer;
  }
  function numOrEmpty(value) {
    return value === void 0 ? "" : String(value);
  }
  function readOptionalInt(input) {
    if (!input || input.value.trim() === "") return void 0;
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) return void 0;
    return Math.round(n);
  }
  function openSettingsModal() {
    var _a, _b;
    const settings2 = getSettings();
    const overlay = document.createElement("div");
    overlay.className = "bazaar-modal-overlay";
    const modal = document.createElement("div");
    modal.className = "bazaar-settings-modal";
    modal.innerHTML = `
    <div class="bazaar-settings-title">Bazaar Settings</div>
    <div class="bazaar-tabs">
      <div class="bazaar-tab active" data-tab="general">General</div>
      <div class="bazaar-tab" data-tab="traders">Traders</div>
    </div>

    <div class="bazaar-tab-content active" id="tab-general">
      <div class="bazaar-settings-item">
        <label for="bazaar-default-sort">Default Sort</label>
        <select id="bazaar-default-sort">
          <option value="price" ${settings2.defaultSort === "price" ? "selected" : ""}>Price</option>
          <option value="quantity" ${settings2.defaultSort === "quantity" ? "selected" : ""}>Quantity</option>
          <option value="profit" ${settings2.defaultSort === "profit" ? "selected" : ""}>Profit</option>
          <option value="updated" ${settings2.defaultSort === "updated" ? "selected" : ""}>Last Updated</option>
        </select>
      </div>
      <div class="bazaar-settings-item">
        <label for="bazaar-default-order">Default Order</label>
        <select id="bazaar-default-order">
          <option value="asc" ${settings2.defaultOrder === "asc" ? "selected" : ""}>Ascending</option>
          <option value="desc" ${settings2.defaultOrder === "desc" ? "selected" : ""}>Descending</option>
        </select>
      </div>
      <div class="bazaar-settings-item">
        <label for="bazaar-listing-fee">Listing Fee (%)</label>
        <input type="number" id="bazaar-listing-fee" class="bazaar-number-input" value="${settings2.listingFee}" min="0" max="100" step="1">
        <div class="bazaar-api-note">Used for profit estimates vs weav3r market price.</div>
      </div>
      <div class="bazaar-settings-item">
        <label for="bazaar-default-display">Default Display Mode</label>
        <select id="bazaar-default-display">
          <option value="percentage" ${settings2.defaultDisplayMode === "percentage" ? "selected" : ""}>Percentage</option>
          <option value="profit" ${settings2.defaultDisplayMode === "profit" ? "selected" : ""}>Profit $</option>
        </select>
      </div>
      <div class="bazaar-settings-item">
        <label for="bazaar-link-behavior">Bazaar Link Click</label>
        <select id="bazaar-link-behavior">
          <option value="new_tab" ${settings2.linkBehavior === "new_tab" ? "selected" : ""}>New Tab</option>
          <option value="new_window" ${settings2.linkBehavior === "new_window" ? "selected" : ""}>New Window</option>
          <option value="same_tab" ${settings2.linkBehavior === "same_tab" ? "selected" : ""}>Same Tab</option>
        </select>
      </div>
      <div class="bazaar-settings-item">
        <label for="bazaar-layout-mode">Card Layout</label>
        <select id="bazaar-layout-mode">
          <option value="default" ${settings2.layoutMode === "default" ? "selected" : ""}>Horizontal cards</option>
          <option value="compact" ${settings2.layoutMode === "compact" ? "selected" : ""}>Compact list</option>
        </select>
      </div>
      <div class="bazaar-api-note">Marketplace filters (qty/price/limit) live on the item toolbar.</div>
    </div>

    <div class="bazaar-tab-content" id="tab-traders">
      <div class="bazaar-settings-item">
        <label class="bazaar-checkbox-row" for="bim-show-traders">
          <input type="checkbox" id="bim-show-traders" ${settings2.showTraders ? "checked" : ""}>
          Show traders panel
        </label>
        <div class="bazaar-api-note">Best buy (≥5↑) still loads in the header either way.</div>
      </div>
      <div class="bazaar-settings-grid">
        <div class="bazaar-settings-item">
          <label for="bim-traders-limit">limit (1–100)</label>
          <input type="number" id="bim-traders-limit" min="1" max="100" value="${settings2.traders.limit ?? 25}">
        </div>
        <div class="bazaar-settings-item">
          <label for="bim-traders-sort">sort</label>
          <select id="bim-traders-sort">
            <option value="price" ${settings2.traders.sort === "price" ? "selected" : ""}>price</option>
            <option value="fast" ${settings2.traders.sort === "fast" ? "selected" : ""}>fast</option>
          </select>
        </div>
        <div class="bazaar-settings-item">
          <label for="bim-traded-within">tradedWithinHours</label>
          <input type="number" id="bim-traded-within" min="1" max="168" value="${numOrEmpty(settings2.traders.tradedWithinHours)}" placeholder="optional">
        </div>
      </div>
    </div>

    <div class="bazaar-settings-buttons">
      <button type="button" class="bazaar-settings-save">Save</button>
      <button type="button" class="bazaar-settings-cancel">Cancel</button>
    </div>
    <div class="bazaar-settings-footer">
      <p>Created by <a href="https://www.torn.com/profiles.php?XID=1853324" target="_blank" rel="noopener noreferrer">Weav3r [1853324]</a>
      · <a href="https://weav3r.dev/" target="_blank" rel="noopener noreferrer">weav3r.dev</a></p>
    </div>
  `;
    overlay.appendChild(modal);
    modal.querySelectorAll(".bazaar-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        var _a2;
        modal.querySelectorAll(".bazaar-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        modal.querySelectorAll(".bazaar-tab-content").forEach((c) => c.classList.remove("active"));
        const id = `tab-${tab.getAttribute("data-tab")}`;
        (_a2 = document.getElementById(id)) == null ? void 0 : _a2.classList.add("active");
      });
    });
    (_a = modal.querySelector(".bazaar-settings-save")) == null ? void 0 : _a.addEventListener("click", () => {
      applySettingsFromModal(modal);
      overlay.remove();
    });
    (_b = modal.querySelector(".bazaar-settings-cancel")) == null ? void 0 : _b.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }
  function applySettingsFromModal(modal) {
    const old = getSettings();
    const draft = {
      defaultSort: modal.querySelector("#bazaar-default-sort").value,
      defaultOrder: modal.querySelector("#bazaar-default-order").value,
      listingFee: Number(modal.querySelector("#bazaar-listing-fee").value) || 0,
      defaultDisplayMode: modal.querySelector("#bazaar-default-display").value,
      linkBehavior: modal.querySelector("#bazaar-link-behavior").value,
      layoutMode: modal.querySelector("#bazaar-layout-mode").value,
      showTraders: modal.querySelector("#bim-show-traders").checked,
      marketplace: { ...old.marketplace },
      traders: {
        limit: readOptionalInt(modal.querySelector("#bim-traders-limit")) ?? 25,
        sort: modal.querySelector("#bim-traders-sort").value,
        tradedWithinHours: readOptionalInt(modal.querySelector("#bim-traded-within"))
      }
    };
    const next = normalizeSettings(draft);
    setSettings(next);
    saveSettings(next);
    session.sortKey = next.defaultSort;
    session.sortOrder = next.defaultOrder;
    session.displayMode = next.defaultDisplayMode;
    const tradersUiChanged = old.showTraders !== next.showTraders || JSON.stringify(old.traders) !== JSON.stringify(next.traders);
    document.querySelectorAll(".bazaar-info-container").forEach((node) => {
      const container = node;
      const sortSelect = container.querySelector(".bazaar-sort-select");
      if (sortSelect) sortSelect.value = session.sortKey;
      const orderToggle = container.querySelector(".bazaar-order-toggle");
      if (orderToggle) orderToggle.textContent = session.sortOrder === "asc" ? "Asc" : "Desc";
      const displayToggle = container.querySelector(".bazaar-display-toggle");
      if (displayToggle) displayToggle.textContent = session.displayMode === "percentage" ? "%" : "$";
      const layoutToggle = container.querySelector(".bazaar-layout-toggle");
      if (layoutToggle) {
        layoutToggle.textContent = next.layoutMode === "compact" ? "List" : "Cards";
      }
      if (tradersUiChanged) {
        const parent = container.parentElement;
        if (parent) {
          parent.removeAttribute("data-has-bazaar-info");
          parent.removeAttribute("data-bazaar-processed");
          parent.removeAttribute("data-has-bazaar-container");
        }
        container.remove();
      } else {
        performSort(container);
      }
    });
    if (tradersUiChanged) {
      processAllSellerWrappers();
      processMobileSellerList();
    } else {
      refreshAllContainers();
    }
  }
  function addSettingsMenuItem() {
    const menu = document.querySelector(".settings-menu");
    if (!menu || document.querySelector(".bazaar-settings-button")) return;
    const li = document.createElement("li");
    li.className = "link bazaar-settings-button";
    const a = document.createElement("a");
    a.href = "#";
    a.innerHTML = `
    <div class="icon-wrapper">
      <svg class="default" fill="#fff" stroke="transparent" stroke-width="0" width="16" height="16" viewBox="0 0 640 512" aria-hidden="true">
        <path d="M36.8 192l566.3 0c20.3 0 36.8-16.5 36.8-36.8c0-7.3-2.2-14.4-6.2-20.4L558.2 21.4C549.3 8 534.4 0 518.3 0L121.7 0c-16 0-31 8-39.9 21.4L6.2 134.7c-4 6.1-6.2 13.2-6.2 20.4C0 175.5 16.5 192 36.8 192zM64 224l0 160 0 80c0 26.5 21.5 48 48 48l224 0c26.5 0 48-21.5 48-48l0-80 0-160-64 0 0 160-192 0 0-160-64 0zm448 0l0 256c0 17.7 14.3 32 32 32s32-14.3 32-32l0-256-64 0z"/>
      </svg>
    </div>
    <span>Bazaar Settings</span>
  `;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.body.click();
      openSettingsModal();
    });
    li.appendChild(a);
    const logoutButton = menu.querySelector("li.logout");
    if (logoutButton) menu.insertBefore(li, logoutButton);
    else menu.appendChild(li);
  }
  function observeUserMenu() {
    const menuObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("settings-menu")) {
            addSettingsMenuItem();
            return;
          }
        }
      }
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });
    if (document.querySelector(".settings-menu")) addSettingsMenuItem();
  }
  function boot() {
    gmAddStyle(css);
    checkMobileView();
    window.addEventListener("resize", () => {
      checkMobileView();
      processMobileSellerList();
    });
    processAllSellerWrappers();
    processMobileSellerList();
    const observer = startDomObserver();
    bindContainerEvents();
    handleBazaarHighlight();
    purgeLegacyStorage();
    observeUserMenu();
    window.addEventListener("beforeunload", () => {
      observer.disconnect();
    });
  }
  boot();

})();