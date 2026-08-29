// ==UserScript==
// @name         Bazaar Quick Remove
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @author       Gheric
// @description  Adds a trash icon to each bazaar manage item that fills the remove field with the item's full quantity
// @license      MIT
// @match        https://www.torn.com/bazaar.php*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function isManagePage() {
    return location.pathname.endsWith('/bazaar.php') &&
      !location.hash.startsWith('#/add');
  }

  GM_addStyle(`
    .bqr-bin-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: transparent;
      border: 1px solid rgba(220, 53, 69, 0.45);
      border-radius: 3px;
      color: rgba(220, 53, 69, 0.65);
      cursor: pointer;
      padding: 2px 4px;
      margin-right: 4px;
      line-height: 1;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .bqr-bin-btn:hover {
      background: rgba(220, 53, 69, 0.15);
      border-color: rgba(220, 53, 69, 0.85);
      color: #dc3545;
    }
    .bqr-bin-btn.bqr-done {
      background: rgba(34, 197, 94, 0.15);
      border-color: rgba(34, 197, 94, 0.75);
      color: #22c55e;
      pointer-events: none;
    }
    .bqr-bin-btn.bqr-mobile {
      width: 30px;
      min-width: 30px;
      height: 28px;
      margin-right: 0;
      margin-left: 0;
    }
    /* Keep the remove column flex so the icon fits beside the input */
    .remove___KBNXE {
      display: flex !important;
      align-items: center;
    }
  `);

  const BIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`;

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  function triggerReact(input, value) {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function parseQuantity(row) {
    const span = row.querySelector('.desc___TpUlk span');
    if (!span) return null;
    const m = span.textContent.match(/x(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function findRemoveInput(row) {
    return row.querySelector('.removeAmountInput___ILDPv') ||
      row.querySelector('.remove___KBNXE input[type="text"]');
  }

  function isMobileRow(row) {
    return !!row.querySelector('.mobileContainer___IP3uc');
  }

  async function handleBinClick(row, btn) {
    if (btn.classList.contains('bqr-done')) return;

    const qty = parseQuantity(row);
    if (!qty) return;

    // Mobile: expand the Manage panel so the remove input is rendered
    if (isMobileRow(row)) {
      const manageBtn = row.querySelector('.mobileContainer___IP3uc button[aria-label="Manage"]');
      if (manageBtn && !findRemoveInput(row)) {
        manageBtn.click();
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 50));
          if (findRemoveInput(row)) break;
        }
      }
    }

    const input = findRemoveInput(row);
    if (!input) return;

    triggerReact(input, String(qty));

    btn.classList.add('bqr-done');
    btn.title = `Queued for removal: ${qty} — click Save Changes`;
    setTimeout(() => btn.classList.remove('bqr-done'), 2500);
  }

  function injectRow(row) {
    if (row.dataset.bqrInjected) return;

    const removeDiv  = row.querySelector('.remove___KBNXE');
    const mobileArea = row.querySelector('.mobileContainer___IP3uc .menuActivators___I7505');

    if (!removeDiv && !mobileArea) return;

    row.dataset.bqrInjected = '1';

    const mobile = isMobileRow(row);
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'bqr-bin-btn' + (mobile ? ' bqr-mobile' : '');
    btn.title     = 'Fill remove field with max quantity';
    btn.innerHTML = BIN_SVG;
    btn.addEventListener('click', e => { e.stopPropagation(); handleBinClick(row, btn); });

    if (mobile) {
      const manageBtn = mobileArea.querySelector('button[aria-label="Manage"]');
      mobileArea.insertBefore(btn, manageBtn || null);
    } else {
      // Prepend before the input inside the remove column
      removeDiv.insertBefore(btn, removeDiv.firstChild);
    }
  }

  let bazaarList     = null;
  let listObserver   = null;

  function scanRows(root) {
    root.querySelectorAll('div.row___mbuuh[data-testid="sortable-item"]').forEach(injectRow);
  }

  function startObserver() {
    const list = document.querySelector('div[data-testid="virtualized-list"]');
    if (!list) {
      setTimeout(startObserver, 800);
      return;
    }
    if (list === bazaarList && listObserver) {
      scanRows(list);
      return;
    }
    if (listObserver) listObserver.disconnect();
    bazaarList = list;
    scanRows(list);
    listObserver = new MutationObserver(() => scanRows(list));
    listObserver.observe(list, { childList: true, subtree: true });
  }

  function init() {
    if (!isManagePage()) return;
    startObserver();
  }

  window.addEventListener('hashchange', init);
  init();

  // Reattach if Torn replaces the manage list during a React re-render
  let rebindQueued = false;
  new MutationObserver(() => {
    if (!isManagePage()) return;
    if (bazaarList?.isConnected && listObserver) return;
    if (rebindQueued) return;
    rebindQueued = true;
    requestAnimationFrame(() => { rebindQueued = false; startObserver(); });
  }).observe(document.body, { childList: true, subtree: true });
})();
