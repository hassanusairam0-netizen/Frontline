import { Emitter } from '../engine/emitter.js';
import { load, save, remove } from './storage.js';
import { OPERATORS, OUTFITS, BANNERS, DEFAULT_OPERATOR } from '../shared/operators.js';
import { WEAPONS, SKINS, DEFAULT_LOADOUT } from '../shared/weapons.js';
import { computeRewards, levelFromXp, dailyChallengesFor, todayKey, OBJECTIVES } from '../shared/rules.js';

// Player progression. Local profiles persist in localStorage. When an online
// profile is linked, the server is the source of truth: purchases and online
// match rewards go through it and the local copy only mirrors the server's reply.

const KEY = 'frontline.profile.v1';
const STARTING_CREDITS = 600;

function fresh() {
  return {
    version: 1,
    name: '',
    credits: STARTING_CREDITS,
    xp: 0,
    owned: { operators: [DEFAULT_OPERATOR], weapons: ['vk7', 'hornet', 'vesper'], skins: [], outfits: [], banners: ['standard'] },
    equipped: { operator: DEFAULT_OPERATOR, primary: DEFAULT_LOADOUT.primary, secondary: DEFAULT_LOADOUT.secondary, skins: {}, outfits: {}, banner: 'standard' },
    stats: { matches: 0, wins: 0, kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, roundsWon: 0, abilities: 0, playtime: 0 },
    daily: { date: '', progress: {}, claimed: [] },
    objectives: [],
    history: [],
    token: null,
    linked: false,
  };
}

function migrate(p) {
  const f = fresh();
  const out = { ...f, ...p, owned: { ...f.owned, ...(p?.owned || {}) }, equipped: { ...f.equipped, ...(p?.equipped || {}) }, stats: { ...f.stats, ...(p?.stats || {}) }, daily: { ...f.daily, ...(p?.daily || {}) } };
  if (!out.owned.operators.includes(DEFAULT_OPERATOR)) out.owned.operators.push(DEFAULT_OPERATOR);
  for (const w of ['vk7', 'hornet', 'vesper']) if (!out.owned.weapons.includes(w)) out.owned.weapons.push(w);
  return out;
}

export function itemPrice(kind, id) {
  if (kind === 'operator') return OPERATORS[id]?.price ?? null;
  if (kind === 'weapon') return WEAPONS[id]?.unlock.price ?? null;
  if (kind === 'skin') return SKINS[id.split(':')[1]]?.price ?? null;
  if (kind === 'outfit') return OUTFITS[id.split(':')[1]]?.price ?? null;
  if (kind === 'banner') return BANNERS[id]?.price ?? null;
  return null;
}

class Profile extends Emitter {
  constructor() {
    super();
    this.data = migrate(load(KEY, fresh()));
    this.remote = null; // set by net layer when linked: { request(type, payload) => Promise }
    this.rollDaily();
  }

  persist() { save(KEY, this.data); this.emit('change', this.data); }

  get credits() { return this.data.credits; }
  get level() { return levelFromXp(this.data.xp); }

  owns(kind, id) {
    const o = this.data.owned;
    if (kind === 'operator') return o.operators.includes(id);
    if (kind === 'weapon') return o.weapons.includes(id);
    if (kind === 'skin') return id.endsWith(':factory') || o.skins.includes(id);
    if (kind === 'outfit') return id.endsWith(':standard') || o.outfits.includes(id);
    if (kind === 'banner') return o.banners.includes(id);
    return false;
  }

  /** Reason a purchase is not allowed, or null. */
  canBuy(kind, id) {
    if (this.owns(kind, id)) return 'Already owned';
    const price = itemPrice(kind, id);
    if (price == null) return 'Unknown item';
    if (kind === 'weapon' && WEAPONS[id].unlock.level > this.level.level) return `Requires level ${WEAPONS[id].unlock.level}`;
    if (this.data.credits < price) return `Need ${(price - this.data.credits).toLocaleString()} more credits`;
    return null;
  }

  async purchase(kind, id) {
    const reason = this.canBuy(kind, id);
    if (reason) return { ok: false, reason };
    if (this.data.linked && this.remote) {
      try {
        const res = await this.remote.request('purchase', { kind, id });
        if (!res.ok) return res;
        this.applyServerProfile(res.profile);
        this.emit('purchase', { kind, id });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'Online profile unreachable — purchase not made.' };
      }
    }
    const price = itemPrice(kind, id);
    this.data.credits -= price;
    const o = this.data.owned;
    ({ operator: o.operators, weapon: o.weapons, skin: o.skins, outfit: o.outfits, banner: o.banners })[kind].push(id);
    this.checkObjectives({});
    this.persist();
    this.emit('purchase', { kind, id });
    return { ok: true };
  }

  equip(slot, value) {
    const e = this.data.equipped;
    if (slot === 'operator' && this.owns('operator', value)) e.operator = value;
    else if ((slot === 'primary' || slot === 'secondary') && this.owns('weapon', value) && WEAPONS[value].slot === slot) e[slot] = value;
    else if (slot === 'skin') { const [w, s] = value.split(':'); if (this.owns('skin', value)) e.skins[w] = s; }
    else if (slot === 'outfit') { const [op, s] = value.split(':'); if (this.owns('outfit', value)) e.outfits[op] = s; }
    else if (slot === 'banner' && this.owns('banner', value)) e.banner = value;
    else return false;
    this.persist();
    if (this.data.linked && this.remote) this.remote.request('equip', { equipped: e }).catch(() => {});
    return true;
  }

  skinFor(weaponId) { return this.data.equipped.skins[weaponId] || 'factory'; }
  outfitFor(opId) { return this.data.equipped.outfits[opId] || 'standard'; }

  loadout() {
    const e = this.data.equipped;
    return {
      operator: e.operator, outfit: this.outfitFor(e.operator), primary: e.primary, secondary: e.secondary,
      skins: { [e.primary]: this.skinFor(e.primary), [e.secondary]: this.skinFor(e.secondary) }, banner: e.banner,
    };
  }

  setName(name) { this.data.name = name.slice(0, 16); this.persist(); }

  // ---- daily challenges ----
  rollDaily() {
    const key = todayKey();
    if (this.data.daily.date !== key) { this.data.daily = { date: key, progress: {}, claimed: [] }; this.persist(); }
  }
  dailies() {
    this.rollDaily();
    return dailyChallengesFor(this.data.daily.date).map((c) => {
      const progress = Math.min(c.goal, this.data.daily.progress[c.stat] || 0);
      return { ...c, progress, done: progress >= c.goal, claimed: this.data.daily.claimed.includes(c.id) };
    });
  }
  async claimDaily(id) {
    const c = this.dailies().find((d) => d.id === id);
    if (!c || !c.done || c.claimed) return { ok: false };
    if (this.data.linked && this.remote) {
      try { const res = await this.remote.request('claimDaily', { id, progress: this.data.daily.progress }); if (!res.ok) return res; this.applyServerProfile(res.profile); }
      catch { return { ok: false, reason: 'Online profile unreachable.' }; }
    } else this.data.credits += c.reward;
    this.data.daily.claimed.push(id);
    this.persist();
    return { ok: true, reward: c.reward };
  }

  checkObjectives(match) {
    const earned = [];
    for (const ob of OBJECTIVES) {
      if (this.data.objectives.includes(ob.id)) continue;
      try { if (ob.test(match, this.data)) { this.data.objectives.push(ob.id); earned.push(ob); } } catch { /* match may lack fields */ }
    }
    return earned;
  }

  /**
   * Record a finished match. For online matches the server has already granted
   * rewards; pass serverResult to mirror it instead of paying locally.
   */
  recordMatch(m, serverResult = null) {
    const d = this.data, st = d.stats;
    const before = { credits: d.credits, ...this.level, xp: d.xp };
    st.matches++; if (m.won) st.wins++;
    st.kills += m.kills; st.deaths += m.deaths; st.shots += m.shots; st.hits += m.hits; st.headshots += m.headshots;
    st.roundsWon += m.roundsWon; st.abilities += m.abilities || 0; st.playtime += m.duration || 0;
    // daily progress
    const dp = d.daily.progress;
    const inc = (k, v) => { if (v) dp[k] = (dp[k] || 0) + v; };
    inc('wins', m.won ? 1 : 0); inc('kills', m.kills); inc('headshots', m.headshotKills ?? m.headshots); inc('abilities', m.abilities);
    inc('roundsWon', m.roundsWon); inc('sidearmKills', m.sidearmKills); inc('matches', 1); inc('flawless', m.flawless);
    inc('hardWins', m.won && (m.mode === 'hard' || m.mode === 'online') ? 1 : 0);

    let rewards;
    if (serverResult) {
      rewards = serverResult.rewards;
      if (serverResult.profile) this.applyServerProfile(serverResult.profile, true);
    } else {
      rewards = computeRewards(m, m.mode);
      d.credits += rewards.total;
      d.xp += rewards.xp;
    }
    const objectives = this.checkObjectives(m);
    let objectiveCredits = 0;
    if (!serverResult) for (const ob of objectives) { d.credits += ob.reward; objectiveCredits += ob.reward; }
    d.history.unshift({ at: Date.now(), map: m.map, mode: m.mode, won: m.won, score: `${m.roundsWon}-${m.roundsLost}`, kills: m.kills, credits: rewards.total + objectiveCredits });
    d.history = d.history.slice(0, 20);
    this.persist();
    return { rewards, objectives, objectiveCredits, before, after: { credits: d.credits, ...this.level, xp: d.xp } };
  }

  /** Mirror an authoritative server profile (online mode). */
  applyServerProfile(sp, keepLocalStats = false) {
    const d = this.data;
    d.credits = sp.credits; d.xp = sp.xp;
    d.owned = { ...d.owned, ...sp.owned };
    if (sp.equipped) d.equipped = { ...d.equipped, ...sp.equipped };
    if (!keepLocalStats && sp.stats) d.stats = { ...d.stats, ...sp.stats };
    d.linked = true;
    this.persist();
  }

  /** Snapshot sent to the server the first time an online profile is linked. */
  exportForLink() {
    const d = this.data;
    return { name: d.name, credits: d.credits, xp: d.xp, owned: d.owned, equipped: d.equipped, stats: d.stats };
  }

  unlink() { this.data.linked = false; this.persist(); }

  reset() { const token = this.data.token; remove(KEY); this.data = fresh(); this.data.token = token; this.rollDaily(); this.persist(); }

  /** Next unlock to show progress toward on the results screen. */
  nextGoal() {
    const ops = Object.values(OPERATORS).filter((o) => !this.owns('operator', o.id)).sort((a, b) => a.price - b.price);
    if (ops.length) return { label: `Unlock ${ops[0].name}`, price: ops[0].price, kind: 'operator', id: ops[0].id };
    const ws = Object.values(WEAPONS).filter((w) => !this.owns('weapon', w.id)).sort((a, b) => a.unlock.price - b.unlock.price);
    if (ws.length) return { label: `Unlock ${ws[0].name}`, price: ws[0].unlock.price, kind: 'weapon', id: ws[0].id };
    return null;
  }
}

export const profile = new Profile();
