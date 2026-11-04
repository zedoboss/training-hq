// FOOD STOCK (#/pantry, part of Fuel; Thu 11/5, his list of missing features: "No food stock list (beef, eggs,
// almonds and so on) or shopping list"). What he has at home, how long it lasts at his pace, and the shopping list:
// what runs out within his days (Settings fuel.shopDays, default 3), is gone, or he put on it. He counts; the app only
// works out the days. Nothing is suggested.
import { ready, saveSettings } from '../lib/data.js';
import { getState } from '../lib/store.js';
import { withDefaults } from '../lib/settings.js';
import { formatDay, isoDate } from '../lib/time.js';
import { wakingDayAt } from '../lib/waking-day.js';
import { overlay, actionSheet, confirmSheet, promptText } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { pantryStatus, shoppingList, amountOf, lastsText, FROM_TEXT, UNITS, pantryId, stockItem } from '../lib/pantry.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const UNIT_TEXT = { g: 'grams', kg: 'kg', count: 'pieces', pack: 'packs' };

/** Add an item, or a new count for one (bought: on top of what's left). */
function editItem(repo, { cur = null, left = null, bought = false, today, plan, onSave }) {
  const { el, close } = overlay(`<form class="sheet-form"><div class="hud c-muted sheet-title">${cur ? (bought ? `BOUGHT: ${esc(cur.name.toUpperCase())}` : `COUNT: ${esc(cur.name.toUpperCase())}`) : 'ADD TO YOUR FOOD STOCK'}</div>
    ${cur ? '' : '<label class="opt"><span>What</span><input class="input" id="p-name" maxlength="40" placeholder="e.g. beef, eggs, almonds"></label>'}
    <label class="opt"><span>${bought ? 'How much you bought' : 'How much you have now'}</span><input class="input mini num" id="p-amount" inputmode="decimal" value="${cur && !bought && left != null ? left : ''}"></label>
    <label class="opt"><span>Unit</span><select class="input" id="p-unit">${UNITS.map((u) => `<option value="${u}" ${(cur?.unit || 'g') === u ? 'selected' : ''}>${UNIT_TEXT[u]}</option>`).join('')}</select></label>
    ${bought ? '' : `<label class="opt"><span>Per day (optional, your own number)</span><input class="input mini num" id="p-per" inputmode="decimal" value="${cur?.perDay ?? ''}" placeholder="auto"></label>`}
    <p class="hint">Empty per day: the app uses your logged meals of the last 7 days, else your planned day.</p>
    <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">Save</button></div></form>`);
  el.querySelector('[data-cancel]').onclick = () => close();
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = cur ? cur.name : el.querySelector('#p-name').value.trim();
    const amount = Number(el.querySelector('#p-amount').value.replace(',', '.'));
    const unit = el.querySelector('#p-unit').value;
    const perIn = el.querySelector('#p-per')?.value.trim() ?? '';
    const per = perIn === '' ? (cur ? 0 : null) : Number(perIn.replace(',', '.'));
    if (!name) { toast('What is it?'); return; }
    if (!(amount >= 0 && amount < 100000)) { toast('How much: a number.'); return; }
    if (per != null && !(per >= 0)) { toast('Per day: a number, or leave it empty.'); return; }
    const base = bought && cur && cur.unit === unit && left != null ? left : 0;
    const next = stockItem({ name, amount: Math.round((base + amount) * 10) / 10, unit, perDay: bought ? null : per, now: Date.now(), countedOn: today, cur });
    if (!cur && (await repo.get('pantry', next.id))?.removed === false) next.id = `${pantryId(name)}-${Date.now().toString(36)}`;
    await repo.put('pantry', next.id, next);
    toast(`${next.name}: ${amountOf(next, next.amount, plan)}.`);
    close();
    onSave?.();
  });
}

export function render(view) {
  let alive = true; let off = () => {};
  view.innerHTML = '<div class="lib-head"><a class="pill" href="#/fuel">Fuel</a></div><p class="view-sub">Loading…</p>';
  const draw = async (repo) => {
    const [items, plan, meals, today] = await Promise.all([repo.list('pantry'), repo.get('fuel', 'plan'), repo.list('meals'), wakingDayAt(repo)]);
    if (!alive) return;
    const within = withDefaults(getState().settings).fuel.shopDays || 3;
    const c = { plan, meals, today, tzDate: (at) => isoDate(new Date(at)) };
    const live = items.filter((x) => x && !x.removed).sort((a, b) => a.name.localeCompare(b.name));
    const shop = shoppingList(live, c, { within });
    const day = (d) => formatDay(new Date(`${d}T12:00:00`));
    const line = (item) => {
      const st = pantryStatus(item, c);
      return `<div class="supp-item" data-p="${esc(item.id)}"><div class="supp-main"><b>${esc(item.name)}</b>
        <span class="hint ${st.left <= 0 || (st.days != null && st.days <= within) ? 'c-amber' : ''}">${st.about ? 'about ' : ''}${esc(amountOf(item, st.left, plan))} left · ${esc(lastsText(st))}${st.runsOut && st.left > 0 ? ` (to ${esc(day(st.runsOut))})` : ''}</span>
        <span class="hint">${st.perDay ? `${esc(amountOf(item, st.perDay, plan))} a day, ${esc(FROM_TEXT[st.from])}` : 'Daily use unknown: set your own number'}${item.onList ? ' · on your list' : ''}</span></div>
        <span class="supp-btns"><button class="btn-ghost small" type="button" data-more>···</button></span></div>`;
    };
    view.innerHTML = `
      <div class="lib-head"><a class="pill" href="#/fuel">Fuel</a></div>
      <h1 class="view-title">Food stock</h1>
      <div class="section-label">Shopping list · ${shop.length}</div>
      <section class="card supp-group" id="p-shop">${shop.map(({ item, why }) => `<div class="supp-item" data-p="${esc(item.id)}"><div class="supp-main"><b>${esc(item.name)}</b>
          <span class="hint c-amber">${why === 'out' ? 'None left' : why === 'soon' ? esc(lastsText(pantryStatus(item, c))) : 'You put it on the list'}</span></div>
          <span class="supp-btns"><button class="btn-primary small" type="button" data-bought>Bought</button></span></div>`).join('')
        || `<p class="hint pad">Nothing runs out within ${within} days by your counts.</p>`}
        <button class="link-btn pad" type="button" id="p-days">Runs out within: ${within} days · change</button></section>
      <div class="section-label">At home · ${live.length}</div>
      <section class="card supp-group" id="p-list">${live.map(line).join('') || '<p class="hint pad">Nothing counted yet. Add what you have: beef, eggs, almonds...</p>'}
        <button class="btn-ghost supp-all" type="button" id="p-add">+ Add an item</button></section>
      <p class="hint">Left = your count minus what your logged meals used since; a past day with no meal logged counts at the daily pace (shown as "about").</p>`;
    const find = (b) => live.find((x) => x.id === b.closest('[data-p]').dataset.p);
    const left = (item) => pantryStatus(item, c).left;
    view.querySelector('#p-add').onclick = () => editItem(repo, { today, plan });
    view.querySelectorAll('[data-bought]').forEach((b) => b.addEventListener('click', () => { const it = find(b); editItem(repo, { cur: it, left: left(it), bought: true, today, plan }); }));
    view.querySelectorAll('#p-list [data-more]').forEach((b) => b.addEventListener('click', () => {
      const it = find(b);
      actionSheet(it.name, [
        { label: 'Bought some', run: () => editItem(repo, { cur: it, left: left(it), bought: true, today, plan }) },
        { label: 'New count / per day', run: () => editItem(repo, { cur: it, left: left(it), today, plan }) },
        { label: it.onList ? 'Take off the shopping list' : 'Put on the shopping list', run: () => repo.put('pantry', it.id, { ...it, onList: !it.onList }) },
        { label: 'Remove', run: async () => { if (await confirmSheet(`Remove ${it.name} from your food stock?`, { ok: 'Remove' })) await repo.put('pantry', it.id, { ...it, removed: true }); } },
      ]);
    }));
    view.querySelector('#p-days').onclick = async () => {
      const v = await promptText('Shopping list: runs out within how many days?', String(within), { placeholder: 'days' });
      const n = Math.round(Number(v));
      if (v === null) return;
      if (!(n >= 1 && n <= 30)) { toast('1 to 30 days.'); return; }
      await saveSettings({ fuel: { shopDays: n } });
      draw(repo);
    };
  };
  ready.then((repo) => {
    if (!alive) return;
    draw(repo);
    off = repo.onChange((cols) => { if (cols.some((x) => ['pantry', 'meals', 'fuel', 'settings'].includes(x))) draw(repo); });
  });
  return () => { alive = false; off(); };
}
