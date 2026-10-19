import { h, clear, fmt, toast, confirm, unlockAnimation, icon } from '../dom.js';
import { profile } from '../../state/profile.js';
import { StudioStage } from '../../stages/StudioStage.js';
import { OPERATOR_LIST, OPERATORS, OUTFIT_LIST, operatorPalette } from '../../shared/operators.js';
import { attachDrag } from './drag.js';

const ABILITY_ICON = { recon: 'recon', barrier: 'barrier', overdrive: 'overdrive', stim: 'stim' };
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export async function purchaseFlow(kind, id, name, price, onDone) {
  const reason = profile.canBuy(kind, id);
  if (reason && reason !== 'Already owned') { toast(reason, 'err'); return false; }
  const ok = await confirm({ eyebrow: 'Confirm purchase', title: `Unlock ${name}`, body: h('div', h('p', `Spend `, h('span.price', fmt(price)), ` credits? You have ${fmt(profile.credits)}.`), h('p.small.muted', 'Credits are earned through gameplay only. No real money is involved.')), ok: `Unlock · ${fmt(price)}` });
  if (!ok) return false;
  const res = await profile.purchase(kind, id);
  if (!res.ok) { toast(res.reason || 'Purchase failed', 'err'); return false; }
  unlockAnimation(name);
  onDone?.();
  return true;
}

export class OperatorsScreen {
  constructor(app) { this.app = app; this.music = 'menu'; this.ambience = null; this.sel = profile.data.equipped.operator; this.previewOutfit = null; }
  async prepareStage() {
    this.stage = await this.app.useStage('studio-op', () => new StudioStage(this.app.engine, 'operator'));
    this.showModel();
  }
  showModel() {
    const op = OPERATORS[this.sel];
    const outfit = this.previewOutfit || profile.outfitFor(op.id);
    const lo = profile.loadout();
    this.stage.setOperator(op.id, outfit, op.id === 'bulwark' ? 'breacher' : op.id === 'phantom' ? 'ridgeline' : lo.primary, 'factory');
  }

  render() {
    this.listEl = h('div.list.scroll-y');
    this.detailEl = h('div.detail.scroll-y');
    this.drag = h('div.drag-zone');
    const el = h('section.screen',
      this.drag,
      h('div.split', { style: { pointerEvents: 'none' } },
        h('div.col', { style: { pointerEvents: 'auto', minHeight: 0 } }, h('div.eyebrow', 'Operators'), h('div.small.muted', 'One free operator. Unlock the rest with credits.'), this.listEl),
        h('div.stage-space'),
        h('div', { style: { pointerEvents: 'auto', minHeight: 0, display: 'flex' } }, this.detailEl)),
      h('div.stage-hint', 'Drag to rotate'));
    this.drawList(); this.drawDetail();
    attachDrag(this.drag, (dx) => this.stage.drag(dx, 0));
    return el;
  }

  drawList() {
    clear(this.listEl);
    for (const op of OPERATOR_LIST) {
      const owned = profile.owns('operator', op.id);
      const eq = profile.data.equipped.operator === op.id;
      this.listEl.append(h('button.list-item', { class: this.sel === op.id ? 'active' : '', onclick: () => { this.sel = op.id; this.previewOutfit = null; this.showModel(); this.drawList(); this.drawDetail(); }, dataset: { op: op.id } },
        h('div', h('div.name', op.name), h('div.meta', `${op.role} · ${op.ability.name}`)),
        h('div.state', eq ? h('span.tag.amber', 'Equipped') : owned ? h('span.tag.ok', 'Owned') : h('span.price', fmt(op.price)))));
    }
  }

  drawDetail() {
    const op = OPERATORS[this.sel];
    const owned = profile.owns('operator', op.id);
    const eq = profile.data.equipped.operator === op.id;
    const A = op.ability;
    const outfitCur = this.previewOutfit || profile.outfitFor(op.id);
    const bal = [['Mobility', Math.round(op.speed * 80)], ['Durability', 70], ['Utility', { recon: 85, barrier: 80, overdrive: 60, stim: 75 }[A.id]], ['Ability CD', Math.round(100 - A.cooldown * 1.6)]];
    const swatches = OUTFIT_LIST.map((o) => {
      const id = `${op.id}:${o.id}`;
      const own = profile.owns('outfit', id);
      const pal = operatorPalette(op.id, o.id);
      return h('div', { style: { textAlign: 'center' } },
        h('div.swatch', { class: outfitCur === o.id ? 'active' : '', title: o.name, style: { background: `linear-gradient(135deg, ${hex(pal.fabric)} 0 50%, ${hex(pal.armor)} 50% 80%, ${hex(pal.accent)} 80%)` }, onclick: () => this.pickOutfit(o, id, own), dataset: { outfit: o.id } }, own ? null : h('i.lock')),
        h('div.swatch-label', own ? o.name.split(' ')[0] : fmt(o.price)));
    });
    clear(this.detailEl).append(
      h('div.reveal.col', { style: { gap: '14px', width: '100%' } },
        h('div.row', h('span.tag.amber', op.role), h('span.small.muted', op.callsign)),
        h('div.h-display', op.name),
        h('p', { style: { margin: 0 } }, op.bio),
        h('div.panel.ability-card',
          h('div.ability-icon', { style: { color: hex(op.accent) } }, icon(ABILITY_ICON[A.id])),
          h('div', h('div.row', h('strong', { style: { fontFamily: 'var(--f-display)', letterSpacing: '.14em', fontSize: '17px' } }, A.name), h('span.grow'), h('span.tag', `Q · ${A.cooldown}s`)),
            h('p.small', { style: { margin: '6px 0 10px' } }, A.desc),
            h('button.btn.btn--sm.btn--blue', { onclick: () => this.stage.previewAbility(A.id), dataset: { act: 'preview-ability' } }, 'Preview ability'))),
        h('div.col', { style: { gap: '9px' } }, bal.map(([k, v]) => h('div.stat', h('span', k), h('div.bar', h('i', { style: { width: `${v}%` } })), h('span.v', v)))),
        h('div', h('div.cat-head', 'Outfits'), h('div.swatches', swatches)),
        h('div.divider'),
        owned
          ? h('button.btn.btn--primary.btn--lg', { disabled: eq, onclick: () => { profile.equip('operator', op.id); toast(`${op.name} equipped`); this.drawList(); this.drawDetail(); }, dataset: { act: 'equip-op' } }, eq ? 'Equipped' : 'Select operator')
          : h('button.btn.btn--primary.btn--lg', { onclick: () => purchaseFlow('operator', op.id, op.name, op.price, () => { profile.equip('operator', op.id); this.drawList(); this.drawDetail(); }), dataset: { act: 'buy-op' } }, h('span', 'Unlock'), h('span.price', { style: { color: '#15120d' } }, fmt(op.price))),
        !owned && profile.credits < op.price ? h('div.small.muted', `You need ${fmt(op.price - profile.credits)} more credits. Win matches and complete daily challenges to earn them.`) : null));
  }

  async pickOutfit(o, id, own) {
    this.previewOutfit = o.id;
    this.showModel();
    if (own) { if (profile.owns('operator', this.sel)) { profile.equip('outfit', id); toast(`${o.name} equipped`); } }
    else {
      if (!profile.owns('operator', this.sel)) { toast('Unlock the operator first to buy outfits for them.', 'blue'); this.drawDetail(); return; }
      const bought = await purchaseFlow('outfit', id, `${OPERATORS[this.sel].name} · ${o.name}`, o.price, () => profile.equip('outfit', id));
      if (!bought) { this.previewOutfit = null; this.showModel(); }
    }
    this.drawDetail();
  }
}
