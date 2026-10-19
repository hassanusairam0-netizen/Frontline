import { h, clear, fmt } from './dom.js';
import { profile } from '../state/profile.js';
import { audio } from '../engine/audio.js';
import { net } from '../game/net.js';

// Application shell: screen router, persistent top bar, stage lifecycle and
// fade transitions between 3D stages.

const NAV = [
  ['play', 'Play'], ['operators', 'Operators'], ['armory', 'Armory'], ['maps', 'Maps'], ['store', 'Store'], ['settings', 'Settings'],
];

export class App {
  constructor(engine, screens) {
    this.engine = engine;
    this.screens = screens;
    this.root = document.getElementById('app');
    this.fade = document.getElementById('fade');
    this.current = null;
    this.currentName = null;
    this.stages = {};
    this.stageKey = null;
    this.buildTopbar();
    profile.on('change', () => this.updateTopbar());
    net.on('status', () => this.updateTopbar());
  }

  buildTopbar() {
    this.navButtons = {};
    this.creditsEl = h('span.mono', fmt(profile.credits));
    this.pill = h('button.credits-pill', { title: 'Credits — earned in matches. Spend them in the Store.', onclick: () => this.go('store') }, h('i.cr-icon'), this.creditsEl);
    this.levelText = h('span');
    this.levelArc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 38 38');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const c of [bg, this.levelArc]) { c.setAttribute('cx', 19); c.setAttribute('cy', 19); c.setAttribute('r', 16); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', 2); }
    bg.setAttribute('stroke', 'rgba(255,255,255,0.12)');
    this.levelArc.setAttribute('stroke', '#5aa9e6');
    this.levelArc.setAttribute('stroke-dasharray', `${2 * Math.PI * 16}`);
    svg.append(bg, this.levelArc);
    this.nameEl = h('div.player-name');
    this.topbar = h('header.topbar',
      h('div.brand', { onclick: () => this.go('menu') }, h('div.brand-mark'), h('div.brand-name', 'FRONTLINE')),
      h('nav.nav', NAV.map(([id, label]) => (this.navButtons[id] = h('button', { onclick: () => this.go(id), dataset: { nav: id } }, label)))),
      h('div.topbar-right', h('div.level-chip', h('div.level-ring', svg, this.levelText), this.nameEl), this.pill));
    this.root.appendChild(this.topbar);
    this.updateTopbar();
  }

  updateTopbar() {
    const prev = Number(this.creditsEl.dataset.v || profile.credits);
    if (prev !== profile.credits) { this.pill.classList.remove('bump'); void this.pill.offsetWidth; this.pill.classList.add('bump'); }
    this.creditsEl.textContent = fmt(profile.credits);
    this.creditsEl.dataset.v = profile.credits;
    const L = profile.level;
    this.levelText.textContent = L.level;
    this.levelArc.setAttribute('stroke-dashoffset', `${2 * Math.PI * 16 * (1 - L.into / L.need)}`);
    clear(this.nameEl).append(h('span', h('span.online-dot', { class: net.connected ? 'on' : '' }), profile.data.name || 'OPERATOR'), h('small', `${profile.data.linked ? 'ONLINE PROFILE' : 'LOCAL PROFILE'} · LV ${L.level}`));
  }

  showTopbar(v) { this.topbar.style.display = v ? '' : 'none'; }

  /** Resolve a stage for a key, building and caching menu stage; others are rebuilt. */
  async useStage(key, make) {
    if (this.stageKey === key && this.engine.stage) return this.engine.stage;
    const needsFade = this.stageKey !== null;
    if (needsFade) await this.fadeOut();
    const old = this.engine.stage;
    const oldKey = this.stageKey;
    let stage;
    if (key === 'menu') stage = this.stages.menu || (this.stages.menu = make());
    else stage = make();
    this.engine.setStage(stage, false);
    if (old && old !== stage && oldKey !== 'menu') old.dispose?.();
    this.stageKey = key;
    if (needsFade) this.fadeIn();
    return stage;
  }

  releaseMenuStage() {
    if (this.stages.menu) { if (this.engine.stage !== this.stages.menu) this.stages.menu.dispose(); this.stages.menu = null; }
  }

  fadeOut(ms = 380) { this.fade.classList.add('on'); return new Promise((r) => setTimeout(r, ms)); }
  fadeIn() { requestAnimationFrame(() => this.fade.classList.remove('on')); }

  async go(name, params = {}) {
    if (this._busy) return;
    const S = this.screens[name];
    if (!S) return console.warn('no screen', name);
    this._busy = true;
    try {
      audio.unlock();
      if (this.current) { this.current.unmount?.(); this.current.el?.remove(); }
      this.current = null;
      const screen = new S(this, params);
      this.currentName = name;
      for (const [id, b] of Object.entries(this.navButtons)) b.classList.toggle('active', id === name || (name === 'lobby' && id === 'play'));
      this.showTopbar(screen.topbar !== false);
      if (screen.prepareStage) await screen.prepareStage();
      screen.el = screen.render();
      screen.el.classList.add('screen-enter');
      this.root.appendChild(screen.el);
      this.current = screen;
      screen.mounted?.();
      if (screen.music !== undefined) audio.setMusic(screen.music);
      if (screen.ambience !== undefined) audio.setAmbience(screen.ambience);
      history.replaceState(null, '', name === 'menu' ? '#play' : `#play/${name}`);
    } catch (e) {
      console.error(e);
    } finally {
      this._busy = false;
    }
  }
}
