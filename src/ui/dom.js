import { audio } from '../engine/audio.js';

/** Tiny hyperscript helper. h('div.cls#id', {onclick, style:{}}, ...children) */
export function h(sel, props = {}, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { children.unshift(props); props = {}; }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  (m?.[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Animated number tween into an element's textContent. */
export function tweenNumber(el, from, to, dur = 1200, onTick) {
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * e);
    onTick?.(t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Global UI sound: hover ticks + click confirmations on interactive elements.
export function installUiSounds() {
  let last = null;
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('button, .list-item, .mode-card, .map-card, .item-card, .swatch, .vote');
    if (t && t !== last && !t.disabled) { last = t; audio.hover(); }
    if (!t) last = null;
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('button, .list-item, .mode-card, .map-card, .item-card, .swatch, .vote');
    if (t && !t.disabled && !t.dataset.silent) audio.click();
  }, true);
}

const ICONS = {
  recon: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="16" cy="16" r="3"/><path d="M16 4a12 12 0 0 1 12 12M16 9a7 7 0 0 1 7 7M4 16A12 12 0 0 1 16 4" /><path d="M16 28a12 12 0 0 1-12-12" opacity=".4"/></svg>',
  barrier: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 8h20v14l-10 6-10-6z"/><path d="M11 13h10M11 18h10"/></svg>',
  overdrive: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 3 8 18h7l-2 11 11-16h-7z"/></svg>',
  stim: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="6" width="20" height="20" rx="2"/><path d="M16 11v10M11 16h10"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 8 3 3 7-7"/></svg>',
  skull: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1C4.7 1 2.5 3.3 2.5 6.3c0 1.9.9 3.2 2 4V13h1.5v-1.5h1V13h2v-1.5h1V13h1.5v-2.7c1.1-.8 2-2.1 2-4C13.5 3.3 11.3 1 8 1zM5.8 8.6a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4.4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg>',
  head: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg>',
};
export function icon(name) { const s = document.createElement('span'); s.className = `ico ico-${name}`; s.innerHTML = ICONS[name] || ''; s.style.display = 'inline-grid'; return s; }

// ---------- toasts & modals ----------
let toastRoot = null;
export function toast(msg, kind = '') {
  if (!toastRoot) { toastRoot = h('div.toasts'); document.body.appendChild(toastRoot); }
  const t = h(`div.toast${kind ? `.${kind}` : ''}`, msg);
  toastRoot.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 3200);
}

export function modal({ eyebrow = '', title, body, actions = [], onClose }) {
  const back = h('div.modal-back');
  const close = (v) => { back.remove(); onClose?.(v); };
  const m = h('div.modal',
    eyebrow && h('div.eyebrow', eyebrow),
    h('h3', title),
    typeof body === 'string' ? h('p', body) : body,
    h('div.actions', actions.map((a) => h(`button.btn${a.primary ? '.btn--primary' : ''}`, { onclick: () => { const r = a.onClick?.(); if (r !== false) close(a.value); } }, a.label))));
  back.appendChild(m);
  back.addEventListener('click', (e) => { if (e.target === back) close(null); });
  document.body.appendChild(back);
  const esc = (e) => { if (e.key === 'Escape') { close(null); removeEventListener('keydown', esc); } };
  addEventListener('keydown', esc);
  return { close, el: m };
}

export function confirm(opts) {
  return new Promise((res) => modal({ ...opts, onClose: (v) => res(!!v), actions: [{ label: opts.cancel || 'Cancel', value: false }, { label: opts.ok || 'Confirm', primary: true, value: true }] }));
}

export function unlockAnimation(title, sub = 'UNLOCKED') {
  audio.unlockSfx();
  const fx = h('div.unlock-fx', h('div.burst'), h('div.burst', { style: { animationDelay: '0.15s' } }), h('div.label', h('div.eyebrow', sub), h('div.h-display', title)));
  document.body.appendChild(fx);
  setTimeout(() => fx.remove(), 2500);
}
