import { h, clear, fmt, toast } from '../dom.js';
import { profile } from '../../state/profile.js';
import { StudioStage } from '../../stages/StudioStage.js';
import { WEAPON_LIST, WEAPONS, CATEGORIES, SKIN_LIST, displayStats } from '../../shared/weapons.js';
import { attachDrag } from './drag.js';
import { purchaseFlow } from './operators.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class ArmoryScreen {
  constructor(app) { this.app = app; this.music = 'menu'; this.ambience = null; this.sel = profile.data.equipped.primary; this.previewSkin = null; }
  async prepareStage() {
    this.stage = await this.app.useStage('studio-wpn', () => new StudioStage(this.app.engine, 'weapon'));
    this.showModel();
  }
  showModel() { this.stage.setWeapon(this.sel, this.previewSkin || profile.skinFor(this.sel)); }

  render() {
    this.listEl = h('div.list.scroll-y');
    this.detailEl = h('div.detail.scroll-y');
    this.drag = h('div.drag-zone');
    const el = h('section.screen',
      this.drag,
      h('div.split', { style: { pointerEvents: 'none' } },
        h('div.col', { style: { pointerEvents: 'auto', minHeight: 0 } }, h('div.eyebrow', 'Armory'), h('div.small.muted', 'Your selection here is the weapon you carry into matches.'), this.listEl),
        h('div.stage-space'),
        h('div', { style: { pointerEvents: 'auto', minHeight: 0, display: 'flex' } }, this.detailEl)),
      h('div.stage-hint', 'Drag to rotate · Scroll to zoom'));
    this.drawList(); this.drawDetail();
    attachDrag(this.drag, (dx, dy) => this.stage.drag(dx, dy), (d) => this.stage.wheel(d));
    return el;
  }

  drawList() {
    clear(this.listEl);
    const e = profile.data.equipped;
    for (const cat of CATEGORIES) {
      this.listEl.append(h('div.cat-head', cat));
      for (const w of WEAPON_LIST.filter((x) => x.category === cat)) {
        const owned = profile.owns('weapon', w.id);
        const eq = e.primary === w.id || e.secondary === w.id;
        this.listEl.append(h('button.list-item', { class: this.sel === w.id ? 'active' : '', onclick: () => { this.sel = w.id; this.previewSkin = null; this.showModel(); this.drawList(); this.drawDetail(); }, dataset: { weapon: w.id } },
          h('div', h('div.name', { style: { fontSize: '16px' } }, w.name), h('div.meta', w.slot === 'primary' ? 'Primary' : 'Sidearm')),
          h('div.state', eq ? h('span.tag.amber', 'Equipped') : owned ? h('span.tag.ok', 'Owned') : w.unlock.level > profile.level.level ? h('span.tag', `LV ${w.unlock.level}`) : h('span.price', fmt(w.unlock.price)))));
      }
    }
  }

  drawDetail() {
    const w = WEAPONS[this.sel];
    const st = displayStats(w);
    const owned = profile.owns('weapon', w.id);
    const e = profile.data.equipped;
    const eq = e[w.slot] === w.id;
    const skinCur = this.previewSkin || profile.skinFor(w.id);
    const rows = [['Damage', st.damage], ['Fire rate', st.fireRate], ['Accuracy', st.accuracy], ['Handling', st.handling], ['Range', st.range], ['Mobility', st.mobility]];
    const lockedByLevel = w.unlock.level > profile.level.level;
    const swatches = SKIN_LIST.map((s) => {
      const id = `${w.id}:${s.id}`;
      const own = profile.owns('skin', id);
      return h('div', { style: { textAlign: 'center' } },
        h('div.swatch', { class: skinCur === s.id ? 'active' : '', title: `${s.name} · ${s.rarity}`, style: { background: `linear-gradient(135deg, ${hex(s.base)} 0 55%, ${hex(s.polymer)} 55% 82%, ${hex(s.accent)} 82%)` }, onclick: () => this.pickSkin(s, id, own), dataset: { skin: s.id } }, own ? null : h('i.lock')),
        h('div.swatch-label', own ? s.name.split(' ')[0] : fmt(s.price)));
    });
    clear(this.detailEl).append(
      h('div.reveal.col', { style: { gap: '14px', width: '100%' } },
        h('div.row', h('span.tag.amber', w.category), h('span.small.muted', w.slot === 'primary' ? 'Primary slot' : 'Sidearm slot')),
        h('div.h-display', { style: { fontSize: 'clamp(40px, 4.4vw, 64px)' } }, w.name),
        h('p', { style: { margin: 0 } }, w.blurb),
        h('div.col', { style: { gap: '9px' } }, rows.map(([k, v]) => h('div.stat', h('span', k), h('div.bar', h('i', { style: { width: `${v}%` } })), h('span.v', v)))),
        h('div.kv', { style: { gridTemplateColumns: 'repeat(3, 1fr)' } },
          h('div', h('div.k', 'Magazine'), h('div.v', { style: { fontSize: '20px' } }, `${w.mag}/${w.reserve}`)),
          h('div', h('div.k', 'RPM'), h('div.v', { style: { fontSize: '20px' } }, w.rpm)),
          h('div', h('div.k', 'DPS'), h('div.v', { style: { fontSize: '20px' } }, st.dps))),
        h('div.row', h('button.btn.btn--sm', { onclick: () => this.stage.fireDemo(), dataset: { act: 'fire-demo' } }, 'Test fire'), h('button.btn.btn--sm', { onclick: () => this.stage.reloadDemo(), dataset: { act: 'reload-demo' } }, 'Reload'), h('span.small.muted', 'Safe range preview')),
        h('div', h('div.cat-head', 'Finishes'), h('div.swatches', swatches)),
        h('div.divider'),
        owned
          ? h('button.btn.btn--primary.btn--lg', { disabled: eq, onclick: () => { profile.equip(w.slot, w.id); toast(`${w.name} equipped as ${w.slot === 'primary' ? 'primary' : 'sidearm'}`); this.drawList(); this.drawDetail(); }, dataset: { act: 'equip-weapon' } }, eq ? 'Equipped' : `Equip as ${w.slot === 'primary' ? 'primary' : 'sidearm'}`)
          : lockedByLevel
            ? h('div.notice.warn', `Unlock requirement: reach level ${w.unlock.level} (you are level ${profile.level.level}), then ${fmt(w.unlock.price)} credits.`)
            : h('button.btn.btn--primary.btn--lg', { onclick: () => purchaseFlow('weapon', w.id, w.name, w.unlock.price, () => { profile.equip(w.slot, w.id); this.drawList(); this.drawDetail(); }), dataset: { act: 'buy-weapon' } }, h('span', 'Unlock'), h('span.price', { style: { color: '#15120d' } }, fmt(w.unlock.price)))));
  }

  async pickSkin(s, id, own) {
    this.previewSkin = s.id;
    this.showModel();
    if (own) { if (profile.owns('weapon', this.sel)) { profile.equip('skin', id); toast(`${s.name} applied`); } }
    else {
      if (!profile.owns('weapon', this.sel)) { toast('Unlock the weapon first to buy finishes for it.', 'blue'); this.drawDetail(); return; }
      const bought = await purchaseFlow('skin', id, `${WEAPONS[this.sel].name} · ${s.name}`, s.price, () => profile.equip('skin', id));
      if (!bought) { this.previewSkin = null; this.showModel(); }
    }
    this.drawDetail();
  }
}
