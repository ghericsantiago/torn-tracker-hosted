// ==UserScript==
// @name         Torn Tracker — Trade Receipt
// @namespace    torn-tracker-receipt
// @version      3.5
// @description  Generate trade receipts with pricing from your catalog
// @match        https://www.torn.com/trade.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── CONFIG ───────────────────────────────────────────────────────────────────
  // RECEIPT_TOKEN: go to your Admin Dashboard → Settings → "Receipt Token" → Copy
  const APP_URL       = 'https://itrade.devs.surf';
  const RECEIPT_TOKEN = '926cc7e6-5092-40cc-ba8a-a3f9b8070a6c';
  // ─────────────────────────────────────────────────────────────────────────────

  function parseHash() {
    const params = {};
    window.location.hash.replace(/^#\/?/, '').split('&').forEach(p => {
      const [k, v] = p.split('='); if (k) params[k] = v;
    });
    return { step: params.step, id: params.ID };
  }

  function fmt(n) {
    return n == null ? '—' : '$' + Number(n).toLocaleString();
  }

  function gmPost(url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST', url,
        headers: { 'Content-Type': 'application/json', 'X-Receipt-Token': RECEIPT_TOKEN },
        data: JSON.stringify(data),
        onload: r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(new Error('Bad response')); } },
        onerror: () => reject(new Error('Network error')),
      });
    });
  }

  // ── Price Modal ──────────────────────────────────────────────────────────────
  function buildModal(data, tradeId) {
    document.getElementById('tt-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'tt-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:\'Space Grotesk\',sans-serif';

    const itemsCopy = JSON.parse(JSON.stringify(data.items));
    itemsCopy.forEach(item => {
      item._editMode = item.price_mode === 'market_pct' && Number(item.market_price) > 0 ? 'market_pct' : 'fixed';
      item._editValue = item._editMode === 'market_pct' && item.resolved_pct != null
        ? Number((Number(item.resolved_pct) * 100).toFixed(2))
        : Number(item.effective_price) || 0;
      item._manualAdjusted = false;
    });

    const rowsHtml = itemsCopy.map((item, idx) => {
      const drop = item.market_drop_pct != null ? Number(item.market_drop_pct).toFixed(1).replace(/\.0$/, '') + '%' : 'below market';
      const support = item.protection_lowest_price ?? item.market_reference_price;
      const trackedDate = item.market_reference_date ? String(item.market_reference_date).slice(0, 10) : 'latest tracked day';
      const samples = item.market_reference_samples ? `, observed ${item.market_reference_samples} time${Number(item.market_reference_samples) === 1 ? '' : 's'}` : '';
      const protectionHelp = `Protection applied: highest dense level ${fmt(support)} (${drop} below market ${fmt(item.market_price)}) is the median of the highest qualifying 1% price band from ${trackedDate}${samples}. The normal ${(Number(item.resolved_pct || 0) * 100).toFixed(0)}% buy rate changed the unit offer from ${fmt(item.unprotected_price)} to ${fmt(item.effective_price)}.`;
      const protectionBadge = item.market_protection_applied ? `
        <span class="tt-protection" data-idx="${idx}" title="${protectionHelp}" tabindex="0" aria-label="${protectionHelp}"
          style="display:inline-flex;width:17px;height:17px;align-items:center;justify-content:center;border-radius:50%;background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.38);color:#f87171;cursor:help">
          <svg viewBox="0 0 24 24" aria-hidden="true" style="width:11px;height:11px;fill:rgba(248,113,113,.16);stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M12 2.5 20 6v5.3c0 5.1-3.2 8.6-8 10.2-4.8-1.6-8-5.1-8-10.2V6l8-3.5Z"/><path d="m8.7 12 2.1 2.1 4.6-4.7"/></svg>
        </span>` : '';
      const protectionDetail = item.market_protection_applied
        ? `<div class="tt-protection-detail" data-idx="${idx}" style="font:9px monospace;color:#f87171;margin-top:2px">support ${fmt(support)} · −${drop} · was ${fmt(item.unprotected_price)}</div>`
        : '';
      const rateNote = item.price_mode === 'fixed'
        ? ' · fixed item price'
        : item.resolved_pct != null
          ? ` · ${(Number(item.resolved_pct) * 100).toFixed(0)}% mkt`
          : !item.in_catalog ? ' · global rate applied' : '';
      return `
      <tr data-idx="${idx}" style="border-bottom:1px solid rgba(255,255,255,.04);${!item.in_catalog ? 'background:rgba(251,191,36,.04);box-shadow:inset 3px 0 0 #f59e0b;' : ''}">
        <td style="padding:8px 12px">
          <div style="display:flex;align-items:center;gap:8px">
            <img src="https://www.torn.com/images/items/${item.torn_item_id}/large.png"
                 style="width:28px;height:28px;object-fit:contain;border-radius:4px;flex-shrink:0"
                 onerror="this.style.display='none'">
            <div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:13px;color:#e2e8f0">${item.item_name}</span>
                ${!item.in_catalog ? '<span style="font-size:9px;font-family:monospace;background:rgba(251,191,36,.15);color:#f59e0b;border:1px solid rgba(251,191,36,.3);border-radius:4px;padding:1px 5px;letter-spacing:.06em">UNLISTED</span>' : ''}
                ${protectionBadge}
              </div>
              <div style="font-size:10px;color:#64748b">qty: ${item.quantity}${rateNote}</div>
              ${protectionDetail}
            </div>
          </div>
        </td>
        <td style="padding:8px 12px;text-align:right;font-family:monospace;color:#94a3b8;font-size:12px">${fmt(item.market_price)}</td>
        <td style="padding:8px 12px;text-align:right">
          <div style="display:flex;justify-content:flex-end;gap:5px">
            <select class="tt-mode" data-idx="${idx}" style="width:72px;background:#151a2d;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:4px;color:#cbd5e1;font-size:11px;outline:none">
              <option value="fixed" ${item._editMode === 'fixed' ? 'selected' : ''}>Fixed</option>
              <option value="market_pct" ${item._editMode === 'market_pct' ? 'selected' : ''} ${Number(item.market_price) > 0 ? '' : 'disabled'}>Market %</option>
            </select>
            <input type="number" class="tt-price-value" data-idx="${idx}" data-original="${item.effective_price ?? 0}"
              value="${item._editValue}" min="0" step="${item._editMode === 'market_pct' ? '0.1' : '1'}"
              style="width:88px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
                   border-radius:6px;padding:4px 8px;color:#6ee7f7;font-family:monospace;font-size:12px;
                   text-align:right;outline:none">
            <span id="tt-suffix-${idx}" style="width:12px;color:#64748b;font:11px monospace;align-self:center">${item._editMode === 'market_pct' ? '%' : '$'}</span>
          </div>
          <div id="tt-delta-${idx}" style="font-size:10px;font-family:monospace;min-height:14px;text-align:right;margin-top:2px"></div>
        </td>
        <td class="tt-sub" style="padding:8px 12px;text-align:right;font-family:monospace;color:#6ee7f7;font-size:13px">
          ${fmt((item.effective_price ?? 0) * item.quantity)}
        </td>
      </tr>`;
    }).join('');

    let bonusAmount = 0;
    const initTotal = itemsCopy.reduce((s, i) => s + (i.effective_price ?? 0) * i.quantity, 0);

    overlay.innerHTML = `
      <div style="background:#0d1020;border:1px solid rgba(110,231,247,.2);border-radius:14px;
                  width:min(780px,96vw);max-height:88vh;display:flex;flex-direction:column;
                  box-shadow:0 20px 60px rgba(0,0,0,.8);overflow:hidden">
        <div style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between;
                    border-bottom:1px solid rgba(255,255,255,.07);background:rgba(110,231,247,.03);flex-shrink:0">
          <div>
            <div style="font-size:10px;font-family:monospace;color:#64748b;letter-spacing:.1em;text-transform:uppercase">Trade Receipt Preview</div>
            <div style="font-size:15px;font-weight:700;color:#e2e8f0">
              ${data.buyer?.name ?? 'Buyer'} → ${data.seller?.name ?? 'You'}
              <span style="font-size:11px;color:#64748b;font-family:monospace;margin-left:6px">#${tradeId}</span>
            </div>
          </div>
          <button id="tt-close" style="background:none;border:1px solid rgba(255,255,255,.1);color:#64748b;
                  width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:16px;
                  display:flex;align-items:center;justify-content:center">×</button>
        </div>
        <div style="overflow-y:auto;flex:1;min-height:0">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:rgba(255,255,255,.02)">
                <th style="padding:8px 12px;text-align:left;font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.09em;border-bottom:1px solid rgba(255,255,255,.07)">Item</th>
                <th style="padding:8px 12px;text-align:right;font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.09em;border-bottom:1px solid rgba(255,255,255,.07)">Market</th>
                <th style="padding:8px 12px;text-align:right;font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.09em;border-bottom:1px solid rgba(255,255,255,.07)">Unit Offer</th>
                <th style="padding:8px 12px;text-align:right;font-family:monospace;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.09em;border-bottom:1px solid rgba(255,255,255,.07)">Subtotal</th>
              </tr>
            </thead>
            <tbody id="tt-body">${rowsHtml}</tbody>
            <tfoot>
              <tr style="border-top:1px solid rgba(255,255,255,.1)">
                <td colspan="2" style="padding:10px 12px;text-align:right;font-size:11px;color:#64748b;font-family:monospace;text-transform:uppercase;letter-spacing:.08em">Total</td>
                <td colspan="2" style="padding:8px 12px">
                  <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px">
                    <span style="color:#64748b;font:13px monospace;font-weight:700">$</span>
                    <input type="number" id="tt-total-input" value="${initTotal}" min="0" step="1000"
                      style="width:150px;background:rgba(110,231,247,.05);border:1px solid rgba(110,231,247,.2);
                             border-radius:6px;padding:5px 10px;color:#6ee7f7;font-family:monospace;
                             font-size:16px;font-weight:700;text-align:right;outline:none">
                    <button id="tt-copy-total" title="Copy total to clipboard"
                      style="background:none;border:1px solid rgba(255,255,255,.1);color:#64748b;
                             width:28px;height:28px;border-radius:7px;cursor:pointer;font-size:14px;
                             display:flex;align-items:center;justify-content:center;flex-shrink:0;
                             transition:color .15s,border-color .15s">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                  </div>
                  <div id="tt-adj-hint" style="font-size:10px;font-family:monospace;text-align:right;margin-top:3px;min-height:14px;color:#64748b"></div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style="padding:12px 18px;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:8px">
          <span id="tt-status" style="font-size:11px;font-family:monospace;color:#64748b;flex:1"></span>
          <button id="tt-cancel" style="background:none;border:1px solid rgba(255,255,255,.1);color:#94a3b8;padding:6px 16px;border-radius:7px;cursor:pointer;font-size:12px">Cancel</button>
          <button id="tt-refresh" style="background:none;border:1px solid rgba(110,231,247,.25);color:#6ee7f7;padding:6px 16px;border-radius:7px;cursor:pointer;font-size:12px">↻ Refresh</button>
          <button id="tt-confirm" style="background:#6ee7f7;color:#07080f;border:none;padding:6px 20px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">Confirm & Create Receipt</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // No separate clipboard target needed — user can select the input value directly

    function recalcTotalRow() {
      const itemsTotal = itemsCopy.reduce((s, i) => s + (i.effective_price ?? 0) * i.quantity, 0);
      // Keep bonus locked — update the displayed total to reflect item price changes + bonus
      const totalInput = document.getElementById('tt-total-input');
      if (totalInput) totalInput.value = itemsTotal + bonusAmount;
      const hintEl = document.getElementById('tt-adj-hint');
      if (!hintEl) return;
      if (bonusAmount === 0) {
        hintEl.textContent = '';
      } else {
        const pos = bonusAmount > 0;
        const n = itemsCopy.length;
        const perItem = Math.round(Math.abs(bonusAmount) / n);
        hintEl.textContent = `${pos ? '+' : '−'}${fmt(Math.abs(bonusAmount))} adjustment ÷ ${n} items ≈ ${fmt(perItem)} each`;
        hintEl.style.color = pos ? '#4ade80' : '#f87171';
      }
    }

    // Live recalculate for either an exact fixed unit price or a percentage of market value.
    function recalculateItem(idx) {
        const input = overlay.querySelector(`.tt-price-value[data-idx="${idx}"]`);
        const mode = overlay.querySelector(`.tt-mode[data-idx="${idx}"]`).value;
        const entered = Math.max(0, Number(input.value) || 0);
        const market = Number(itemsCopy[idx].market_price) || 0;
        const unit = mode === 'market_pct' ? Math.round(market * entered / 100) : Math.round(entered);
        const original = Number(input.dataset.original) || 0;
        itemsCopy[idx]._editMode = mode;
        itemsCopy[idx]._editValue = entered;
        itemsCopy[idx]._manualAdjusted = true;
        itemsCopy[idx].effective_price = unit;
        const row = overlay.querySelector(`tr[data-idx="${idx}"]`);
        const protectionBadge = row.querySelector('.tt-protection');
        const protectionDetail = row.querySelector('.tt-protection-detail');
        if (protectionBadge) {
          protectionBadge.style.opacity = '.4';
          protectionBadge.title = 'Manual offer adjustment will replace automatic market protection.';
        }
        if (protectionDetail) protectionDetail.textContent = 'manual adjustment replaces protection';
        row.querySelector('.tt-sub').textContent = fmt(unit * itemsCopy[idx].quantity);
        recalcTotalRow();

        const deltaEl = document.getElementById(`tt-delta-${idx}`);
        if (deltaEl && original > 0 && unit !== original) {
          const pct = Math.abs(((unit - original) / original) * 100).toFixed(1);
          if (unit > original) {
            deltaEl.textContent = '↑ +' + pct + '% discount';
            deltaEl.style.color = '#4ade80';
          } else {
            deltaEl.textContent = '↓ −' + pct + '% below rate';
            deltaEl.style.color = '#f87171';
          }
        } else if (deltaEl) {
          deltaEl.textContent = '';
        }
    }

    overlay.querySelectorAll('.tt-price-value').forEach(input => {
      input.addEventListener('input', () => recalculateItem(Number(input.dataset.idx)));
    });
    overlay.querySelectorAll('.tt-mode').forEach(select => {
      select.addEventListener('change', () => {
        const idx = Number(select.dataset.idx);
        const input = overlay.querySelector(`.tt-price-value[data-idx="${idx}"]`);
        const currentUnit = Number(itemsCopy[idx].effective_price) || 0;
        if (select.value === 'market_pct') {
          const market = Number(itemsCopy[idx].market_price) || 0;
          input.value = market > 0 ? Number((currentUnit / market * 100).toFixed(2)) : 0;
          input.step = '0.1';
          document.getElementById(`tt-suffix-${idx}`).textContent = '%';
        } else {
          input.value = currentUnit;
          input.step = '1';
          document.getElementById(`tt-suffix-${idx}`).textContent = '$';
        }
        recalculateItem(idx);
      });
    });

    document.getElementById('tt-total-input').addEventListener('input', () => {
      const itemsTotal = itemsCopy.reduce((s, i) => s + (i.effective_price ?? 0) * i.quantity, 0);
      const entered = Math.round(Number(document.getElementById('tt-total-input').value) || 0);
      bonusAmount = entered - itemsTotal;
      recalcTotalRow();
    });

    document.getElementById('tt-copy-total').addEventListener('click', () => {
      const val = document.getElementById('tt-total-input').value;
      navigator.clipboard.writeText(val).then(() => {
        const btn = document.getElementById('tt-copy-total');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.style.color = '#4ade80';
        btn.style.borderColor = 'rgba(74,222,128,.4)';
        setTimeout(() => {
          btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          btn.style.color = '#64748b';
          btn.style.borderColor = 'rgba(255,255,255,.1)';
        }, 1500);
      }).catch(() => {});
    });

    const close = () => overlay.remove();
    document.getElementById('tt-close').addEventListener('click', close);
    document.getElementById('tt-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    document.getElementById('tt-refresh').addEventListener('click', async () => {
      const btn = document.getElementById('tt-refresh');
      btn.textContent = 'Refreshing…';
      btn.disabled = true;
      try {
        const fresh = await gmPost(`${APP_URL}/api/receipt/preview`, { trade_id: Number(tradeId) });
        if (fresh.error) {
          document.getElementById('tt-status').textContent = 'Refresh failed: ' + fresh.error;
          document.getElementById('tt-status').style.color = '#f87171';
          btn.textContent = '↻ Refresh'; btn.disabled = false;
          return;
        }
        overlay.remove();
        buildModal(fresh, tradeId);
      } catch (e) {
        document.getElementById('tt-status').textContent = 'Network error — try again';
        document.getElementById('tt-status').style.color = '#f87171';
        btn.textContent = '↻ Refresh'; btn.disabled = false;
      }
    });

    document.getElementById('tt-confirm').addEventListener('click', async () => {
      const btn    = document.getElementById('tt-confirm');
      const status = document.getElementById('tt-status');
      btn.disabled = true;
      btn.textContent = 'Creating…';

      // Distribute bonus equally across items (extra total ÷ qty = unit price adj)
      const n = itemsCopy.length;
      const bonusPerItem = Array.from({ length: n }, (_, i) =>
        i === n - 1
          ? bonusAmount - Math.round(bonusAmount / n) * (n - 1)
          : Math.round(bonusAmount / n)
      );

      const overrides = itemsCopy.map((i, idx) => ({
        torn_item_id: i.torn_item_id,
        unit_price:   (i.effective_price ?? 0) + (n > 0 ? Math.round(bonusPerItem[idx] / i.quantity) : 0),
        override_price_mode: i._editMode,
        override_market_pct: i._editMode === 'market_pct' ? (Number(i._editValue) || 0) / 100 : null,
        market_protection_applied: i.market_protection_applied === true && !i._manualAdjusted,
        market_drop_pct: i.market_drop_pct ?? null,
        market_protection_threshold_pct: i.market_protection_threshold_pct ?? null,
        unprotected_price: i.unprotected_price ?? null,
        protection_lowest_price: i.protection_lowest_price ?? i.market_reference_price ?? null,
        protection_market_value: i.protection_market_value ?? i.market_price ?? null,
      }));

      try {
        const result = await gmPost(`${APP_URL}/api/receipt/create`, {
          trade_id: tradeId,
          items_override: overrides,
        });

        if (result.error) {
          status.textContent = 'Error: ' + result.error;
          status.style.color = '#f87171';
          btn.disabled = false;
          btn.textContent = 'Confirm & Create Receipt';
          return;
        }

        GM_setValue(`receipt_${tradeId}`, result.short_id || result.id);

        // Auto-fill comment box (max 155 chars)
        const commentText = `Receipt: ${APP_URL}${result.url} | Total: ${fmt(result.total)}`;
        const textarea = document.getElementById('postTradeMessage');
        if (textarea) {
          textarea.value = commentText.slice(0, 155);
          ['input', 'change'].forEach(ev =>
            textarea.dispatchEvent(new Event(ev, { bubbles: true }))
          );
          const addBtn = textarea.closest('form')?.querySelector('input[type="submit"]');
          if (addBtn) addBtn.disabled = false;
        }

        close();
        handleView(tradeId);
        showWidget(result.id, result.url, result.total);
      } catch (e) {
        status.textContent = 'Network error — try again';
        status.style.color = '#f87171';
        btn.disabled = false;
        btn.textContent = 'Confirm & Create Receipt';
      }
    });
  }

  // ── Confirmation widget ──────────────────────────────────────────────────────
  function showWidget(receiptId, url, total) {
    document.getElementById('tt-widget')?.remove();
    const w = document.createElement('div');
    w.id = 'tt-widget';
    w.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:2147483639;background:#0d1020;border:1px solid rgba(110,231,247,.25);border-radius:10px;padding:12px 16px;min-width:220px;font-family:\'Space Grotesk\',sans-serif;font-size:13px;color:#e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,.5)';
    w.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="color:#6ee7f7;font-size:10px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em">Receipt Created ✓</span>
        <button onclick="document.getElementById('tt-widget').remove()"
                style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;line-height:1">×</button>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">
        Total: <span style="color:#6ee7f7;font-family:monospace">${fmt(total)}</span>
      </div>
      <a href="${APP_URL}${url}" target="_blank"
         style="display:block;font-size:11px;color:#6ee7f7;text-decoration:none;opacity:.8">
        View Receipt →
      </a>`;
    document.body.appendChild(w);
  }

  // ── Inject "Get Price" button ─────────────────────────────────────────────────
  function injectPriceBtn(anchor, tradeId) {
    document.getElementById('tt-price-btn')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'tt-price-btn';
    wrap.style.cssText = 'margin:8px 0';
    wrap.innerHTML = `
      <button id="tt-price-inner"
              style="background:rgba(110,231,247,.1);color:#6ee7f7;border:1px solid rgba(110,231,247,.25);
                     border-radius:7px;padding:6px 18px;font-size:12px;font-weight:600;
                     font-family:'Space Grotesk',sans-serif;cursor:pointer;letter-spacing:.02em">
        💰 Get Price
      </button>`;
    anchor.before(wrap);

    document.getElementById('tt-price-inner').addEventListener('click', async () => {
      const btn = document.getElementById('tt-price-inner');
      btn.textContent = 'Loading…';
      btn.disabled = true;
      try {
        const data = await gmPost(`${APP_URL}/api/receipt/preview`, { trade_id: Number(tradeId) });
        btn.textContent = '💰 Get Price';
        btn.disabled = false;
        if (data.error) { btn.textContent = '⚠ ' + data.error; return; }
        buildModal(data, Number(tradeId));
      } catch (e) {
        btn.textContent = '⚠ Network Error';
        btn.disabled = false;
      }
    });
  }

  let viewObserver = null;

  function stopViewObserver() {
    if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
    document.getElementById('tt-price-btn')?.remove();
  }

  function handleView(tradeId) {
    stopViewObserver();

    const inject = () => {
      const textarea = document.getElementById('postTradeMessage');
      if (!textarea) return;
      if (!document.getElementById('tt-price-btn')) injectPriceBtn(textarea, tradeId);
    };

    inject();
    viewObserver = new MutationObserver(inject);
    viewObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── Mark receipt complete when trade is accepted ───────────────────────────
  async function handleAccept2(tradeId) {
    const receiptId = await GM_getValue(`receipt_${tradeId}`);
    if (!receiptId) return;
    try {
      await gmPost(`${APP_URL}/api/receipt/${receiptId}/complete`, {});
    } catch (_) {}
  }

  // ── Hash change watcher ────────────────────────────────────────────────────
  let lastHash = '', debounce = null;

  function onHashChange() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const hash = window.location.hash;
      if (hash === lastHash) return;
      lastHash = hash;
      stopViewObserver();

      const { step, id } = parseHash();
      if (!id) return;

      if (step === 'view')    handleView(id);
      if (step === 'accept2') handleAccept2(id);
    }, 200);
  }

  window.addEventListener('hashchange', onHashChange);
  onHashChange();
})();
