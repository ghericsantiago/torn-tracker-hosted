// ==UserScript==
// @name         Torn Tracker - Trade Automation
// @namespace    torn-tracker-trade-automation
// @version      1.5.0
// @description  Queue current trades, wait for items, create a receipt, and add the quoted money
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const APP_URL = 'https://itrade.devs.surf';
  const RECEIPT_TOKEN = '926cc7e6-5092-40cc-ba8a-a3f9b8070a6c';
  const SETTINGS_KEY = 'tta_settings_v1';
  const JOB_KEY = 'tta_active_job_v1';
  const DONE_KEY = 'tta_completed_trades_v1';
  const NAV_KEY = 'tta_navigation_guard_v1';
  const TRADE_ALERT_KEY = 'tta_pending_trade_alert_v1';
  const MAX_COMMENT = 155;
  const TICK_MS = 1000;
  const NAV_GUARD_MS = 60000;

  const DEFAULTS = {
    enabled: false,
    waitSeconds: 60,
    requestMessage: 'Hi! Please add your items. Thanks',
    receiptMessage: 'Receipt: {url} | Total: {total}',
    thankYouMessage: 'Thank you for trading with me!',
  };

  let busy = false;
  const skippedThisPage = new Set();

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

  function resetAutomation() {
    saveSettings({ ...DEFAULTS });
    GM_setValue(JOB_KEY, '');
    writeJson(DONE_KEY, {});
    GM_setValue(NAV_KEY, '');
    GM_setValue(TRADE_ALERT_KEY, '');
    skippedThisPage.clear();
  }

  function getJob() {
    return readJson(JOB_KEY, null);
  }

  function saveJob(job) {
    writeJson(JOB_KEY, job);
    renderStatus();
  }

  function clearJob(tradeId) {
    const completed = readJson(DONE_KEY, {});
    completed[String(tradeId)] = Date.now();
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    Object.keys(completed).forEach(id => {
      if (completed[id] < cutoff) delete completed[id];
    });
    writeJson(DONE_KEY, completed);
    GM_setValue(JOB_KEY, '');
    renderStatus();
  }

  function abandonJob(tradeId) {
    skippedThisPage.add(String(tradeId));
    GM_setValue(JOB_KEY, '');
    renderStatus();
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
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out')),
        timeout: 20000,
      });
    });
  }

  function submitComment(text, nextJob) {
    const control = findCommentControl();
    const form = control?.closest('form');
    if (!control || !form) return false;
    setNativeValue(control, String(text).slice(0, MAX_COMMENT));
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
    const done = readJson(DONE_KEY, {});
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
        return id && !done[id] && !skippedThisPage.has(String(id))
          ? { row, link, id, expires: expirySeconds(row) }
          : null;
      })
      .filter(Boolean);
    candidates.sort((a, b) => a.expires - b.expires);
    return candidates[0] || null;
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

  async function createReceipt(job) {
    const preview = await gmPost(`${APP_URL}/api/receipt/preview`, { trade_id: Number(job.tradeId) });
    if (preview.error) throw new Error(preview.error);
    const items = Array.isArray(preview.items) ? preview.items : [];
    if (items.length === 0) return null;
    const result = await gmPost(`${APP_URL}/api/receipt/create`, {
      trade_id: Number(job.tradeId),
      items_override: items.map(item => ({
        torn_item_id: item.torn_item_id,
        unit_price: item.effective_price ?? 0,
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
      saveJob({ tradeId: oldest.id, stage: 'opening', startedAt: Date.now() });
      navigateTrade('view', oldest.id);
      return;
    }
  }

  async function handleView(settings, job, id) {
    if (!job || String(job.tradeId) !== String(id)) {
      navigateTrade();
      return;
    }

    if (job.stage === 'opening') {
      if (!findCommentControl()) return;
      const next = {
        ...job,
        stage: 'waiting',
        askedAt: Date.now(),
        deadline: Date.now() + (settings.waitSeconds * 1000),
        error: '',
      };
      if (!submitComment(settings.requestMessage, next)) throw new Error('Comment form not found');
      return;
    }

    if (job.stage === 'waiting') {
      if (Date.now() < job.deadline) return;
      saveJob({ ...job, stage: 'pricing', error: '' });
      job = getJob();
    }

    if (job.stage === 'pricing') {
      // Wait for Torn's asynchronously rendered comment form before creating
      // anything server-side, otherwise a retry could create two receipts.
      if (!findCommentControl()) return;
      const receipt = await createReceipt(job);
      if (!receipt) {
        abandonJob(job.tradeId);
        navigateTrade();
        return;
      }
      const receiptUrl = `${APP_URL}${receipt.url}`;
      GM_setValue(`receipt_${job.tradeId}`, receipt.short_id || receipt.id);
      const message = settings.receiptMessage
        .replaceAll('{url}', receiptUrl)
        .replaceAll('{total}', money(receipt.total))
        .replaceAll('{tradeId}', String(job.tradeId));
      const next = {
        ...job,
        stage: 'receipt_posted',
        receiptPostedAt: Date.now(),
        total: Math.round(Number(receipt.total) || 0),
        receiptId: receipt.short_id || receipt.id,
        receiptUrl,
        error: '',
      };
      if (!submitComment(message, next)) throw new Error('Comment form not found');
      return;
    }

    if (job.stage === 'receipt_posted' || job.stage === 'add_money') {
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
        document.querySelector('.tta-accept-ready').click();
      }, 1000);
      saveJob({ ...job, stage: 'awaiting_accept', error: '' });
      job = getJob();
    }

    if (job.stage === 'awaiting_accept') {
      setTimeout(() => {
        document.querySelector('.tta-accept-ready').click();
      }, 8000);
      highlightAcceptControl();
      return;
    }

    if (job.stage === 'complete') {
      clearJob(job.tradeId);
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
          await gmPost(`${APP_URL}/api/receipt/${job.receiptId}/complete`, {});
        } catch (_) {}
      }
      saveJob({ ...job, stage: 'complete', error: '' });
      clearJob(job.tradeId);
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

  async function tick() {
    const settings = getSettings();
    const guard = readJson(NAV_KEY, null);
    if (guard?.target === location.hash.replace(/^#\/?/, '')) GM_setValue(NAV_KEY, '');
    renderStatus();
    if (!settings.enabled || busy) return;
    if (handlePendingTradeAlert()) return;
    if (location.pathname.toLowerCase() !== '/trade.php') return;
    const job = getJob();
    if (job?.retryAt && Date.now() < job.retryAt) return;
    busy = true;
    try {
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
        <label>Wait before continuing <small>(seconds)</small>
          <input id="tta-wait" type="number" min="5" max="3600" value="${settings.waitSeconds}">
        </label>
        <label>Initial comment <small>(${MAX_COMMENT} characters maximum)</small>
          <textarea id="tta-request" maxlength="${MAX_COMMENT}">${escapeHtml(settings.requestMessage)}</textarea>
        </label>
        <label>Receipt comment <small>variables: {url}, {total}, {tradeId}</small>
          <textarea id="tta-receipt" maxlength="${MAX_COMMENT}">${escapeHtml(settings.receiptMessage)}</textarea>
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
        waitSeconds: Math.min(3600, Math.max(5, Number(overlay.querySelector('#tta-wait').value) || 30)),
        requestMessage: overlay.querySelector('#tta-request').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.requestMessage,
        receiptMessage: overlay.querySelector('#tta-receipt').value.trim().slice(0, MAX_COMMENT) || DEFAULTS.receiptMessage,
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

  function injectUi() {
    if (document.getElementById('tta-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'tta-panel';
    panel.innerHTML = '<button id="tta-toggle" type="button"></button><span id="tta-state"></span><button id="tta-price-now" type="button" style="display:none">Price Now</button><button id="tta-settings" type="button">Settings</button>';
    document.body.appendChild(panel);
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
      if (!job || job.stage !== 'waiting') return;
      saveJob({ ...job, deadline: Date.now(), error: '' });
      tick();
    });
  }

  function renderStatus() {
    injectUi();
    const settings = getSettings();
    const job = getJob();
    const toggle = document.getElementById('tta-toggle');
    const state = document.getElementById('tta-state');
    const priceNow = document.getElementById('tta-price-now');
    if (!toggle || !state || !priceNow) return;
    toggle.textContent = settings.enabled ? 'Automation: ON' : 'Automation: OFF';
    toggle.classList.toggle('on', settings.enabled);
    let label = job ? `#${job.tradeId}: ${String(job.stage).replace('_', ' ')}` : 'Idle';
    if (job?.stage === 'waiting') label += ` (${Math.max(0, Math.ceil((job.deadline - Date.now()) / 1000))}s)`;
    if (job?.stage === 'awaiting_accept') label += ' - click both Torn ACCEPT buttons';
    if (job?.error) label += ` - ${job.error}`;
    state.textContent = label;
    state.title = label;
    priceNow.style.display = settings.enabled && job?.stage === 'waiting' ? '' : 'none';
  }

  GM_registerMenuCommand('Trade Automation Settings', openSettings);
  GM_registerMenuCommand('Reset Active Trade Job', () => {
    GM_setValue(JOB_KEY, '');
    GM_setValue(NAV_KEY, '');
    GM_setValue(TRADE_ALERT_KEY, '');
    renderStatus();
  });
  GM_registerMenuCommand('Clear Processed Trade History', () => {
    writeJson(DONE_KEY, {});
    skippedThisPage.clear();
    renderStatus();
    tick();
  });

  const style = document.createElement('style');
  style.textContent = `
    #tta-panel{position:fixed;right:12px;top:12px;z-index:2147483638;display:flex;align-items:center;gap:8px;max-width:min(560px,calc(100vw - 24px));padding:8px;border:1px solid #52606d;border-radius:8px;background:#15191dcc;color:#ddd;font:12px Arial,sans-serif;box-shadow:0 3px 16px #0008;backdrop-filter:blur(5px)}
    #tta-panel button{border:1px solid #66717c;border-radius:5px;background:#30363d;color:#eee;padding:5px 8px;cursor:pointer}#tta-panel #tta-toggle.on{border-color:#2e9d59;background:#176b39}#tta-state{min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tta-accept-ready{position:relative!important;z-index:2!important;outline:3px solid #ffd43b!important;box-shadow:0 0 0 5px #ffca2844,0 0 18px 8px #ffd43b99!important;animation:ttaAcceptPulse 1s ease-in-out infinite alternate!important}@keyframes ttaAcceptPulse{from{filter:brightness(1)}to{filter:brightness(1.65)}}
    #tta-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#000a;font:13px Arial,sans-serif}.tta-dialog{width:min(520px,calc(100vw - 30px));padding:18px;border:1px solid #59636e;border-radius:9px;background:#20252a;color:#eee;box-shadow:0 10px 40px #000}.tta-dialog h3{margin:0 0 14px}.tta-dialog label{display:block;margin:10px 0 4px}.tta-dialog small{color:#aab2ba}.tta-dialog textarea,.tta-dialog input[type=number]{box-sizing:border-box;width:100%;margin-top:5px;padding:7px;border:1px solid #606b76;border-radius:4px;background:#11161a;color:#eee}.tta-dialog textarea{min-height:58px;resize:vertical}.tta-dialog .tta-check{display:flex;gap:7px;align-items:center}.tta-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:16px}.tta-action-spacer{flex:1}.tta-actions button{padding:7px 14px;border:1px solid #64707b;border-radius:5px;background:#343b42;color:#fff;cursor:pointer}.tta-actions #tta-reset{border-color:#a85252;background:#6f2929}.tta-actions #tta-save{border-color:#3d9660;background:#247044}
  `;
  document.head.appendChild(style);

  injectUi();
  setInterval(tick, TICK_MS);
  window.addEventListener('hashchange', () => setTimeout(tick, 500));
  tick();
})();
