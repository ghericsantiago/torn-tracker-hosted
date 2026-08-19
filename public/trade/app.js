(() => {
  const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString();
  const pct = v => v == null ? '' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%';

  let allData   = null;
  let activeCat = 'all';
  let searchQ   = '';

  // ── Fetch & render ─────────────────────────────────────────────────────

  async function load() {
    try {
      const res  = await fetch('/api/trade/listings');
      if (!res.ok) throw new Error(await res.text());
      allData = await res.json();
      render();
    } catch (e) {
      document.getElementById('skeleton').innerHTML =
        `<div class="empty-state"><div class="empty-icon">⚠</div>Failed to load listings: ${e.message}</div>`;
    }
  }

  function render() {
    const { profile, categories, total } = allData;

    // Hero
    document.getElementById('heroName').textContent = profile.display_name || 'Torn Trader';
    document.title = `${profile.display_name || 'Torn Trader'} — Wanted to Buy`;

    const bioEl = document.getElementById('heroBio');
    if (profile.bio) {
      bioEl.textContent = profile.bio;
      bioEl.style.display = '';
    } else {
      bioEl.style.display = 'none';
    }

    const contactEl = document.getElementById('heroContact');
    contactEl.innerHTML = '';
    if (profile.discord_handle) {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'contact-badge';
      a.innerHTML = `<span class="icon">💬</span>${profile.discord_handle}`;
      contactEl.appendChild(a);
    }
    if (profile.torn_profile_url) {
      const a = document.createElement('a');
      a.href  = profile.torn_profile_url;
      a.target = '_blank';
      a.rel   = 'noopener noreferrer';
      a.className = 'contact-badge';
      a.innerHTML = `<span class="icon">🎮</span>Torn Profile`;
      contactEl.appendChild(a);
    }

    document.getElementById('metaCount').textContent = total;
    document.getElementById('metaCats').textContent  = categories.length;

    // Filter pills
    buildFilterPills(categories, total);

    // Sections
    renderSections();

    // Hide skeleton
    document.getElementById('skeleton').style.display = 'none';

    // Footer
    document.getElementById('footer').textContent =
      `Torn Tracker · Price list · ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}`;
  }

  function buildFilterPills(categories, total) {
    const bar = document.getElementById('filterBar');
    bar.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className   = 'filter-pill' + (activeCat === 'all' ? ' active' : '');
    allBtn.dataset.cat = 'all';
    allBtn.innerHTML   = `All <span class="count">${total}</span>`;
    allBtn.addEventListener('click', () => setFilter('all'));
    bar.appendChild(allBtn);

    for (const { name, items } of categories) {
      const btn = document.createElement('button');
      btn.className   = 'filter-pill' + (activeCat === name ? ' active' : '');
      btn.dataset.cat = name;
      btn.innerHTML   = `${name} <span class="count">${items.length}</span>`;
      btn.addEventListener('click', () => setFilter(name));
      bar.appendChild(btn);
    }
  }

  function setFilter(cat) {
    activeCat = cat;
    document.querySelectorAll('.filter-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === cat);
    });
    renderSections();
    if (cat !== 'all') {
      const el = document.getElementById('cat-' + slugify(cat));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderSections() {
    const container = document.getElementById('categories');
    container.innerHTML = '';
    let totalVisible = 0;

    for (const { name, items } of allData.categories) {
      if (activeCat !== 'all' && activeCat !== name) continue;

      // Apply search filter
      const filtered = searchQ
        ? items.filter(i => i.item_name.toLowerCase().includes(searchQ))
        : items;

      if (!filtered.length) continue;
      totalVisible += filtered.length;

      const section = document.createElement('div');
      section.className = 'category-section';
      section.id = 'cat-' + slugify(name);
      section.innerHTML = `
        <div class="category-header">
          <div class="category-line"></div>
          <span class="category-title">${esc(name)}</span>
          <span class="category-count">${filtered.length}</span>
          <div class="category-line"></div>
        </div>
        <div class="items-table-wrap">
          <table class="items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:right">Offer Price</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(itemRow).join('')}
            </tbody>
          </table>
        </div>
      `;
      container.appendChild(section);
    }

    const noRes = document.getElementById('noResults');
    noRes.classList.toggle('visible', totalVisible === 0 && searchQ !== '');
  }

  function itemRow(item) {
    const price     = item.effective_price;
    const priceHtml = price != null
      ? `<div class="price-amount">${fmt(price)}</div>
         ${item.price_mode === 'market_pct' && item.market_pct
           ? `<div class="price-basis"><span class="pct-badge">${pct(item.market_pct)} market</span></div>`
           : ''}`
      : `<div class="price-amount" style="color:var(--text-muted)">—</div>`;

    const notesHtml = item.notes
      ? `<span>${esc(item.notes)}</span>`
      : `<span class="notes-empty">—</span>`;

    return `<tr>
      <td>
        <div class="item-name">${esc(item.item_name)}</div>
      </td>
      <td class="price-cell">${priceHtml}</td>
      <td class="notes-cell">${notesHtml}</td>
    </tr>`;
  }

  // ── Search ─────────────────────────────────────────────────────────────

  document.getElementById('globalSearch').addEventListener('input', e => {
    searchQ = e.target.value.trim().toLowerCase();
    if (allData) renderSections();
  });

  // ── Utils ───────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  load();
})();
