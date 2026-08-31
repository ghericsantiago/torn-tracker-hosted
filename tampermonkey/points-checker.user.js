// ==UserScript==
// @name         Torn Plushie Set Points Checker
// @namespace    torn-tracker
// @version      1.0.0
// @description  Compare Plushie Set costs with Point Market prices using Torn Tracker data.
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      torn-imarket-tracker.gvsantiago.com
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  const API = 'https://torn-imarket-tracker.gvsantiago.com/api/points-checker';
  const money = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  GM_addStyle(`
    #pc-open{position:fixed;right:18px;bottom:92px;z-index:999998;width:48px;height:48px;border:0;border-radius:50%;color:#fff;background:linear-gradient(135deg,#6a5acd,#9370db);box-shadow:0 6px 20px #0007;cursor:pointer;font-size:20px;font-weight:bold}
    #pc-panel{position:fixed;z-index:999999;top:0;right:0;width:min(760px,100vw);height:100vh;color:#e5e7eb;background:#10121a;box-shadow:-8px 0 30px #0008;transform:translateX(105%);transition:.2s;overflow:auto;font:14px/1.4 Arial,sans-serif}#pc-panel.open{transform:none}#pc-panel *{box-sizing:border-box}
    .pc-head{position:sticky;top:0;z-index:2;padding:20px 24px;color:#fff;background:linear-gradient(135deg,#5b4bc4,#8b65d1)}.pc-head h2{margin:0 80px 4px 0;font-size:22px}.pc-head p{margin:0;opacity:.82}
    .pc-close,.pc-refresh{position:absolute;top:18px;width:34px;height:34px;border:0;border-radius:50%;background:#ffffff25;color:#fff;cursor:pointer;font-size:18px}.pc-close{right:18px}.pc-refresh{right:58px}.pc-body{padding:20px}.pc-status{padding:36px;text-align:center;color:#a7afc0}
    .pc-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.pc-card{padding:14px;border:1px solid #ffffff12;border-radius:10px;background:#ffffff08}.pc-card b{display:block;margin-bottom:8px;color:#b9a8ff}.pc-total{font-size:19px;font-weight:bold;color:#fff}.pc-profit{color:#48d597}.pc-loss{color:#ff7272}
    .pc-wrap{overflow:auto;border:1px solid #ffffff12;border-radius:10px}.pc-table{width:100%;border-collapse:collapse;white-space:nowrap}.pc-table th,.pc-table td{padding:10px 12px;border-bottom:1px solid #ffffff10;text-align:right}.pc-table th:first-child,.pc-table td:first-child{text-align:left}.pc-table th{background:#242032;color:#cfc4ff}.pc-foot{margin-top:12px;color:#7f899d;text-align:right;font-size:12px}@media(max-width:620px){.pc-cards{grid-template-columns:1fr}}
  `);
  const button = document.createElement('button'); button.id = 'pc-open'; button.textContent = 'P'; button.title = 'Plushie Set Points Checker';
  const panel = document.createElement('aside'); panel.id = 'pc-panel';
  panel.innerHTML = `<header class="pc-head"><h2>Plushie Set Calculator</h2><p>Set value compared with the Point Market</p><button class="pc-refresh" title="Refresh">↻</button><button class="pc-close" title="Close">×</button></header><div class="pc-body"><div class="pc-status">Open to load tracker data.</div></div>`;
  document.body.append(button, panel);
  const body = () => panel.querySelector('.pc-body');
  const fail = message => { body().innerHTML = `<div class="pc-status pc-loss">${esc(message)}</div>`; };
  function load() {
    body().innerHTML = '<div class="pc-status">Loading latest tracker data…</div>';
    GM_xmlhttpRequest({method:'GET',url:API,timeout:15000,onload:r=>{if(r.status<200||r.status>=300)return fail(`Server returned HTTP ${r.status}.`);try{render(JSON.parse(r.responseText));}catch(e){fail('The server returned invalid data.');}},onerror:()=>fail('Could not reach the tracker API.'),ontimeout:()=>fail('The tracker API request timed out.')});
  }
  function render(data) {
    if (!data.point_market) return fail('No Point Market observation is available yet.');
    const pointPrice=Number(data.point_market.price), points=Number(data.set?.points)||10;
    const metrics=[['Market value','market_price'],["Today's low",'low'],["Today's high",'high']].map(([label,key])=>{const values=data.plushies.map(x=>x[key]);const total=values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null;const per=total==null?null:total/points;const profit=per==null?null:pointPrice-per;return{label,total,per,profit,pct:profit==null||!per?null:profit/per*100};});
    const cards=metrics.map(x=>`<div class="pc-card"><b>${x.label}</b><div class="pc-total">${money(x.total)}</div><div>Per point: ${money(x.per)}</div><div class="${x.profit==null?'':x.profit>=0?'pc-profit':'pc-loss'}">Profit: ${money(x.profit)}${x.pct==null?'':` (${x.pct>=0?'+':''}${x.pct.toFixed(2)}%)`}</div></div>`).join('');
    const rows=data.plushies.map(x=>{const p=Number.isFinite(x.market_price)&&Number.isFinite(x.low)&&x.low>0?(x.market_price-x.low)/x.low*100:null;return `<tr><td>${esc(x.name)}</td><td>${money(x.market_price)}</td><td>${money(x.low)}</td><td>${money(x.high)}</td><td class="${p==null?'':p>=5?'pc-profit':p<=-5?'pc-loss':''}">${p==null?'—':`${p>=0?'+':''}${p.toFixed(2)}%`}</td></tr>`;}).join('');
    body().innerHTML=`<div style="margin-bottom:14px;font-size:17px">Current point price: <b>${money(pointPrice)}</b></div><div class="pc-cards">${cards}</div><div class="pc-wrap"><table class="pc-table"><thead><tr><th>Plushie</th><th>Market value</th><th>Today's low</th><th>Today's high</th><th>Market vs low</th></tr></thead><tbody>${rows}</tbody></table></div><div class="pc-foot">Tracker data generated ${esc(new Date(data.generated_at).toLocaleString())}</div>`;
  }
  const open=()=>{panel.classList.add('open');load();}; button.addEventListener('click',open); panel.querySelector('.pc-close').addEventListener('click',()=>panel.classList.remove('open')); panel.querySelector('.pc-refresh').addEventListener('click',load); GM_registerMenuCommand('Open Plushie Set Checker',open);
})();
