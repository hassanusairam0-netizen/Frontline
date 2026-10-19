// Fictional weapon catalogue. Shared by the client (handling, visuals) and the
// server (fire-rate, ammo and damage validation), so every number here is gameplay.

export const CATEGORIES = ['ASSAULT RIFLE', 'SUBMACHINE GUN', 'SHOTGUN', 'PRECISION RIFLE', 'SIDEARM'];

export const WEAPONS = {
  vk7: {
    id: 'vk7', name: 'VK-7 WARDEN', category: 'ASSAULT RIFLE', slot: 'primary',
    blurb: 'A balanced bullpup-style carbine built for mid-range lanes. Predictable vertical climb, forgiving reset.',
    damage: 25, headMult: 1.7, rpm: 640, auto: true, pellets: 1,
    mag: 30, reserve: 120, reload: 2.25, reloadEmpty: 2.75,
    spread: { hip: 2.6, ads: 0.28, move: 1.8, air: 5 },
    recoil: { v: 0.62, h: 0.24, kick: 0.045, recover: 8 },
    range: { start: 26, end: 60, min: 0.62 },
    ads: { fov: 50, time: 0.22 }, move: 0.95, sound: 'rifle',
    unlock: { level: 1, price: 0 },
  },
  hornet: {
    id: 'hornet', name: 'HORNET SMG-4', category: 'SUBMACHINE GUN', slot: 'primary',
    blurb: 'Compact, fast-cycling and light in the hands. Wins corners, loses long sightlines.',
    damage: 18, headMult: 1.5, rpm: 860, auto: true, pellets: 1,
    mag: 32, reserve: 160, reload: 1.85, reloadEmpty: 2.2,
    spread: { hip: 2.0, ads: 0.6, move: 0.9, air: 3.5 },
    recoil: { v: 0.38, h: 0.32, kick: 0.03, recover: 11 },
    range: { start: 12, end: 34, min: 0.5 },
    ads: { fov: 56, time: 0.16 }, move: 1.03, sound: 'smg',
    unlock: { level: 1, price: 0 },
  },
  breacher: {
    id: 'breacher', name: 'BREACHER 12', category: 'SHOTGUN', slot: 'primary',
    blurb: 'Pump-action close-quarters tool. Nine pellets, a heavy kick, and a long walk back to range.',
    damage: 12, headMult: 1.25, rpm: 72, auto: false, pellets: 9,
    mag: 6, reserve: 30, reload: 0.52, reloadEmpty: 0.52, perShell: true,
    spread: { hip: 5.2, ads: 4.0, move: 0.6, air: 1.5 },
    recoil: { v: 3.4, h: 0.9, kick: 0.12, recover: 6 },
    range: { start: 6, end: 18, min: 0.22 },
    ads: { fov: 60, time: 0.2 }, move: 0.97, sound: 'shotgun', pump: true,
    unlock: { level: 2, price: 600 },
  },
  ridgeline: {
    id: 'ridgeline', name: 'RIDGELINE DMR', category: 'PRECISION RIFLE', slot: 'primary',
    blurb: 'Semi-automatic marksman rifle with a low-power optic. Two to the head, three to the chest.',
    damage: 44, headMult: 2.0, rpm: 270, auto: false, pellets: 1,
    mag: 12, reserve: 48, reload: 2.5, reloadEmpty: 2.9,
    spread: { hip: 4.5, ads: 0.08, move: 2.5, air: 6 },
    recoil: { v: 1.6, h: 0.35, kick: 0.07, recover: 7 },
    range: { start: 45, end: 90, min: 0.8 },
    ads: { fov: 34, time: 0.27 }, move: 0.92, sound: 'dmr', scope: 'reflex',
    unlock: { level: 3, price: 900 },
  },
  longshot: {
    id: 'longshot', name: 'LONGSHOT LR-50', category: 'PRECISION RIFLE', slot: 'primary',
    blurb: 'Bolt-action long rifle. A clean headshot ends the round; a miss costs you the next second.',
    damage: 86, headMult: 2.4, rpm: 44, auto: false, pellets: 1,
    mag: 5, reserve: 25, reload: 3.0, reloadEmpty: 3.4, bolt: true,
    spread: { hip: 8, ads: 0.0, move: 4, air: 10 },
    recoil: { v: 4.2, h: 0.6, kick: 0.14, recover: 5 },
    range: { start: 80, end: 140, min: 0.9 },
    ads: { fov: 20, time: 0.34 }, move: 0.88, sound: 'sniper', scope: 'sniper',
    unlock: { level: 4, price: 1400 },
  },
  vesper: {
    id: 'vesper', name: 'VESPER P-11', category: 'SIDEARM', slot: 'secondary',
    blurb: 'Polymer-frame semi-automatic. Quick to draw, quick to settle. Your second chance.',
    damage: 30, headMult: 1.8, rpm: 400, auto: false, pellets: 1,
    mag: 12, reserve: 48, reload: 1.45, reloadEmpty: 1.75,
    spread: { hip: 1.8, ads: 0.4, move: 0.8, air: 3 },
    recoil: { v: 1.1, h: 0.3, kick: 0.05, recover: 10 },
    range: { start: 14, end: 36, min: 0.6 },
    ads: { fov: 60, time: 0.14 }, move: 1.05, sound: 'pistol', slide: true,
    unlock: { level: 1, price: 0 },
  },
  mako: {
    id: 'mako', name: 'MAKO .50 HAND CANNON', category: 'SIDEARM', slot: 'secondary',
    blurb: 'Six-shot heavy revolver. Slow, loud, and decisive when you land it.',
    damage: 54, headMult: 1.9, rpm: 150, auto: false, pellets: 1,
    mag: 6, reserve: 24, reload: 2.3, reloadEmpty: 2.3,
    spread: { hip: 2.4, ads: 0.25, move: 1.2, air: 4 },
    recoil: { v: 3.0, h: 0.5, kick: 0.1, recover: 7 },
    range: { start: 18, end: 45, min: 0.6 },
    ads: { fov: 58, time: 0.18 }, move: 1.02, sound: 'magnum', revolver: true,
    unlock: { level: 2, price: 700 },
  },
};

export const WEAPON_LIST = Object.values(WEAPONS);
export const DEFAULT_LOADOUT = { primary: 'vk7', secondary: 'vesper' };

/** Seconds between shots. */
export const fireInterval = (w) => 60 / w.rpm;

/** Damage multiplier from distance (linear falloff between range.start and range.end). */
export function falloff(w, dist) {
  if (dist <= w.range.start) return 1;
  if (dist >= w.range.end) return w.range.min;
  const t = (dist - w.range.start) / (w.range.end - w.range.start);
  return 1 - t * (1 - w.range.min);
}

export function damageFor(w, dist, part) {
  const base = w.damage * falloff(w, dist) * (part === 'head' ? w.headMult : part === 'legs' ? 0.8 : 1);
  return Math.max(1, Math.round(base));
}

/** Normalised 0-100 display stats for the armory. */
export function displayStats(w) {
  const dps = w.damage * w.pellets * (w.rpm / 60);
  const clamp = (v) => Math.max(4, Math.min(100, Math.round(v)));
  return {
    damage: clamp(((w.damage * w.pellets) / 110) * 100),
    fireRate: clamp((w.rpm / 900) * 100),
    accuracy: clamp(100 - w.spread.ads * 18 - w.spread.hip * 4),
    handling: clamp(110 - w.ads.time * 140 - w.recoil.v * 9),
    range: clamp((w.range.end / 140) * 100),
    mobility: clamp((w.move - 0.8) * 400),
    dps: Math.round(dps),
  };
}

// Cosmetic weapon finishes. Ownership is per weapon ("vk7:carbon").
export const SKINS = {
  factory: { id: 'factory', name: 'FACTORY', price: 0, rarity: 'STANDARD', base: 0x2a2c30, polymer: 0x1b1c1f, accent: 0x6b6f76, pattern: null },
  graphite: { id: 'graphite', name: 'GRAPHITE', price: 300, rarity: 'STANDARD', base: 0x45484e, polymer: 0x2e3035, accent: 0x9aa0a8, pattern: 'brushed' },
  amberline: { id: 'amberline', name: 'AMBER LINE', price: 550, rarity: 'REFINED', base: 0x1c1d20, polymer: 0x141517, accent: 0xe8a33d, pattern: 'stripe' },
  glacier: { id: 'glacier', name: 'GLACIER', price: 550, rarity: 'REFINED', base: 0xc9d3dc, polymer: 0x8fa3b5, accent: 0x5aa9e6, pattern: 'splinter' },
  dune: { id: 'dune', name: 'DUNE', price: 450, rarity: 'STANDARD', base: 0x9a8565, polymer: 0x6f5f47, accent: 0x3a3226, pattern: 'splinter' },
  carbon: { id: 'carbon', name: 'CARBON WEAVE', price: 800, rarity: 'ELITE', base: 0x18191b, polymer: 0x101113, accent: 0x5aa9e6, pattern: 'carbon' },
  gilded: { id: 'gilded', name: 'GILDED EDGE', price: 1200, rarity: 'ELITE', base: 0x1a1a1a, polymer: 0x111111, accent: 0xd8a24a, pattern: 'gilded' },
};
export const SKIN_LIST = Object.values(SKINS);
