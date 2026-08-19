(() => {
  const fmt = n => n == null ? '—' : '$' + Number(n).toLocaleString();
  const pct = v => v == null ? '' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%';

  let allData   = null;
  let activeCat = 'all';
  let searchQ   = '';

  // ── Fetch & render ─────────────────────────────────────────────────────

  async function load() {
    try {
      const res = await fetch('/api/trade/listings');
      if (!res.ok) throw new Error(await res.text());
      allData = await res.json();
      render();
    } catch (e) {
      document.getElementById('skeleton').innerHTML =
        `<div style="text-align:center;padding:2rem;color:var(--text-muted)">⚠ Failed to load: ${e.message}</div>`;
    }
  }

  function render() {
    const { profile, categories, total } = allData;

    document.getElementById('heroName').textContent = profile.display_name || 'Torn Trader';
    document.title = `${profile.display_name || 'Torn Trader'} — WTB`;

    const bioEl = document.getElementById('heroBio');
    bioEl.textContent = profile.bio || '';
    bioEl.style.display = profile.bio ? '' : 'none';

    const contactEl = document.getElementById('heroContact');
    contactEl.innerHTML = '';
    if (profile.discord_handle) {
      contactEl.insertAdjacentHTML('beforeend',
        `<a class="contact-badge" href="#">💬 ${esc(profile.discord_handle)}</a>`);
    }
    if (profile.torn_profile_url) {
      contactEl.insertAdjacentHTML('beforeend',
        `<a class="contact-badge" href="${esc(profile.torn_profile_url)}" target="_blank" rel="noopener">🎮 Torn Profile</a>`);
    }

    document.getElementById('metaCount').textContent = total;
    document.getElementById('metaCats').textContent  = categories.length;

    buildFilterPills(categories, total);
    renderSections();

    document.getElementById('skeleton').style.display = 'none';
    document.getElementById('footer').textContent =
      `Torn Tracker · WTB list · ${new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}`;
  }

  function buildFilterPills(categories, total) {
    const bar = document.getElementById('filterBar');
    bar.innerHTML = '';

    pill(bar, 'all', `All <span class="count">${total}</span>`, activeCat === 'all',
      () => setFilter('all'));

    for (const { name, items } of categories) {
      pill(bar, name, `${esc(name)} <span class="count">${items.length}</span>`,
        activeCat === name, () => setFilter(name));
    }
  }

  function pill(bar, cat, html, active, onClick) {
    const btn = document.createElement('button');
    btn.className   = 'filter-pill' + (active ? ' active' : '');
    btn.dataset.cat = cat;
    btn.innerHTML   = html;
    btn.addEventListener('click', onClick);
    bar.appendChild(btn);
  }

  function setFilter(cat) {
    activeCat = cat;
    document.querySelectorAll('.filter-pill').forEach(b =>
      b.classList.toggle('active', b.dataset.cat === cat)
    );
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
                <th class="col-price">Offer Price</th>
              </tr>
            </thead>
            <tbody>${filtered.map(itemRow).join('')}</tbody>
          </table>
        </div>`;
      container.appendChild(section);
    }

    document.getElementById('noResults').classList.toggle('visible',
      totalVisible === 0 && searchQ !== '');
  }

  function itemRow(item) {
    const price = item.effective_price;
    const pctBadge = item.price_mode === 'market_pct' && item.market_pct
      ? `<span class="pct-badge">${pct(item.market_pct)}</span>` : '';

    const priceHtml = price != null
      ? `<span class="price-amount">${fmt(price)}</span>${pctBadge}`
      : `<span class="price-amount" style="color:var(--text-muted)">—</span>`;

    const notesHtml = item.notes
      ? `<div class="item-notes">${esc(item.notes)}</div>` : '';

    const imgSrc = `https://www.torn.com/images/items/${item.torn_item_id}/large.png`;

    return `<tr>
      <td>
        <div class="item-cell">
          <img class="item-icon" src="${imgSrc}" alt=""
            onerror="this.style.display='none'">
          <div class="item-text">
            <div class="item-name">${esc(item.item_name)}</div>
            ${notesHtml}
          </div>
        </div>
      </td>
      <td class="price-cell">${priceHtml}</td>
    </tr>`;
  }

  // ── Search ──────────────────────────────────────────────────────────────
  document.getElementById('globalSearch').addEventListener('input', e => {
    searchQ = e.target.value.trim().toLowerCase();
    if (allData) renderSections();
  });

  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  }

  load();
})();
