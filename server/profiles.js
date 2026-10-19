import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OPERATORS, OUTFITS, BANNERS, DEFAULT_OPERATOR } from '../src/shared/operators.js';
import { WEAPONS, SKINS } from '../src/shared/weapons.js';
import { levelFromXp, dailyChallengesFor, todayKey, computeRewards } from '../src/shared/rules.js';

// Server-held player profiles. The server is the only party that changes an
// online profile's credits, XP and unlocks. Persisted as JSON on disk.

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = path.join(DIR, 'profiles.json');
const MAX_IMPORT_CREDITS = 25000;
const PRACTICE_PER_DAY = 20;

let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; }
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('profile save failed', e.message); }
  }, 300);
}

const valid = {
  operator: (id) => !!OPERATORS[id],
  weapon: (id) => !!WEAPONS[id],
  skin: (id) => { const [w, s] = String(id).split(':'); return !!WEAPONS[w] && !!SKINS[s]; },
  outfit: (id) => { const [o, s] = String(id).split(':'); return !!OPERATORS[o] && !!OUTFITS[s]; },
  banner: (id) => !!BANNERS[id],
};

function freshProfile(token, name) {
  return {
    token, name: (name || 'OPERATOR').slice(0, 16), credits: 600, xp: 0,
    owned: { operators: [DEFAULT_OPERATOR], weapons: ['vk7', 'hornet', 'vesper'], skins: [], outfits: [], banners: ['standard'] },
    equipped: { operator: DEFAULT_OPERATOR, primary: 'vk7', secondary: 'vesper', skins: {}, outfits: {}, banner: 'standard' },
    stats: { matches: 0, wins: 0, kills: 0, deaths: 0 },
    daily: { date: '', claimed: [] }, practice: { day: '', count: 0, last: 0 },
    created: Date.now(),
  };
}

/** Find or create a profile. `link` is the client's local profile, imported once (trust-on-first-use, sanitised). */
export function getOrCreate(token, name, link) {
  if (token && db[token]) { if (name) db[token].name = String(name).slice(0, 16); return db[token]; }
  const t = crypto.randomBytes(18).toString('base64url');
  const p = freshProfile(t, name);
  if (link && typeof link === 'object') {
    p.credits = Math.max(0, Math.min(MAX_IMPORT_CREDITS, Math.floor(Number(link.credits) || 0)));
    p.xp = Math.max(0, Math.min(200000, Math.floor(Number(link.xp) || 0)));
    const o = link.owned || {};
    p.owned.operators = [...new Set([DEFAULT_OPERATOR, ...(o.operators || []).filter(valid.operator)])];
    p.owned.weapons = [...new Set(['vk7', 'hornet', 'vesper', ...(o.weapons || []).filter(valid.weapon)])];
    p.owned.skins = [...new Set((o.skins || []).filter(valid.skin))];
    p.owned.outfits = [...new Set((o.outfits || []).filter(valid.outfit))];
    p.owned.banners = [...new Set(['standard', ...(o.banners || []).filter(valid.banner)])];
    if (link.equipped) sanitiseEquip(p, link.equipped);
  }
  db[t] = p;
  persist();
  return p;
}

function sanitiseEquip(p, e) {
  const q = p.equipped;
  if (p.owned.operators.includes(e.operator)) q.operator = e.operator;
  if (p.owned.weapons.includes(e.primary) && WEAPONS[e.primary]?.slot === 'primary') q.primary = e.primary;
  if (p.owned.weapons.includes(e.secondary) && WEAPONS[e.secondary]?.slot === 'secondary') q.secondary = e.secondary;
  q.skins = {}; for (const [w, s] of Object.entries(e.skins || {})) if (s === 'factory' || p.owned.skins.includes(`${w}:${s}`)) q.skins[w] = s;
  q.outfits = {}; for (const [o, s] of Object.entries(e.outfits || {})) if (s === 'standard' || p.owned.outfits.includes(`${o}:${s}`)) q.outfits[o] = s;
  if (p.owned.banners.includes(e.banner)) q.banner = e.banner;
}

export function publicProfile(p) {
  return { name: p.name, credits: p.credits, xp: p.xp, owned: p.owned, equipped: p.equipped, stats: p.stats };
}

function priceOf(kind, id) {
  if (kind === 'operator') return OPERATORS[id]?.price;
  if (kind === 'weapon') return WEAPONS[id]?.unlock.price;
  if (kind === 'skin') return SKINS[String(id).split(':')[1]]?.price;
  if (kind === 'outfit') return OUTFITS[String(id).split(':')[1]]?.price;
  if (kind === 'banner') return BANNERS[id]?.price;
  return undefined;
}
const LIST = { operator: 'operators', weapon: 'weapons', skin: 'skins', outfit: 'outfits', banner: 'banners' };

export function purchase(p, kind, id) {
  if (!LIST[kind] || !valid[kind](id)) return { ok: false, reason: 'Unknown item' };
  const list = p.owned[LIST[kind]];
  if (list.includes(id)) return { ok: false, reason: 'Already owned' };
  const price = priceOf(kind, id);
  if (price == null) return { ok: false, reason: 'Not for sale' };
  if (kind === 'weapon' && WEAPONS[id].unlock.level > levelFromXp(p.xp).level) return { ok: false, reason: `Requires level ${WEAPONS[id].unlock.level}` };
  if (p.credits < price) return { ok: false, reason: 'Not enough credits' };
  p.credits -= price;
  list.push(id);
  persist();
  return { ok: true, profile: publicProfile(p) };
}

export function equip(p, equipped) { sanitiseEquip(p, equipped || {}); persist(); return { ok: true, profile: publicProfile(p) }; }

/** Daily challenge claim: id must be one of today's three, once per day. */
export function claimDaily(p, id) {
  const day = todayKey();
  if (p.daily.date !== day) p.daily = { date: day, claimed: [] };
  const ch = dailyChallengesFor(day).find((c) => c.id === id);
  if (!ch) return { ok: false, reason: 'Not an active challenge' };
  if (p.daily.claimed.includes(id)) return { ok: false, reason: 'Already claimed' };
  p.daily.claimed.push(id);
  p.credits += ch.reward;
  persist();
  return { ok: true, reward: ch.reward, profile: publicProfile(p) };
}

/** Practice results are client-reported, so they are rate-limited and capped. */
export function practiceResult(p, r) {
  const day = todayKey();
  if (p.practice.day !== day) p.practice = { day, count: 0, last: 0 };
  if (p.practice.count >= PRACTICE_PER_DAY) return { ok: false, reason: 'Daily practice reward limit reached' };
  if (Date.now() - p.practice.last < 45000) return { ok: false, reason: 'Too soon after the last practice match' };
  const mode = ['easy', 'normal', 'hard'].includes(r?.mode) ? r.mode : 'easy';
  const roundsWon = Math.max(0, Math.min(5, r.roundsWon | 0));
  const duration = Math.max(0, r.duration | 0);
  if (duration < roundsWon * 8 + 20) return { ok: false, reason: 'Match too short' };
  const stats = {
    won: !!r.won && roundsWon >= 3, roundsWon, roundsLost: Math.min(5, r.roundsLost | 0),
    kills: Math.min(roundsWon + 1, r.kills | 0), headshots: Math.min(roundsWon, r.headshots | 0), shots: Math.max(0, r.shots | 0), hits: Math.max(0, Math.min(r.shots | 0, r.hits | 0)), flawless: Math.min(roundsWon, r.flawless | 0),
  };
  const rewards = computeRewards(stats, mode);
  p.credits += rewards.total; p.xp += rewards.xp;
  p.practice.count++; p.practice.last = Date.now();
  persist();
  return { ok: true, rewards, profile: publicProfile(p) };
}

/** Online match rewards computed from server-observed stats. */
export function grantMatch(p, stats) {
  const rewards = computeRewards(stats, 'online');
  p.credits += rewards.total; p.xp += rewards.xp;
  p.stats.matches++; if (stats.won) p.stats.wins++;
  p.stats.kills += stats.kills; p.stats.deaths += stats.deaths;
  persist();
  return rewards;
}

export function loadoutAllowed(p, lo) {
  const e = p.equipped;
  const ok = (k, v) => (k === 'operator' ? p.owned.operators.includes(v) : p.owned.weapons.includes(v));
  return {
    operator: ok('operator', lo?.operator) ? lo.operator : e.operator,
    outfit: lo?.outfit === 'standard' || p.owned.outfits.includes(`${lo?.operator}:${lo?.outfit}`) ? (lo?.outfit || 'standard') : 'standard',
    primary: ok('weapon', lo?.primary) && WEAPONS[lo.primary].slot === 'primary' ? lo.primary : e.primary,
    secondary: ok('weapon', lo?.secondary) && WEAPONS[lo.secondary].slot === 'secondary' ? lo.secondary : e.secondary,
    skins: Object.fromEntries(Object.entries(lo?.skins || {}).filter(([w, s]) => s === 'factory' || p.owned.skins.includes(`${w}:${s}`))),
    banner: p.owned.banners.includes(lo?.banner) ? lo.banner : 'standard',
  };
}

export function stats() { return { profiles: Object.keys(db).length }; }
