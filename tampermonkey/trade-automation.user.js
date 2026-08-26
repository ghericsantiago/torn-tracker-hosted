// ==UserScript==
// @name         Torn Tracker - Trade Automation
// @namespace    torn-tracker-trade-automation
// @version      2.9.0
// @description  Queue current trades, wait for items, create a receipt, and add the quoted money. Auto-uses Blood Bag B+ from faction armory when hospital time < 5 min.
// @match        https://www.torn.com/trade.php*
// @match        https://www.torn.com/factions.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @connect      itrade.devs.surf
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_APP_URL = 'https://itrade.devs.surf';
  const RECEIPT_TOKEN = '926cc7e6-5092-40cc-ba8a-a3f9b8070a6c';
  const SETTINGS_KEY = 'tta_settings_v1';
  const JOB_KEY = 'tta_active_job_v1';
  const DONE_KEY = 'tta_completed_trades_v2';
  const LOCKED_KEY = 'tta_locked_trades_v1';
  const NAV_KEY = 'tta_navigation_guard_v1';
  const TRADE_ALERT_KEY = 'tta_pending_trade_alert_v1';
  const MAX_COMMENT = 155;
  const TICK_MS = 1000;
  const NAV_GUARD_MS = 60000;
  const ITEM_SETTLE_MS = 10000;
  const AUTO_SKIP_MS = 2 * 60 * 1000; // 2 minutes
  // Stages the script should complete quickly; auto-skip if stuck longer than AUTO_SKIP_MS
  const AUTO_SKIP_STAGES = new Set(['opening', 'pricing', 'receipt_posted', 'add_money', 'returning', 'thank_posted', 'reopened']);
  const BLOODBAG_KEY = 'tta_bloodbag_v1';
  const BLOODBAG_ITEM_ID = '734'; // fallback; overridden by settings.bloodBagItemId
  const BLOODBAG_OPTIONS = [
    { id: '732', label: 'Blood Bag : A+' },
    { id: '733', label: 'Blood Bag : A-' },
    { id: '734', label: 'Blood Bag : B+' },
    { id: '735', label: 'Blood Bag : B-' },
    { id: '736', label: 'Blood Bag : AB+' },
    { id: '737', label: 'Blood Bag : AB-' },
    { id: '738', label: 'Blood Bag : O+' },
    { id: '739', label: 'Blood Bag : O-' },
    { id: '1012', label: 'Blood Bag : Irradiated' },
  ];
  const HOSPITAL_TRIGGER_SECS = 300;
  const BLOODBAG_TIMEOUT_MS = 30000;

  const DEFAULTS = {
    enabled: false,
    apiPolling: true,
    apiKey: '',
    apiPollSeconds: 30,
    waitSeconds: 60,
    bloodBagTriggerMinutes: 5,
    bloodBagItemId: '734',
    pricingServerUrl: DEFAULT_APP_URL,
    requestMessage: 'Hi! Please add your items. Thanks',
    receiptMessage: 'Receipt: {url} | Total: {total}',
    unlistedItemsMessage: 'Receipt: {url} | {total}. Unlisted items got lower offers. Please review before accepting; happy to negotiate.',
    protectedItemsMessage: 'Receipt: {url} | {total}. Low-market protection adjusted {protectedCount} item(s). Please review; happy to negotiate.',
    protectedUnlistedItemsMessage: 'Receipt: {url} | {total}. Unlisted/low-market items got lower offers. Please review; happy to negotiate.',
    insufficientCashMessage: 'Sorry, I only have {cash}. Could you adjust the items to fit that amount?',
    thankYouMessage: 'Thank you for trading with me!',
  };

  let busy = false;
  let lastApiPoll = 0;
  let remoteStatus = 'idle'; // 'idle' | 'ok' | 'error'
  let remoteStatusDetail = '…';

  function readJson(key, fallback) {
    try {
      const raw = GM_getValue(key, '');
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    GM_setValue(key, JSON.stringify(value));
  }

  function getSettings() {
    const settings = { ...DEFAULTS, ...readJson(SETTINGS_KEY, {}) };
    if (/let me know when (?:you are|you're) done adding/i.test(settings.requestMessage)) {
      settings.requestMessage = DEFAULTS.requestMessage;
    }
    return settings;
  }

  function saveSettings(value) {
    writeJson(SETTINGS_KEY, value);
  }

  function pricingServer(settings = getSettings()) {
    return String(settings.pricingServerUrl || DEFAULT_APP_URL).trim().replace(/\/+$/, '');
  }

  function resetAutomation() {
    saveSettings({ ...DEFAULTS });
    GM_setValue(JOB_KEY, '');
    writeJson(DONE_KEY, {});
    writeJson(LOCKED_KEY, {});
    GM_setValue(NAV_KEY, '');
    GM_setValue(TRADE_ALERT_KEY, '');
  }

  function getJob() {
    return readJson(JOB_KEY, null);
  }

  function saveJob(job) {
    const prev = getJob();
    if (!job.stageChangedAt || (prev && prev.stage !== job.stage)) {
      job = { ...job, stageChangedAt: Date.now() };
    }
    writeJson(JOB_KEY, job);
    renderStatus();
  }

  function clearJob(tradeId) {
    GM_setValue(JOB_KEY, '');
    renderStatus();
  }

  function completeJob(tradeId) {
    const completed = readJson(DONE_KEY, {});
    const now = Date.now();
    const cutoff = now - (30 * 24 * 60 * 60 * 1000);
    const job = getJob();
    completed[String(tradeId)] = { at: now, itemSignature: job?.pricedItemSignature || '' };
    Object.keys(completed).forEach(id => {
      const entry = completed[id];
      const entryTime = typeof entry === 'number' ? entry : (entry?.at || 0);
      if (entryTime < cutoff) delete completed[id];
    });
    writeJson(DONE_KEY, completed);
    clearJob(tradeId);
  }

  function activeLockedTrades() {
    const locked = readJson(LOCKED_KEY, {});
    const now = Date.now();
    let changed = false;
    Object.keys(locked).forEach(id => {
      if (Number(locked[id]) <= now) { delete locked[id]; changed = true; }
    });
    if (changed) writeJson(LOCKED_KEY, locked);
    return locked;
  }

  function deferLockedTrade(tradeId) {
    const locked = activeLockedTrades();
    locked[String(tradeId)] = Date.now() + (5 * 60 * 1000);
    writeJson(LOCKED_KEY, locked);
    clearJob(tradeId);
  }

  function pageShowsLockedTrade() {
    const pageText = normalize(document.body.textContent);
    return pageText.includes('this trade is currently locked') && pageText.includes('please wait');
  }

  function pageShowsMissingTrade() {
    const pageText = normalize(document.body.textContent);
    return pageText.includes('no trade was found')
      && pageText.includes('it may have expired')
      && pageText.includes('the goods will be returned to you within 15 minutes');
  }

  function tradeLogShowsAccepted() {
    const messages = [...document.querySelectorAll('.log .msg, .trade-log .msg, .msg')];
    if (!messages.length) return false;
    const latest = messages[0];
    if (!/\bthe trade was accepted by\b/i.test(latest.textContent)) return false;
    const selfId = currentUserId();
    const authorId = latest.querySelector('a[href*="profiles.php?XID="]')?.href
      .match(/[?&]XID=(\d+)/i)?.[1] || '';
    return !(selfId && authorId && authorId === selfId);
  }

  function pageShowsWeAccepted() {
    const text = normalize(document.body.textContent);
    return text.includes('you have accepted the trade') && text.includes('please wait for the other person to accept');
  }

  function parseHash() {
    const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
    return { step: params.get('step') || '', id: params.get('ID') || '' };
  }

  function navigateTrade(step = '', id = '') {
    const target = step ? `step=${step}&ID=${encodeURIComponent(id)}` : '';
    const current = location.hash.replace(/^#\/?/, '');
    if (current === target) {
      GM_setValue(NAV_KEY, '');
      return false;
    }
    const guard = readJson(NAV_KEY, null);
    if (guard?.target === target && Date.now() - guard.at < NAV_GUARD_MS) return false;
    writeJson(NAV_KEY, { target, at: Date.now() });
    location.hash = target;
    return true;
  }

  function money(value) {
    return '$' + Math.round(Number(value) || 0).toLocaleString();
  }

  function parseAmount(value) {
    const normalized = String(value || '').toLowerCase().replace(/[$,\s]/g, '');
    const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m|b)?$/);
    if (!match) return null;
    const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[match[2]] || 1;
    const amount = Number(match[1]) * multiplier;
    return Number.isFinite(amount) ? Math.round(amount) : null;
  }

  function cashOnHand() {
    const element = document.getElementById('user-money');
    if (!element) return null;
    return parseAmount(element.dataset.money || element.textContent);
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setNativeValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function findCommentControl() {
    const selectors = [
      '#postTradeMessage',
      'textarea[name="post"]',
      'input[name="post"]',
      'form[action*="inserter=1"] textarea',
      'form[action*="inserter=1"] input[type="text"]',
      '.post-wrap textarea',
      '.post textarea',
    ];
    return selectors.map(selector => document.querySelector(selector)).find(Boolean) || null;
  }

  function gmPost(url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', 'X-Receipt-Token': RECEIPT_TOKEN },
        data: JSON.stringify(data),
        onload: response => {
          try {
            const body = JSON.parse(response.responseText);
            if (response.status < 200 || response.status >= 300) {
              reject(new Error(body.error || `Server returned ${response.status}`));
            } else {
              resolve(body);
            }
          } catch (_) {
            reject(new Error(`Invalid server response (${response.status})`));
          }
        },
        onerror: response => reject(new Error(`Pricing server network error${response?.status ? ` (${response.status})` : ''}`)),
        ontimeout: () => reject(new Error('Pricing server request timed out')),
        timeout: 20000,
      });
    });
  }

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 20000,
        onload: response => {
          try {
            const body = JSON.parse(response.responseText);
            if (body.error) reject(new Error(body.error.error || body.error.code || 'Torn API error'));
            else if (response.status < 200 || response.status >= 300) reject(new Error(`Torn API returned ${response.status}`));
            else resolve(body);
          } catch (_) {
            reject(new Error(`Invalid Torn API response (${response.status})`));
          }
        },
        onerror: () => reject(new Error('Torn API network error')),
        ontimeout: () => reject(new Error('Torn API request timed out')),
      });
    });
  }

  async function pollOldestOpenTrade(settings) {
    if (!settings.apiPolling || !settings.apiKey) return null;
    const interval = Math.max(15, Number(settings.apiPollSeconds) || 30) * 1000;
    if (Date.now() - lastApiPoll < interval) return null;
    lastApiPoll = Date.now();
    const url = `https://api.torn.com/v2/user/trades?cat=ongoing&key=${encodeURIComponent(settings.apiKey)}&_=${Date.now()}`;
    const data = await gmGet(url);
    const completed = readJson(DONE_KEY, {});
    const locked = activeLockedTrades();
    const eligible = (Array.isArray(data.trades) ? data.trades : [])
      .filter(trade => trade?.id && !locked[String(trade.id)]);
    const pending = eligible.filter(t => !completed[String(t.id)]);
    const sorted = arr => arr.sort((a, b) => Number(a.expires_at || Infinity) - Number(b.expires_at || Infinity));
    if (pending.length) return sorted(pending)[0];
    const reopened = eligible.filter(t => completed[String(t.id)]);
    return reopened.length ? { ...sorted(reopened)[0], reopened: true } : null;
  }

  function currentUserId() {
    try {
      return String(JSON.parse(document.getElementById('torn-user')?.value || '{}').id || '');
    } catch (_) {
      return '';
    }
  }

  function tradeLogHasComment(message) {
    const expected = normalize(message);
    const selfId = currentUserId();
    return [...document.querySelectorAll('.log .msg, .trade-log .msg, .msg')].some(element => {
      if (!/\bsays:\s*/i.test(element.textContent)) return false;
      const authorId = element.querySelector('a[href*="profiles.php?XID="]')?.href
        .match(/[?&]XID=(\d+)/i)?.[1] || '';
      if (selfId && authorId && authorId !== selfId) return false;
      const body = normalize(element.textContent.replace(/^.*?\bsays:\s*/i, ''));
      return body === expected;
    });
  }

  function latestCounterpartMessageIs(text) {
    const expected = normalize(text);
    const selfId = currentUserId();
    const messages = [...document.querySelectorAll('.log .msg, .trade-log .msg, .msg')]
      .filter(el => /\bsays:\s*/i.test(el.textContent));
    // DOM is newest-first; find the first entry that belongs to the counterpart
    const latest = messages.find(el => {
      const authorId = el.querySelector('a[href*="profiles.php?XID="]')?.href
        .match(/[?&]XID=(\d+)/i)?.[1] || '';
      return !(selfId && authorId && authorId === selfId);
    });
    if (!latest) return false;
    const body = normalize(latest.textContent.replace(/^.*?\bsays:\s*/i, ''));
    return body === expected;
  }

  function counterpartItemSignature() {
    const selfId = currentUserId();
    const sideItems = [...document.querySelectorAll('.trade-cont .user.right > ul.cont > li.color2 .name:not(.inactive)')]
      .map(element => normalize(element.textContent))
      .filter(text => text && !/^no items? in trade$/.test(text));
    const additions = [...document.querySelectorAll('.log .msg, .trade-log .msg')]
      .filter(element => /\badded\s+\d+x\s+.+\s+to the trade\b/i.test(element.textContent))
      .filter(element => {
        const authorId = element.querySelector('a[href*="profiles.php?XID="]')?.href
          .match(/[?&]XID=(\d+)/i)?.[1] || '';
        return !(selfId && authorId && authorId === selfId);
      })
      .map(element => normalize(element.textContent));
    return [...sideItems, ...additions].sort().join('|');
  }

  function restartPricingIfItemsChanged(job) {
    if (!job?.pricedItemSignature) return false;
    const itemSignature = counterpartItemSignature();
    if (!itemSignature || itemSignature === job.pricedItemSignature) return false;
    const now = Date.now();
    saveJob({
      ...job,
      stage: 'waiting',
      defaultDeadline: now + ITEM_SETTLE_MS,
      deadline: now + ITEM_SETTLE_MS,
      itemSignature,
      itemDetected: true,
      acceptanceInvalidated: true,
      error: '',
    });
    return true;
  }

  function submitComment(text, nextJob) {
    const comment = String(text).slice(0, MAX_COMMENT);
    if (tradeLogHasComment(comment)) {
      saveJob(nextJob);
      return true;
    }
    const control = findCommentControl();
    const form = control?.closest('form');
    if (!control || !form) return false;
    setNativeValue(control, comment);
    const submit = form.querySelector('input[type="submit"], button[type="submit"]');
    if (!submit) return false;
    submit.disabled = false;
    submit.removeAttribute('disabled');
    submit.classList.remove('disabled');
    submit.closest('.btn, .btn-wrap')?.classList.remove('disabled');
    saveJob(nextJob);
    submit.click();
    return true;
  }

  function expirySeconds(row) {
    const text = normalize(row.querySelector('.time')?.textContent);
    const hours = Number(text.match(/(\d+)\s*hr/)?.[1] || 0);
    const minutes = Number(text.match(/(\d+)\s*min/)?.[1] || 0);
    const seconds = Number(text.match(/(\d+)\s*sec/)?.[1] || 0);
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  function findOldestTrade(root = document) {
    const completed = readJson(DONE_KEY, {});
    const locked = activeLockedTrades();
    const currentHeading = [...root.querySelectorAll('.title-black')]
      .find(element => /^current\s+trades?$/i.test(element.textContent.trim()));
    const currentList = currentHeading?.nextElementSibling?.matches('ul.trades-cont.current')
      ? currentHeading.nextElementSibling
      : root.querySelector('ul.trades-cont.current:not(.m-bottom10)');
    if (!currentList) return null;
    const candidates = [...currentList.querySelectorAll(':scope > li')]
      .map(row => {
        const link = row.querySelector('a[href*="step=view"][href*="ID="]');
        const id = link?.href.match(/[?&#]ID=(\d+)/i)?.[1];
        if (!id || locked[String(id)]) return null;
        return { row, link, id, expires: expirySeconds(row), reopened: Boolean(completed[String(id)]) };
      })
      .filter(Boolean);
    candidates.sort((a, b) => a.expires - b.expires);
    return candidates.find(c => !c.reopened) || candidates.find(c => c.reopened) || null;
  }

  function pendingTradeAlert() {
    return document.querySelector(
      'ul[class*="status-icons"] a[href="/trade.php"][aria-label^="Trade pending:"]'
    );
  }

  function handlePendingTradeAlert() {
    const alert = pendingTradeAlert();
    const saved = readJson(TRADE_ALERT_KEY, null);
    if (!alert) {
      if (saved && !saved.missingSince) writeJson(TRADE_ALERT_KEY, { ...saved, missingSince: Date.now() });
      else if (saved?.missingSince && Date.now() - saved.missingSince >= 5000) GM_setValue(TRADE_ALERT_KEY, '');
      return false;
    }
    const signature = alert.getAttribute('aria-label') || 'Trade pending';
    if (saved?.signature === signature) {
      if (saved.missingSince) writeJson(TRADE_ALERT_KEY, { signature, missingSince: 0 });
      return false;
    }
    writeJson(TRADE_ALERT_KEY, { signature, missingSince: 0 });

    if (location.pathname.toLowerCase() !== '/trade.php') {
      location.assign(`${location.origin}/trade.php`);
      return true;
    }

    // Never refresh selected-trade or add-money routes: their missing list is
    // expected, and their form submissions manage their own transitions.
    if (parseHash().step) return false;

    // The trade list itself is not reactive. If its current-trade section has
    // not caught up with the newly appeared status icon, reload it exactly once.
    if (!findOldestTrade()) {
      location.reload();
      return true;
    }
    return false;
  }

  async function previewReceipt(job, settings) {
    const preview = await gmPost(`${pricingServer(settings)}/api/receipt/preview`, {
      trade_id: Number(job.tradeId),
    });
    if (preview.error) throw new Error(preview.error);
    const items = Array.isArray(preview.items) ? preview.items : [];
    if (items.length === 0) return null;
    return { ...preview, items };
  }

  async function createReceipt(job, preview, settings) {
    const result = await gmPost(`${pricingServer(settings)}/api/receipt/create`, {
      trade_id: Number(job.tradeId),
      items_override: preview.items.map(item => ({
        torn_item_id: item.torn_item_id,
        unit_price: item.effective_price ?? 0,
        market_protection_applied: item.market_protection_applied === true,
        market_drop_pct: item.market_drop_pct ?? null,
        market_protection_threshold_pct: item.market_protection_threshold_pct ?? null,
        unprotected_price: item.unprotected_price ?? null,
        protection_lowest_price: item.market_protection_applied ? item.market_reference_price : null,
        protection_market_value: item.market_protection_applied ? item.market_price : null,
      })),
    });
    if (result.error) throw new Error(result.error);
    return result;
  }

  function showError(message) {
    const job = getJob();
    if (job) saveJob({ ...job, error: String(message), retryAt: Date.now() + 10000 });
  }

  async function handleList(settings, job) {
    if (job) {
      navigateTrade(job.stage === 'add_money' ? 'addmoney' : 'view', job.tradeId);
      return;
    }
    const oldest = findOldestTrade();
    if (oldest) {
      let lastAcceptedItemSignature = '';
      if (oldest.reopened) {
        const completed = readJson(DONE_KEY, {});
        const entry = completed[String(oldest.id)];
        lastAcceptedItemSignature = typeof entry === 'object' ? (entry?.itemSignature || '') : '';
        delete completed[String(oldest.id)];
        writeJson(DONE_KEY, completed);
      }
      saveJob({ tradeId: oldest.id, stage: oldest.reopened ? 'reopened' : 'opening', startedAt: Date.now(), lastAcceptedItemSignature });
      navigateTrade('view', oldest.id);
      return;
    }
  }

  async function handleView(settings, job, id) {
    if (!job || String(job.tradeId) !== String(id)) {
      navigateTrade();
      return;
    }

    if (pageShowsMissingTrade()) {
      deferLockedTrade(job.tradeId);
      navigateTrade();
      return;
    }

    if (pageShowsLockedTrade() && ['opening', 'waiting', 'waiting_for_items', 'waiting_for_adjustment', 'pricing', 'receipt_posted', 'add_money'].includes(job.stage)) {
      deferLockedTrade(job.tradeId);
      navigateTrade();
      return;
    }

    if (normalize(document.body.textContent).includes('you cannot remove anything from this trade as one party has already accepted it')) {
      deferLockedTrade(job.tradeId);
      navigateTrade();
      return;
    }

    if (tradeLogShowsAccepted() || latestCounterpartMessageIs(settings.thankYouMessage)) {
      completeJob(job.tradeId);
      navigateTrade();
      return;
    }

    if (['receipt_posted', 'add_money'].includes(job.stage)
      && restartPricingIfItemsChanged(job)) return;

    if (job.stage === 'reopened') {
      if (!findCommentControl()) return;
      if (tradeLogShowsAccepted()) {
        completeJob(job.tradeId);
        navigateTrade();
        return;
      }
      if (pageShowsWeAccepted()) {
        saveJob({ ...job, stage: 'awaiting_accept', error: '' });
        return;
      }
      const allMessages = [...document.querySelectorAll('.log .msg, .trade-log .msg, .msg')];
      const wasDeclined = allMessages.some(el => /\bthe trade was declined by\b/i.test(el.textContent));
      const currentSignature = counterpartItemSignature();
      const itemsUnchanged = job.lastAcceptedItemSignature
        ? currentSignature === job.lastAcceptedItemSignature
        : false;
      if (!wasDeclined && itemsUnchanged && tradeLogHasComment(settings.thankYouMessage)) {
        saveJob({ ...job, stage: 'awaiting_accept', error: '' });
        return;
      }
      const now = Date.now();
      saveJob({
        ...job,
        stage: 'waiting',
        defaultDeadline: now + ITEM_SETTLE_MS,
        deadline: now + ITEM_SETTLE_MS,
        itemSignature: currentSignature,
        itemDetected: Boolean(currentSignature),
        error: '',
      });
      return;
    }

    if (job.stage === 'opening') {
      if (!findCommentControl()) return;
      const now = Date.now();
      const itemSignature = counterpartItemSignature();
      const defaultDeadline = now + (settings.waitSeconds * 1000);
      const next = {
        ...job,
        stage: 'waiting',
        askedAt: now,
        defaultDeadline,
        deadline: itemSignature ? Math.min(defaultDeadline, now + ITEM_SETTLE_MS) : defaultDeadline,
        itemSignature,
        itemDetected: Boolean(itemSignature),
        error: '',
      };
      if (!submitComment(settings.requestMessage, next)) throw new Error('Comment form not found');
      return;
    }

    if (job.stage === 'waiting') {
      const now = Date.now();
      const defaultDeadline = Number(job.defaultDeadline) || Number(job.deadline) || (now + settings.waitSeconds * 1000);
      const itemSignature = counterpartItemSignature();
      if (itemSignature && itemSignature !== job.itemSignature) {
        saveJob({
          ...job,
          defaultDeadline,
          deadline: Math.min(defaultDeadline, now + ITEM_SETTLE_MS),
          itemSignature,
          itemDetected: true,
          error: '',
        });
        return;
      }
      if (Date.now() < job.deadline) return;
      saveJob({ ...job, stage: 'pricing', error: '' });
      job = getJob();
    }

    if (job.stage === 'waiting_for_items') {
      const itemSignature = counterpartItemSignature();
      if (!itemSignature) return;
      const now = Date.now();
      saveJob({
        ...job,
        stage: 'waiting',
        defaultDeadline: now + ITEM_SETTLE_MS,
        deadline: now + ITEM_SETTLE_MS,
        itemSignature,
        itemDetected: true,
        error: '',
      });
      return;
    }

    if (job.stage === 'waiting_for_adjustment') {
      const itemSignature = counterpartItemSignature();
      if (!itemSignature || itemSignature === job.itemSignature) return;
      const now = Date.now();
      saveJob({
        ...job,
        stage: 'waiting',
        defaultDeadline: now + ITEM_SETTLE_MS,
        deadline: now + ITEM_SETTLE_MS,
        itemSignature,
        itemDetected: true,
        error: '',
      });
      return;
    }

    if (job.stage === 'pricing') {
      // Wait for Torn's asynchronously rendered comment form before creating
      // anything server-side, otherwise a retry could create two receipts.
      if (!findCommentControl()) return;
      let preview = await previewReceipt(job, settings);
      if (!preview) {
        saveJob({
          ...job,
          stage: 'waiting_for_items',
          itemSignature: counterpartItemSignature(),
          error: '',
        });
        return;
      }
      const total = Math.round(Number(preview.total) || 0);
      const cash = cashOnHand();
      if (cash != null && total > cash) {
        const message = settings.insufficientCashMessage
          .replaceAll('{cash}', money(cash))
          .replaceAll('{total}', money(total))
          .replaceAll('{shortfall}', money(total - cash))
          .replaceAll('{tradeId}', String(job.tradeId));
        const next = {
          ...job,
          stage: 'waiting_for_adjustment',
          itemSignature: counterpartItemSignature(),
          quotedTotal: total,
          availableCash: cash,
          error: '',
        };
        if (!submitComment(message, next)) throw new Error('Comment form not found');
        return;
      }
      const receipt = await createReceipt(job, preview, settings);
      const receiptServerUrl = pricingServer(settings);
      const receiptUrl = `${receiptServerUrl}${receipt.url}`;
      GM_setValue(`receipt_${job.tradeId}`, receipt.short_id || receipt.id);
      const unlistedItems = preview.items.filter(item => item.in_catalog === false);
      const protectedItems = preview.items.filter(item => item.market_protection_applied === true);
      const messageTemplate = protectedItems.length && unlistedItems.length
        ? settings.protectedUnlistedItemsMessage
        : protectedItems.length
          ? settings.protectedItemsMessage
          : unlistedItems.length
            ? settings.unlistedItemsMessage
            : settings.receiptMessage;
      const message = messageTemplate
        .replaceAll('{url}', receiptUrl)
        .replaceAll('{total}', money(receipt.total))
        .replaceAll('{unlistedCount}', String(unlistedItems.length))
        .replaceAll('{protectedCount}', String(protectedItems.length))
        .replaceAll('{tradeId}', String(job.tradeId));
      const next = {
        ...job,
        stage: 'receipt_posted',
        receiptPostedAt: Date.now(),
        total: Math.round(Number(receipt.total) || 0),
        receiptId: receipt.short_id || receipt.id,
        receiptUrl,
        receiptServerUrl,
        unlistedItemCount: unlistedItems.length,
        protectedItemCount: protectedItems.length,
        pricedItemSignature: counterpartItemSignature() || job.itemSignature || '',
        acceptanceInvalidated: false,
        error: '',
      };
      if (!submitComment(message, next)) throw new Error('Comment form not found');
      return;
    }

    if (job.stage === 'receipt_posted' || job.stage === 'add_money') {
      if (pageShowsWeAccepted()) {
        saveJob({ ...job, stage: 'awaiting_accept', error: '' });
        return;
      }
      if (job.stage === 'receipt_posted' && Date.now() - job.receiptPostedAt < 2000) return;
      if (Number(job.total) <= 0) {
        saveJob({ ...job, stage: 'returning', error: '' });
        return;
      }
      const addMoney = document.querySelector('a[href*="step=addmoney"][href*="ID="]');
      if (!addMoney) return;
      saveJob({ ...job, stage: 'add_money', error: '' });
      navigateTrade('addmoney', job.tradeId);
      return;
    }

    if (job.stage === 'returning') {
      if (!findCommentControl()) return;
      const next = { ...job, stage: 'thank_posted', error: '' };
      if (!submitComment(settings.thankYouMessage, next)) throw new Error('Comment form not found');
      return;
    }

    if (job.stage === 'thank_posted') {
      setTimeout(() => {
        if (getJob()?.stage === 'awaiting_accept') document.querySelector('.tta-accept-ready')?.click();
      }, 1000);
      saveJob({ ...job, stage: 'awaiting_accept', error: '' });
      job = getJob();
    }

    if (job.stage === 'awaiting_accept') {
      setTimeout(() => {
        if (getJob()?.stage === 'awaiting_accept') document.querySelector('.tta-accept-ready')?.click();
      }, 13000);
      highlightAcceptControl();
      return;
    }

    if (job.stage === 'complete') {
      completeJob(job.tradeId);
      navigateTrade();
    }
  }

  function findAcceptControl() {
    const selectors = [
      'a.accept[aria-label*="Accept trade"]',
      'a[href*="step=accept2"][href*="ID="]',
      'a[href*="step=accept"][href*="ID="]',
      'button[aria-label*="Accept trade"]',
      'input[type="submit"][value="ACCEPT"]',
    ];
    return selectors.map(selector => document.querySelector(selector)).find(control => {
      return control && !control.disabled && control.getAttribute('aria-disabled') !== 'true';
    }) || null;
  }

  function highlightAcceptControl() {
    document.querySelectorAll('.tta-accept-ready').forEach(element => element.classList.remove('tta-accept-ready'));
    const control = findAcceptControl();
    if (!control) return false;
    control.classList.add('tta-accept-ready');
    control.title = 'Manual action required: click ACCEPT';
    return true;
  }

  async function handleAcceptRoute(job, route) {
    if (!job || String(job.tradeId) !== String(route.id) || job.stage !== 'awaiting_accept') return;
    if (route.step === 'accept2') {
      if (job.receiptId) {
        try {
          await gmPost(`${job.receiptServerUrl || pricingServer()}/api/receipt/${job.receiptId}/complete`, {});
        } catch (_) {}
      }
      saveJob({ ...job, stage: 'complete', error: '' });
      completeJob(job.tradeId);
      navigateTrade();
      return;
    }
    highlightAcceptControl();
  }

  async function handleAddMoney(job, id) {
    if (job && String(job.tradeId) === String(id) && job.stage === 'returning') return;
    if (!job || String(job.tradeId) !== String(id) || job.stage !== 'add_money') {
      navigateTrade();
      return;
    }
    if (pageShowsLockedTrade()) {
      deferLockedTrade(job.tradeId);
      navigateTrade();
      return;
    }
    if (normalize(document.body.textContent).includes('one party has already accepted it')) {
      saveJob({ ...job, stage: 'awaiting_accept', error: '' });
      navigateTrade('view', job.tradeId);
      return;
    }
    const form = document.querySelector('.init-trade.add-money form[action*="addmoney2"]');
    const visible = form?.querySelector('input.input-money[type="text"]');
    const hidden = form?.querySelector('input.input-money[type="hidden"][name="amount"]');
    const submit = form?.querySelector('input[type="submit"], button[type="submit"]');
    if (!form || !visible || !hidden || !submit) return;
    const amount = String(Math.max(0, Math.round(Number(job.total) || 0)));
    setNativeValue(visible, amount);
    setNativeValue(hidden, amount);
    if (!job.moneyReadyAt) {
      saveJob({ ...job, moneyReadyAt: Date.now() + 1000, error: '' });
      return;
    }
    if (Date.now() < job.moneyReadyAt) return;
    submit.disabled = false;
    submit.removeAttribute('disabled');
    submit.classList.remove('disabled');
    submit.closest('.btn, .btn-wrap')?.classList.remove('disabled');
    saveJob({ ...job, stage: 'returning', moneyReadyAt: 0, error: '' });
    submit.click();
  }

  function hospitalSecondsRemaining() {
    try {
      const initData = window.topBannerInitData;
      if (initData?.user?.state?.status && initData.user.state.status !== 'hospital') return 0;
    } catch (_) {}
    const header = document.getElementById('topHeaderBanner');
    if (!header) return null;
    const stamp = Number(header.dataset.hospital || 0);
    if (!stamp) return null;
    let serverNow;
    try { serverNow = window.topBannerInitData?.serverState?.currentTime; } catch (_) {}
    const now = serverNow || Math.floor(Date.now() / 1000);
    const remaining = stamp - now;
    return remaining > 0 ? remaining : 0;
  }

  function checkHospitalBloodBag(settings) {
    if (!settings.enabled) return false;
    const remaining = hospitalSecondsRemaining();
    const triggerSecs = Math.max(1, Number(settings.bloodBagTriggerMinutes) || 5) * 60;
    if (remaining === null || remaining <= 0 || remaining > triggerSecs) return false;
    const stamp = Number(document.getElementById('topHeaderBanner')?.dataset.hospital || 0);
    const saved = readJson(BLOODBAG_KEY, null);
    if (saved?.stamp === stamp) return false;
    writeJson(BLOODBAG_KEY, { stamp, at: Date.now() });
    location.assign(`${location.origin}/factions.php?step=your&type=1#/tab=armoury&start=0&sub=medical`);
    return true;
  }

  async function handleFactionArmory() {
    const saved = readJson(BLOODBAG_KEY, null);
    if (!saved) return;
    if (Date.now() - saved.at > BLOODBAG_TIMEOUT_MS) {
      GM_setValue(BLOODBAG_KEY, '');
      location.assign(`${location.origin}/trade.php`);
      return;
    }
    const itemId = String(getSettings().bloodBagItemId || BLOODBAG_ITEM_ID);
    const bloodBag = document.querySelector(`div.item[data-id="${itemId}"]`);
    if (!bloodBag) return;
    GM_setValue(BLOODBAG_KEY, '');
    bloodBag.click();
    setTimeout(() => location.assign(`${location.origin}/trade.php`), 1500);
  }

  async function tick() {
    const settings = getSettings();
    const guard = readJson(NAV_KEY, null);
    if (guard?.target === location.hash.replace(/^#\/?/, '')) GM_setValue(NAV_KEY, '');
    renderStatus();
    remoteStateReport();
    if (!settings.enabled || busy) return;
    // Auto-skip if stuck in an action stage for more than 2 minutes
    const stuckJob = getJob();
    if (stuckJob && AUTO_SKIP_STAGES.has(stuckJob.stage) && stuckJob.stageChangedAt && Date.now() - stuckJob.stageChangedAt > AUTO_SKIP_MS) {
      deferLockedTrade(stuckJob.tradeId);
      navigateTrade();
      return;
    }
    busy = true;
    try {
      let job = getJob();
      if (!job) {
        const apiTrade = await pollOldestOpenTrade(settings);
        if (apiTrade) {
          let lastAcceptedItemSignature = '';
          if (apiTrade.reopened) {
            const completed = readJson(DONE_KEY, {});
            const entry = completed[String(apiTrade.id)];
            lastAcceptedItemSignature = typeof entry === 'object' ? (entry?.itemSignature || '') : '';
            delete completed[String(apiTrade.id)];
            writeJson(DONE_KEY, completed);
          }
          job = { tradeId: String(apiTrade.id), stage: apiTrade.reopened ? 'reopened' : 'opening', startedAt: Date.now(), lastAcceptedItemSignature };
          saveJob(job);
          if (location.pathname.toLowerCase() !== '/trade.php') {
            location.assign(`${location.origin}/trade.php#step=view&ID=${encodeURIComponent(apiTrade.id)}`);
          } else {
            navigateTrade('view', apiTrade.id);
          }
          return;
        }
      }
      if (location.pathname.toLowerCase() === '/factions.php') {
        await handleFactionArmory();
        return;
      }
      if (handlePendingTradeAlert()) return;
      if (checkHospitalBloodBag(settings)) return;
      if (location.pathname.toLowerCase() !== '/trade.php') return;
      if (job?.retryAt && Date.now() < job.retryAt) return;
      const route = parseHash();
      if (route.step === 'view' && route.id) await handleView(settings, job, route.id);
      else if (route.step === 'addmoney' && route.id) await handleAddMoney(job, route.id);
      else if ((route.step === 'accept' || route.step === 'accept2') && route.id) await handleAcceptRoute(job, route);
      else await handleList(settings, job);
    } catch (error) {
      showError(error.message || error);
    } finally {
      busy = false;
    }
  }

  function openSettings() {
    document.getElementById('tta-modal')?.remove();
    const settings = getSettings();
    const overlay = document.createElement('div');
    overlay.id = 'tta-modal';
    overlay.innerHTML = `
      <div class="tta-dialog">
        <h3>Trade Automation Settings</h3>
        <label class="tta-check"><input id="tta-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}> Automation enabled</label>
        <label class="tta-check"><input id="tta-api-polling" type="checkbox" ${settings.apiPolling ? 'checked' : ''}> Poll Torn API for ongoing trades</label>
        <label>Torn limited-access API key
          <input id="tta-api-key" type="password" value="${escapeHtml(settings.apiKey)}" autocomplete="off">
        </label>
        <label>API polling interval <small>(seconds, minimum 15)</small>
          <input id="tta-api-interval" type="number" min="15" max="3600" value="${settings.apiPollSeconds}">
        </label>
        <label>Wait before continuing <small>(seconds)</small>
          <input id="tta-wait" type="number" min="5" max="3600" value="${settings.waitSeconds}">
        </label>
        <label>Use blood bag when hospital time is under <small>(minutes)</small>
          <input id="tta-bloodbag-trigger" type="number" min="1" max="60" value="${settings.bloodBagTriggerMinutes}">
        </label>
        <label>Blood bag type to use
          <select id="tta-bloodbag-type">
            ${BLOODBAG_OPTIONS.map(o => `<option value="${o.id}"${o.id === String(settings.bloodBagItemId || BLOODBAG_ITEM_ID) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <label>Pricing server URL <small>(use http://localhost:3001 for local testing)</small>
          <input id="tta-server-url" type="url" value="${escapeHtml(settings.pricingServerUrl)}">
        </label>
        <label>Initial comment <small>(${MAX_COMMENT} characters maximum)</small>
          <textarea id="tta-request" maxlength="${MAX_COMMENT}">${escapeHtml(settings.requestMessage)}</textarea>
        </label>
        <label>Receipt comment <small>variables: {url}, {total}, {tradeId}</small>
          <textarea id="tta-receipt" maxlength="${MAX_COMMENT}">${escapeHtml(settings.receiptMessage)}</textarea>
        </label>
        <label>Receipt comment with unlisted items <small>variables: {url}, {total}, {unlistedCount}, {tradeId}</small>
          <textarea id="tta-unlisted-items" maxlength="${MAX_COMMENT}">${escapeHtml(settings.unlistedItemsMessage)}</textarea>
        </label>
        <label>Receipt comment with protected prices <small>variables: {url}, {total}, {protectedCount}, {tradeId}</small>
          <textarea id="tta-protected-items" maxlength="${MAX_COMMENT}">${escapeHtml(settings.protectedItemsMessage)}</textarea>
        </label>
        <label>Receipt comment with protected and unlisted items <small>variables: {url}, {total}, {protectedCount}, {unlistedCount}, {tradeId}</small>
          <textarea id="tta-protected-unlisted" maxlength="${MAX_COMMENT}">${escapeHtml(settings.protectedUnlistedItemsMessage)}</textarea>
        </label>
        <label>Insufficient-cash comment <small>variables: {cash}, {total}, {shortfall}, {tradeId}</small>
          <textarea id="tta-insufficient-cash" maxlength="${MAX_COMMENT}">${escapeHtml(settings.insufficientCashMessage)}</textarea>
        </label>
        <label>Thank-you comment <small>(${MAX_COMMENT} characters maximum)</small>
          <textarea id="tta-thanks" maxlength="${MAX_COMMENT}">${escapeHtml(settings.thankYouMessage)}</textarea>
        </label>
        <div class="tta-actions"><button id="tta-reset">Reset Automation</button><span class="tta-action-spacer"></span><button id="tta-cancel">Cancel</button><button id="tta-save">Save</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#tta-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('#tta-reset').addEventListener('click', () => {
      if (!window.confirm('Reset all trade automation settings, active state, and processed-trade history?')) return;
      resetAutomation();
      overlay.remove();
      renderStatus();
    });
    overlay.querySelector('#tta-save').addEventListener('click', () => {
      saveSettings({
        enabled: overlay.querySelector('#tta-enabled').checked,
        apiPolling: overlay.querySelector('#tta-api-polling').checked,
        apiKey: overlay.querySelector('#tta-api-key').value.trim(),
        apiPollSeconds: Math.min(3600, Math.max(15, Number(overlay.querySelector('#tta-api-interval').value) || 30)),
        waitSeconds: Math.min(3600, Math.max(5, Number(overlay.querySelector('#tta-wait').value) || 30)),
        bloodBagTriggerMinutes: Math.min(60, Math.max(1, Number(overlay.querySelector('#tta-bloodbag-trigger').value) || 5)),
        bloodBagItemId: overlay.querySelector('#tta-bloodbag-type').value || BLOODBAG_ITEM_ID,
        pricingServerUrl: overlay.querySelector('#tta-server-url').value.trim().replace(/\/+$/, '') || DEFAULT_APP_URL,
        requestMessage: overlay.querySelector('#tta-request').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.requestMessage,
        receiptMessage: overlay.querySelector('#tta-receipt').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.receiptMessage,
        unlistedItemsMessage: overlay.querySelector('#tta-unlisted-items').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.unlistedItemsMessage,
        protectedItemsMessage: overlay.querySelector('#tta-protected-items').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.protectedItemsMessage,
        protectedUnlistedItemsMessage: overlay.querySelector('#tta-protected-unlisted').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.protectedUnlistedItemsMessage,
        insufficientCashMessage: overlay.querySelector('#tta-insufficient-cash').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.insufficientCashMessage,
        thankYouMessage: overlay.querySelector('#tta-thanks').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.thankYouMessage,
      });
      overlay.remove();
      renderStatus();
      tick();
    });
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
  }

  function counterpartName() {
    const selfId = currentUserId();
    const msgs = document.querySelectorAll('.log li .msg, .trade-log li .msg');
    for (const msg of msgs) {
      const link = msg.querySelector('a[href*="profiles.php?XID="]');
      if (!link) continue;
      const authorId = link.href.match(/[?&]XID=(\d+)/i)?.[1] || '';
      if (selfId && authorId && authorId !== selfId) return link.textContent.trim();
    }
    return '';
  }

  function makePanelDraggable(panel) {
    const POS_KEY = 'tta_panel_pos_v1';
    let dragging = false, startX, startY, startLeft, startTop;
    const saved = readJson(POS_KEY, null);
    if (saved) {
      panel.style.right = 'auto';
      panel.style.left = saved.x + 'px';
      panel.style.top = saved.y + 'px';
    }
    const handle = document.getElementById('tta-drag');
    if (!handle) return;
    function start(e) {
      dragging = true;
      const t = e.touches?.[0] || e;
      startX = t.clientX; startY = t.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      panel.style.right = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      document.addEventListener('mousemove', move);
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('mouseup', stop);
      document.addEventListener('touchend', stop);
    }
    function move(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const t = e.touches?.[0] || e;
      const newX = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + t.clientX - startX));
      const newY = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + t.clientY - startY));
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
    }
    function stop() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('mouseup', stop);
      document.removeEventListener('touchend', stop);
      writeJson(POS_KEY, { x: parseInt(panel.style.left), y: parseInt(panel.style.top) });
    }
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: true });
  }

  function injectUi() {
    if (document.getElementById('tta-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'tta-panel';
    panel.innerHTML = '<span id="tta-drag" title="Drag to move">⠿</span><button id="tta-toggle" type="button"></button><span id="tta-state"></span><span id="tta-bloodbag-status" style="display:none"></span><span id="tta-remote" style="font-size:11px;white-space:nowrap">⬤ …</span><button id="tta-price-now" type="button" style="display:none">Price Now</button><button id="tta-skip" type="button" style="display:none">Skip Trade</button><button id="tta-settings" type="button">Settings</button>';
    document.body.appendChild(panel);
    makePanelDraggable(panel);
    panel.querySelector('#tta-toggle').addEventListener('click', () => {
      const settings = getSettings();
      settings.enabled = !settings.enabled;
      saveSettings(settings);
      renderStatus();
      tick();
    });
    panel.querySelector('#tta-settings').addEventListener('click', openSettings);
    panel.querySelector('#tta-price-now').addEventListener('click', () => {
      const job = getJob();
      if (!job || !['waiting', 'waiting_for_adjustment'].includes(job.stage)) return;
      saveJob(job.stage === 'waiting_for_adjustment'
        ? { ...job, stage: 'pricing', error: '' }
        : { ...job, deadline: Date.now(), error: '' });
      tick();
    });
    panel.querySelector('#tta-skip').addEventListener('click', () => {
      const job = getJob();
      if (!job) return;
      deferLockedTrade(job.tradeId);
      navigateTrade();
    });
  }

  function renderStatus() {
    injectUi();
    const settings = getSettings();
    const job = getJob();
    const toggle = document.getElementById('tta-toggle');
    const state = document.getElementById('tta-state');
    const priceNow = document.getElementById('tta-price-now');
    const skip = document.getElementById('tta-skip');
    const bloodbagStatus = document.getElementById('tta-bloodbag-status');
    const remoteDot = document.getElementById('tta-remote');
    if (!toggle || !state || !priceNow || !skip) return;
    if (remoteDot) {
      const color = remoteStatus === 'ok' ? '#3acc7e' : remoteStatus === 'error' ? '#e05555' : '#888';
      remoteDot.style.color = color;
      remoteDot.textContent = `⬤ ${remoteStatusDetail}`;
    }
    toggle.textContent = settings.enabled ? 'Automation: ON' : 'Automation: OFF';
    toggle.classList.toggle('on', settings.enabled);
    let label = job ? `#${job.tradeId}: ${String(job.stage).replace('_', ' ')}` : 'Idle';
    if (job?.stage === 'waiting') label += ` (${Math.max(0, Math.ceil((job.deadline - Date.now()) / 1000))}s)`;
    if (job?.stage === 'waiting_for_items') label += ' - waiting for items';
    if (job?.stage === 'waiting_for_adjustment') label += ` - only ${money(job.availableCash)} available; waiting for adjusted items`;
    if (job?.stage === 'awaiting_accept') label += ' - click both Torn ACCEPT buttons';
    if (job?.error) label += ` - ${job.error}`;
    state.textContent = label;
    state.title = label;
    priceNow.style.display = settings.enabled && ['waiting', 'waiting_for_adjustment'].includes(job?.stage) ? '' : 'none';
    skip.style.display = settings.enabled && job ? '' : 'none';
    if (bloodbagStatus) {
      const bbSaved = readJson(BLOODBAG_KEY, null);
      if (bbSaved) {
        bloodbagStatus.textContent = 'Using blood bag...';
        bloodbagStatus.style.cssText = 'display:inline;color:#f4b942;font-weight:bold';
      } else {
        bloodbagStatus.style.display = 'none';
      }
    }
  }

  GM_registerMenuCommand('Trade Automation Settings', openSettings);
  GM_registerMenuCommand('Reset Active Trade Job', () => {
    GM_setValue(JOB_KEY, '');
    GM_setValue(NAV_KEY, '');
    GM_setValue(TRADE_ALERT_KEY, '');
    renderStatus();
  });
  GM_registerMenuCommand('Clear Completed Trade History', () => {
    writeJson(DONE_KEY, {});
    renderStatus();
    tick();
  });
  GM_registerMenuCommand('Clear Locked Trade Cooldowns', () => {
    writeJson(LOCKED_KEY, {});
    renderStatus();
    tick();
  });
  const style = document.createElement('style');
  style.textContent = `
    #tta-panel{position:fixed;right:12px;top:12px;z-index:2147483638;display:flex;align-items:center;gap:8px;max-width:min(560px,calc(100vw - 24px));padding:8px;border:1px solid #52606d;border-radius:8px;background:#15191dcc;color:#ddd;font:12px Arial,sans-serif;box-shadow:0 3px 16px #0008;backdrop-filter:blur(5px)}
    #tta-drag{cursor:grab;color:#52606d;font-size:16px;line-height:1;padding:0 2px;user-select:none;flex-shrink:0}#tta-drag:active{cursor:grabbing}
    #tta-panel button{border:1px solid #66717c;border-radius:5px;background:#30363d;color:#eee;padding:5px 8px;cursor:pointer}#tta-panel #tta-toggle.on{border-color:#2e9d59;background:#176b39}#tta-state{min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tta-accept-ready{position:relative!important;z-index:2!important;outline:3px solid #ffd43b!important;box-shadow:0 0 0 5px #ffca2844,0 0 18px 8px #ffd43b99!important;animation:ttaAcceptPulse 1s ease-in-out infinite alternate!important}@keyframes ttaAcceptPulse{from{filter:brightness(1)}to{filter:brightness(1.65)}}
    #tta-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#000a;font:13px Arial,sans-serif}.tta-dialog{width:min(520px,calc(100vw - 30px));max-height:calc(100vh - 30px);overflow:auto;padding:18px;border:1px solid #59636e;border-radius:9px;background:#20252a;color:#eee;box-shadow:0 10px 40px #000}.tta-dialog h3{margin:0 0 14px}.tta-dialog label{display:block;margin:10px 0 4px}.tta-dialog small{color:#aab2ba}.tta-dialog textarea,.tta-dialog input[type=number],.tta-dialog input[type=password],.tta-dialog select{box-sizing:border-box;width:100%;margin-top:5px;padding:7px;border:1px solid #606b76;border-radius:4px;background:#11161a;color:#eee}.tta-dialog textarea{min-height:58px;resize:vertical}.tta-dialog .tta-check{display:flex;gap:7px;align-items:center}.tta-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:16px}.tta-action-spacer{flex:1}.tta-actions button{padding:7px 14px;border:1px solid #64707b;border-radius:5px;background:#343b42;color:#fff;cursor:pointer}.tta-actions #tta-reset{border-color:#a85252;background:#6f2929}.tta-actions #tta-save{border-color:#3d9660;background:#247044}
  `;
  document.head.appendChild(style);

  // ── Remote control (GM_xmlhttpRequest bypasses Torn CSP) ─────────────────────
  let lastRemoteReport = 0;

  function remoteStateReport() {
    const now = Date.now();
    if (now - lastRemoteReport < 2000) return; // at most once per 2 s
    lastRemoteReport = now;
    const job = getJob();
    const settings = getSettings();
    const state = job
      ? { tradeId: job.tradeId, stage: job.stage, error: job.error || '', enabled: settings.enabled, traderName: counterpartName(), startedAt: job.startedAt || null, stageChangedAt: job.stageChangedAt || null }
      : { tradeId: null, stage: 'idle', error: '', enabled: settings.enabled, traderName: '', startedAt: null, stageChangedAt: null };
    GM_xmlhttpRequest({
      method: 'PUT',
      url: `${pricingServer(settings)}/api/trade/state`,
      headers: { 'Content-Type': 'application/json', 'X-Receipt-Token': RECEIPT_TOKEN },
      data: JSON.stringify(state),
      timeout: 8000,
      onload: (r) => {
        remoteStatus = r.status >= 200 && r.status < 300 ? 'ok' : 'error';
        remoteStatusDetail = r.status >= 200 && r.status < 300 ? `OK (${r.status})` : `HTTP ${r.status}`;
        renderStatus();
      },
      onerror: () => { remoteStatus = 'error'; remoteStatusDetail = 'Network error'; renderStatus(); },
      ontimeout: () => { remoteStatus = 'error'; remoteStatusDetail = 'Timeout'; renderStatus(); },
    });
  }

  function remoteCommandPoll() {
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${pricingServer()}/api/trade/command?_=${Date.now()}`,
      headers: { 'X-Receipt-Token': RECEIPT_TOKEN },
      timeout: 8000,
      onload: (response) => {
        try {
          const { command } = JSON.parse(response.responseText);
          if (command === 'skip') {
            const job = getJob();
            if (job) { deferLockedTrade(job.tradeId); navigateTrade(); }
          } else if (command === 'toggle') {
            const s = getSettings();
            s.enabled = !s.enabled;
            saveSettings(s);
            renderStatus();
            tick();
          }
        } catch (_) {}
      },
    });
  }

  GM_deleteValue('tta_completed_trades_v1');
  injectUi();
  setInterval(tick, TICK_MS);
  setInterval(remoteCommandPoll, 2000);
  window.addEventListener('hashchange', () => setTimeout(tick, 500));
  tick();
})();
