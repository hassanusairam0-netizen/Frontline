import { h, clear } from '../dom.js';
import { MapStage, drawMapPlan } from '../../stages/MapStage.js';
import { MAP_LIST, MAPS, getLayout } from '../../shared/maps/index.js';
import { attachDrag } from './drag.js';
import { audio } from '../../engine/audio.js';

export class MapsScreen {
  constructor(app, params) { this.app = app; this.sel = params.map || 'neon'; this.music = 'menu'; }
  async prepareStage() {
    this.stage = await this.app.useStage(`map-${this.sel}`, () => new MapStage(this.app.engine, this.sel));
    audio.setAmbience(MAPS[this.sel] && { neon: 'rain', desert: 'desert', arctic: 'arctic', industrial: 'industrial' }[this.sel]);
  }

  render() {
    const m = MAPS[this.sel];
    const drag = h('div', { style: { position: 'absolute', inset: '72px 0 0 0', cursor: 'grab' } });
    attachDrag(drag, (dx) => this.stage.dragBy(dx));
    const list = h('div.col', { style: { gap: '10px', width: '300px' } }, h('div.eyebrow', 'Maps · 4 environments'),
      MAP_LIST.map((mm) => {
        const plan = drawMapPlan(getLayout(mm.id), 280, 120); plan.className = 'thumb'; plan.style.aspectRatio = '7 / 3';
        return h('button.map-card', { class: mm.id === this.sel ? 'active' : '', onclick: () => this.select(mm.id), dataset: { map: mm.id } }, plan,
          h('div.info', { style: { padding: '8px 12px 10px' } }, h('div.idx', `MAP ${mm.index}`), h('div.nm', { style: { fontSize: '17px' } }, mm.name)));
      }));
    const info = h('div.panel.panel-pad.col.reveal', { style: { width: '400px', gap: '12px' } },
      h('div.row', h('span.idx.mono', { style: { color: 'var(--amber)' } }, `MAP ${m.index}`), h('span.grow'), h('span.small.muted.mono', m.time)),
      h('div.h-display', { style: { fontSize: '52px' } }, m.name),
      h('div', { style: { fontFamily: 'var(--f-display)', letterSpacing: '.16em', color: 'var(--text-2)', textTransform: 'uppercase', fontSize: '14px' } }, m.tagline),
      h('p', { style: { margin: 0 } }, m.desc),
      h('div.notice', h('strong', 'Strategy · '), m.strategy),
      h('div.row', { style: { flexWrap: 'wrap' } }, h('span.small.muted', 'DIFFICULTY'), h('span.diff', [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= m.difficulty ? 'on' : '' }))), h('span.grow'), h('span.tag', m.size), ...m.tags.map((t) => h('span.tag', t))),
      h('div.row', h('button.btn.btn--primary', { onclick: () => this.app.go('play', { practice: true, map: m.id }), dataset: { act: 'play-map' } }, 'Practice on this map'), h('button.btn', { onclick: () => this.app.go('lobby', { mode: 'quick' }) }, 'Quick match')));
    return h('section.screen', drag,
      h('div', { style: { position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', pointerEvents: 'none', flexWrap: 'wrap' } },
        h('div', { style: { pointerEvents: 'auto' } }, list), h('div', { style: { pointerEvents: 'auto' } }, info)),
      h('div.stage-hint', 'Live 3D preview · drag to orbit'));
  }

  select(id) { if (id !== this.sel) this.app.go('maps', { map: id }); }
}
export { clear };
