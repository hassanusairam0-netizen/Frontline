import { h, fmt, toast, unlockAnimation } from '../dom.js';
import { profile } from '../../state/profile.js';
import { MenuStage } from '../../stages/MenuStage.js';
import { OPERATORS } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';

export class MenuScreen {
  constructor(app) { this.app = app; this.music = 'menu'; this.ambience = 'menu'; }
  async prepareStage() { this.stage = await this.app.useStage('menu', () => new MenuStage(this.app.engine)); this.stage.refreshFighter?.(); }

  render() {
    const lo = profile.loadout();
    const el = h('section.screen.menu', { style: { padding: 0 } },
      h('div.menu-hero.reveal',
        h('div.eyebrow', 'Tactical 1v1 · Season 01'),
        h('h1.h-display.menu-title', 'FRONTLINE'),
        h('div.menu-title-rule', h('span.menu-sub', 'One arena. Two fighters. No second chances.')),
        h('div.menu-actions',
          h('button.btn.btn--primary.btn--lg', { onclick: () => this.app.go('lobby', { mode: 'quick' }), dataset: { act: 'quick' } }, 'Quick Match'),
          h('button.btn.btn--lg', { onclick: () => this.app.go('play', { practice: true }), dataset: { act: 'bots' } }, 'Play Against Bots')),
        h('div.row', { style: { marginTop: '22px', gap: '18px' } },
          h('span.tag', `${OPERATORS[lo.operator].name} · ${OPERATORS[lo.operator].role}`),
          h('span.tag', WEAPONS[lo.primary].name),
          h('span.tag', WEAPONS[lo.secondary].name))),
      this.side(),
      h('button.menu-credit', { style: { background: 'none', border: 0, cursor: 'pointer' }, onclick: () => this.app.go('credits') },
        'Designed & built by', h('strong', 'USAIRAM HASSAN')));
    return el;
  }

  side() {
    const dailies = profile.dailies();
    const goal = profile.nextGoal();
    const card = h('div.panel.mini-card',
      h('h4', 'Daily challenges'),
      dailies.map((c) => h('div.challenge',
        h('span', c.text),
        c.claimed ? h('span.tag.ok', 'Claimed') : c.done
          ? h('button.btn.btn--sm.btn--primary', { onclick: async (e) => { e.stopPropagation(); const r = await profile.claimDaily(c.id); if (r.ok) { unlockAnimation(`+${fmt(r.reward)} CR`, 'Challenge complete'); this.refresh(); } else toast(r.reason || 'Could not claim', 'err'); } }, `+${c.reward}`)
          : h('span.mono.small.muted', `${c.progress}/${c.goal}`),
        h('div.bar', h('i', { style: { width: `${(c.progress / c.goal) * 100}%` } })))));
    const goalCard = goal && h('div.panel.mini-card',
      h('h4', 'Next unlock'),
      h('div.row', h('span.grow', { style: { fontFamily: 'var(--f-display)', fontWeight: 600, letterSpacing: '.1em', fontSize: '17px' } }, goal.label), h('span.price', fmt(goal.price))),
      h('div.bar', { style: { marginTop: '10px' } }, h('i', { style: { width: `${Math.min(100, (profile.credits / goal.price) * 100)}%` } })),
      h('div.small.muted', { style: { marginTop: '8px' } }, profile.credits >= goal.price ? 'You can afford this now — visit the Store.' : `${fmt(goal.price - profile.credits)} credits to go`));
    const last = profile.data.history[0];
    const lastCard = last && h('div.panel.mini-card', h('h4', 'Last match'),
      h('div.row', h('span.tag', { class: last.won ? 'amber' : '' }, last.won ? 'Victory' : 'Defeat'), h('span.mono', last.score), h('span.grow'), h('span.small.muted', `+${fmt(last.credits)} CR`)));
    this.sideEl = h('aside.menu-side.reveal', card, goalCard, lastCard);
    return this.sideEl;
  }

  refresh() { const n = this.side(); this.el.querySelector('.menu-side').replaceWith(n); }
}
