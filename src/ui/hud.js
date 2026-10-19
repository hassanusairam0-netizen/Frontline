import { h, icon } from './dom.js';
import { settings } from '../state/settings.js';
import { MAX_HEALTH } from '../shared/operators.js';

// Restrained tactical HUD. Updates are diffed so the DOM only changes when values do.

const ABILITY_SVG = {
  recon: '<svg class="icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="16" cy="16" r="3"/><path d="M16 4a12 12 0 0 1 12 12M16 9a7 7 0 0 1 7 7M4 16A12 12 0 0 1 16 4"/></svg>',
  barrier: '<svg class="icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 8h20v14l-10 6-10-6z"/><path d="M11 13h10M11 18h10"/></svg>',
  overdrive: '<svg class="icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 3 8 18h7l-2 11 11-16h-7z"/></svg>',
  stim: '<svg class="icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="6" width="20" height="20" rx="2"/><path d="M16 11v10M11 16h10"/></svg>',
};
const XH = { amber: '#e8a33d', white: '#f3efe7', blue: '#7cc0f0', green: '#8fe0a8' };

export class Hud {
  constructor({ youName, oppName, oppOperator, oppRole, roundsToWin, operator, mode }) {
    this.cache = {};
    this.roundsToWin = roundsToWin;
    const pips = (n) => h('div.hud-pips', Array.from({ length: n }, () => h('i')));
    this.el = h('div.hud',
      this.scopeEl = h('div.scope', h('div.ret', h('i.h'), h('i.v'), h('i.dot'), h('i.chev'))),
      this.speedEl = h('div.speedlines'),
      this.healEl = h('div.heal-glow'),
      h('div.hud-score.shadow',
        h('div.side.you', this.youPips = pips(roundsToWin), h('span.nm', youName), this.youPts = h('span.pts', '0')),
        h('div.mid', this.timerEl = h('div.timer', '1:30'), this.roundEl = h('div.rnd', 'ROUND 1')),
        h('div.side.opp', this.oppPts = h('span.pts', '0'), h('span.nm', oppName), this.oppPips = pips(roundsToWin))),
      this.objEl = h('div.hud-objective.shadow', 'Eliminate the opponent'),
      this.oppEl = h('div.hud-opp', h('div.k', mode === 'online' ? 'Opponent · Online' : 'Opponent · AI'), h('div.n', oppName), h('div.s', h('i.dot'), this.oppStatus = h('span', 'Alive'), h('span.muted', `· ${oppOperator} ${oppRole}`))),
      this.feed = h('div.killfeed'),
      this.netEl = h('div.net-info'),
      this.alertEl = h('div.alert-detected', 'Position revealed'),
      this.xh = h('div.crosshair', h('i.t'), h('i.b'), h('i.l'), h('i.r'), h('i.d')),
      this.hm = h('div.hitmarker', h('i'), h('i'), h('i'), h('i')),
      this.dmgRing = h('div.dmg-ring'),
      this.msg = h('div.hud-center-msg'),
      this.hint = h('div.hint'),
      this.clickEl = h('div.click-to-play', 'Click to resume'),
      this.help = h('div.hud-help', h('div', h('span.kbd', 'WASD'), 'Move  ', h('span.kbd', 'SHIFT'), 'Sprint  ', h('span.kbd', 'CTRL/C'), 'Crouch  ', h('span.kbd', 'SPACE'), 'Jump'), h('div', h('span.kbd', 'LMB'), 'Fire  ', h('span.kbd', 'RMB'), 'Aim  ', h('span.kbd', 'R'), 'Reload  ', h('span.kbd', '1/2'), 'Weapons  ', h('span.kbd', 'Q'), 'Ability  ', h('span.kbd', 'ESC'), 'Menu')),
      h('div.hud-health.shadow',
        h('div.hp-block', h('div.lbl', 'HEALTH'), this.hpNum = h('div.num', '100'), h('div.hp-bar', this.hpLag = h('b', { style: { width: '100%' } }), this.hpBar = h('i', { style: { width: '100%' } })), h('div.op', operator.toUpperCase())),
        this.abEl = h('div.ability', { html: ABILITY_SVG[operator === 'VOLT' ? 'overdrive' : ''] || '' })),
      h('div.hud-ammo.shadow',
        this.wName = h('div.wn', ''),
        h('div.ammo', this.magEl = h('span.mag', '30'), this.resEl = h('span.res', '/ 120')),
        this.bulletsEl = h('div.bullets'),
        h('div.slots', this.slotEls = [h('span', '1 PRIMARY'), h('span', '2 SIDEARM')])),
      this.fpsEl = h('div.fps'));
    this.cdSvg = null;
    this.arcs = [];
    document.body.appendChild(this.el);
    this.applyCrosshair();
    this._s = settings.on('change:crosshair', () => this.applyCrosshair());
    setTimeout(() => this.help.classList.add('show'), 400);
    setTimeout(() => this.help.classList.remove('show'), 9000);
  }

  applyCrosshair() { this.xh.style.setProperty('--xh', XH[settings.get('crosshair')] || XH.white); }

  setAbility(id, key = 'Q') {
    this.abEl.innerHTML = ABILITY_SVG[id] || '';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'cd'); svg.setAttribute('viewBox', '0 0 62 62');
    const r = document.createElementNS(ns, 'rect'); r.setAttribute('x', 1); r.setAttribute('y', 1); r.setAttribute('width', 60); r.setAttribute('height', 60);
    r.setAttribute('fill', 'none'); r.setAttribute('stroke', 'currentColor'); r.setAttribute('stroke-width', 2); r.setAttribute('pathLength', 100); r.setAttribute('stroke-dasharray', '100');
    svg.appendChild(r);
    this.cdRect = r;
    this.cdTxt = h('span.cdtxt');
    this.abEl.append(svg, this.cdTxt, h('span.key', key));
  }

  set(key, val, fn) { if (this.cache[key] !== val) { this.cache[key] = val; fn(val); } }

  update(s) {
    // s: { hp, mag, reserve, magSize, weaponName, slot, abilityCd, abilityMax, abilityActive, timer, round, you, opp, oppAlive, spread, ads, scoped, scopeKind, sprinting, reloading, overdrive, healing, fps, ping, revealedMe, oppRevealed }
    this.set('hp', Math.ceil(s.hp), (v) => {
      this.hpNum.textContent = Math.max(0, v);
      this.hpNum.classList.toggle('low', v <= 30);
      const pct = `${Math.max(0, (v / MAX_HEALTH) * 100)}%`;
      this.hpBar.style.width = pct; this.hpLag.style.width = pct;
    });
    this.set('mag', `${s.mag}|${s.reserve}|${s.magSize}`, () => {
      this.magEl.textContent = s.mag; this.resEl.textContent = `/ ${s.reserve}`;
      this.magEl.classList.toggle('low', s.mag <= Math.ceil(s.magSize * 0.25));
      const n = Math.min(s.magSize, 40);
      if (this.bulletsEl.childElementCount !== n) { this.bulletsEl.innerHTML = ''; for (let i = 0; i < n; i++) this.bulletsEl.appendChild(h('i')); }
      const filled = Math.round((s.mag / s.magSize) * n);
      [...this.bulletsEl.children].forEach((c, i) => c.classList.toggle('empty', i >= filled));
    });
    this.set('wn', s.weaponName, (v) => { this.wName.textContent = v; });
    this.set('slot', s.slot, (v) => this.slotEls.forEach((e, i) => e.classList.toggle('on', i === v)));
    const cdFrac = s.abilityMax ? s.abilityCd / s.abilityMax : 0;
    this.set('ab', `${Math.ceil(s.abilityCd)}|${s.abilityActive > 0}|${Math.round(cdFrac * 50)}`, () => {
      const ready = s.abilityCd <= 0;
      this.abEl.classList.toggle('ready', ready && !(s.abilityActive > 0));
      this.abEl.classList.toggle('active', s.abilityActive > 0);
      if (this.cdRect) this.cdRect.setAttribute('stroke-dashoffset', `${ready ? 0 : cdFrac * 100}`);
      if (this.cdTxt) this.cdTxt.textContent = ready ? '' : Math.ceil(s.abilityCd);
      this.abEl.querySelector('svg.icon')?.style.setProperty('opacity', ready ? '1' : '0.25');
    });
    const t = Math.max(0, Math.ceil(s.timer));
    this.set('timer', t, (v) => { this.timerEl.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; this.timerEl.classList.toggle('low', v <= 10); });
    this.set('round', s.round, (v) => { this.roundEl.textContent = `ROUND ${v}`; });
    this.set('score', `${s.you}-${s.opp}`, () => {
      this.youPts.textContent = s.you; this.oppPts.textContent = s.opp;
      [...this.youPips.children].forEach((c, i) => c.classList.toggle('on', i < s.you));
      [...this.oppPips.children].forEach((c, i) => c.classList.toggle('on', i < s.opp));
    });
    this.set('oppAlive', s.oppAlive, (v) => { this.oppEl.classList.toggle('dead', !v); this.oppStatus.textContent = v ? 'Alive' : 'Eliminated'; });
    this.set('oppRev', !!s.oppRevealed, (v) => this.oppEl.classList.toggle('revealed', v));
    // crosshair spread (deg -> px)
    const fovPx = innerHeight / (2 * Math.tan((s.fov || 72) * Math.PI / 360));
    const gap = Math.max(3, Math.tan((s.spread * Math.PI) / 180) * fovPx);
    this.set('xh', `${Math.round(gap)}|${s.ads}|${s.sprinting}|${s.scoped}`, () => {
      const [T, B, L, R] = this.xh.children;
      T.style.transform = `translateY(${-gap - 8}px)`; B.style.transform = `translateY(${gap}px)`;
      L.style.transform = `translateX(${-gap - 8}px)`; R.style.transform = `translateX(${gap}px)`;
      this.xh.style.opacity = s.scoped || s.sprinting ? 0 : s.ads ? 0.35 : 1;
    });
    this.set('scope', `${s.scoped}|${s.scopeKind}`, () => { this.scopeEl.classList.toggle('show', !!s.scoped); this.scopeEl.classList.toggle('reflex', s.scopeKind === 'reflex'); });
    this.set('od', !!s.overdrive, (v) => this.speedEl.classList.toggle('show', v));
    this.set('heal', !!s.healing, (v) => this.healEl.classList.toggle('show', v));
    this.set('rev', !!s.revealedMe, (v) => this.alertEl.classList.toggle('show', v));
    let hint = '';
    if (s.reloading) hint = 'Reloading';
    else if (s.mag === 0 && s.reserve === 0) hint = 'Out of ammo · Press 2';
    else if (s.mag <= Math.ceil(s.magSize * 0.2) && s.reserve > 0) hint = 'Press R to reload';
    this.set('hint', hint, (v) => { this.hint.textContent = v; this.hint.classList.toggle('show', !!v); });
    this.set('fps', settings.get('showFps') ? Math.round(s.fps) : -1, (v) => { this.fpsEl.textContent = v >= 0 ? `${v} FPS` : ''; });
    this.set('ping', s.ping != null ? Math.round(s.ping) : -1, (v) => { this.netEl.textContent = v >= 0 ? `${v} MS` : ''; });
  }

  hitmarker(kind) {
    this.hm.className = `hitmarker ${kind || ''}`;
    void this.hm.offsetWidth;
    this.hm.classList.add('show');
  }

  damageFrom(angleRad) {
    const arc = h('div.dmg-arc', { style: { transform: `rotate(${angleRad}rad)`, opacity: 1 } });
    this.dmgRing.appendChild(arc);
    setTimeout(() => { arc.style.opacity = 0; }, 450);
    setTimeout(() => arc.remove(), 1100);
  }

  kill(killer, victim, weapon, head, killerIsYou) {
    const row = h('div.kf', h('span', { class: killerIsYou ? 'a' : 'b' }, killer), head ? icon('head') : null, h('span.w', weapon), h('span', { class: killerIsYou ? 'b' : 'a' }, victim));
    if (head) row.querySelector('.ico')?.classList.add('hs');
    this.feed.prepend(row);
    while (this.feed.children.length > 4) this.feed.lastChild.remove();
    setTimeout(() => { row.style.transition = 'opacity .6s'; row.style.opacity = 0; setTimeout(() => row.remove(), 650); }, 6000);
  }

  message(big, sm = '', count = null, cls = '') {
    this.msg.innerHTML = '';
    if (!big) return;
    const parts = [h('div.big', { style: { color: cls === 'win' ? 'var(--amber)' : cls === 'loss' ? '#c9c3b8' : '' } }, big)];
    if (sm) parts.push(h('div.sm', sm));
    if (count != null) parts.push(h('div.count', String(count)));
    this.msg.append(...parts);
    this.msg.classList.remove('anim'); void this.msg.offsetWidth; this.msg.classList.add('anim');
  }
  countdown(n) { const c = this.msg.querySelector('.count'); if (c) c.textContent = n; }
  objective(text) { this.objEl.textContent = text; }
  showClickToPlay(v) { this.clickEl.classList.toggle('show', v); }
  setVisible(v) { this.el.style.display = v ? '' : 'none'; }

  dispose() { this._s?.(); this.el.remove(); }
}
