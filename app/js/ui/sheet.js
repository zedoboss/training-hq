// Bottom action sheet and a simple text prompt, in the app's own style.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function overlay(inner, onClose) {
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${inner}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close(v) { el.remove(); document.removeEventListener('keydown', onKey); onClose?.(v); }
  document.body.append(el);
  return { el, close };
}

/** actions: [{label, danger?, run}] */
export function actionSheet(title, actions) {
  const { el, close } = overlay(`
    ${title ? `<div class="hud c-muted sheet-title">${esc(title)}</div>` : ''}
    ${actions.map((a, i) => `<button class="sheet-btn ${a.danger ? 'c-red' : ''}" data-i="${i}" type="button">${esc(a.label)}</button>`).join('')}
    <button class="sheet-btn sheet-cancel" data-cancel type="button">Cancel</button>`);
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { close(); actions[Number(b.dataset.i)].run(); }));
  el.querySelector('[data-cancel]').addEventListener('click', () => close());
}

/** Resolves to the entered text, or null if cancelled. */
export function promptText(title, value = '', { placeholder = '', ok = 'Save' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const { el, close } = overlay(`
      <form class="sheet-form">
        <label class="hud c-muted sheet-title" for="sheet-input">${esc(title)}</label>
        <input class="input" id="sheet-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80" autocomplete="off">
        <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary" type="submit">${esc(ok)}</button></div>
      </form>`, () => resolve(result));
    const input = el.querySelector('input');
    setTimeout(() => input.focus(), 50);
    el.querySelector('[data-cancel]').addEventListener('click', () => close());
    el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); result = input.value.trim() || null; close(); });
  });
}

/** Yes/no confirmation in the app's style. */
export function confirmSheet(text, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const { el, close } = overlay(`
      <p class="sheet-text">${esc(text)}</p>
      <div class="btn-row"><button class="btn-ghost" type="button" data-cancel>Cancel</button><button class="btn-primary ${danger ? 'btn-danger-solid' : ''}" type="button" data-ok>${esc(ok)}</button></div>`,
    () => resolve(result));
    el.querySelector('[data-cancel]').addEventListener('click', () => close());
    el.querySelector('[data-ok]').addEventListener('click', () => { result = true; close(); });
  });
}

export { overlay };
