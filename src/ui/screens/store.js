import { h, clear, fmt, toast, unlockAnimation } from '../dom.js';
import { profile, itemPrice } from '../../state/profile.js';
import { MenuStage } from '../../stages/MenuStage.js';
import { OPERATOR_LIST, OPERATORS, OUTFIT_LIST, BANNER_LIST, BANNERS } from '../../shared/operators.js';
import { WEAPON_LIST, WEAPONS, SKIN_LIST, SKINS } from '../../shared/weapons.js';
import { OBJECTIVES, todayKey } from '../../shared/rules.js';
import { thumb } from '../thumbs.js';
import { purchaseFlow } from './operators.js';

const TABS = [['featured', 'Featured'], ['operators', 'Operators'], ['weapons', 'Weapons'], ['finishes', 'Weapon finishes'], ['outfits', 'Outfits'], ['banners', 'Banners'], ['challenges', 'Challenges']];

export class StoreScreen {
  constructor(app, params) { this.app = app; this.tab = params.tab || 'featured'; this.music = 'menu'; this.ambience = 'menu'; this.finishWeapon = profile.data.equipped.primary; }
  async prepareStage() { await this.app.useStage('menu', () => new MenuStage(this.app.engine)); }

  render() {
    this.tabsEl = h('div.tabs');
    this.gridEl = h('div');
    this.balEl = h('span.price', fmt(profile.credits));
    this.off = profile.on('change', () => { this.balEl.textContent = fmt(profile.credits); });
    const el = h('section.screen.scroll-y', { style: { background: 'linear-gradient(90deg, rgba(8,9,11,.92), rgba(8,9,11,.75))' } },
      h('div', { style: { maxWidth: '1280px', width: '100%', margin: '0 auto' } },
        h('div.row', { style: { alignItems: 'flex-end', marginBottom: '18px' } },
          h('div.grow', h('div.eyebrow', 'Store'), h('h2.h-section', 'Spend earned credits')),
          h('div', { style: { textAlign: 'right' } }, h('div.small.muted', 'BALANCE'), this.balEl)),
        h('div.notice', { style: { marginBottom: '18px' } }, 'Everything here is unlocked with credits earned by playing — finishing matches, winning rounds, daily challenges and objectives. There are no real-money purchases.'),
        this.tabsEl, this.gridEl));
    this.draw();
    return el;
  }

  draw() {
    clear(this.tabsEl).append(...TABS.map(([id, label]) => h('button', { class: this.tab === id ? 'on' : '', onclick: () => { this.tab = id; this.draw(); }, dataset: { tab: id } }, label)));
    const g = clear(this.gridEl);
    const grid = h('div.store-grid.reveal');
    const items = this.items();
    if (this.tab === 'finishes') {
      g.append(h('div.row', { style: { marginBottom: '14px', flexWrap: 'wrap' } }, h('span.small.muted', 'WEAPON'), h('div.seg', { style: { flexWrap: 'wrap' } }, WEAPON_LIST.map((w) => h('button', { class: this.finishWeapon === w.id ? 'on' : '', onclick: () => { this.finishWeapon = w.id; this.draw(); } }, w.name.split(' ')[0])))));
    }
    if (this.tab === 'challenges') { g.append(this.challenges()); return; }
    for (const it of items) grid.append(this.card(it));
    g.append(grid);
  }

  items() {
    const ops = OPERATOR_LIST.filter((o) => o.price > 0).map((o) => ({ kind: 'operator', id: o.id, title: o.name, sub: `Operator · ${o.role}`, art: { type: 'operator', id: o.id } }));
    const wps = WEAPON_LIST.filter((w) => w.unlock.price > 0).map((w) => ({ kind: 'weapon', id: w.id, title: w.name, sub: `${w.category} · Level ${w.unlock.level}`, art: { type: 'weapon', id: w.id } }));
    const fins = SKIN_LIST.filter((s) => s.price > 0).map((s) => ({ kind: 'skin', id: `${this.finishWeapon}:${s.id}`, title: s.name, sub: `${WEAPONS[this.finishWeapon].name} · ${s.rarity}`, rarity: s.rarity, art: { type: 'weapon', id: this.finishWeapon, skin: s.id } }));
    const outs = OPERATOR_LIST.flatMap((o) => OUTFIT_LIST.filter((x) => x.price > 0).map((x) => ({ kind: 'outfit', id: `${o.id}:${x.id}`, title: x.name, sub: `Outfit · ${o.name}`, art: { type: 'operator', id: o.id, outfit: x.id, bust: false } })));
    const bans = BANNER_LIST.filter((b) => b.price > 0).map((b) => ({ kind: 'banner', id: b.id, title: b.name, sub: 'Player banner', banner: b }));
    if (this.tab === 'operators') return ops;
    if (this.tab === 'weapons') return wps;
    if (this.tab === 'finishes') return fins;
    if (this.tab === 'outfits') return outs;
    if (this.tab === 'banners') return bans;
    // featured: deterministic daily rotation across categories
    let hsh = 0; for (const c of todayKey()) hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0;
    const pick = (arr, n) => { const a = arr.slice(); const out = []; for (let i = 0; i < n && a.length; i++) { hsh = (hsh * 1103515245 + 12345) >>> 0; out.push(a.splice(hsh % a.length, 1)[0]); } return out; };
    const allFins = WEAPON_LIST.flatMap((w) => SKIN_LIST.filter((s) => s.price > 0).map((s) => ({ kind: 'skin', id: `${w.id}:${s.id}`, title: s.name, sub: `${w.name} · ${s.rarity}`, rarity: s.rarity, art: { type: 'weapon', id: w.id, skin: s.id } })));
    return [...pick(ops, 2), ...pick(allFins, 3), ...pick(outs, 2), ...pick(bans, 1)];
  }

  card(it) {
    const price = itemPrice(it.kind, it.id);
    const owned = profile.owns(it.kind, it.id);
    const reason = owned ? null : profile.canBuy(it.kind, it.id);
    const art = h('div.art');
    if (it.banner) art.append(h('div', { style: { width: '100%', height: '100%', background: `linear-gradient(120deg, ${it.banner.colors[0]} 0 45%, ${it.banner.colors[1]} 45% 47%, ${it.banner.colors[0]} 47%)`, display: 'grid', placeItems: 'center', fontFamily: 'var(--f-display)', fontWeight: 700, letterSpacing: '.3em', color: it.banner.colors[1] } }, it.banner.name));
    else art.append(thumb(it.art));
    const equipLabel = it.kind === 'operator' ? 'Select' : 'Equip';
    return h('button.item-card', { class: `${owned ? 'owned' : ''} rarity-${it.rarity || ''}`, onclick: () => this.buy(it, owned), dataset: { item: `${it.kind}:${it.id}` } },
      art,
      h('div.body', h('div.k', it.sub), h('div.t', it.title)),
      h('div.foot', owned ? h('span.tag.ok', 'Owned') : h('span.price', fmt(price)), owned ? h('span.small.muted', equipLabel) : reason ? h('span.small.muted', { style: { maxWidth: '120px', textAlign: 'right' } }, reason.startsWith('Need') ? 'Need more' : reason) : h('span.small', { style: { color: 'var(--amber)' } }, 'Unlock')));
  }

  async buy(it, owned) {
    const slotOf = { operator: 'operator', skin: 'skin', outfit: 'outfit', banner: 'banner' };
    if (owned) {
      if (it.kind === 'weapon') profile.equip(WEAPONS[it.id].slot, it.id);
      else if (it.kind === 'outfit' && !profile.owns('operator', it.id.split(':')[0])) { toast('Unlock this operator to wear the outfit.', 'blue'); return; }
      else profile.equip(slotOf[it.kind], it.id);
      toast(`${it.title} equipped`);
      this.draw();
      return;
    }
    const ok = await purchaseFlow(it.kind, it.id, it.title, itemPrice(it.kind, it.id), () => {
      if (it.kind === 'weapon') profile.equip(WEAPONS[it.id].slot, it.id);
      else if (it.kind !== 'outfit' || profile.owns('operator', it.id.split(':')[0])) profile.equip(slotOf[it.kind], it.id);
    });
    if (ok) this.draw();
  }

  challenges() {
    const d = profile.dailies();
    const done = profile.data.objectives;
    return h('div.reveal', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' } },
      h('div.panel.panel-pad', h('div.eyebrow', `Daily · resets at 00:00 UTC`), h('h3.h-section', { style: { fontSize: '26px', margin: '6px 0 12px' } }, 'Daily challenges'),
        d.map((c) => h('div.challenge', h('span', c.text), c.claimed ? h('span.tag.ok', 'Claimed') : c.done ? h('button.btn.btn--sm.btn--primary', { onclick: async () => { const r = await profile.claimDaily(c.id); if (r.ok) { unlockAnimation(`+${fmt(r.reward)} CR`, 'Challenge complete'); this.draw(); } else toast(r.reason || 'Could not claim', 'err'); } }, `Claim +${c.reward}`) : h('span.mono.small.muted', `${c.progress}/${c.goal} · +${c.reward}`), h('div.bar', h('i', { style: { width: `${(c.progress / c.goal) * 100}%` } }))))),
      h('div.panel.panel-pad', h('div.eyebrow.blue', 'One-time'), h('h3.h-section', { style: { fontSize: '26px', margin: '6px 0 12px' } }, 'Objectives'),
        OBJECTIVES.map((o) => h('div.challenge', h('span', { style: { color: done.includes(o.id) ? 'var(--text)' : '' } }, o.text), done.includes(o.id) ? h('span.tag.ok', 'Done') : h('span.mono.small.muted', `+${o.reward}`)))),
      h('div.panel.panel-pad', h('div.eyebrow', 'Career'), h('h3.h-section', { style: { fontSize: '26px', margin: '6px 0 12px' } }, 'Service record'),
        h('div.kv', Object.entries({ Matches: profile.data.stats.matches, Wins: profile.data.stats.wins, Eliminations: profile.data.stats.kills, 'Headshot kills': profile.data.stats.headshots, Accuracy: `${profile.data.stats.shots ? Math.round((profile.data.stats.hits / profile.data.stats.shots) * 100) : 0}%`, 'Abilities used': profile.data.stats.abilities }).map(([k, v]) => h('div', h('div.k', k), h('div.v', { style: { fontSize: '22px' } }, v))))));
  }

  unmount() { this.off?.(); }
}
export { OPERATORS, SKINS, BANNERS };
