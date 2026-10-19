import { h, clear, toast } from '../dom.js';
import { profile } from '../../state/profile.js';
import { MenuStage } from '../../stages/MenuStage.js';
import { MAP_LIST, getLayout } from '../../shared/maps/index.js';
import { OPERATORS } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';
import { drawMapPlan } from '../../stages/MapStage.js';
import { launchMatch } from '../../game/launch.js';
import { load, save } from '../../state/storage.js';

const PREF = 'frontline.practice.v1';

export class PlayScreen {
  constructor(app, params) {
    this.app = app; this.params = params; this.music = 'menu'; this.ambience = 'menu';
    this.cfg = { difficulty: 'normal', map: 'neon', roundsToWin: 4, ...load(PREF, {}), ...(params.map ? { map: params.map } : {}) };
  }
  async prepareStage() { await this.app.useStage('menu', () => new MenuStage(this.app.engine)); }

  render() {
    const lo = profile.loadout();
    const op = OPERATORS[lo.operator];
    this.practiceEl = h('div');
    const el = h('section.screen.scroll-y',
      h('div.reveal', { style: { maxWidth: '1280px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' } },
        h('div', h('div.eyebrow', 'Deploy'), h('h2.h-section', 'Select a mode')),
        h('div.mode-grid',
          h('div.mode-card', { onclick: () => this.app.go('lobby', { mode: 'quick' }), dataset: { mode: 'quick' } },
            h('span.tag.amber', 'Online · Ranked-style'), h('h3', 'Quick Match'),
            h('p', 'Matchmaking pairs you with the next available opponent. Server-authoritative hits, live lobby, map vote and rewards.'),
            h('div.go', h('button.btn.btn--primary', 'Find match'))),
          h('div.mode-card', { onclick: () => this.app.go('lobby', { mode: 'room' }), dataset: { mode: 'room' } },
            h('span.tag.blue', 'Online · Invite'), h('h3', 'Private Room'),
            h('p', 'Create a room and share the four-letter code, or join a friend’s room. Same rules, your opponent.'),
            h('div.go', h('button.btn', 'Create or join'))),
          h('div.mode-card', { onclick: () => this.showPractice(), dataset: { mode: 'bots' } },
            h('span.tag', 'Offline · Practice'), h('h3', 'Play vs Bots'),
            h('p', 'A fully offline 1v1 against an AI operator that navigates, flanks, takes cover and adapts to the difficulty you choose.'),
            h('div.go', h('button.btn', 'Configure')))),
        h('div.panel.panel-pad.row', { style: { gap: '28px', flexWrap: 'wrap' } },
          h('div', h('div.eyebrow', 'Current loadout'), h('div', { style: { fontFamily: 'var(--f-display)', fontSize: '26px', fontWeight: 700, letterSpacing: '.08em', marginTop: '6px' } }, `${op.name} `, h('span.muted', { style: { fontSize: '16px' } }, op.role))),
          h('div', h('div.small.muted', 'PRIMARY'), h('div', WEAPONS[lo.primary].name)),
          h('div', h('div.small.muted', 'SIDEARM'), h('div', WEAPONS[lo.secondary].name)),
          h('div', h('div.small.muted', 'ABILITY'), h('div', `${op.ability.name} · ${op.ability.cooldown}s`)),
          h('span.grow'),
          h('button.btn.btn--sm', { onclick: () => this.app.go('operators') }, 'Change operator'),
          h('button.btn.btn--sm', { onclick: () => this.app.go('armory') }, 'Change weapons')),
        this.practiceEl));
    if (this.params.practice) setTimeout(() => this.showPractice(), 50);
    return el;
  }

  showPractice() {
    const c = this.cfg;
    const seg = (key, opts) => h('div.seg', opts.map(([v, label]) => h('button', { class: c[key] === v ? 'on' : '', onclick: () => { c[key] = v; this.showPractice(); } }, label)));
    const maps = h('div.map-grid', MAP_LIST.map((m) => {
      const card = h('button.map-card', { class: c.map === m.id ? 'active' : '', onclick: () => { c.map = m.id; this.showPractice(); }, dataset: { map: m.id } });
      const plan = drawMapPlan(getLayout(m.id), 320, 180);
      plan.className = 'thumb';
      card.append(plan, h('div.info', h('div.idx', `MAP ${m.index}`), h('div.nm', m.name), h('div.row', { style: { marginTop: '6px' } }, h('span.diff', [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= m.difficulty ? 'on' : '' }))), h('span.small.muted', m.size))));
      return card;
    }));
    const diffNote = { easy: 'Slow reactions, loose aim, rarely uses cover. Rewards ×0.6.', normal: 'Competent: tracks, strafes and takes cover when hurt. Rewards ×1.0.', hard: 'Fast reactions, tight tracking, flanks and uses its ability aggressively. Rewards ×1.35.' }[c.difficulty];
    const panel = h('div.panel.panel-pad.col', { style: { gap: '18px' }, id: 'practice' },
      h('div.row', h('div.grow', h('div.eyebrow', 'Practice vs bots'), h('h2.h-section', 'Configure practice')), h('span.tag', 'Works offline')),
      h('div.row', { style: { gap: '36px', flexWrap: 'wrap', alignItems: 'flex-start' } },
        h('div.field', h('label', 'Bot difficulty'), seg('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]), h('div.small.muted', { style: { maxWidth: '360px' } }, diffNote)),
        h('div.field', h('label', 'Rounds to win'), seg('roundsToWin', [[3, '3'], [4, '4'], [5, '5']]))),
      h('div.field', h('label', 'Map'), maps),
      h('div.row', h('span.grow'), h('button.btn.btn--primary.btn--lg', { onclick: () => this.start(), dataset: { act: 'start-practice' } }, 'Deploy')));
    clear(this.practiceEl).append(panel);
    if (!this._scrolled) { this._scrolled = true; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  start() {
    save(PREF, this.cfg);
    if (!profile.owns('operator', profile.data.equipped.operator)) { toast('Equip an operator you own first.', 'err'); return; }
    launchMatch(this.app, { mode: 'bots', ...this.cfg, loadout: profile.loadout() });
  }
}
