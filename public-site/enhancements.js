'use strict';

// Exchange rates are public data; the vault remains the only place where user data is stored.
const RATE_KEY = 'subtrack.usd-bdt-rate.v1';
let rateCache = null, rateBusy = false, rateMessage = '', selectedCostId = null;
try {
  const saved = JSON.parse(localStorage.getItem(RATE_KEY) || 'null');
  if (saved && Number.isFinite(saved.rate) && saved.rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) && parseDate(saved.date) && saved.date <= today()) rateCache = saved;
} catch (_) { /* A bad or unavailable cache can be replaced on refresh. */ }

function currentRate() {
  return rateCache?.rate || (Number(vault?.settings.rate) > 0 ? Number(vault.settings.rate) : 0);
}
function rateDescription() {
  if (rateCache) return `1 USD = ${rateCache.rate.toFixed(2)} BDT · rate date ${rateCache.date}${rateCache.date < today() ? ' (last available)' : ''}`;
  if (currentRate()) return `1 USD = ${currentRate().toFixed(2)} BDT · manual fallback`;
  return 'USD to BDT rate unavailable; totals are shown separately.';
}
async function refreshRate() {
  if (rateBusy) return;
  rateBusy = true;
  $('refreshRate').disabled = true;
  rateMessage = 'Checking the latest rate…';
  updateRateLabel();
  const endpoints = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
  ];
  let found = false;
  for (const url of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {signal: controller.signal, cache: 'no-cache'});
      if (!response.ok) throw Error('Rate request failed');
      const data = await response.json();
      const rate = Number(data?.usd?.bdt);
      if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || !parseDate(data.date) || data.date > today()) throw Error('Invalid rate');
      // Do not overwrite a newer cached quote with an older response from a mirror.
      if (!rateCache || data.date >= rateCache.date) {
        rateCache = {rate, date: data.date};
        try { localStorage.setItem(RATE_KEY, JSON.stringify(rateCache)); } catch (_) { /* Still usable until the tab closes. */ }
      }
      found = true;
      break;
    } catch (_) { /* Try the next endpoint. */ }
    finally { clearTimeout(timer); }
  }
  rateBusy = false;
  rateMessage = found ? '' : 'Could not refresh; using the last available rate or manual fallback.';
  $('refreshRate').disabled = false;
  if (vault) render();
}
function updateRateLabel() {
  $('rateStatus').textContent = `${rateDescription()}${rateMessage ? ' · ' + rateMessage : ''}`;
}
function estimateText(t) {
  const rate = currentRate();
  return t.USD && rate ? '≈ ' + money(t.BDT + t.USD * rate, 'BDT') : totalText(t);
}
function monthlyAmount(s) {
  const factor = s.cycle === 'yearly' ? 1 / 12 : s.cycle === 'custom-months' ? 1 / Number(s.interval || 1) : s.cycle === 'custom-days' ? 365.2425 / 12 / Number(s.interval || 1) : 1;
  return Number(s.price) * factor;
}
const iconMap = [
  [/\b(chat\s*gpt|openai|codex)\b/i, 'ChatGPT_icon_black_512.png'],
  [/\bclaude\b/i, 'Claude_icon_512.png'],
  [/\b(manus)\b/i, 'Manus_icon_512.png'],
  [/\b(google\s*one)\b/i, 'Google_One_icon_512.png'],
  [/\b(gemini|google\s+ai)\b/i, 'Gemini_icon_512.png'],
  [/\b(banglalink|bangla\s*link|mobile\s+bill)\b/i, 'Banglalink_icon_512.png'],
  [/\b(bas\s*net)\b/i, 'BAS_Net_icon_512.png'],
  [/\bspotify\b/i, '../spotify.svg']
];
function avatar(name) {
  const icon = iconMap.find(([pattern]) => pattern.test(name));
  const initial = esc(name.trim().charAt(0).toUpperCase());
  if (!icon) return `<span class="avatar">${initial}</span>`;
  return `<span class="avatar"><img ${icon[1].startsWith('ChatGPT') ? 'class="chatgpt" ' : ''}src="assets/subscription_tracker_all_logos/${icon[1]}" alt="" onerror="this.parentNode.textContent=this.dataset.initial" data-initial="${initial}"></span>`;
}
function renderCosts() {
  const list = vault.subscriptions.filter(s => active(s) && isForecast(s));
  const total = totals(list.map(s => ({currency: s.currency, amount: monthlyAmount(s)})));
  if (!list.length) {
    $('costChart').innerHTML = '<div class="empty">Add an active recurring subscription to see its share.</div>';
    return;
  }
  const rate = currentRate();
  const canChart = !total.USD || rate > 0;
  const palette = ['#178b7d','#e2a450','#6f86cc','#c77a8e','#8eae64','#b393ce','#dd815c','#5aabbb'];
  const values = list.map(s => monthlyAmount(s) * (s.currency === 'USD' ? rate : 1));
  const sum = values.reduce((a,b) => a+b, 0);
  let cursor = 0;
  const stops = values.map((value, i) => { const start = cursor; cursor += sum ? value / sum * 100 : 0; return `${palette[i % palette.length]} ${start}% ${cursor}%`; });
  const chart = canChart && sum > 0 ? `<div class="cost-donut" aria-hidden="true" style="background:conic-gradient(${stops.join(',')})"></div>` : `<p class="rate-message">${canChart ? 'All monthly amounts are zero.' : 'A USD-to-BDT rate is needed to compare shares.'}</p>`;
  if (!list.some(s => s.id === selectedCostId)) selectedCostId = null;
  const choices = list.map((s,i) => `<button class="cost-choice" data-cost-id="${esc(s.id)}" aria-pressed="${s.id === selectedCostId}"><span class="swatch" style="background:${palette[i % palette.length]}"></span><span>${esc(s.name)}</span><span class="cost-value">${esc(estimateText(totals([{currency:s.currency,amount:monthlyAmount(s)}])))}/mo${canChart && sum > 0 ? ` · ${(values[i] / sum * 100).toFixed(1)}%` : ''}</span></button>`).join('');
  const selected = list.find(s => s.id === selectedCostId);
  let preview = '<p class="rate-message">Select a plan to preview the effect of removing it.</p>';
  if (selected) {
    const cost = totals([{currency:selected.currency, amount:monthlyAmount(selected)}]);
    const remaining = totals(list.filter(s => s.id !== selected.id).map(s => ({currency:s.currency,amount:monthlyAmount(s)})));
    preview = `<div class="cost-preview" role="status"><strong>Without ${esc(selected.name)}</strong><p>Monthly savings: ${esc(estimateText(cost))}</p><p>New monthly estimate: ${esc(estimateText(remaining))}</p><small>Preview only; your subscription is unchanged.</small></div>`;
  }
  $('costChart').innerHTML = `${chart}<div class="cost-list" aria-label="Monthly cost by subscription">${choices}</div>${preview}`;
}
function renderMonthlyPayments() {
  const month = $('paymentMonth').value || today().slice(0,7);
  const payments = vault.payments.filter(p => p.date.startsWith(month));
  const groups = new Map();
  for (const p of payments) {
    if (!groups.has(p.subscriptionId)) groups.set(p.subscriptionId, []);
    groups.get(p.subscriptionId).push(p);
  }
  const paid = [...groups.entries()].map(([id, items]) => {
    const sub = vault.subscriptions.find(s => s.id === id);
    const name = sub?.name || items[0].name || 'Deleted subscription';
    const note = sub ? (active(sub) ? '' : ` · ${sub.status}`) : ' · Deleted subscription';
    return `<div class="item"><div><strong>${esc(name)}</strong><small>${items.length} payment${items.length === 1 ? '' : 's'}${esc(note)}</small></div><span class="amount">${esc(totalText(totals(items)))}</span></div>`;
  }).join('');
  const unpaid = vault.subscriptions.filter(s => active(s) && !groups.has(s.id)).sort((a,b) => a.name.localeCompare(b.name)).map(s => `<div class="item"><div><strong>${esc(s.name)}</strong><small>${esc(s.status)}</small></div><button class="more" data-quick-pay="${esc(s.id)}">Record payment<span class="sr-only"> for ${esc(s.name)}</span></button></div>`).join('');
  $('monthlyPayments').innerHTML = `<div class="payment-group"><h3>Paid (${groups.size})</h3>${paid || '<div class="empty">No payments recorded for this month.</div>'}</div><div class="payment-group"><h3>No payment recorded</h3>${unpaid || '<div class="empty">No current active plans in this group.</div>'}</div><p class="rate-message">No payment recorded does not necessarily mean a bill is overdue. This list uses current active plans, not historical plan status.</p>`;
}

const baseRender = render;
render = function () {
  if (!vault) return;
  baseRender();
  const monthly = vault.subscriptions.filter(s => active(s) && isForecast(s)).map(s => ({currency:s.currency, amount:monthlyAmount(s)}));
  const paid = vault.payments.filter(p => p.date.startsWith(today().slice(0,7)));
  const metrics = $('summary').querySelectorAll('.metric');
  metrics[0].querySelector('.number').textContent = estimateText(totals(monthly));
  metrics[0].querySelector('small').textContent = 'Normalized monthly · ' + totalText(totals(monthly));
  metrics[3].querySelector('.number').textContent = estimateText(totals(paid));
  metrics[3].querySelector('small').textContent = 'Actual payments and fees · ' + totalText(totals(paid));
  for (const row of $('records').querySelectorAll('[data-detail]')) {
    const sub = vault.subscriptions.find(s => s.id === row.dataset.detail);
    const old = row.closest('.record')?.querySelector('.avatar');
    if (sub && old) old.outerHTML = avatar(sub.name);
  }
  updateRateLabel();
  renderCosts();
  renderMonthlyPayments();
};

$('paymentMonth').value = today().slice(0,7);
$('paymentMonth').addEventListener('change', renderMonthlyPayments);
$('refreshRate').addEventListener('click', refreshRate);
$('costChart').addEventListener('click', e => { const b = e.target.closest('[data-cost-id]'); if (b) { selectedCostId = b.dataset.costId; renderCosts(); [...$('costChart').querySelectorAll('[data-cost-id]')].find(choice => choice.dataset.costId === selectedCostId)?.focus(); } });
$('monthlyPayments').addEventListener('click', e => {
  const b = e.target.closest('[data-quick-pay]');
  const sub = b && vault.subscriptions.find(s => s.id === b.dataset.quickPay);
  if (!sub) return;
  openPay(sub);
  const month = $('paymentMonth').value;
  if (month && month !== today().slice(0,7)) $('payDate').value = month + '-01';
});
$('saveButton').addEventListener('click', async () => { try { await persist(); render(); showToast('Vault saved in this browser'); } catch (_) { /* The save status already describes the error. */ } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && vault && (!rateCache || rateCache.date < today())) refreshRate(); });
function scheduleDailyRateRefresh() {
  const next = new Date();
  next.setHours(24, 0, 1, 0);
  setTimeout(() => { if (vault) refreshRate(); scheduleDailyRateRefresh(); }, Math.max(1000, next - Date.now()));
}
scheduleDailyRateRefresh();
