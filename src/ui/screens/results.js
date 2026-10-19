import { h, fmt, tweenNumber, unlockAnimation } from '../dom.js';
import { profile } from '../../state/profile.js';
import { net } from '../../game/net.js';
import { audio } from '../../engine/audio.js';
import { MAPS } from '../../shared/maps/index.js';
import { launchMatch } from '../../game/launch.js';

// Post-match debrief: outcome, stats, animated reward breakdown, level and unlock progress.

export class ResultsScreen {
  constructor(app, { result, config, game }) {
    this.app = app; this.result = result; this.config = config; this.game = game;
    this.topbar = false;
  }

  async record() {
    const r = this.result;
    if (r.server) {
      const s = r.server;
      return profile.recordMatch(r, { rewards: s.rewards || { lines: [], total: 0, xp: 0 }, profile: s.profile });
    }
    if (profile.data.linked) {
      if (!net.connected) { try { await net.connect(2000); } catch { /* offline */ } }
      if (net.connected) {
        try {
          const res = await net.request('practiceResult', { result: r });
          if (res.ok) return profile.recordMatch(r, { rewards: res.rewards, profile: res.profile });
          return { ...profile.recordMatch(r, { rewards: { lines: [], total: 0, xp: 0 } }), note: `Server declined practice rewards: ${res.reason}` };
        } catch { /* fall through */ }
      }
      return { ...profile.recordMatch(r, { rewards: { lines: [], total: 0, xp: 0 } }), note: 'Your online profile is offline, so practice rewards could not be granted.' };
    }
    return profile.recordMatch(r);
  }

  render() {
    const r = this.result;
    const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
    const mm = `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}`;
    this.rewardsCol = h('div.col', { style: { gap: 0 } }, h('div.eyebrow', 'Rewards'), h('div.small.muted', { style: { marginTop: '8px' } }, 'Calculating…'));
    const el = h('section.results',
      h('div.results-inner',
        h('div.col', { style: { gap: '18px' } },
          h('div.eyebrow', `${r.mode === 'online' ? 'Online match' : `Practice · ${r.mode.toUpperCase()}`} · ${MAPS[r.map]?.name || ''}`),
          h('div.h-display.result-title', { class: r.won ? 'win' : 'loss' }, r.won ? 'Victory' : 'Defeat'),
          h('div.row', h('span.result-score', `${r.roundsWon} — ${r.roundsLost}`), h('span.muted', `vs ${r.oppName} · ${r.oppOperator}`), r.forfeit ? h('span.tag', 'Forfeit') : null),
          h('div.kv',
            h('div', h('div.k', 'Eliminations'), h('div.v', r.kills)),
            h('div', h('div.k', 'Accuracy'), h('div.v', `${acc}%`)),
            h('div', h('div.k', 'Headshot kills'), h('div.v', r.headshots)),
            h('div', h('div.k', 'Damage dealt'), h('div.v', fmt(r.damage))),
            h('div', h('div.k', 'Match duration'), h('div.v', mm)),
            h('div', h('div.k', 'Flawless rounds'), h('div.v', r.flawless))),
          h('div.row', { style: { flexWrap: 'wrap' } },
            h('button.btn.btn--primary.btn--lg', { onclick: () => this.again(), dataset: { act: 'again' } }, 'Play again'),
            h('button.btn.btn--lg', { onclick: () => this.app.go('operators'), dataset: { act: 'loadout' } }, 'Change loadout'),
            h('button.btn.btn--lg', { onclick: () => this.app.go('menu'), dataset: { act: 'menu' } }, 'Return to menu'))),
        h('div.panel.panel-pad', this.rewardsCol)));
    return el;
  }

  async mounted() {
    audio.setMusic('menu');
    const rec = await this.record();
    this.rec = rec;
    const col = this.rewardsCol;
    col.innerHTML = '';
    col.append(h('div.eyebrow', 'Rewards'));
    const lines = rec.rewards.lines || [];
    lines.forEach((l, i) => col.append(h('div.reward-line', { style: { animationDelay: `${0.15 + i * 0.12}s` } }, h('span', l.label), h('span.mono', `+${fmt(l.amount)}`))));
    if (rec.rewards.scale && rec.rewards.scale !== 1) col.append(h('div.reward-line', { style: { animationDelay: `${0.15 + lines.length * 0.12}s` } }, h('span.muted', `Difficulty multiplier`), h('span.mono', `×${rec.rewards.scale}`)));
    for (const ob of rec.objectives || []) col.append(h('div.reward-line', { style: { animationDelay: `${0.3 + lines.length * 0.12}s` } }, h('span', { style: { color: 'var(--amber)' } }, `Objective: ${ob.text}`), h('span.mono', `+${fmt(ob.reward)}`)));
    const total = (rec.rewards.total || 0) + (rec.objectiveCredits || 0);
    const num = h('span.num', '0');
    col.append(h('div.reward-total', h('span.eyebrow', 'Credits earned'), num));
    const bal = h('span.mono', fmt(rec.before.credits));
    col.append(h('div.row', h('span.small.muted', 'Balance'), h('span.grow'), bal));
    // level progress
    const lvBar = h('i', { style: { width: `${(rec.before.into / rec.before.need) * 100}%` } });
    col.append(h('div.divider'), h('div.row', h('span.small.muted', `Level ${rec.after.level}`), h('span.grow'), h('span.small.mono', `+${fmt(rec.rewards.xp || 0)} XP`)), h('div.bar.blue', { style: { height: '4px', marginTop: '8px' } }, lvBar));
    const goal = profile.nextGoal();
    if (goal) {
      const gBar = h('i', { style: { width: `${Math.min(100, (rec.before.credits / goal.price) * 100)}%` } });
      col.append(h('div.row', { style: { marginTop: '16px' } }, h('span.small.muted', `Progress: ${goal.label}`), h('span.grow'), h('span.small.mono', `${fmt(Math.min(rec.after.credits, goal.price))} / ${fmt(goal.price)}`)), h('div.bar', { style: { height: '4px', marginTop: '8px' } }, gBar));
      setTimeout(() => { gBar.style.width = `${Math.min(100, (rec.after.credits / goal.price) * 100)}%`; }, 900 + lines.length * 120);
    }
    if (rec.note) col.append(h('div.notice.warn', { style: { marginTop: '14px' } }, rec.note));
    const delay = 400 + lines.length * 120;
    setTimeout(() => {
      tweenNumber(num, 0, total, 1300, () => { if (Math.random() < 0.35) audio.coin(); });
      tweenNumber(bal, rec.before.credits, rec.after.credits, 1300);
      lvBar.style.width = rec.after.level > rec.before.level ? '100%' : `${(rec.after.into / rec.after.need) * 100}%`;
      if (rec.after.level > rec.before.level) setTimeout(() => { lvBar.style.transition = 'none'; lvBar.style.width = '0%'; void lvBar.offsetWidth; lvBar.style.transition = ''; lvBar.style.width = `${(rec.after.into / rec.after.need) * 100}%`; unlockAnimation(`Level ${rec.after.level}`, 'Level up'); }, 900);
      else if (rec.objectives?.length) setTimeout(() => unlockAnimation(rec.objectives[0].text, 'Objective complete'), 1500);
    }, delay);
  }

  again() {
    if (this.config.mode === 'online') {
      this.app.go('lobby', { mode: this.config.room?.kind === 'private' ? 'room' : 'quick', room: net.room && net.room.state !== 'match' ? net.room : null });
    } else launchMatch(this.app, { ...this.config, loadout: profile.loadout() });
  }
}
