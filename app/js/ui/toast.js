// One short message at the bottom of the screen, optionally with one action button.
let timer = null;

export function toast(message, { action, onAction, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  if (action) {
    const b = document.createElement('button');
    b.className = 'pill is-on';
    b.textContent = action;
    b.addEventListener('click', () => { hide(); onAction?.(); });
    el.append(b);
  }
  el.classList.add('is-on');
  clearTimeout(timer);
  if (ms) timer = setTimeout(hide, ms);
}

function hide() {
  document.getElementById('toast')?.classList.remove('is-on');
}
