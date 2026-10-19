// Operators: identical health so no operator out-trades another on raw stats.
// Power lives in abilities, each gated by a cooldown the server also enforces.

export const OPERATORS = {
  volt: {
    id: 'volt', name: 'VOLT', role: 'ASSAULT', price: 0, accent: 0xe8a33d, accentName: 'AMBER',
    callsign: 'Operator 03 · Kaya Voss',
    bio: 'A former courier-racer recruited after outrunning a security cordon on foot. Volt fights in lightweight kit, trading plate for pace, and trusts momentum over cover.',
    ability: {
      id: 'overdrive', name: 'OVERDRIVE', cooldown: 22, duration: 4,
      desc: 'Injects a short burst of adrenaline: +32% movement speed for 4 seconds. Weapon handling is unaffected.',
    },
    speed: 1.02, build: 'light',
  },
  phantom: {
    id: 'phantom', name: 'PHANTOM', role: 'RECON', price: 1500, accent: 0x5aa9e6, accentName: 'COLD BLUE',
    callsign: 'Operator 01 · Identity withheld',
    bio: 'No file, no face, no confirmed record. Phantom carries a wrist-mounted acoustic array that maps movement through walls for a few seconds at a time.',
    ability: {
      id: 'recon', name: 'RECON PULSE', cooldown: 30, duration: 4, radius: 32,
      desc: 'Emits an acoustic pulse that reveals enemy positions within 32 m for 4 seconds, through walls.',
    },
    speed: 1.0, build: 'slim',
  },
  bulwark: {
    id: 'bulwark', name: 'BULWARK', role: 'DEFENDER', price: 1800, accent: 0xd08a2e, accentName: 'HAZARD AMBER',
    callsign: 'Operator 07 · Teodor Brann',
    bio: 'A breaching specialist who walked out of a collapsed refinery carrying two teammates. Bulwark deploys a fold-out ballistic barrier wherever the fight needs a wall.',
    ability: {
      id: 'barrier', name: 'AEGIS BARRIER', cooldown: 34, duration: 9, hp: 260,
      desc: 'Deploys a 2.6 m ballistic barrier in front of you for 9 seconds. Blocks all fire until it absorbs 260 damage.',
    },
    speed: 0.96, build: 'heavy',
  },
  medic: {
    id: 'medic', name: 'MEDIC', role: 'SUPPORT', price: 1200, accent: 0x4fc3b0, accentName: 'FIELD TEAL',
    callsign: 'Operator 05 · Dr. Imani Okafor',
    bio: 'A trauma surgeon who stopped waiting for casualties to reach her. Medic carries an auto-injector rig that stabilises wounds mid-fight.',
    ability: {
      id: 'stim', name: 'TRAUMA STIM', cooldown: 30, duration: 2, heal: 40,
      desc: 'Restores 40 health over 2 seconds. Cannot exceed maximum health. Taking damage does not cancel it.',
    },
    speed: 1.0, build: 'medium',
  },
};

export const OPERATOR_LIST = Object.values(OPERATORS);
export const DEFAULT_OPERATOR = 'volt';
export const MAX_HEALTH = 100;

// Cosmetic outfits (palette variants). Ownership is per operator ("phantom:dune").
export const OUTFITS = {
  standard: { id: 'standard', name: 'STANDARD ISSUE', price: 0 },
  nightfall: { id: 'nightfall', name: 'NIGHTFALL', price: 450 },
  dune: { id: 'dune', name: 'DUNE RUNNER', price: 450 },
  whiteout: { id: 'whiteout', name: 'WHITEOUT', price: 600 },
};
export const OUTFIT_LIST = Object.values(OUTFITS);

// Palette per operator & outfit: fabric, armor, gear, accent, skin tone.
const BASE_PAL = {
  volt: { fabric: 0x3b3f44, armor: 0x2a2c2f, gear: 0x55524a, skin: 0xb98a6a },
  phantom: { fabric: 0x1d2024, armor: 0x16181b, gear: 0x24282d, skin: 0x8f6a52 },
  bulwark: { fabric: 0x3d4136, armor: 0x4a4c45, gear: 0x343630, skin: 0xd2a684 },
  medic: { fabric: 0x3a4044, armor: 0x2f3438, gear: 0x5a5f60, skin: 0x6b4a36 },
};
const OUTFIT_TINTS = {
  standard: null,
  nightfall: { fabric: 0x15171b, armor: 0x101215, gear: 0x1c1f24 },
  dune: { fabric: 0x8a7656, armor: 0x6e5d43, gear: 0x9b8763 },
  whiteout: { fabric: 0xc8cdd2, armor: 0xa9b0b7, gear: 0xdfe3e6 },
};

export function operatorPalette(opId, outfitId = 'standard') {
  const op = OPERATORS[opId] || OPERATORS.volt;
  const base = BASE_PAL[op.id];
  return { ...base, ...(OUTFIT_TINTS[outfitId] || {}), accent: op.accent };
}

// Player banners shown in lobbies and on the results screen.
export const BANNERS = {
  standard: { id: 'standard', name: 'GRAPHITE', price: 0, colors: ['#1f2227', '#2c3037'], mark: 'line' },
  ember: { id: 'ember', name: 'EMBER LINE', price: 200, colors: ['#2a1a0c', '#e8a33d'], mark: 'chevron' },
  tide: { id: 'tide', name: 'COLD TIDE', price: 200, colors: ['#0c1a26', '#5aa9e6'], mark: 'wave' },
  meridian: { id: 'meridian', name: 'MERIDIAN', price: 350, colors: ['#141518', '#c7a26a'], mark: 'grid' },
  frontline: { id: 'frontline', name: 'FRONTLINE', price: 500, colors: ['#0b0c0e', '#e8a33d'], mark: 'crest' },
};
export const BANNER_LIST = Object.values(BANNERS);
