import { h } from '../ui/dom.js';

// Gameplay input: keyboard, pointer-locked mouse, wheel and an on-screen touch
// layout. The game reads a per-frame snapshot; nothing here leaks into menus.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.locked = false;
    this.enabled = true;
    this.touch = null;
    this._h = {
      kd: (e) => {
        if (!this.enabled) return;
        if (['Space', 'Tab', 'ControlLeft'].includes(e.code) || (e.code.startsWith('Key') && this.locked)) e.preventDefault();
        if (!this.keys.has(e.code)) this.pressed.add(e.code);
        this.keys.add(e.code);
      },
      ku: (e) => this.keys.delete(e.code),
      mm: (e) => { if (this.locked) { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; } },
      md: (e) => {
        if (!this.enabled) return;
        if (!this.locked && e.target === canvas) { this.requestLock(); return; }
        if (!this.locked) return;
        if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
        if (e.button === 2) this.mouse.right = true;
      },
      mu: (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; },
      wh: (e) => { if (this.locked) { this.mouse.wheel += Math.sign(e.deltaY); } },
      plc: () => {
        this.locked = document.pointerLockElement === canvas;
        if (!this.locked) { this.mouse.left = this.mouse.right = false; this.keys.clear(); }
        this.onLockChange?.(this.locked);
      },
      ctx: (e) => { if (this.enabled) e.preventDefault(); },
      blur: () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; },
    };
    addEventListener('keydown', this._h.kd);
    addEventListener('keyup', this._h.ku);
    addEventListener('mousemove', this._h.mm);
    addEventListener('mousedown', this._h.md);
    addEventListener('mouseup', this._h.mu);
    addEventListener('wheel', this._h.wh, { passive: true });
    addEventListener('contextmenu', this._h.ctx);
    addEventListener('blur', this._h.blur);
    document.addEventListener('pointerlockchange', this._h.plc);
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    if (this.isTouch) this.buildTouch();
  }

  requestLock() {
    if (this.isTouch) return;
    // Pointer lock needs a user gesture; without one the browser rejects and we
    // simply show "click to resume" until the player clicks the canvas.
    const retry = () => { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* not allowed yet */ } };
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(retry); } catch { retry(); }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /** Called once per frame after the game consumed input. */
  endFrame() {
    this.pressed.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
    if (this.touch) { this.touch.look.dx = this.touch.look.dy = 0; this.touch.tapped.clear(); }
  }

  /** Movement axes in [-1,1]. */
  axes() {
    let f = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    let s = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    if (this.touch?.move.active) { f = -this.touch.move.y; s = this.touch.move.x; }
    return { f, s };
  }
  look() {
    let dx = this.mouse.dx, dy = this.mouse.dy;
    if (this.touch) { dx += this.touch.look.dx * 2.2; dy += this.touch.look.dy * 2.2; }
    return { dx, dy };
  }
  get fire() { return this.mouse.left || !!this.touch?.held.has('fire'); }
  get firePressed() { return this.mouse.leftPressed || !!this.touch?.tapped.has('fire'); }
  get ads() { return this.mouse.right || !!this.touch?.toggles.has('ads'); }
  touchTap(name) { return !!this.touch?.tapped.has(name); }
  touchHeld(name) { return !!this.touch?.held.has(name); }

  buildTouch() {
    const T = this.touch = { move: { active: false, x: 0, y: 0, id: null, ox: 0, oy: 0 }, look: { dx: 0, dy: 0, id: null, lx: 0, ly: 0 }, held: new Set(), tapped: new Set(), toggles: new Set() };
    const stick = h('div', { style: { position: 'absolute', left: '40px', bottom: '40px', width: '130px', height: '130px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%' } });
    const nub = h('div', { style: { position: 'absolute', left: '45px', top: '45px', width: '40px', height: '40px', background: 'rgba(232,163,61,0.5)', borderRadius: '50%' } });
    stick.appendChild(nub);
    const btn = (name, label, style, toggle = false) => {
      const b = h('div', { style: { position: 'absolute', width: '64px', height: '64px', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(12,13,16,0.45)', display: 'grid', placeItems: 'center', fontFamily: 'var(--f-display)', fontWeight: 600, letterSpacing: '.12em', fontSize: '12px', color: '#eee', userSelect: 'none', ...style } }, label);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); T.tapped.add(name); if (toggle) { T.toggles.has(name) ? T.toggles.delete(name) : T.toggles.add(name); b.style.borderColor = T.toggles.has(name) ? '#e8a33d' : 'rgba(255,255,255,0.25)'; } else T.held.add(name); }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); T.held.delete(name); }, { passive: false });
      return b;
    };
    this.touchEl = h('div.touch-ui', { style: { position: 'fixed', inset: 0, zIndex: 15, touchAction: 'none' } },
      stick,
      btn('fire', 'FIRE', { right: '40px', bottom: '60px', width: '86px', height: '86px', borderColor: 'rgba(232,163,61,0.6)' }),
      btn('ads', 'AIM', { right: '140px', bottom: '40px' }, true),
      btn('jump', 'JUMP', { right: '40px', bottom: '170px' }),
      btn('crouch', 'CROUCH', { right: '120px', bottom: '130px' }, true),
      btn('reload', 'RLD', { right: '210px', bottom: '110px' }),
      btn('ability', 'ABIL', { right: '40px', bottom: '250px' }),
      btn('swap', 'SWAP', { right: '120px', bottom: '215px' }),
      btn('pause', 'II', { right: '20px', top: '20px', width: '44px', height: '44px' }));
    const el = this.touchEl;
    el.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.4 && T.move.id === null) { T.move.id = t.identifier; T.move.active = true; T.move.ox = t.clientX; T.move.oy = t.clientY; }
        else if (T.look.id === null) { T.look.id = t.identifier; T.look.lx = t.clientX; T.look.ly = t.clientY; }
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.move.id) {
          const dx = t.clientX - T.move.ox, dy = t.clientY - T.move.oy, l = Math.min(1, Math.hypot(dx, dy) / 55), a = Math.atan2(dy, dx);
          T.move.x = Math.cos(a) * l; T.move.y = Math.sin(a) * l;
          nub.style.transform = `translate(${T.move.x * 40}px, ${T.move.y * 40}px)`;
        } else if (t.identifier === T.look.id) { T.look.dx += t.clientX - T.look.lx; T.look.dy += t.clientY - T.look.ly; T.look.lx = t.clientX; T.look.ly = t.clientY; }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.move.id) { T.move.id = null; T.move.active = false; T.move.x = T.move.y = 0; nub.style.transform = ''; }
        if (t.identifier === T.look.id) T.look.id = null;
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }

  showTouch(v) { if (this.touchEl) { if (v) document.body.appendChild(this.touchEl); else this.touchEl.remove(); } }

  dispose() {
    removeEventListener('keydown', this._h.kd); removeEventListener('keyup', this._h.ku);
    removeEventListener('mousemove', this._h.mm); removeEventListener('mousedown', this._h.md); removeEventListener('mouseup', this._h.mu);
    removeEventListener('wheel', this._h.wh); removeEventListener('contextmenu', this._h.ctx); removeEventListener('blur', this._h.blur);
    document.removeEventListener('pointerlockchange', this._h.plc);
    this.exitLock();
    this.touchEl?.remove();
  }
}
