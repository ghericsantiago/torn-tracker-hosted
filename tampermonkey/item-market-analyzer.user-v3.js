// ==UserScript==
// @name         Torn Item Market Analyzer
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Torn item market price history — powered by torn-imarket-tracker.gvsantiago.com
// @author       Gheric
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js
// @run-at       document-idle
// @connect      torn-imarket-tracker.gvsantiago.com
// ==/UserScript==

(function () {
  'use strict';

  const BASE_URL = 'https://torn-imarket-tracker.gvsantiago.com';

  const TF_BUCKET_MS = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, 'day': 86400000,
  };

  // ── Timezone State ──────────────────────────────────────────────────────
  let useTCT = true; // Default to TCT (UTC)

  // ── Timezone Helpers ──────────────────────────────────────────────────────
  function getTCTNow() {
    return new Date(new Date().toUTCString());
  }

  function getLocalNow() {
    return new Date();
  }

  function getDisplayTime() {
    return useTCT ? getTCTNow() : getLocalNow();
  }

  function formatDisplayDateTime(date) {
    if (useTCT) {
      const d = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
      return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())} TCT`;
    } else {
      const d = new Date(date);
      return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())} ${getLocalTimezoneAbbr()}`;
    }
  }

  function getLocalTimezoneAbbr() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = tz.split('/');
    const short = parts[parts.length - 1].replace(/_/g, ' ');
    const offset = -new Date().getTimezoneOffset();
    const hours = Math.floor(Math.abs(offset) / 60);
    const mins = Math.abs(offset) % 60;
    const sign = offset >= 0 ? '+' : '-';
    return `${short} (UTC${sign}${p2(hours)}:${p2(mins)})`;
  }

  function getDateInput() {
    if (useTCT) {
      return new Date().toISOString().slice(0, 10);
    } else {
      const now = new Date();
      return `${now.getFullYear()}-${p2(now.getMonth()+1)}-${p2(now.getDate())}`;
    }
  }

  function formatDisplayTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (useTCT) {
      const d = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
      return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())} TCT`;
    } else {
      return `${date.getFullYear()}-${p2(date.getMonth()+1)}-${p2(date.getDate())} ${p2(date.getHours())}:${p2(date.getMinutes())} ${getLocalTimezoneAbbr()}`;
    }
  }

  function shiftDate(dir) {
    const fromEl = document.getElementById('ima-from');
    const toEl = document.getElementById('ima-to');
    
    const fromDate = new Date(fromEl.value + 'T00:00:00Z');
    const toDate = new Date(toEl.value + 'T00:00:00Z');
    
    const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
    const shift = (spanDays + 1) * dir;
    
    fromDate.setUTCDate(fromDate.getUTCDate() + shift);
    toDate.setUTCDate(toDate.getUTCDate() + shift);
    
    fromEl.value = fromDate.toISOString().slice(0, 10);
    toEl.value = toDate.toISOString().slice(0, 10);
    fetchData();
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let panelOpen        = false;
  let currentTF        = '5m';
  let currentChartType = 'line';
  let currentItemId    = null;
  let rawData          = [];
  let tableData        = [];
  let priceChart       = null;
  let refreshTimer     = null;
  let autoRefreshOn    = false;
  let sortState        = { col: null, dir: 'asc' };
  let awaitingSell     = false;
  let bestLoaded       = false;
  let calcAutoOpen     = true;
  let bestData         = [];
  let bestSort         = { col: 'net_profit', dir: 'desc' };

  // ── Google Fonts ───────────────────────────────────────────────────────────
  const _link = document.createElement('link');
  _link.rel  = 'stylesheet';
  _link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap';
  document.head.appendChild(_link);

  // ── CSS ────────────────────────────────────────────────────────────────────
  GM_addStyle(`
    :root {
      --ima-bg:       #07080f;
      --ima-glass:    rgba(255,255,255,0.035);
      --ima-border:   rgba(255,255,255,0.07);
      --ima-hover:    rgba(255,255,255,0.055);
      --ima-accent:   #6ee7f7;
      --ima-adim:     rgba(110,231,247,0.12);
      --ima-accent2:  #818cf8;
      --ima-success:  #4ade80;
      --ima-warn:     #fbbf24;
      --ima-error:    #f87171;
      --ima-text:     #e2e8f0;
      --ima-muted:    #64748b;
      --ima-dim:      #94a3b8;
      --ima-mono:     'JetBrains Mono', monospace;
      --ima-sans:     'Space Grotesk', sans-serif;
      --ima-body:     'Inter', sans-serif;
      --ima-r:        12px;
      --ima-tr:       0.2s cubic-bezier(0.4,0,0.2,1);
    }

    #ima-toggle {
      position: fixed;
      right: 0;
      top: 30%;
      transform: translateY(-30%);
      background: rgba(110,231,247,0.08);
      border: 1px solid rgba(110,231,247,0.2);
      border-right: none;
      color: var(--ima-accent);
      width: 18px;
      padding: 12px 0;
      border-radius: 8px 0 0 8px;
      cursor: pointer;
      z-index: 2147483638;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font: 600 8px/1 var(--ima-mono);
      letter-spacing: 2px;
      text-align: center;
      user-select: none;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: background var(--ima-tr), opacity 0.2s;
      padding-right: 10px;
    }
    #ima-toggle:hover { background: rgba(110,231,247,0.14); }
    #ima-toggle.open  { opacity: 0; pointer-events: none; }

    #ima-panel {
      position: fixed;
      top: 0;
      right: -820px;
      width: min(800px, 100vw);
      height: 100dvh;
      background: rgba(7,8,15,0.97);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      color: var(--ima-text);
      z-index: 2147483643;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--ima-border);
      box-shadow: -12px 0 60px rgba(0,0,0,0.8);
      transition: right 0.32s cubic-bezier(.4,0,.2,1);
      font-family: var(--ima-body);
      font-size: 13px;
      overflow: hidden;
    }
    #ima-panel.open { right: 0; }

    #ima-hdr {
      padding: 14px 18px 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--ima-border);
      flex-shrink: 0;
      background: rgba(110,231,247,0.03);
    }
    #ima-hdr-icon {
      font-family: var(--ima-mono);
      font-size: 13px;
      color: var(--ima-accent);
      font-weight: 500;
    }
    #ima-hdr h2 {
      margin: 0;
      font-family: var(--ima-sans);
      font-size: 14px;
      font-weight: 700;
      color: var(--ima-text);
      flex: 1;
    }
    #ima-hdr-sub { font-family: var(--ima-mono); font-size: 9px; color: var(--ima-muted); letter-spacing: 0.08em; }
    #ima-close {
      background: transparent; border: 1px solid var(--ima-border);
      color: var(--ima-muted); font-size: 14px; cursor: pointer;
      width: 28px; height: 28px; border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      transition: all var(--ima-tr);
    }
    #ima-close:hover { border-color: var(--ima-accent); color: var(--ima-accent); }

    .ima-time-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--ima-border);
      border-radius: 7px;
      padding: 2px;
      flex-shrink: 0;
    }
    .ima-time-toggle-btn {
      background: transparent;
      border: none;
      color: var(--ima-muted);
      padding: 3px 10px;
      border-radius: 5px;
      font-size: 9px;
      font-family: var(--ima-mono);
      cursor: pointer;
      transition: all var(--ima-tr);
      white-space: nowrap;
    }
    .ima-time-toggle-btn.active {
      background: var(--ima-adim);
      color: var(--ima-accent);
    }
    .ima-time-toggle-btn:hover:not(.active) {
      color: var(--ima-text);
    }

    #ima-controls {
      background: rgba(255,255,255,0.015);
      border-bottom: 1px solid var(--ima-border);
      padding: 10px 14px;
      display: flex; flex-direction: column; gap: 7px;
      flex-shrink: 0;
    }
    .ima-ctrl-row { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
    #ima-controls label {
      font-family: var(--ima-mono); font-size: 9px; font-weight: 500;
      color: var(--ima-accent); text-transform: uppercase; letter-spacing: 0.1em;
      white-space: nowrap; flex-shrink: 0;
    }
    #ima-controls input[type="text"],
    #ima-controls input[type="date"],
    #ima-controls input[type="time"],
    #ima-controls input[type="number"] {
      background: rgba(255,255,255,0.04); border: 1px solid var(--ima-border);
      color: var(--ima-text); padding: 5px 9px; border-radius: 7px;
      font-size: 12px; font-family: var(--ima-body); outline: none;
      min-width: 0; transition: border-color var(--ima-tr);
    }
    #ima-controls input:focus { border-color: rgba(110,231,247,0.4); }
    #ima-controls input::placeholder { color: var(--ima-muted); }
    #ima-item-name  { flex: 1; min-width: 140px; max-width: 280px; }
    #ima-from, #ima-to { flex: 1; min-width: 100px; max-width: 140px; }
    #ima-time-from, #ima-time-to { width: 88px; flex-shrink: 0; }
    #ima-controls input[type="date"]::-webkit-calendar-picker-indicator,
    #ima-controls input[type="time"]::-webkit-calendar-picker-indicator {
      filter: invert(0.4) sepia(1) saturate(3) hue-rotate(160deg); cursor: pointer;
    }

    #ima-date-collapse {
      max-height: 0; overflow: hidden;
      transition: max-height 0.28s cubic-bezier(0.4,0,0.2,1), padding 0.28s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column; gap: 7px; padding: 0;
    }
    #ima-date-collapse.open { max-height: 120px; padding-top: 2px; }
    #ima-date-toggle { font-size: 10px; font-family: var(--ima-mono); letter-spacing: 0.05em; }

    #ima-status { font-family: var(--ima-mono); font-size: 10px; color: var(--ima-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #ima-status.err { color: var(--ima-error); }
    #ima-status.ok  { color: var(--ima-success); }

    #ima-time-display {
      font-family: var(--ima-mono);
      font-size: 9px;
      color: var(--ima-muted);
      background: rgba(110,231,247,0.05);
      border: 1px solid var(--ima-border);
      border-radius: 6px;
      padding: 4px 10px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    #ima-time-display .time-label { color: var(--ima-accent); font-weight: 600; }
    #ima-time-display .time-value { color: var(--ima-text); }

    #ima-ac-portal {
      position: fixed;
      background: #0f1019; border: 1px solid var(--ima-border);
      border-top: none; border-radius: 0 0 8px 8px;
      max-height: 200px; overflow-y: auto;
      z-index: 2147483647; display: none;
      box-shadow: 0 12px 32px rgba(0,0,0,0.6);
    }
    .ima-ac-item { padding: 7px 11px; font-size: 12px; color: var(--ima-text); cursor: pointer; font-family: var(--ima-body); display: flex; align-items: baseline; gap: 6px; }
    .ima-ac-item:hover, .ima-ac-item.active { background: var(--ima-hover); color: var(--ima-accent); }
    .ima-ac-id { font-family: var(--ima-mono); font-size: 10px; color: var(--ima-muted); }

    .ima-btn {
      background: var(--ima-accent); color: #07080f;
      border: none; padding: 0 13px; border-radius: 7px;
      font-size: 11px; font-weight: 600; font-family: var(--ima-sans);
      cursor: pointer; white-space: nowrap; height: 28px;
      transition: all var(--ima-tr); flex-shrink: 0;
    }
    .ima-btn:hover    { background: #93f0ff; }
    .ima-btn:disabled { opacity: .35; cursor: not-allowed; }
    .ima-btn.ghost { background: transparent; color: var(--ima-dim); border: 1px solid var(--ima-border); }
    .ima-btn.ghost:hover { background: var(--ima-hover); color: var(--ima-text); }
    .ima-btn.active-toggle { background: var(--ima-adim); color: var(--ima-accent); border: 1px solid rgba(110,231,247,0.3); }

    .ima-nav {
      background: transparent; border: 1px solid var(--ima-border);
      color: var(--ima-muted); width: 26px; height: 28px;
      border-radius: 7px; cursor: pointer; font-size: 14px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all var(--ima-tr); flex-shrink: 0;
    }
    .ima-nav:hover { border-color: rgba(110,231,247,0.35); color: var(--ima-accent); }

    .ima-tf-btn {
      background: transparent; border: 1px solid var(--ima-border); color: var(--ima-muted);
      padding: 3px 9px; border-radius: 6px; font-size: 11px; font-family: var(--ima-mono);
      cursor: pointer; white-space: nowrap; transition: all var(--ima-tr); flex-shrink: 0;
    }
    .ima-tf-btn:hover  { border-color: rgba(110,231,247,0.35); color: var(--ima-text); }
    .ima-tf-btn.active { background: var(--ima-adim); border-color: rgba(110,231,247,0.35); color: var(--ima-accent); }

    #ima-summary { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--ima-border); }
    .ima-tile {
      flex: 1; padding: 10px 14px 9px;
      border-right: 1px solid var(--ima-border); position: relative;
    }
    .ima-tile:last-child { border-right: none; }
    .ima-tile-lbl { font-family: var(--ima-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ima-muted); margin-bottom: 4px; }
    .ima-tile-val { font-family: var(--ima-mono); font-size: 14px; font-weight: 500; line-height: 1; }
    #ima-summary .ima-tile-val[data-raw] { cursor: pointer; }
    #ima-summary .ima-tile-val[data-raw]:hover { opacity: 0.75; }
    .ima-tile.blue  .ima-tile-val { color: var(--ima-accent); }
    .ima-tile.gold  .ima-tile-val { color: var(--ima-warn); }
    .ima-tile.green .ima-tile-val { color: var(--ima-success); }
    .ima-tile.red   .ima-tile-val { color: var(--ima-error); }

    #ima-tabs {
      display: flex; align-items: center; gap: 4px; padding: 8px 14px;
      border-bottom: 1px solid var(--ima-border); flex-shrink: 0;
    }
    .ima-tab {
      background: transparent; color: var(--ima-muted); border: 1px solid transparent;
      padding: 5px 14px; border-radius: 7px; font-size: 12px; font-family: var(--ima-sans);
      font-weight: 500; cursor: pointer; transition: all var(--ima-tr); white-space: nowrap;
    }
    .ima-tab:hover  { color: var(--ima-text); background: var(--ima-hover); border-color: var(--ima-border); }
    .ima-tab.active { background: var(--ima-adim); border-color: rgba(110,231,247,0.3); color: var(--ima-accent); }
    #ima-best-btn, #ima-calc-btn, #ima-reco-btn {
      margin-left: 4px; background: transparent; color: var(--ima-muted);
      border: 1px solid var(--ima-border); padding: 5px 12px; border-radius: 7px;
      font-size: 11px; font-family: var(--ima-sans); font-weight: 500;
      cursor: pointer; transition: all var(--ima-tr); white-space: nowrap;
    }
    #ima-best-btn:hover, #ima-calc-btn:hover, #ima-reco-btn:hover { color: var(--ima-text); border-color: rgba(110,231,247,0.3); }
    #ima-best-btn.active, #ima-calc-btn.active, #ima-reco-btn.active { background: var(--ima-adim); border-color: rgba(110,231,247,0.3); color: var(--ima-accent); }
    #ima-best-btn { margin-left: auto; }

    #ima-content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }

    #ima-chart-pane { display: flex; flex-direction: column; height: 100%; }
    #ima-chart-controls {
      display: flex; gap: 5px; padding: 8px 14px;
      border-bottom: 1px solid var(--ima-border); flex-shrink: 0; align-items: center;
    }
    .ima-ct-btn {
      background: transparent; border: 1px solid var(--ima-border); color: var(--ima-muted);
      padding: 4px 13px; border-radius: 6px; font-size: 11px; font-family: var(--ima-sans);
      cursor: pointer; transition: all var(--ima-tr); white-space: nowrap;
    }
    .ima-ct-btn:hover  { border-color: rgba(110,231,247,0.35); color: var(--ima-text); }
    .ima-ct-btn.active { background: var(--ima-adim); border-color: rgba(110,231,247,0.35); color: var(--ima-accent); }
    #ima-chart-area { flex: 1; min-height: 0; position: relative; padding: 10px 14px 12px; }
    #ima-price-chart { width: 100% !important; height: 100% !important; }
    #ima-chart-status {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 10px; color: var(--ima-muted);
      font-size: 13px; pointer-events: none;
    }
    #ima-chart-status.hidden { display: none; }
    .ima-click-hint { font-family: var(--ima-mono); font-size: 9px; color: var(--ima-muted); text-align: center; padding: 5px 14px; border-top: 1px solid var(--ima-border); flex-shrink: 0; letter-spacing: 0.05em; }

    #ima-table-pane { height: 100%; overflow-y: auto; overflow-x: auto; display: none; }
    #ima-panel table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #ima-panel thead th {
      background: rgba(255,255,255,0.02); color: var(--ima-muted); padding: 8px 12px;
      text-align: left; white-space: nowrap; position: sticky; top: 0; z-index: 2;
      cursor: pointer; user-select: none; font-family: var(--ima-mono); font-size: 9px;
      text-transform: uppercase; letter-spacing: 0.1em;
      border-bottom: 1px solid var(--ima-border); transition: color var(--ima-tr);
    }
    #ima-panel thead th:hover { color: var(--ima-text); }
    #ima-panel thead th.r     { text-align: right; }
    #ima-panel thead th::after { content: " ↕"; font-size: 8px; opacity: .25; }
    #ima-panel thead th.s-asc::after  { content: " ↑"; opacity: 1; color: var(--ima-accent); }
    #ima-panel thead th.s-desc::after { content: " ↓"; opacity: 1; color: var(--ima-accent); }
    #ima-panel tbody td { padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--ima-dim); white-space: nowrap; }
    #ima-panel tbody tr:hover td { background: var(--ima-hover); }
    #ima-panel td.r     { text-align: right; }
    #ima-panel td.mono  { font-family: var(--ima-mono); }
    #ima-panel td.acc   { text-align: right; font-family: var(--ima-mono); color: var(--ima-accent); }
    #ima-panel td.empty { text-align: center; color: var(--ima-muted); padding: 40px 0; font-size: 13px; }

    #ima-best-drawer, #ima-calc-drawer, #ima-reco-drawer {
      position: absolute; top: 0; bottom: 0;
      background: rgba(7,8,15,0.98); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border-left: 1px solid var(--ima-border);
      box-shadow: -8px 0 32px rgba(0,0,0,0.6);
      transition: right 0.28s cubic-bezier(.4,0,.2,1);
      z-index: 10; display: flex; flex-direction: column; overflow: hidden;
    }
    #ima-best-drawer { right: -380px; width: 360px; }
    #ima-calc-drawer { right: -320px; width: 300px; }
    #ima-reco-drawer { right: -360px; width: 340px; }
    #ima-best-drawer.visible, #ima-calc-drawer.visible, #ima-reco-drawer.visible { right: 0; }

    .ima-drawer-hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 13px 16px; border-bottom: 1px solid var(--ima-border); flex-shrink: 0;
      background: rgba(110,231,247,0.03);
    }
    .ima-drawer-title { font-family: var(--ima-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ima-accent); }
    .ima-drawer-close {
      background: transparent; border: 1px solid var(--ima-border); color: var(--ima-muted);
      font-size: 13px; cursor: pointer; width: 24px; height: 24px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; transition: all var(--ima-tr);
    }
    .ima-drawer-close:hover { border-color: var(--ima-accent); color: var(--ima-accent); }
    .ima-drawer-body { padding: 12px 14px; flex: 1; overflow-y: auto; }

    .ima-reco-section {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--ima-border);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .ima-reco-section-title {
      font-family: var(--ima-mono);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--ima-muted);
      margin-bottom: 10px;
    }
    .ima-reco-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      font-size: 13px;
    }
    .ima-reco-row:last-child { border-bottom: none; }
    .ima-reco-label {
      color: var(--ima-muted);
      font-size: 12px;
    }
    .ima-reco-value {
      font-family: var(--ima-mono);
      font-weight: 500;
      color: var(--ima-dim);
    }
    .ima-reco-value.buy { color: var(--ima-success); }
    .ima-reco-value.sell { color: var(--ima-accent); }
    .ima-reco-value.profit { color: var(--ima-success); }
    .ima-reco-value.loss { color: var(--ima-error); }
    .ima-reco-value.stop { color: var(--ima-error); }
    .ima-reco-value.hold { color: var(--ima-warn); }
    .ima-reco-badge {
      display: inline-block;
      padding: 3px 12px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      font-family: var(--ima-sans);
    }
    .ima-reco-badge.buy { background: rgba(74,222,128,0.15); color: var(--ima-success); }
    .ima-reco-badge.sell { background: rgba(110,231,247,0.15); color: var(--ima-accent); }
    .ima-reco-badge.hold { background: rgba(251,191,36,0.15); color: var(--ima-warn); }
    .ima-reco-badge.strong-buy { background: rgba(74,222,128,0.25); color: var(--ima-success); font-weight: 700; }
    #ima-reco-status {
      text-align: center;
      color: var(--ima-muted);
      padding: 30px 0;
      font-size: 13px;
    }

    .ima-best-fee-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .ima-best-fee-row label { font-family: var(--ima-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ima-accent); }
    .ima-best-fee { background: rgba(255,255,255,0.04); border: 1px solid var(--ima-border); color: var(--ima-text); padding: 4px 8px; border-radius: 7px; font-size: 12px; width: 58px; outline: none; font-family: var(--ima-body); }
    .ima-best-fee:focus { border-color: rgba(110,231,247,0.4); }

    .ima-best-hdr {
      display: grid; grid-template-columns: 1fr 70px 58px 44px;
      gap: 6px; padding: 5px 8px;
      font-family: var(--ima-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--ima-muted); border-bottom: 1px solid var(--ima-border); margin-bottom: 4px;
    }
    .ima-best-hdr span { cursor: pointer; user-select: none; transition: color var(--ima-tr); }
    .ima-best-hdr span:not(:first-child) { text-align: right; }
    .ima-best-hdr span:hover { color: var(--ima-text); }
    .ima-best-hdr span::after { content: " ↕"; font-size: 7px; opacity: .2; }
    .ima-best-hdr span.s-asc::after  { content: " ↑"; opacity: 1; color: var(--ima-accent); }
    .ima-best-hdr span.s-desc::after { content: " ↓"; opacity: 1; color: var(--ima-accent); }
    .ima-best-row {
      display: grid; grid-template-columns: 1fr 70px 58px 44px;
      gap: 6px; padding: 7px 8px; border-radius: 8px; cursor: pointer;
      transition: background var(--ima-tr); border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center;
    }
    .ima-best-row:hover { background: var(--ima-hover); }
    .ima-best-name  { font-size: 12px; color: var(--ima-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ima-best-val   { font-family: var(--ima-mono); font-size: 11px; text-align: right; }
    .ima-best-profit { color: var(--ima-success); }
    .ima-best-margin { color: var(--ima-accent); background: var(--ima-adim); border-radius: 4px; padding: 1px 5px; }
    .ima-best-margin.mid  { color: var(--ima-warn);    background: rgba(251,191,36,0.12); }
    .ima-best-margin.high { color: var(--ima-success); background: rgba(74,222,128,0.12); }
    .ima-best-conf  { border-radius: 4px; padding: 1px 4px; }
    .ima-best-conf.lo { color: var(--ima-error);   background: rgba(248,113,113,0.12); }
    .ima-best-conf.md { color: var(--ima-warn);    background: rgba(251,191,36,0.12); }
    .ima-best-conf.hi { color: var(--ima-success); background: rgba(74,222,128,0.12); }
    #ima-best-status { text-align: center; color: var(--ima-muted); padding: 40px 0; font-size: 13px; }

    .ima-calc-grp { margin-bottom: 14px; }
    .ima-calc-lbl { font-family: var(--ima-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ima-muted); margin-bottom: 5px; }
    .ima-calc-inp {
      background: rgba(255,255,255,0.04); border: 1px solid var(--ima-border); color: var(--ima-text);
      padding: 8px 11px; border-radius: 8px; font-size: 13px; font-family: var(--ima-body);
      outline: none; width: 100%; box-sizing: border-box; transition: border-color var(--ima-tr);
    }
    .ima-calc-inp:focus { border-color: rgba(110,231,247,0.4); }
    .ima-calc-results { background: rgba(255,255,255,0.02); border: 1px solid var(--ima-border); border-radius: 10px; padding: 12px; margin-top: 14px; }
    .ima-calc-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
    .ima-calc-row:last-child { border-bottom: none; }
    .ima-calc-row-lbl { color: var(--ima-muted); font-size: 12px; }
    .ima-calc-row-val { font-family: var(--ima-mono); font-weight: 500; color: var(--ima-dim); }
    .ima-calc-row-val.pos { color: var(--ima-success); }
    .ima-calc-row-val.neg { color: var(--ima-error); }
    .ima-calc-hint  { font-size: 11px; color: var(--ima-muted); margin-top: 12px; }
    .ima-calc-state { font-family: var(--ima-mono); font-size: 10px; color: var(--ima-accent); margin-top: 8px; text-align: center; min-height: 16px; }

    .ima-spin { width: 26px; height: 26px; border: 2px solid var(--ima-border); border-top-color: var(--ima-accent); border-radius: 50%; animation: ima-spin 0.7s linear infinite; }
    @keyframes ima-spin { to { transform: rotate(360deg); } }

    #ima-panel ::-webkit-scrollbar { width: 4px; height: 4px; }
    #ima-panel ::-webkit-scrollbar-track { background: transparent; }
    #ima-panel ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
    #ima-ac-portal ::-webkit-scrollbar { width: 4px; }
    #ima-ac-portal ::-webkit-scrollbar-thumb { background: var(--ima-border); border-radius: 3px; }

    .ima-desk-only { }
    .ima-mob-only, .ima-tct-badge, .ima-mob-auto-btn,
    .ima-mob-section-lbl, .ima-mob-date-range-lbl, .ima-mob-dt-hdr { display: none; }
    .ima-spacer-desk { flex: 1; }
    .ima-date-field-group { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
    .ima-date-field { display: flex; align-items: center; gap: 6px; flex: 1; }
    .ima-field-lbl {
      font-family: var(--ima-mono); font-size: 9px; font-weight: 500;
      color: var(--ima-accent); text-transform: uppercase; letter-spacing: 0.1em;
      white-space: nowrap; flex-shrink: 0;
    }
    .ima-date-reset-row { display: flex; justify-content: flex-end; padding-top: 2px; }

    @media (max-width: 600px) {
      #ima-panel { width: 100vw; }
      .ima-best-hdr, .ima-best-row { grid-template-columns: 1fr 62px 50px; }
      .ima-desk-only { display: none !important; }
      .ima-mob-only  { display: flex   !important; }
      .ima-spacer-desk { display: none !important; }
      #ima-hdr-sub { display: none; }
      #ima-status { flex: 0; max-width: 30%; font-size: 9px; }
      #ima-hdr { padding: 10px 14px; gap: 8px; }
      #ima-hdr h2 { font-size: 13px; }
      .ima-tct-badge {
        display: inline-flex; align-items: center; justify-content: center;
        font-family: var(--ima-mono); font-size: 9px; font-weight: 600;
        color: var(--ima-accent); background: var(--ima-adim);
        border: 1px solid rgba(110,231,247,0.25);
        padding: 3px 7px; border-radius: 5px; letter-spacing: 0.08em;
        white-space: nowrap; flex-shrink: 0;
      }
      .ima-mob-auto-btn {
        display: inline-flex !important; align-items: center;
        font-size: 10px !important; height: 26px !important;
        padding: 0 8px !important; white-space: nowrap !important;
        flex-shrink: 0;
      }
      #ima-controls { padding: 0; gap: 0; }
      .ima-mob-section-lbl {
        display: block;
        font-family: var(--ima-mono); font-size: 9px; font-weight: 600;
        color: var(--ima-accent); text-transform: uppercase; letter-spacing: 0.12em;
        padding: 12px 14px 5px;
      }
      #ima-item-ctrl-row { padding: 0 14px 8px; }
      #ima-item-name { max-width: 100% !important; }
      #ima-nav-row { padding: 0 14px 12px; gap: 8px; }
      #ima-apply {
        flex: 1 !important; padding: 0 !important;
        height: 36px !important; font-size: 13px !important;
      }
      #ima-nav-row .ima-nav { width: 36px !important; height: 36px !important; font-size: 16px !important; }
      .ima-mob-dt-hdr {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; cursor: pointer; user-select: none;
        border-top: 1px solid var(--ima-border);
        background: rgba(255,255,255,0.01);
      }
      .ima-mob-dt-hdr-left {
        font-family: var(--ima-mono); font-size: 10px; font-weight: 600;
        color: var(--ima-accent); text-transform: uppercase; letter-spacing: 0.12em;
      }
      .ima-mob-dt-arrow { font-size: 10px; color: var(--ima-accent); transition: transform var(--ima-tr); }
      #ima-date-collapse { padding: 0; }
      #ima-date-collapse.open { max-height: 440px; padding: 12px 14px 14px; }
      .ima-mob-date-range-lbl {
        display: block;
        font-family: var(--ima-mono); font-size: 9px; font-weight: 600;
        color: var(--ima-muted); text-transform: uppercase; letter-spacing: 0.1em;
        margin-bottom: 10px;
      }
      .ima-date-field-group { flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 10px; }
      .ima-date-field { flex-direction: column; align-items: stretch; gap: 4px; }
      #ima-from, #ima-to, #ima-time-from, #ima-time-to {
        min-width: 0 !important; max-width: 100% !important; width: 100% !important;
        flex-shrink: 1 !important; box-sizing: border-box;
      }
      .ima-date-reset-row { justify-content: center; margin-top: 4px; }
      #ima-reset { padding: 0 20px; }
    }
  `);

  // ── Build UI ───────────────────────────────────────────────────────────────
  function buildUI() {
    const today = getDateInput();
    const now = getDisplayTime();

    const toggle = el('div', { id: 'ima-toggle', title: 'Item Market Analyzer' }, '>_ Market');
    toggle.addEventListener('click', togglePanel);

    const panel = el('div', { id: 'ima-panel' });
    panel.innerHTML = `
      <div id="ima-hdr">
        <span id="ima-hdr-icon">&gt;_</span>
        <div style="flex:1;min-width:0">
          <h2>Torn Item Tracker</h2>
          <div id="ima-hdr-sub">torn-imarket-tracker.gvsantiago.com</div>
        </div>
        <span id="ima-time-display" class="ima-desk-only">
          <span class="time-label">${useTCT ? 'TCT' : 'Local'}</span>
          <span class="time-value">${formatDisplayDateTime(now)}</span>
        </span>
        <span class="ima-tct-badge ima-mob-only">${useTCT ? 'TCT' : 'Local'}</span>
        <div class="ima-time-toggle" id="ima-hdr-tz-toggle">
          <button class="ima-time-toggle-btn ${useTCT ? 'active' : ''}" data-tz="tct">TCT</button>
          <button class="ima-time-toggle-btn ${!useTCT ? 'active' : ''}" data-tz="local">Local</button>
        </div>
        <button class="ima-btn ghost ima-mob-auto-btn" id="ima-auto-btn-mob">Auto-Refresh: Off</button>
        <button id="ima-close" title="Close">&#x2715;</button>
      </div>

      <div id="ima-controls">
        <div class="ima-mob-section-lbl">Item</div>
        <div class="ima-ctrl-row" id="ima-item-ctrl-row">
          <label class="ima-desk-only">Item</label>
          <input id="ima-item-name" type="text" placeholder="Search item name…" autocomplete="off">
          <span id="ima-status"></span>
        </div>
        <div class="ima-ctrl-row" id="ima-nav-row">
          <button class="ima-btn ghost ima-desk-only" id="ima-date-toggle">&#x2699; Date / Time</button>
          <div class="ima-spacer-desk"></div>
          <button class="ima-nav" id="ima-prev" title="Previous day">&#x2039;</button>
          <button class="ima-btn" id="ima-apply" style="flex:0;padding:0 16px">Apply</button>
          <button class="ima-nav" id="ima-next" title="Next day">&#x203A;</button>
        </div>
        <div class="ima-mob-dt-hdr" id="ima-date-toggle-mob">
          <span class="ima-mob-dt-hdr-left">&#x25C8; DATE / TIME</span>
          <span class="ima-mob-dt-arrow">&#x25BC;</span>
        </div>
        <div id="ima-date-collapse">
          <div class="ima-mob-date-range-lbl">Date Range (${useTCT ? 'TCT' : 'Local'})</div>
          <div class="ima-date-field-group">
            <div class="ima-date-field">
              <label class="ima-field-lbl">From</label>
              <input id="ima-from" type="date" value="${today}">
            </div>
            <div class="ima-date-field">
              <label class="ima-field-lbl">To</label>
              <input id="ima-to" type="date" value="${today}">
            </div>
          </div>
          <div class="ima-date-field-group">
            <div class="ima-date-field">
              <label class="ima-field-lbl">Start Time</label>
              <input id="ima-time-from" type="time" value="00:00">
            </div>
            <div class="ima-date-field">
              <label class="ima-field-lbl">End Time</label>
              <input id="ima-time-to" type="time" value="23:59">
            </div>
          </div>
          <div class="ima-date-reset-row" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap">
            <button class="ima-btn ghost" id="ima-reset">Reset</button>
          </div>
        </div>
        <div class="ima-ctrl-row">
          <label>TF</label>
          <button class="ima-tf-btn" data-tf="day">1D</button>
          <button class="ima-tf-btn" data-tf="1h">1H</button>
          <button class="ima-tf-btn" data-tf="30m">30M</button>
          <button class="ima-tf-btn" data-tf="15m">15M</button>
          <button class="ima-tf-btn active" data-tf="5m">5M</button>
          <button class="ima-tf-btn" data-tf="1m">1M</button>
          <div style="flex:1"></div>
          <button class="ima-btn ghost" id="ima-auto-btn">&#x21BB; Auto</button>
        </div>
      </div>

      <div id="ima-summary">
        <div class="ima-tile gold">
          <div class="ima-tile-lbl">Avg Price</div>
          <div class="ima-tile-val" id="ima-s-avg">—</div>
        </div>
        <div class="ima-tile green">
          <div class="ima-tile-lbl">Min</div>
          <div class="ima-tile-val" id="ima-s-min">—</div>
        </div>
        <div class="ima-tile red">
          <div class="ima-tile-lbl">Max</div>
          <div class="ima-tile-val" id="ima-s-max">—</div>
        </div>
        <div class="ima-tile green">
          <div class="ima-tile-lbl">Rec Buy</div>
          <div class="ima-tile-val" id="ima-s-buy">—</div>
        </div>
        <div class="ima-tile blue">
          <div class="ima-tile-lbl">Rec Sell</div>
          <div class="ima-tile-val" id="ima-s-sell">—</div>
        </div>
      </div>

      <div id="ima-tabs">
        <button class="ima-tab active" data-tab="chart">Chart</button>
        <button class="ima-tab" data-tab="table">Table</button>
        <button id="ima-reco-btn">&#x1F4C8; Auto</button>
        <button id="ima-best-btn">Best Items</button>
        <button id="ima-calc-btn">Calculator</button>
      </div>

      <div id="ima-content">
        <div id="ima-chart-pane">
          <div id="ima-chart-controls">
            <button class="ima-ct-btn active" data-ct="line">Line</button>
            <button class="ima-ct-btn" data-ct="bar">Bar</button>
            <button class="ima-ct-btn" data-ct="scatter">Scatter</button>
          </div>
          <div id="ima-chart-area">
            <canvas id="ima-price-chart"></canvas>
            <div id="ima-chart-status">
              <span>Search for an item above and click Apply</span>
            </div>
          </div>
          <div class="ima-click-hint" id="ima-click-hint" style="display:none">
            Click once → set Buy price &nbsp;·&nbsp; Click again → set Sell price &nbsp;·&nbsp; 3rd click resets
          </div>
        </div>

        <div id="ima-table-pane">
          <table>
            <thead>
              <tr>
                <th>Date (${useTCT ? 'TCT' : 'Local'})</th>
                <th>Name</th>
                <th class="r">Avg Price</th>
                <th class="r">Price</th>
                <th class="r">Qty</th>
              </tr>
            </thead>
            <tbody id="ima-tbody">
              <tr><td colspan="5" class="empty">No data loaded.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recommendation Drawer -->
      <div id="ima-reco-drawer">
        <div class="ima-drawer-hdr">
          <span class="ima-drawer-title">&#x1F4C8; Auto Buy/Sell Recommendation</span>
          <button class="ima-drawer-close" id="ima-reco-close">&#x2715;</button>
        </div>
        <div class="ima-drawer-body" id="ima-reco-body">
          <div id="ima-reco-status">Load item data to see recommendations.</div>
        </div>
      </div>

      <!-- Best Items Drawer -->
      <div id="ima-best-drawer">
        <div class="ima-drawer-hdr">
          <span class="ima-drawer-title">Best Items to Buy</span>
          <button class="ima-drawer-close" id="ima-best-close">&#x2715;</button>
        </div>
        <div class="ima-drawer-body">
          <div class="ima-best-fee-row">
            <label>Fee %</label>
            <input type="number" class="ima-best-fee" id="ima-best-fee" value="5" min="0" max="100" step="0.1">
            <button class="ima-btn" id="ima-best-reload" style="font-size:10px;height:26px;padding:0 10px">Reload</button>
          </div>
          <div class="ima-best-hdr" id="ima-best-hdr">
            <span data-col="name">Item</span>
            <span data-col="net_profit" class="s-desc">Profit</span>
            <span data-col="margin_pct">Margin</span>
            <span data-col="confidence_pct">Conf</span>
          </div>
          <div id="ima-best-list">
            <div id="ima-best-status">Click Best Items to load.</div>
          </div>
        </div>
      </div>

      <!-- Calculator Drawer -->
      <div id="ima-calc-drawer">
        <div class="ima-drawer-hdr">
          <span class="ima-drawer-title">Profit Calculator</span>
          <button class="ima-drawer-close" id="ima-calc-close">&#x2715;</button>
        </div>
        <div class="ima-drawer-body">
          <div class="ima-calc-grp">
            <div class="ima-calc-lbl">Buy Price ($)</div>
            <input class="ima-calc-inp" id="ima-c-buy" type="number" min="0" placeholder="0" step="any">
          </div>
          <div class="ima-calc-grp">
            <div class="ima-calc-lbl">Transaction Fee (%)</div>
            <input class="ima-calc-inp" id="ima-c-fee" type="number" min="0" max="100" value="5" step="0.1">
          </div>
          <div class="ima-calc-grp">
            <div class="ima-calc-lbl">Target Sell Price ($)</div>
            <input class="ima-calc-inp" id="ima-c-sell" type="number" min="0" placeholder="0" step="any">
          </div>
          <div class="ima-calc-results">
            <div class="ima-calc-row">
              <span class="ima-calc-row-lbl">Fee Amount</span>
              <span class="ima-calc-row-val" id="ima-c-r-fee">$0.00</span>
            </div>
            <div class="ima-calc-row">
              <span class="ima-calc-row-lbl">Total Cost</span>
              <span class="ima-calc-row-val" id="ima-c-r-cost">$0.00</span>
            </div>
            <div class="ima-calc-row">
              <span class="ima-calc-row-lbl">Profit</span>
              <span class="ima-calc-row-val" id="ima-c-r-profit">$0.00</span>
            </div>
            <div class="ima-calc-row">
              <span class="ima-calc-row-lbl">Margin</span>
              <span class="ima-calc-row-val" id="ima-c-r-pct">0.00%</span>
            </div>
          </div>
          <div class="ima-calc-hint">Click a chart point to fill Buy, click another to fill Sell.</div>
          <div class="ima-calc-state" id="ima-calc-state"></div>
          <div style="margin-top:16px">
            <button class="ima-btn ghost" id="ima-c-reset" style="width:100%;justify-content:center">Reset</button>
          </div>
          <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--ima-border)">
            <span style="font-family:var(--ima-mono);font-size:9px;color:var(--ima-muted);text-transform:uppercase;letter-spacing:0.1em">Auto-open on fill</span>
            <button id="ima-calc-auto-open" class="ima-btn ghost active-toggle" style="height:24px;padding:0 10px;font-size:10px">On</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    // Wire events
    panel.querySelector('#ima-close')       .addEventListener('click', togglePanel);
    panel.querySelector('#ima-apply')       .addEventListener('click', fetchData);
    panel.querySelector('#ima-reset')       .addEventListener('click', resetFilters);
    panel.querySelector('#ima-prev')        .addEventListener('click', () => shiftDate(-1));
    panel.querySelector('#ima-next')        .addEventListener('click', () => shiftDate(1));
    panel.querySelector('#ima-auto-btn')    .addEventListener('click', toggleAutoRefresh);
    panel.querySelector('#ima-date-toggle').addEventListener('click', function () {
      const body = document.getElementById('ima-date-collapse');
      const open = body.classList.toggle('open');
      this.classList.toggle('active-toggle', open);
    });
    panel.querySelector('#ima-date-toggle-mob').addEventListener('click', function () {
      const body  = document.getElementById('ima-date-collapse');
      const open  = body.classList.toggle('open');
      const arrow = this.querySelector('.ima-mob-dt-arrow');
      arrow.textContent = open ? '▲' : '▼';
    });
    panel.querySelector('#ima-auto-btn-mob').addEventListener('click', toggleAutoRefresh);
    panel.querySelector('#ima-c-reset')     .addEventListener('click', resetCalculator);
    panel.querySelector('#ima-calc-auto-open').addEventListener('click', function () {
      calcAutoOpen = !calcAutoOpen;
      this.textContent = calcAutoOpen ? 'On' : 'Off';
      this.classList.toggle('active-toggle', calcAutoOpen);
    });
    panel.querySelector('#ima-reco-btn')    .addEventListener('click', toggleRecoDrawer);
    panel.querySelector('#ima-reco-close')  .addEventListener('click', toggleRecoDrawer);
    panel.querySelector('#ima-best-btn')    .addEventListener('click', toggleBestDrawer);
    panel.querySelector('#ima-best-close')  .addEventListener('click', toggleBestDrawer);
    panel.querySelector('#ima-calc-btn')    .addEventListener('click', toggleCalcDrawer);
    panel.querySelector('#ima-calc-close')  .addEventListener('click', toggleCalcDrawer);
    panel.querySelector('#ima-best-reload') .addEventListener('click', () => fetchBestItems(true));
    panel.querySelectorAll('#ima-summary .ima-tile-val').forEach(el => {
      el.addEventListener('click', function () {
        const raw = this.dataset.raw;
        if (!raw) return;
        const isFull = this.dataset.full === '1';
        this.dataset.full = isFull ? '0' : '1';
        this.textContent = isFull ? fmt$(Number(raw)) : ('$' + fmtFull(Number(raw)));
      });
    });

    panel.querySelector('#ima-best-hdr').addEventListener('click', e => {
      const span = e.target.closest('[data-col]');
      if (!span) return;
      const col = span.dataset.col;
      bestSort.dir = (bestSort.col === col && bestSort.dir === 'asc') ? 'desc' : 'asc';
      bestSort.col = col;
      document.querySelectorAll('#ima-best-hdr span').forEach(s => s.classList.remove('s-asc', 's-desc'));
      span.classList.add(bestSort.dir === 'asc' ? 's-asc' : 's-desc');
      if (bestData.length) renderBestItems();
    });
    
    // Timezone toggle
    panel.querySelectorAll('.ima-time-toggle-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const tz = this.dataset.tz;
        useTCT = (tz === 'tct');
        document.querySelectorAll('.ima-time-toggle-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        updateTimeDisplay();
        updateDateInputs();
        updateTableHeaders();
        if (tableData.length) renderTable();
        if (rawData.length) renderChart(rawData);
        if (document.getElementById('ima-reco-drawer').classList.contains('visible')) {
          generateRecommendation();
        }
      });
    });

    panel.querySelectorAll('.ima-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        panel.querySelectorAll('.ima-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showTab(activeTab);
        if (activeTab === 'chart' && priceChart) priceChart.resize();
      });
    });

    panel.querySelectorAll('.ima-tf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.ima-tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTF = btn.dataset.tf;
        if (rawData.length) renderChart(rawData);
      });
    });

    panel.querySelectorAll('.ima-ct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.ima-ct-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentChartType = btn.dataset.ct;
        if (rawData.length) renderChart(rawData);
      });
    });

    panel.querySelectorAll('#ima-table-pane thead th').forEach((th, i) => {
      th.addEventListener('click', () => sortTable(i));
    });

    initCalculator();
    initAutocomplete();
    setInterval(updateTimeDisplay, 60000);
  }

  // ── Helper Functions ──────────────────────────────────────────────────────
  function updateTimeDisplay() {
    const display = document.getElementById('ima-time-display');
    if (display) {
      const now = getDisplayTime();
      display.innerHTML = `
        <span class="time-label">${useTCT ? 'TCT' : 'Local'}</span>
        <span class="time-value">${formatDisplayDateTime(now)}</span>
      `;
    }
  }

  function updateDateInputs() {
    const today = getDateInput();
    document.getElementById('ima-from').value = today;
    document.getElementById('ima-to').value = today;
    const label = document.querySelector('.ima-mob-date-range-lbl');
    if (label) {
      label.textContent = `Date Range (${useTCT ? 'TCT' : 'Local'})`;
    }
  }

  function updateTableHeaders() {
    const headers = document.querySelectorAll('#ima-table-pane thead th');
    if (headers.length) {
      headers[0].textContent = `Date (${useTCT ? 'TCT' : 'Local'})`;
    }
  }

  let activeTab = 'chart';
  function showTab(tab) {
    document.getElementById('ima-chart-pane').style.display = tab === 'chart' ? 'flex' : 'none';
    document.getElementById('ima-table-pane').style.display = tab === 'table' ? 'block' : 'none';
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    document.getElementById('ima-panel') .classList.toggle('open', panelOpen);
    document.getElementById('ima-toggle').classList.toggle('open', panelOpen);
  }

  function toggleRecoDrawer() {
    const d = document.getElementById('ima-reco-drawer');
    const b = document.getElementById('ima-reco-btn');
    const v = d.classList.toggle('visible');
    b.classList.toggle('active', v);
    if (v) {
      document.getElementById('ima-best-drawer').classList.remove('visible');
      document.getElementById('ima-best-btn').classList.remove('active');
      document.getElementById('ima-calc-drawer').classList.remove('visible');
      document.getElementById('ima-calc-btn').classList.remove('active');
      generateRecommendation();
    }
  }

  function toggleBestDrawer() {
    const d = document.getElementById('ima-best-drawer');
    const b = document.getElementById('ima-best-btn');
    const v = d.classList.toggle('visible');
    b.classList.toggle('active', v);
    if (v) {
      document.getElementById('ima-reco-drawer').classList.remove('visible');
      document.getElementById('ima-reco-btn').classList.remove('active');
      document.getElementById('ima-calc-drawer').classList.remove('visible');
      document.getElementById('ima-calc-btn').classList.remove('active');
      fetchBestItems(false);
    }
  }

  function toggleCalcDrawer() {
    const d = document.getElementById('ima-calc-drawer');
    const b = document.getElementById('ima-calc-btn');
    const v = d.classList.toggle('visible');
    b.classList.toggle('active', v);
    if (v) {
      document.getElementById('ima-reco-drawer').classList.remove('visible');
      document.getElementById('ima-reco-btn').classList.remove('active');
      document.getElementById('ima-best-drawer').classList.remove('visible');
      document.getElementById('ima-best-btn').classList.remove('active');
    }
  }

  // ── Recommendation Logic ─────────────────────────────────────────────────
  function generateRecommendation() {
    const body = document.getElementById('ima-reco-body');
    if (!rawData.length) {
      body.innerHTML = '<div id="ima-reco-status">Load item data first (search & Apply).</div>';
      return;
    }

    const priceData = rawData.map(d => ({
      price: Number(d.price),
      quantity: Number(d.quantity) || 1,
      avgPrice: Number(d.average_price)
    })).filter(d => d.price > 0);

    if (!priceData.length) {
      body.innerHTML = '<div id="ima-reco-status">No valid price data available.</div>';
      return;
    }

    const prices = priceData.map(d => d.price);
    const quantities = priceData.map(d => d.quantity);
    const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;

    const weightedPrices = priceData.map(d => ({
      price: d.price,
      quantity: d.quantity,
      weightedPrice: d.price * d.quantity
    }));

    const totalQuantity = quantities.reduce((s, q) => s + q, 0);
    const weightedAvg = totalQuantity > 0 
      ? weightedPrices.reduce((s, d) => s + d.weightedPrice, 0) / totalQuantity 
      : avgPrice;

    const sorted = [...prices].sort((a, b) => a - b);
    const minPrice = sorted[0];
    const maxPrice = sorted[sorted.length - 1];

    const lowThreshold = sorted[Math.floor(sorted.length * 0.3)];
    const highThreshold = sorted[Math.floor(sorted.length * 0.7)];

    const lowPriceData  = priceData.filter(d => d.price <= lowThreshold);
    const highPriceData = priceData.filter(d => d.price >= highThreshold);

    const { buyPrice, sellPrice } = calcBuySell(rawData);
    const supportLevel = Math.min(...lowPriceData.map(d => d.price));
    const resistanceLevel = Math.max(...highPriceData.map(d => d.price));

    const buyData = lowPriceData.filter(d => d.price === buyPrice);
    const sellData = highPriceData.filter(d => d.price === sellPrice);
    
    const buyQuantity = buyData.reduce((s, d) => s + d.quantity, 0);
    const sellQuantity = sellData.reduce((s, d) => s + d.quantity, 0);
    const totalBuyQty = lowPriceData.reduce((s, d) => s + d.quantity, 0);
    const totalSellQty = highPriceData.reduce((s, d) => s + d.quantity, 0);

    const feePercent = 5;
    const feeAmount = sellPrice * (feePercent / 100);
    const totalCost = buyPrice + feeAmount;
    const profitPerUnit = sellPrice - totalCost;
    const profitPerItem = profitPerUnit * Math.min(buyQuantity, sellQuantity);
    const marginPercent = totalCost > 0 ? (profitPerUnit / totalCost) * 100 : 0;

    let recommendation = 'HOLD';
    let recClass = 'hold';
    let recReason = '';

    const minQuantity = 10;
    const availableQty = Math.min(buyQuantity, sellQuantity);

    if (marginPercent > 10 && availableQty >= minQuantity) {
      recommendation = 'STRONG BUY';
      recClass = 'strong-buy';
      recReason = `High margin (${marginPercent.toFixed(2)}%) with ${availableQty} units available`;
    } else if (marginPercent > 3 && availableQty >= minQuantity) {
      recommendation = 'BUY';
      recClass = 'buy';
      recReason = `Good margin (${marginPercent.toFixed(2)}%) with ${availableQty} units available`;
    } else if (marginPercent > 0 && availableQty >= minQuantity) {
      recommendation = 'HOLD';
      recClass = 'hold';
      recReason = `Low margin (${marginPercent.toFixed(2)}%) - wait for better entry`;
    } else if (availableQty < minQuantity) {
      recommendation = 'HOLD';
      recClass = 'hold';
      recReason = `Limited quantity (${availableQty} units) - insufficient for profitable trade`;
    }

    body.innerHTML = `
      <div class="ima-reco-section">
        <div class="ima-reco-section-title">📊 Price & Quantity Analysis</div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Support Zone (Buy)</span>
          <span class="ima-reco-value buy">$${fmtFull(supportLevel)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Resistance Zone (Sell)</span>
          <span class="ima-reco-value sell">$${fmtFull(resistanceLevel)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Avg Price (Weighted)</span>
          <span class="ima-reco-value">$${fmtFull(weightedAvg)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Most Frequent Low (Qty Weighted)</span>
          <span class="ima-reco-value buy">$${fmtFull(buyPrice)} <span style="font-size:10px;color:var(--ima-muted)">(${buyQuantity} units)</span></span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Most Frequent High (Qty Weighted)</span>
          <span class="ima-reco-value sell">$${fmtFull(sellPrice)} <span style="font-size:10px;color:var(--ima-muted)">(${sellQuantity} units)</span></span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Total Buy Volume</span>
          <span class="ima-reco-value">${totalBuyQty.toLocaleString()} units</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Total Sell Volume</span>
          <span class="ima-reco-value">${totalSellQty.toLocaleString()} units</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Available Trade Qty</span>
          <span class="ima-reco-value ${availableQty >= minQuantity ? 'profit' : 'loss'}">${availableQty.toLocaleString()} units</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Data Points</span>
          <span class="ima-reco-value">${prices.length.toLocaleString()}</span>
        </div>
      </div>

      <div class="ima-reco-section">
        <div class="ima-reco-section-title">💰 Profit Calculation (${availableQty} units)</div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Buy Price</span>
          <span class="ima-reco-value buy">$${fmtFull(buyPrice)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Sell Price</span>
          <span class="ima-reco-value sell">$${fmtFull(sellPrice)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Fee (${feePercent}%)</span>
          <span class="ima-reco-value">$${fmtFull(feeAmount)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Total Cost Per Unit</span>
          <span class="ima-reco-value">$${fmtFull(totalCost)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Profit Per Unit</span>
          <span class="ima-reco-value ${profitPerUnit > 0 ? 'profit' : 'loss'}">$${fmtFull(profitPerUnit)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Total Profit</span>
          <span class="ima-reco-value ${profitPerItem > 0 ? 'profit' : 'loss'}">$${fmtFull(profitPerItem)}</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Profit Margin</span>
          <span class="ima-reco-value ${marginPercent > 0 ? 'profit' : 'loss'}">${marginPercent.toFixed(2)}%</span>
        </div>
        <div class="ima-reco-row">
          <span class="ima-reco-label">Stop Loss</span>
          <span class="ima-reco-value stop">$${fmtFull(buyPrice - (sellPrice - buyPrice) * 0.3)}</span>
        </div>
      </div>

      <div class="ima-reco-section" style="text-align:center;padding:20px">
        <div class="ima-reco-section-title">📌 Recommendation</div>
        <div class="ima-reco-badge ${recClass}" style="font-size:18px;padding:8px 24px">
          ${recommendation} ${recommendation === 'STRONG BUY' || recommendation === 'BUY' ? '✅' : '⏳'}
        </div>
        ${recReason ? `
          <div style="margin-top:12px;font-size:12px;color:var(--ima-muted)">
            ${recReason}
          </div>
        ` : ''}
        ${recommendation === 'STRONG BUY' || recommendation === 'BUY' ? `
          <div style="margin-top:12px;font-size:12px;color:var(--ima-muted)">
            Target entry: $${fmtFull(buyPrice)} &bull; Target exit: $${fmtFull(sellPrice)} &bull; ${availableQty} units
          </div>
        ` : `
          <div style="margin-top:12px;font-size:12px;color:var(--ima-muted)">
            ${availableQty < minQuantity ? 'Not enough volume for profitable trade.' : 'Margin too low. Consider waiting for better entry.'}
          </div>
        `}
      </div>
    `;
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────
  function initAutocomplete() {
    const portal = el('div', { id: 'ima-ac-portal' });
    document.body.appendChild(portal);
    const input  = document.getElementById('ima-item-name');
    let acFocus  = -1, acTimer;

    function positionPortal() {
      const r = input.getBoundingClientRect();
      portal.style.top   = r.bottom + 'px';
      portal.style.left  = r.left   + 'px';
      portal.style.width = r.width  + 'px';
    }

    function showAC(items) {
      if (!items.length) { closeAC(); return; }
      acFocus = -1;
      portal.innerHTML = items.map(item =>
        `<div class="ima-ac-item" data-id="${item.item_id}" data-name="${esc(item.name)}">
          ${esc(item.name)}<span class="ima-ac-id">#${item.item_id}</span>
        </div>`
      ).join('');
      portal.style.display = 'block';
      positionPortal();
      portal.querySelectorAll('.ima-ac-item').forEach(row => {
        row.addEventListener('mousedown', e => { e.preventDefault(); selectItem(row.dataset.id, row.dataset.name); });
      });
    }

    function closeAC() { portal.style.display = 'none'; portal.innerHTML = ''; acFocus = -1; }

    function selectItem(id, name) {
      currentItemId = parseInt(id);
      input.value   = name;
      closeAC();
      setStatus(`#${id} selected`, 'ok');
    }

    function updateACFocus(items) {
      items.forEach((item, i) => item.classList.toggle('active', i === acFocus));
      if (acFocus >= 0) items[acFocus].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', () => {
      clearTimeout(acTimer);
      const q = input.value.trim();
      if (!q) { currentItemId = null; closeAC(); return; }
      currentItemId = null;
      acTimer = setTimeout(async () => {
        try { showAC(await apiFetch(`/api/search?q=${encodeURIComponent(q)}`)); } catch { closeAC(); }
      }, 260);
    });

    input.addEventListener('keydown', e => {
      const items = portal.querySelectorAll('.ima-ac-item');
      if (!items.length) return;
      if      (e.key === 'ArrowDown')  { acFocus = Math.min(acFocus + 1, items.length - 1); updateACFocus(items); e.preventDefault(); }
      else if (e.key === 'ArrowUp')    { acFocus = Math.max(acFocus - 1, 0);                updateACFocus(items); e.preventDefault(); }
      else if (e.key === 'Enter' && acFocus >= 0) { const r = items[acFocus]; selectItem(r.dataset.id, r.dataset.name); e.preventDefault(); }
      else if (e.key === 'Escape') closeAC();
    });

    input.addEventListener('blur', () => setTimeout(closeAC, 200));
    document.addEventListener('click', e => {
      if (!e.target.closest('#ima-item-name') && !e.target.closest('#ima-ac-portal')) closeAC();
    });
    window.addEventListener('resize', () => { if (portal.style.display !== 'none') positionPortal(); });
  }

  // ── API ───────────────────────────────────────────────────────────────────
  function apiFetch(path) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: BASE_URL + path, timeout: 20000,
        onload:    r => { try { resolve(JSON.parse(r.responseText)); } catch(e) { reject(new Error('Invalid JSON')); } },
        onerror:   () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out')),
      });
    });
  }

  // ── Fetch Data ────────────────────────────────────────────────────────────
  async function fetchData() {
    if (!currentItemId) { setStatus('Select an item from the dropdown first.', 'err'); return; }
    setStatus('Loading…');
    showChartStatus('<div class="ima-spin"></div>');

    const fromDate = document.getElementById('ima-from').value;
    const toDate   = document.getElementById('ima-to').value;
    const fromTime = document.getElementById('ima-time-from').value || '00:00';
    const toTime   = document.getElementById('ima-time-to').value   || '23:59';

    // TCT inputs are UTC, Local inputs are local — append Z only for TCT
    const suffix = useTCT ? ':00Z' : ':00';
    const fromUTC = new Date(fromDate + 'T' + fromTime + suffix);
    const toUTC   = new Date(toDate   + 'T' + toTime   + suffix);
    
    const params = new URLSearchParams({ limit: 5000 });
    params.set('from', fromUTC.toISOString().slice(0, 16).replace('T', 'T'));
    params.set('to', toUTC.toISOString().slice(0, 16).replace('T', 'T'));

    try {
      const data = await apiFetch(`/api/market/${currentItemId}?${params}`);
      rawData = data; tableData = [...data];

      if (!data.length) {
        showChartStatus('<span>No data found — try adjusting the date range</span>');
        updateSummary([]); setStatus('No data.', 'err');
        if (priceChart) { priceChart.destroy(); priceChart = null; }
        document.getElementById('ima-click-hint').style.display = 'none';
        return;
      }

      hideChartStatus();
      updateSummary(data);
      setStatus(`${data.length.toLocaleString()} records`, 'ok');
      renderChart(data);
      renderTable();
      document.getElementById('ima-click-hint').style.display = 'block';
      
      if (document.getElementById('ima-reco-drawer').classList.contains('visible')) {
        generateRecommendation();
      }
    } catch(e) {
      showChartStatus(`<span style="color:var(--ima-error)">${esc(e.message)}</span>`);
      setStatus('Error: ' + e.message, 'err');
    }
  }

  // ── Timeframe aggregation ─────────────────────────────────────────────────
  function aggregateByTF(rows) {
    const ms = TF_BUCKET_MS[currentTF] || 1800000;
    const buckets = new Map();
    rows.forEach(r => {
      const t = Math.floor(new Date(r.created_at).getTime() / ms) * ms;
      if (!buckets.has(t)) buckets.set(t, []);
      buckets.get(t).push(r);
    });
    return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([t, recs]) => {
      const last = recs[recs.length - 1];
      return {
        created_at:    new Date(t).toISOString(),
        price:         Number(last.price),
        average_price: recs.reduce((s, r) => s + Number(r.average_price), 0) / recs.length,
        quantity:      Number(last.quantity),
        name:          last.name,
      };
    });
  }

  // ── Chart ─────────────────────────────────────────────────────────────────
  function renderChart(rows) {
    if (priceChart) { priceChart.destroy(); priceChart = null; }
    if (!rows.length) return;

    const agg   = aggregateByTF(rows);
    const isBar = currentChartType === 'bar';
    const isSc  = currentChartType === 'scatter';

    // Shift timestamps so Chart.js local-time display shows the selected timezone
    const tzShiftMs = useTCT ? new Date().getTimezoneOffset() * 60000 : 0;
    const toDisplayDate = (ts) => new Date(new Date(ts).getTime() + tzShiftMs);
    const priceData = agg.map(r => ({ x: toDisplayDate(r.created_at), y: r.price }));
    const avgData   = agg.map(r => ({ x: toDisplayDate(r.created_at), y: r.average_price }));
    const qtyData   = agg.map(r => ({ x: toDisplayDate(r.created_at), y: r.quantity }));
    const tzLabel   = useTCT ? ' TCT' : '';

    priceChart = new Chart(
      document.getElementById('ima-price-chart').getContext('2d'),
      {
        type: isSc ? 'scatter' : 'line',
        data: {
          datasets: [
            {
              label: 'Lowest Offer',
              data: priceData,
              borderColor: '#6ee7f7', backgroundColor: isBar ? 'rgba(110,231,247,0.25)' : 'rgba(110,231,247,0.08)',
              borderWidth: 2, pointRadius: isSc ? 4 : 3, pointHoverRadius: 6,
              fill: !isBar && !isSc, tension: 0.3, type: isBar ? 'bar' : 'line', yAxisID: 'y',
            },
            {
              label: 'Market Avg',
              data: avgData,
              borderColor: '#818cf8', backgroundColor: 'transparent',
              borderWidth: 2, borderDash: [5, 3],
              pointRadius: isSc ? 3 : 0, pointHoverRadius: 5,
              fill: false, tension: 0.3, type: 'line', yAxisID: 'y',
            },
            {
              label: 'Quantity',
              data: qtyData,
              borderColor: 'rgba(251,191,36,0.5)', backgroundColor: 'rgba(251,191,36,0.07)',
              borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3,
              fill: 'origin', tension: 0.2, type: 'line', yAxisID: 'yQty',
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 11 }, padding: 14, usePointStyle: true } },
            tooltip: {
              backgroundColor: 'rgba(7,8,15,0.95)', titleColor: '#6ee7f7', bodyColor: '#e2e8f0',
              borderColor: 'rgba(110,231,247,0.2)', borderWidth: 1, padding: 10,
              callbacks: {
                title: items => {
                  if (!items.length) return '';
                  const d = new Date(items[0].parsed.x);
                  return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}` + tzLabel;
                },
                label: ctx => {
                  if (ctx.dataset.label === 'Quantity') return `Qty: ${Number(ctx.parsed.y).toLocaleString()}`;
                  return `${ctx.dataset.label}: $${Number(ctx.parsed.y).toLocaleString()}`;
                },
              },
            },
          },
          scales: {
            x: { type: 'time', ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 }, callback: function(v) { return this.getLabelForValue(v) + tzLabel; } }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { position: 'left', ticks: { color: '#64748b', font: { size: 10 }, callback: v => '$' + Number(v).toLocaleString() }, grid: { color: 'rgba(255,255,255,0.04)' } },
            yQty: {
              position: 'right', min: 0,
              max: Math.max(...qtyData.map(p => p.y), 1) * 5,
              grid: { drawOnChartArea: false },
              ticks: { color: 'rgba(251,191,36,0.45)', maxTicksLimit: 4, callback: v => { const mx = Math.max(...qtyData.map(p => p.y), 1); return v <= mx ? Number(v).toLocaleString() : null; } },
            },
          },
          onClick: (e, elements, chart) => {
            let hits = elements;
            if (!hits.length && e.native) {
              hits = chart.getElementsAtEventForMode(e.native, 'nearest', { intersect: false }, false);
            }
            if (!hits.length) return;
            const hit = hits[0];
            if (hit.datasetIndex === 2) return;
            const price = hit.datasetIndex === 0 ? priceData[hit.index]?.y : avgData[hit.index]?.y;
            if (!price) return;
            chartClickFill(price);
          },
        },
      }
    );
  }

  // ── Calculator chart-click fill ───────────────────────────────────────────
  function chartClickFill(price) {
    const buyEl   = document.getElementById('ima-c-buy');
    const sellEl  = document.getElementById('ima-c-sell');
    const stateEl = document.getElementById('ima-calc-state');

    if (!awaitingSell) {
      buyEl.value   = price;
      sellEl.value  = '';
      awaitingSell  = true;
      stateEl.textContent = 'Buy set — click again to set Sell';
    } else {
      sellEl.value  = price;
      awaitingSell  = false;
      stateEl.textContent = '';
      if (calcAutoOpen && !document.getElementById('ima-calc-drawer').classList.contains('visible')) {
        toggleCalcDrawer();
      }
    }
    calcResults();
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  function renderTable() {
    const tbody = document.getElementById('ima-tbody');
    if (!tableData.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No data.</td></tr>'; return; }
    tbody.innerHTML = tableData.slice().reverse().slice(0, 500).map(r => {
      const dt = new Date(r.created_at);
      const ds = formatDisplayTimestamp(dt);
      return `<tr>
        <td class="mono" style="color:var(--ima-muted);font-size:11px">${ds}</td>
        <td>${esc(r.name || '')}</td>
        <td class="acc">$${fmtFull(r.average_price)}</td>
        <td class="mono r">$${fmtFull(r.price)}</td>
        <td class="r">${r.quantity ?? 1}</td>
      </tr>`;
    }).join('');
  }

  function sortTable(col) {
    const ths = document.querySelectorAll('#ima-table-pane thead th');
    const dir = (sortState.col === col && sortState.dir === 'asc') ? 'desc' : 'asc';
    sortState = { col, dir };
    ths.forEach(th => th.classList.remove('s-asc', 's-desc'));
    ths[col].classList.add(dir === 'asc' ? 's-asc' : 's-desc');
    tableData.sort((a, b) => {
      let av, bv;
      switch(col) {
        case 0: av = new Date(a.created_at); bv = new Date(b.created_at); break;
        case 1: av = (a.name||'').toLowerCase(); bv = (b.name||'').toLowerCase(); break;
        case 2: av = +a.average_price; bv = +b.average_price; break;
        case 3: av = +a.price; bv = +b.price; break;
        case 4: av = +(a.quantity||1); bv = +(b.quantity||1); break;
        default: return 0;
      }
      return dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
    renderTable();
  }

  // ── Best Items ────────────────────────────────────────────────────────────
  async function fetchBestItems(force) {
    if (bestLoaded && !force) return;
    const list = document.getElementById('ima-best-list');
    list.innerHTML = '<div id="ima-best-status"><div class="ima-spin" style="margin:0 auto 10px"></div></div>';
    bestLoaded = false;
    bestData   = [];

    try {
      const fee = parseFloat(document.getElementById('ima-best-fee').value) || 5;
      bestData  = await apiFetch(`/api/best-items?fee=${fee}`);
      bestLoaded = true;
      renderBestItems();
    } catch(e) {
      list.innerHTML = `<div id="ima-best-status" style="color:var(--ima-error)">${esc(e.message)}</div>`;
    }
  }

  function renderBestItems() {
    const list = document.getElementById('ima-best-list');
    if (!bestData.length) { list.innerHTML = '<div id="ima-best-status">No profitable items found yet.</div>'; return; }

    const sorted = [...bestData].sort((a, b) => {
      let av, bv;
      switch (bestSort.col) {
        case 'name':           av = (a.name||'').toLowerCase(); bv = (b.name||'').toLowerCase(); break;
        case 'net_profit':     av = +a.net_profit;     bv = +b.net_profit;     break;
        case 'margin_pct':     av = +a.margin_pct;     bv = +b.margin_pct;     break;
        case 'confidence_pct': av = +a.confidence_pct; bv = +b.confidence_pct; break;
        default: return 0;
      }
      return bestSort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    list.innerHTML = sorted.map(item => {
      const m = Number(item.margin_pct);
      const c = Number(item.confidence_pct);
      const mCls = m >= 15 ? 'high' : m >= 5 ? 'mid' : '';
      const cCls = c >= 80 ? 'hi'   : c >= 50 ? 'md'  : 'lo';
      return `
        <div class="ima-best-row" data-id="${item.item_id}" data-name="${esc(item.name)}">
          <span class="ima-best-name" title="${esc(item.name)}">${esc(item.name)}</span>
          <span class="ima-best-val ima-best-profit">${fmt$(item.net_profit)}</span>
          <span class="ima-best-val ima-best-margin ${mCls}">+${m}%</span>
          <span class="ima-best-val ima-best-conf ${cCls}">${c}%</span>
        </div>`;
    }).join('');

    list.querySelectorAll('.ima-best-row').forEach(row => {
      row.addEventListener('click', () => {
        currentItemId = parseInt(row.dataset.id);
        document.getElementById('ima-item-name').value = row.dataset.name;
        document.getElementById('ima-best-drawer').classList.remove('visible');
        document.getElementById('ima-best-btn').classList.remove('active');
        activeTab = 'chart';
        document.querySelectorAll('.ima-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chart'));
        showTab('chart');
        fetchData();
      });
    });
  }

  // ── Calculator ────────────────────────────────────────────────────────────
  function initCalculator() {
    document.getElementById('ima-c-buy') .addEventListener('input', calcResults);
    document.getElementById('ima-c-fee') .addEventListener('input', calcResults);
    document.getElementById('ima-c-sell').addEventListener('input', () => { awaitingSell = false; calcResults(); });
    calcResults();
  }

  function calcResults() {
    const buy  = parseFloat(document.getElementById('ima-c-buy').value)  || 0;
    const fee  = parseFloat(document.getElementById('ima-c-fee').value)  || 0;
    const sell = parseFloat(document.getElementById('ima-c-sell').value) || 0;
    const feeAmt    = sell * (fee / 100);
    const totalCost = buy + feeAmt;
    const profit    = sell - totalCost;
    const pct       = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    const cls       = profit > 0 ? 'pos' : profit < 0 ? 'neg' : '';
    setCalcVal('ima-c-r-fee',    `$${fmtFull(feeAmt)}`);
    setCalcVal('ima-c-r-cost',   `$${fmtFull(totalCost)}`);
    setCalcVal('ima-c-r-profit', `$${fmtFull(profit)}`, cls);
    setCalcVal('ima-c-r-pct',    `${pct.toFixed(2)}%`,  cls);
  }

  function resetCalculator() {
    awaitingSell = false;
    ['ima-c-buy','ima-c-sell'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ima-c-fee').value = '5';
    document.getElementById('ima-calc-state').textContent = '';
    calcResults();
  }

  function setCalcVal(id, text, cls = '') {
    const e = document.getElementById(id);
    e.textContent = text;
    e.className   = 'ima-calc-row-val' + (cls ? ' ' + cls : '');
  }

  // ── Shared buy/sell calculation ───────────────────────────────────────────
  function calcBuySell(data) {
    const priceData = data.map(d => ({ price: Number(d.price), quantity: Number(d.quantity) || 1 })).filter(d => d.price > 0);
    if (!priceData.length) return { buyPrice: null, sellPrice: null };
    const prices = priceData.map(d => d.price);
    const sorted = [...prices].sort((a, b) => a - b);
    const lowThreshold  = sorted[Math.floor(sorted.length * 0.3)];
    const highThreshold = sorted[Math.floor(sorted.length * 0.7)];
    const lowData  = priceData.filter(d => d.price <= lowThreshold);
    const highData = priceData.filter(d => d.price >= highThreshold);
    const weightedMode = (arr) => {
      if (!arr.length) return null;
      const freq = {};
      arr.forEach(({ price, quantity }) => { freq[price] = (freq[price] || 0) + quantity; });
      let max = 0, mode = arr[0].price;
      for (const [price, count] of Object.entries(freq)) { if (count > max) { max = count; mode = Number(price); } }
      return mode;
    };
    return {
      buyPrice:  weightedMode(lowData)  || sorted[0],
      sellPrice: weightedMode(highData) || sorted[sorted.length - 1],
    };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  function updateSummary(data) {
    const setTile = (id, val) => {
      const e = document.getElementById(id);
      if (val != null && isFinite(val)) {
        e.textContent = fmt$(val);
        e.dataset.raw  = val;
        e.dataset.full = '0';
      } else {
        e.textContent = '—';
        delete e.dataset.raw;
        delete e.dataset.full;
      }
    };
    if (!data.length) {
      ['ima-s-avg','ima-s-min','ima-s-max','ima-s-buy','ima-s-sell'].forEach(id => setTile(id, null));
      return;
    }
    const prices = data.map(d => +d.price).filter(p => p > 0);
    const avgPrices = data.map(d => +d.average_price).filter(p => p > 0);
    const avg = avgPrices.reduce((s, p) => s + p, 0) / (avgPrices.length || 1);
    const { buyPrice, sellPrice } = calcBuySell(data);
    setTile('ima-s-avg',  avg);
    setTile('ima-s-min',  Math.min(...prices));
    setTile('ima-s-max',  Math.max(...prices));
    setTile('ima-s-buy',  buyPrice);
    setTile('ima-s-sell', sellPrice);
  }

  // ── Auto-refresh ──────────────────────────────────────────────────────────
  function toggleAutoRefresh() {
    const btn    = document.getElementById('ima-auto-btn');
    const btnMob = document.getElementById('ima-auto-btn-mob');
    if (autoRefreshOn) {
      clearInterval(refreshTimer); refreshTimer = null; autoRefreshOn = false;
      btn.textContent = '↻ Auto'; btn.classList.remove('active-toggle');
      if (btnMob) { btnMob.textContent = 'Auto-Refresh: Off'; btnMob.classList.remove('active-toggle'); }
    } else {
      autoRefreshOn = true; btn.textContent = '↻ On'; btn.classList.add('active-toggle');
      if (btnMob) { btnMob.textContent = 'Auto-Refresh: On'; btnMob.classList.add('active-toggle'); }
      fetchData(); refreshTimer = setInterval(fetchData, 60000);
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  function resetFilters() {
    const today = getDateInput();
    document.getElementById('ima-from')     .value = today;
    document.getElementById('ima-to')       .value = today;
    document.getElementById('ima-item-name').value = '';
    document.getElementById('ima-time-from').value = '00:00';
    document.getElementById('ima-time-to')  .value = '23:59';
    currentItemId = null;
    document.querySelectorAll('.ima-tf-btn').forEach(b => b.classList.toggle('active', b.dataset.tf === '5m'));
    currentTF = '5m';
    if (autoRefreshOn) toggleAutoRefresh();
    setStatus('');
    if (priceChart) { priceChart.destroy(); priceChart = null; }
    rawData = []; tableData = [];
    updateSummary([]);
    renderTable();
    showChartStatus('<span>Search for an item above and click Apply</span>');
    document.getElementById('ima-click-hint').style.display = 'none';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setStatus(msg, cls = '') {
    const e = document.getElementById('ima-status');
    if (e) { e.textContent = msg; e.className = cls; }
  }
  function showChartStatus(html) {
    const s = document.getElementById('ima-chart-status');
    const c = document.getElementById('ima-price-chart');
    if (s) { s.innerHTML = html; s.classList.remove('hidden'); }
    if (c) c.style.visibility = 'hidden';
  }
  function hideChartStatus() {
    const s = document.getElementById('ima-chart-status');
    const c = document.getElementById('ima-price-chart');
    if (s) s.classList.add('hidden');
    if (c) c.style.visibility = 'visible';
  }
  function fmt$(n) {
    if (!n && n !== 0) return '—';
    const v = Math.abs(n), sg = n < 0 ? '-' : '';
    if (v >= 1e9) return sg + '$' + (v/1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sg + '$' + (v/1e6).toFixed(2) + 'M';
    if (v >= 1e3) return sg + '$' + (v/1e3).toFixed(1) + 'K';
    return sg + '$' + v.toFixed(2);
  }
  function fmtFull(n) { return Number(n||0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  buildUI();
})();