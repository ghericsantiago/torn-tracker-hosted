(function () {
  'use strict';

  // ── Settings modal ──
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.remove('hidden');
  });
  document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('hidden');
  });
  document.getElementById('settingsOverlay').addEventListener('click', () => {
    document.getElementById('settingsModal').classList.add('hidden');
  });

  // ── Logout ──
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/admin/logout', { method: 'POST' });
    window.location.href = '/admin';
  });

  // ── Fetch helpers ──
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) { window.location.href = '/admin'; return null; }
    return res;
  }

  // ── Settings / setup ──
  let storedApiKey = '';

  async function loadSettings() {
    const res = await api('/admin/api/settings');
    if (!res || !res.ok) return;
    const s = await res.json();
    storedApiKey = s.torn_api_key || '';
    updateSyncUI(s);
    if (storedApiKey) {
      document.getElementById('addApiKey').value = storedApiKey;
    } else {
      showSetupModal();
    }
  }

  function updateSyncUI(s) {
    const count = Number(s.items_count || 0);
    document.getElementById('syncCount').textContent =
      count ? `${count.toLocaleString()} items in DB` : 'Items not synced yet';
    document.getElementById('syncTime').textContent = s.items_synced_at
      ? `Last synced: ${new Date(s.items_synced_at).toLocaleString()}`
      : '';
    if (s.retention_days) document.getElementById('retentionDays').value = s.retention_days;
    document.getElementById('cleanupTime').textContent = s.last_cleanup_at
      ? `Last cleanup: ${new Date(s.last_cleanup_at).toLocaleString()}`
      : '';
  }

  document.getElementById('saveRetentionBtn').addEventListener('click', async () => {
    const days = document.getElementById('retentionDays').value;
    const btn  = document.getElementById('saveRetentionBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    await api('/admin/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ retention_days: days || '0' }),
    });
    btn.disabled = false; btn.textContent = 'Save';
  });

  document.getElementById('runCleanupBtn').addEventListener('click', async () => {
    const btn = document.getElementById('runCleanupBtn');
    btn.disabled = true; btn.textContent = 'Running…';
    const res = await api('/admin/api/cleanup', { method: 'POST' });
    btn.disabled = false; btn.textContent = 'Run Now';
    if (res && res.ok) {
      const d = await res.json();
      document.getElementById('cleanupTime').textContent =
        `Last cleanup: ${new Date(d.cleaned_at).toLocaleString()} · ${d.deleted} deleted`;
    }
  });

  async function syncItems() {
    const btn = document.getElementById('syncItemsBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const res = await api('/admin/api/sync-items', { method: 'POST' });
      if (res && res.ok) {
        const d = await res.json();
        document.getElementById('syncCount').textContent = `${Number(d.count).toLocaleString()} items in DB`;
        document.getElementById('syncTime').textContent  = `Last synced: ${new Date(d.synced_at).toLocaleString()}`;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync Items';
    }
  }

  document.getElementById('syncItemsBtn').addEventListener('click', syncItems);

  function showSetupModal() {
    document.getElementById('setupModal').classList.remove('hidden');
    document.getElementById('setupApiKey').focus();
  }

  document.getElementById('setupSave').addEventListener('click', async () => {
    const key = document.getElementById('setupApiKey').value.trim();
    const err = document.getElementById('setupError');
    err.classList.add('hidden');
    if (!key) {
      err.textContent = 'Please enter your Torn API key.';
      err.classList.remove('hidden');
      return;
    }
    const btn = document.getElementById('setupSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const saveRes = await api('/admin/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ torn_api_key: key }),
    });
    if (!saveRes || !saveRes.ok) {
      btn.disabled = false;
      btn.textContent = 'Save & Continue';
      const d = await saveRes?.json() || {};
      err.textContent = d.error || 'Failed to save key.';
      err.classList.remove('hidden');
      return;
    }
    storedApiKey = key;
    document.getElementById('addApiKey').value = key;

    // Sync items right away
    btn.textContent = 'Syncing items…';
    const syncRes = await api('/admin/api/sync-items', { method: 'POST' });
    if (syncRes && syncRes.ok) {
      const d = await syncRes.json();
      updateSyncUI({ items_count: d.count, items_synced_at: d.synced_at });
    }

    btn.disabled = false;
    btn.textContent = 'Save & Continue';
    document.getElementById('setupModal').classList.add('hidden');
  });

  // ── Stats ──
  async function loadStats() {
    const res = await api('/admin/api/stats');
    if (!res || !res.ok) return;
    const d = await res.json();
    document.getElementById('statActive').textContent   = d.active   ?? '0';
    document.getElementById('statInactive').textContent = d.inactive ?? '0';
    document.getElementById('statErrors').textContent   = d.errors   ?? '0';
    document.getElementById('statRecords').textContent  = Number(d.total_records).toLocaleString();
    document.getElementById('statLastSync').textContent = d.last_sync
      ? new Date(d.last_sync).toLocaleTimeString()
      : 'Never';
  }

  // ── Items table ──
  let allItems    = [];
  let tableSort   = { col: 'name', dir: 'asc' };
  let tableFilter = '';
  let statusFilter = null; // null | 'inactive' | 'error'
  let tablePage   = 0;
  const PAGE_SIZE = 20;
  const NUMERIC   = new Set(['torn_item_id', 'latest_price', 'retry_count', 'record_count']);
  const selectedIds = new Set();

  const bulkDeleteBtn   = document.getElementById('bulkDeleteBtn');
  const bulkDeleteCount = document.getElementById('bulkDeleteCount');
  const selectAllCb     = document.getElementById('selectAll');

  function updateBulkBar() {
    const n = selectedIds.size;
    bulkDeleteBtn.style.display = n > 0 ? '' : 'none';
    bulkDeleteCount.textContent = n;
    if (selectAllCb) {
      const pageIds = [...document.querySelectorAll('.row-check')].map(c => Number(c.dataset.id));
      selectAllCb.checked       = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
      selectAllCb.indeterminate = pageIds.some(id => selectedIds.has(id)) && !selectAllCb.checked;
    }
  }

  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      document.querySelectorAll('.row-check').forEach(cb => {
        const id = Number(cb.dataset.id);
        if (selectAllCb.checked) { selectedIds.add(id); cb.checked = true; }
        else                     { selectedIds.delete(id); cb.checked = false; }
      });
      updateBulkBar();
    });
  }

  bulkDeleteBtn.addEventListener('click', async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} item(s) and all their market data?`)) return;
    await api('/admin/api/items/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) });
    selectedIds.clear();
    updateBulkBar();
    await refresh();
  });

  function setStatusFilter(type) {
    statusFilter = statusFilter === type ? null : type;
    const inactiveCard = document.getElementById('filterInactiveCard');
    const errorCard    = document.getElementById('filterErrorCard');
    inactiveCard.classList.toggle('filter-active',       statusFilter === 'inactive');
    errorCard.classList.toggle('filter-active',         false);
    errorCard.classList.toggle('filter-active-error',   statusFilter === 'error');
    tablePage = 0;
    applyTableState();
  }

  document.getElementById('filterInactiveCard').addEventListener('click', () => setStatusFilter('inactive'));
  document.getElementById('filterErrorCard').addEventListener('click',    () => setStatusFilter('error'));

  async function loadItems() {
    const res = await api('/admin/api/items');
    if (!res || !res.ok) return;
    allItems = await res.json();
    applyTableState();
  }

  function applyTableState() {
    const q = tableFilter.toLowerCase();
    let filtered = allItems;
    if (q) filtered = filtered.filter(i =>
      String(i.torn_item_id).includes(q) ||
      (i.name || '').toLowerCase().includes(q) ||
      (i.item_type || '').toLowerCase().includes(q)
    );
    if (statusFilter === 'inactive') filtered = filtered.filter(i => !i.is_active);
    if (statusFilter === 'error')    filtered = filtered.filter(i => !!i.last_error);

    filtered = [...filtered].sort((a, b) => {
      let av = a[tableSort.col] ?? '', bv = b[tableSort.col] ?? '';
      if (NUMERIC.has(tableSort.col)) { av = Number(av) || 0; bv = Number(bv) || 0; }
      else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return tableSort.dir === 'asc' ? cmp : -cmp;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    tablePage = Math.min(tablePage, totalPages - 1);
    const page = filtered.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);
    renderTablePage(page, filtered.length, totalPages);
    updateSortHeaders();
  }

  function badge(item) {
    if (item.last_error) return `<span class="badge badge-error">error</span>`;
    if (!item.is_active)  return `<span class="badge badge-inactive">inactive</span>`;
    return `<span class="badge badge-active">active</span>`;
  }
  function fmtPrice(p) {
    if (p == null) return '<span style="color:var(--text-muted)">—</span>';
    return `<span class="price-cell">$${Number(p).toLocaleString()}</span>`;
  }
  function fmtTime(t) {
    if (!t) return '<span style="color:var(--text-muted)">—</span>';
    return `<span class="mono" style="font-size:0.75rem">${new Date(t).toLocaleString()}</span>`;
  }

  function renderTablePage(page, total, totalPages) {
    const tbody = document.getElementById('itemsBody');
    tbody.innerHTML = page.length
      ? page.map(item => `
          <tr data-id="${item.id}">
            <td style="text-align:center"><input type="checkbox" class="row-check" data-id="${item.id}" ${selectedIds.has(item.id) ? 'checked' : ''}></td>
            <td class="mono" style="color:var(--text-dim)">${item.torn_item_id}</td>
            <td>${item.name || '<span style="color:var(--text-muted)">Pending…</span>'}</td>
            <td style="color:var(--text-dim);font-size:11px">${item.item_type || '<span style="color:var(--text-muted)">—</span>'}</td>
            <td>${badge(item)}</td>
            <td>${fmtPrice(item.latest_price)}</td>
            <td>${fmtTime(item.last_sync)}</td>
            <td class="mono" style="color:${item.retry_count > 3 ? 'var(--error)' : 'var(--text-dim)'}">${item.retry_count}</td>
            <td class="mono" style="color:var(--text-dim)">${Number(item.record_count).toLocaleString()}</td>
            <td>
              <div class="actions">
                <button class="btn-icon" title="Sync now" onclick="triggerSync(${item.id})">⟳</button>
                <button class="btn-icon" title="${item.is_active ? 'Deactivate' : 'Activate'}"
                  onclick="toggleActive(${item.id}, ${!item.is_active})">
                  ${item.is_active ? '⏸' : '▶'}
                </button>
                ${item.last_error ? `<button class="btn-icon" title="View error" onclick="showError(${JSON.stringify(item.last_error).replace(/"/g, '&quot;')})">⚠</button>` : ''}
                <button class="btn-icon danger" title="Delete" onclick="deleteItem(${item.id})">✕</button>
              </div>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="10" class="loading-cell">${tableFilter ? 'No items match your search.' : 'No items yet — add one.'}</td></tr>`;

    // wire row checkboxes after render
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        updateBulkBar();
      });
    });

    const pag = document.getElementById('pagination');
    if (totalPages <= 1) {
      pag.innerHTML = `<span class="page-info">${total} item${total !== 1 ? 's' : ''}</span>`;
    } else {
      pag.innerHTML = `
        <span class="page-info">${total} items</span>
        <div class="page-nav">
          <button class="btn btn-ghost btn-sm" ${tablePage === 0 ? 'disabled' : ''} onclick="goPage(${tablePage - 1})">← Prev</button>
          <span class="page-num">Page ${tablePage + 1} of ${totalPages}</span>
          <button class="btn btn-ghost btn-sm" ${tablePage >= totalPages - 1 ? 'disabled' : ''} onclick="goPage(${tablePage + 1})">Next →</button>
        </div>`;
    }
  }

  function updateSortHeaders() {
    document.querySelectorAll('thead th[data-col]').forEach(th => {
      const icon = th.querySelector('.sort-icon');
      const active = th.dataset.col === tableSort.col;
      th.classList.toggle('sorted', active);
      icon.textContent = active ? (tableSort.dir === 'asc' ? '↑' : '↓') : '↕';
    });
  }

  window.goPage = p => { tablePage = p; applyTableState(); };

  document.getElementById('tableSearch').addEventListener('input', function () {
    tableFilter = this.value.trim();
    tablePage = 0;
    applyTableState();
  });

  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      tableSort = col === tableSort.col
        ? { col, dir: tableSort.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'asc' };
      tablePage = 0;
      applyTableState();
    });
  });

  // ── Actions ──
  window.triggerSync = async (id) => {
    const res = await api(`/admin/api/items/${id}/sync`, { method: 'POST' });
    if (res && res.ok) { await refresh(); }
  };

  window.toggleActive = async (id, active) => {
    await api(`/admin/api/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: active }),
    });
    await refresh();
  };

  window.deleteItem = async (id) => {
    if (!confirm('Delete this item and all its market data?')) return;
    await api(`/admin/api/items/${id}`, { method: 'DELETE' });
    await refresh();
  };

  window.showError = (msg) => {
    document.getElementById('errorDetail').textContent = msg;
    document.getElementById('errorModal').classList.remove('hidden');
  };

  document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('errorModal').classList.add('hidden');
  });
  document.getElementById('modalOverlay').addEventListener('click', () => {
    document.getElementById('errorModal').classList.add('hidden');
  });

  // ── Item autocomplete (multi-select + category filter) ──
  const selectedItems = new Map(); // id → { id, name, type }

  (function initItemSearch() {
    const searchEl  = document.getElementById('addItemSearch');
    const dropdown  = document.getElementById('addItemAc');
    const chipsEl   = document.getElementById('selectedChips');
    const submitBtn = document.querySelector('#addForm button[type="submit"]');
    let timer, results = [], lastClickedIdx = -1;

    function closeDropdown() {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      results = [];
      lastClickedIdx = -1;
    }

    function updateSubmitBtn() {
      submitBtn.textContent = selectedItems.size > 1
        ? `Add ${selectedItems.size} Items`
        : 'Add Item';
    }

    function updateChips() {
      chipsEl.innerHTML = [...selectedItems.values()].map(item => `
        <div class="chip" data-id="${item.id}">
          <span>${item.name}</span>
          <button type="button" class="chip-remove" data-id="${item.id}">&times;</button>
        </div>
      `).join('');
      chipsEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedItems.delete(Number(btn.dataset.id));
          updateChips();
          updateSubmitBtn();
          if (!dropdown.classList.contains('hidden')) renderDropdown(results);
        });
      });
      updateSubmitBtn();
    }

    function toggleItem(item, idx) {
      if (selectedItems.has(item.id)) selectedItems.delete(item.id);
      else selectedItems.set(item.id, item);
      lastClickedIdx = idx;
      updateChips();
      renderDropdown(results);
    }

    function rangeSelect(toIdx) {
      const from = Math.min(lastClickedIdx, toIdx);
      const to   = Math.max(lastClickedIdx, toIdx);
      for (let i = from; i <= to; i++) {
        selectedItems.set(results[i].id, results[i]);
      }
      updateChips();
      renderDropdown(results);
    }

    function renderDropdown(items) {
      if (!items.length) {
        dropdown.innerHTML = '<div class="ac-empty">No items found</div>';
        dropdown.classList.remove('hidden');
        return;
      }
      results = items;
      dropdown.innerHTML = items.map(item => {
        const checked = selectedItems.has(item.id);
        return `
          <div class="ac-item${checked ? ' checked' : ''}" data-id="${item.id}">
            <div class="ac-check">${checked ? '✓' : ''}</div>
            <span class="ac-item-name">${item.name}</span>
            <span class="ac-item-meta">#${item.id} · ${item.type}</span>
          </div>
        `;
      }).join('');
      dropdown.querySelectorAll('.ac-item').forEach((el, i) => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          if (e.shiftKey && lastClickedIdx !== -1) rangeSelect(i);
          else toggleItem(results[i], i);
        });
      });
      dropdown.classList.remove('hidden');
    }

    searchEl.addEventListener('input', function () {
      const q = this.value.trim();
      clearTimeout(timer);
      if (!q) { closeDropdown(); return; }
      timer = setTimeout(async () => {
        try {
          const res  = await fetch(`/admin/api/torn-items?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          if (data.error) { closeDropdown(); return; }
          renderDropdown(data);
        } catch { closeDropdown(); }
      }, 280);
    });

    searchEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeDropdown(); });
    searchEl.addEventListener('blur',    () => setTimeout(closeDropdown, 150));
    document.addEventListener('click',   e => {
      if (!e.target.closest('.ac-wrap') && !e.target.closest('.selected-chips')) closeDropdown();
    });
  })();

  // ── Add item(s) ──
  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err    = document.getElementById('addError');
    const apiKey = document.getElementById('addApiKey').value;
    const items  = [...selectedItems.values()];
    err.classList.add('hidden');

    if (!items.length) {
      err.textContent = 'Select at least one item from the search dropdown.';
      err.classList.remove('hidden');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    let added = 0, failed = 0;
    for (const item of items) {
      btn.textContent = `Adding ${item.name}…`;
      const res = await api('/admin/api/items', {
        method: 'POST',
        body: JSON.stringify({ torn_item_id: item.id, name: item.name, api_key: apiKey }),
      });
      if (res && res.ok) added++;
      else failed++;
    }

    btn.disabled = false;
    btn.textContent = 'Add Item';
    selectedItems.clear();
    document.getElementById('selectedChips').innerHTML = '';
    document.getElementById('addItemSearch').value = '';

    if (failed > 0) {
      err.textContent = `${added} added, ${failed} failed — some may already be monitored.`;
      err.classList.remove('hidden');
    }
    await refresh();
  });

  document.getElementById('refreshBtn').addEventListener('click', refresh);

  async function refresh() {
    await Promise.all([loadStats(), loadItems()]);
  }

  // Auto-refresh every 30s
  loadSettings();
  refresh();
  setInterval(refresh, 30000);
})();
