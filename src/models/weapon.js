import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SKINS } from '../shared/weapons.js';
import { TEX, skinPattern } from '../engine/textures.js';
import { mergeStatic } from './merge.js';

// Procedural fictional firearms. Forward is -Z, origin sits at the top of the grip.
// Each model exposes animated parts (bolt, slide, pump, mag, cylinder) and anchors
// (grip, fore, muzzle, eject, sight) used by hands, effects and ADS alignment.

const geoCache = new Map();
const cachedGeos = new Set();
function rbox(w, h, d, r = 0.006, seg = 2) {
  const key = `rb${w.toFixed(3)}-${h.toFixed(3)}-${d.toFixed(3)}-${r}`;
  if (!geoCache.has(key)) { const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.1, h / 2.1, d / 2.1)); geoCache.set(key, g); cachedGeos.add(g); }
  return geoCache.get(key);
}
function cyl(r1, r2, len, seg = 20) {
  const key = `cy${r1}-${r2}-${len}-${seg}`;
  if (!geoCache.has(key)) { const g = new THREE.CylinderGeometry(r1, r2, len, seg); g.rotateX(Math.PI / 2); geoCache.set(key, g); cachedGeos.add(g); }
  return geoCache.get(key);
}

const skinMatCache = new Map();
export function weaponMaterials(skinId = 'factory') {
  if (skinMatCache.has(skinId)) return skinMatCache.get(skinId);
  const s = SKINS[skinId] || SKINS.factory;
  const metalTex = TEX.metal([0.5, 0.5, 0.52], 61, 0.35);
  const gripTex = TEX.grip();
  const pattern = s.pattern && s.pattern !== 'stripe' && s.pattern !== 'gilded' ? skinPattern(s.pattern, s.accent) : null;
  const base = new THREE.MeshStandardMaterial({
    color: s.base, metalness: 0.75, roughness: 0.38, map: pattern,
    normalMap: metalTex.normalMap, roughnessMap: metalTex.roughnessMap, envMapIntensity: 1.2,
  });
  base.normalScale.set(0.4, 0.4);
  const polymer = new THREE.MeshStandardMaterial({ color: s.polymer, metalness: 0.05, roughness: 0.62, map: pattern, envMapIntensity: 0.9 });
  const grip = new THREE.MeshStandardMaterial({ color: s.polymer, metalness: 0.0, roughness: 0.8, normalMap: gripTex.normalMap, envMapIntensity: 0.7 });
  grip.normalScale.set(1.2, 1.2);
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.3 });
  const brightSteel = new THREE.MeshStandardMaterial({ color: 0x8c9096, metalness: 1, roughness: 0.22 });
  const gilded = s.pattern === 'gilded';
  const accent = new THREE.MeshStandardMaterial({ color: s.accent, metalness: gilded ? 1 : 0.3, roughness: gilded ? 0.22 : 0.45, emissive: s.pattern === 'stripe' ? s.accent : 0x000000, emissiveIntensity: s.pattern === 'stripe' ? 0.25 : 0 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x0a1418, metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 2.5, transparent: true, opacity: 0.85 });
  const dot = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1d, roughness: 0.55, metalness: 0 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.3 });
  const set = { base, polymer, grip, steel, brightSteel, accent, lens, dot, wood, brass, stripe: s.pattern === 'stripe' || gilded };
  skinMatCache.set(skinId, set);
  return set;
}

class Builder {
  constructor(m) { this.root = new THREE.Group(); this.m = m; this.parts = {}; this.anchors = {}; }
  mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.root) {
    const me = new THREE.Mesh(geo, mat);
    me.position.set(x, y, z); me.rotation.set(rx, ry, rz);
    me.castShadow = true; me.receiveShadow = true;
    parent.add(me);
    return me;
  }
  group(name, x, y, z, parent = this.root) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.name = name; parent.add(g); this.parts[name] = g; return g;
  }
  anchor(name, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); this.root.add(o); this.anchors[name] = o; return o; }
  rail(len, x, y, z, parent = this.root) {
    const m = this.m;
    this.mesh(rbox(0.022, 0.008, len, 0.002), m.steel, x, y, z, 0, 0, 0, parent);
    const n = Math.floor(len / 0.012);
    for (let i = 0; i < n; i += 2) this.mesh(rbox(0.024, 0.006, 0.005, 0.001), m.steel, x, y + 0.006, z - len / 2 + i * 0.012 + 0.006, 0, 0, 0, parent);
  }
  reflex(x, y, z) {
    const m = this.m;
    this.mesh(rbox(0.036, 0.012, 0.07, 0.003), m.steel, x, y, z);
    this.mesh(rbox(0.04, 0.042, 0.016, 0.006), m.base, x, y + 0.026, z - 0.03);
    this.mesh(rbox(0.04, 0.042, 0.016, 0.006), m.base, x, y + 0.026, z + 0.022);
    this.mesh(rbox(0.006, 0.042, 0.06, 0.002), m.base, x - 0.018, y + 0.026, z - 0.004);
    this.mesh(rbox(0.006, 0.042, 0.06, 0.002), m.base, x + 0.018, y + 0.026, z - 0.004);
    this.mesh(rbox(0.04, 0.006, 0.06, 0.002), m.base, x, y + 0.046, z - 0.004);
    const lens = this.mesh(new THREE.PlaneGeometry(0.03, 0.03), m.lens, x, y + 0.026, z - 0.03);
    lens.castShadow = false;
    const d = this.mesh(new THREE.CircleGeometry(0.0016, 10), m.dot, x, y + 0.027, z - 0.031);
    d.castShadow = false;
    return y + 0.027;
  }
  scope(x, y, z, len, r, rBell) {
    const m = this.m;
    this.mesh(cyl(r, r, len), m.base, x, y, z);
    this.mesh(cyl(rBell, r, 0.05), m.base, x, y, z - len / 2 - 0.02);
    this.mesh(cyl(r, rBell * 0.85, 0.045), m.base, x, y, z + len / 2 + 0.02);
    this.mesh(cyl(0.017, 0.017, 0.03), m.base, x, y + r + 0.012, z, Math.PI / 2);
    this.mesh(cyl(0.015, 0.015, 0.025), m.base, x + r + 0.01, y, z, 0, Math.PI / 2);
    const front = this.mesh(new THREE.CircleGeometry(rBell * 0.92, 24), m.lens, x, y, z - len / 2 - 0.046, 0, Math.PI);
    front.castShadow = false;
    const back = this.mesh(new THREE.CircleGeometry(rBell * 0.75, 24), m.lens, x, y, z + len / 2 + 0.043);
    back.castShadow = false;
    for (const zz of [z - len * 0.3, z + len * 0.3]) {
      this.mesh(rbox(0.03, 0.03, 0.022, 0.004), m.steel, x, y - r - 0.006, zz);
    }
    return y;
  }
  stripe(x, y, z, w, h, d) { if (this.m.stripe) this.mesh(rbox(w, h, d, 0.001), this.m.accent, x, y, z); }
}

const BUILDERS = {
  vk7(b) {
    const m = b.m;
    // upper receiver with ejection port and forward assist
    b.mesh(rbox(0.058, 0.068, 0.34, 0.012), m.base, 0, 0.036, -0.07);
    b.mesh(rbox(0.004, 0.022, 0.07, 0.002), m.steel, 0.03, 0.04, -0.04);
    b.mesh(cyl(0.008, 0.008, 0.03, 10), m.base, 0.026, 0.05, 0.03, 0, Math.PI / 2, 0);
    // lower receiver, mag well, trigger guard
    b.mesh(rbox(0.05, 0.05, 0.21, 0.012), m.polymer, 0, -0.012, -0.02);
    b.mesh(rbox(0.054, 0.046, 0.06, 0.01), m.polymer, 0, -0.032, -0.115);
    b.mesh(rbox(0.012, 0.03, 0.055, 0.005), m.steel, 0, -0.046, -0.02);
    // octagonal handguard with M-LOK style slots
    b.mesh(cyl(0.036, 0.036, 0.32, 8), m.polymer, 0, 0.036, -0.39, 0, 0, Math.PI / 8);
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) b.mesh(rbox(0.004, 0.012, 0.03, 0.002), m.steel, sx * 0.034, 0.036, -0.28 - i * 0.055);
    for (let i = 0; i < 5; i++) b.mesh(rbox(0.012, 0.004, 0.03, 0.002), m.steel, 0, 0.003, -0.28 - i * 0.055);
    b.rail(0.6, 0, 0.075, -0.24);
    // barrel, gas block, compensator
    b.mesh(cyl(0.011, 0.011, 0.2, 14), m.steel, 0, 0.036, -0.63);
    b.mesh(rbox(0.026, 0.026, 0.03, 0.004), m.steel, 0, 0.036, -0.56);
    b.mesh(cyl(0.016, 0.016, 0.065, 12), m.steel, 0, 0.036, -0.74);
    for (let i = 0; i < 3; i++) b.mesh(rbox(0.034, 0.005, 0.008, 0.001), m.base, 0, 0.052, -0.72 - i * 0.016);
    // buffer tube + adjustable stock
    b.mesh(cyl(0.013, 0.013, 0.14, 14), m.steel, 0, 0.03, 0.16);
    b.mesh(rbox(0.044, 0.07, 0.18, 0.016), m.polymer, 0, 0.022, 0.25);
    b.mesh(rbox(0.04, 0.04, 0.08, 0.012), m.polymer, 0, -0.02, 0.3);
    b.mesh(rbox(0.048, 0.115, 0.026, 0.01), m.grip, 0, 0.004, 0.35);
    b.mesh(rbox(0.036, 0.026, 0.1, 0.01), m.polymer, 0, 0.066, 0.24);
    // pistol grip
    b.mesh(rbox(0.034, 0.11, 0.046, 0.014), m.grip, 0, -0.075, 0.04, -0.32);
    b.mesh(rbox(0.004, 0.02, 0.012, 0.002), m.steel, 0, -0.036, -0.012, -0.3);
    // curved magazine (three segments following the curve)
    const mag = b.group('mag', 0, -0.05, -0.115);
    const segs = [[0.0, -0.035, 0.0, 0.08], [0.0, -0.088, 0.008, 0.2], [0.0, -0.138, 0.022, 0.33]];
    for (const [x, y, z, r] of segs) b.mesh(rbox(0.03, 0.058, 0.066, 0.008), m.polymer, x, y, z, r, 0, 0, mag);
    for (let i = 0; i < 4; i++) b.mesh(rbox(0.031, 0.003, 0.05, 0.001), m.steel, 0, -0.03 - i * 0.03, 0.002 + i * 0.006, 0.1 + i * 0.07, 0, 0, mag);
    b.mesh(rbox(0.034, 0.012, 0.07, 0.004), m.accent, 0, -0.168, 0.034, 0.33, 0, 0, mag);
    // charging handle
    const bolt = b.group('bolt', 0, 0.068, 0.085);
    b.mesh(rbox(0.05, 0.01, 0.022, 0.003), m.accent, 0, 0, 0, 0, 0, 0, bolt);
    // angled foregrip
    b.mesh(rbox(0.026, 0.05, 0.07, 0.01), m.polymer, 0, -0.018, -0.42, 0.5);
    b.stripe(0.03, 0.04, -0.07, 0.002, 0.012, 0.28);
    b.stripe(-0.03, 0.04, -0.07, 0.002, 0.012, 0.28);
    const sy = b.reflex(0, 0.081, -0.14);
    b.anchor('grip', 0, -0.07, 0.045);
    b.anchor('fore', 0, -0.045, -0.42);
    b.anchor('magHand', 0, -0.16, -0.1);
    b.anchor('muzzle', 0, 0.036, -0.78);
    b.anchor('eject', 0.03, 0.045, -0.04);
    b.anchor('sight', 0, sy, -0.14);
  },
  hornet(b) {
    const m = b.m;
    b.mesh(rbox(0.056, 0.085, 0.3, 0.01), m.polymer, 0, 0.03, -0.08);
    b.mesh(rbox(0.06, 0.03, 0.26, 0.008), m.base, 0, 0.08, -0.08);
    b.rail(0.2, 0, 0.098, -0.06);
    b.mesh(cyl(0.022, 0.022, 0.12, 14), m.base, 0, 0.04, -0.28);
    for (let i = 0; i < 4; i++) b.mesh(cyl(0.024, 0.024, 0.008, 14), m.steel, 0, 0.04, -0.24 - i * 0.025);
    b.mesh(cyl(0.009, 0.009, 0.06, 10), m.steel, 0, 0.04, -0.36);
    b.mesh(rbox(0.034, 0.1, 0.044, 0.012), m.grip, 0, -0.07, 0.04, -0.2);
    b.mesh(rbox(0.012, 0.025, 0.045, 0.004), m.steel, 0, -0.035, -0.02);
    // folding wire stock
    b.mesh(cyl(0.006, 0.006, 0.2, 8), m.steel, 0.02, 0.05, 0.16);
    b.mesh(cyl(0.006, 0.006, 0.2, 8), m.steel, -0.02, 0.05, 0.16);
    b.mesh(cyl(0.006, 0.006, 0.2, 8), m.steel, 0, -0.01, 0.15, 0.25);
    b.mesh(rbox(0.05, 0.09, 0.016, 0.006), m.grip, 0, 0.02, 0.26);
    const mag = b.group('mag', 0, -0.02, -0.15);
    b.mesh(rbox(0.026, 0.19, 0.04, 0.005), m.steel, 0, -0.09, 0, 0.05, 0, 0, mag);
    b.mesh(rbox(0.03, 0.012, 0.044, 0.003), m.accent, 0, -0.185, -0.005, 0.05, 0, 0, mag);
    const bolt = b.group('bolt', -0.032, 0.05, -0.12);
    b.mesh(rbox(0.016, 0.012, 0.03, 0.003), m.accent, 0, 0, 0, 0, 0, 0, bolt);
    b.stripe(0.029, 0.03, -0.08, 0.002, 0.03, 0.22);
    const sy = b.reflex(0, 0.105, -0.06);
    b.anchor('grip', 0, -0.065, 0.045);
    b.anchor('fore', 0, -0.05, -0.15);
    b.anchor('magHand', 0, -0.2, -0.15);
    b.anchor('muzzle', 0, 0.04, -0.4);
    b.anchor('eject', 0.03, 0.06, -0.08);
    b.anchor('sight', 0, sy, -0.06);
  },
  breacher(b) {
    const m = b.m;
    b.mesh(rbox(0.06, 0.08, 0.26, 0.01), m.base, 0, 0.03, -0.04);
    b.mesh(cyl(0.016, 0.016, 0.62, 16), m.steel, 0, 0.052, -0.48);
    for (let i = 0; i < 10; i++) b.mesh(rbox(0.04, 0.012, 0.03, 0.003), m.polymer, 0, 0.074, -0.24 - i * 0.05); // heat shield
    b.mesh(cyl(0.016, 0.016, 0.5, 14), m.steel, 0, 0.012, -0.42); // tube mag
    b.mesh(cyl(0.019, 0.019, 0.03, 14), m.base, 0, 0.012, -0.68);
    const pump = b.group('pump', 0, 0.012, -0.36);
    b.mesh(rbox(0.052, 0.05, 0.17, 0.014), m.polymer, 0, -0.005, 0, 0, 0, 0, pump);
    for (let i = 0; i < 6; i++) b.mesh(rbox(0.054, 0.005, 0.006, 0.001), m.grip, 0, -0.005 + (i - 2.5) * 0.007, 0, 0, 0, 0, pump);
    b.mesh(rbox(0.034, 0.1, 0.046, 0.012), m.grip, 0, -0.07, 0.06, -0.38);
    b.mesh(rbox(0.012, 0.025, 0.05, 0.004), m.steel, 0, -0.03, 0.02);
    b.mesh(rbox(0.046, 0.075, 0.24, 0.015), m.polymer, 0, 0.0, 0.25, 0.08);
    b.mesh(rbox(0.05, 0.11, 0.03, 0.01), m.grip, 0, -0.02, 0.37, 0.08);
    b.mesh(new THREE.SphereGeometry(0.004, 8, 6), m.accent, 0, 0.072, -0.78);
    b.mesh(rbox(0.008, 0.016, 0.03, 0.002), m.steel, 0, 0.08, -0.02);
    b.mesh(rbox(0.004, 0.008, 0.07, 0.001), m.accent, 0.031, 0.04, -0.04);
    const shell = b.group('mag', 0.0, 0.0, -0.06);
    b.mesh(cyl(0.011, 0.011, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0x7a1d18, roughness: 0.5 }), 0, -0.02, 0, Math.PI / 2, 0, 0, shell);
    shell.visible = false;
    b.anchor('grip', 0, -0.065, 0.06);
    b.anchor('fore', 0, -0.035, -0.36);
    b.anchor('magHand', 0, -0.03, -0.08);
    b.anchor('muzzle', 0, 0.052, -0.8);
    b.anchor('eject', 0.03, 0.04, -0.04);
    b.anchor('sight', 0, 0.084, -0.02);
  },
  ridgeline(b) {
    const m = b.m;
    b.mesh(rbox(0.058, 0.075, 0.32, 0.01), m.base, 0, 0.035, -0.06);
    b.mesh(rbox(0.05, 0.05, 0.18, 0.01), m.polymer, 0, -0.012, 0.0);
    b.mesh(rbox(0.062, 0.062, 0.42, 0.012), m.base, 0, 0.035, -0.43);
    for (let i = 0; i < 7; i++) b.mesh(rbox(0.064, 0.02, 0.026, 0.004), m.polymer, 0, 0.035, -0.28 - i * 0.05);
    b.rail(0.7, 0, 0.076, -0.3);
    b.mesh(cyl(0.012, 0.012, 0.26, 14), m.steel, 0, 0.035, -0.77);
    b.mesh(cyl(0.018, 0.018, 0.07, 8), m.steel, 0, 0.035, -0.92);
    b.mesh(cyl(0.012, 0.012, 0.16, 10), m.steel, 0, 0.03, 0.17);
    b.mesh(rbox(0.045, 0.11, 0.24, 0.015), m.polymer, 0, 0.0, 0.3);
    b.mesh(rbox(0.04, 0.035, 0.14, 0.012), m.polymer, 0, 0.07, 0.25);
    b.mesh(rbox(0.05, 0.12, 0.03, 0.01), m.grip, 0, 0.0, 0.43);
    b.mesh(rbox(0.034, 0.11, 0.046, 0.012), m.grip, 0, -0.075, 0.05, -0.3);
    b.mesh(rbox(0.012, 0.03, 0.05, 0.004), m.steel, 0, -0.045, -0.01);
    const mag = b.group('mag', 0, -0.05, -0.1);
    b.mesh(rbox(0.032, 0.11, 0.07, 0.006), m.steel, 0, -0.05, 0, 0.06, 0, 0, mag);
    b.mesh(rbox(0.036, 0.012, 0.074, 0.003), m.accent, 0, -0.105, 0.004, 0.06, 0, 0, mag);
    const bolt = b.group('bolt', 0, 0.072, 0.08);
    b.mesh(rbox(0.05, 0.012, 0.025, 0.003), m.accent, 0, 0, 0, 0, 0, 0, bolt);
    // folded bipod
    b.mesh(cyl(0.007, 0.007, 0.18, 8), m.steel, 0.015, -0.01, -0.52);
    b.mesh(cyl(0.007, 0.007, 0.18, 8), m.steel, -0.015, -0.01, -0.52);
    b.stripe(0.031, 0.035, -0.43, 0.002, 0.012, 0.36);
    b.stripe(-0.031, 0.035, -0.43, 0.002, 0.012, 0.36);
    const sy = b.scope(0, 0.115, -0.1, 0.2, 0.019, 0.026);
    b.mesh(rbox(0.03, 0.03, 0.03, 0.004), m.steel, 0, 0.087, -0.06);
    b.anchor('grip', 0, -0.07, 0.055);
    b.anchor('fore', 0, -0.005, -0.42);
    b.anchor('magHand', 0, -0.13, -0.1);
    b.anchor('muzzle', 0, 0.035, -0.96);
    b.anchor('eject', 0.03, 0.045, -0.03);
    b.anchor('sight', 0, sy, -0.1);
  },
  longshot(b) {
    const m = b.m;
    b.mesh(rbox(0.07, 0.08, 0.36, 0.012), m.base, 0, 0.03, -0.06);
    b.mesh(rbox(0.074, 0.07, 0.36, 0.012), m.polymer, 0, 0.03, -0.42);
    for (let i = 0; i < 6; i++) b.mesh(rbox(0.076, 0.018, 0.03, 0.004), m.steel, 0, 0.03, -0.3 - i * 0.05);
    b.mesh(cyl(0.017, 0.015, 0.42, 16), m.steel, 0, 0.04, -0.82);
    for (let i = 0; i < 6; i++) b.mesh(rbox(0.004, 0.034, 0.3, 0.001), m.brightSteel, Math.cos(i) * 0.012, 0.04 + Math.sin(i) * 0.012, -0.78, 0, 0, i);
    b.mesh(rbox(0.05, 0.05, 0.1, 0.01), m.steel, 0, 0.04, -1.07);
    for (let i = 0; i < 3; i++) b.mesh(rbox(0.052, 0.01, 0.014, 0.002), m.base, 0, 0.065, -1.04 - i * 0.025);
    b.mesh(rbox(0.05, 0.09, 0.3, 0.012), m.polymer, 0, 0.0, 0.3);
    b.mesh(rbox(0.054, 0.04, 0.16, 0.012), m.base, 0, 0.065, 0.28);
    b.mesh(rbox(0.056, 0.14, 0.03, 0.01), m.grip, 0, -0.01, 0.46);
    b.mesh(cyl(0.01, 0.01, 0.1, 8), m.steel, 0, -0.075, 0.4, Math.PI / 2); // monopod
    b.mesh(rbox(0.036, 0.115, 0.05, 0.014), m.grip, 0, -0.08, 0.06, -0.15);
    b.mesh(rbox(0.012, 0.03, 0.05, 0.004), m.steel, 0, -0.045, 0.0);
    const mag = b.group('mag', 0, -0.03, -0.12);
    b.mesh(rbox(0.034, 0.075, 0.09, 0.006), m.steel, 0, -0.035, 0, 0, 0, 0, mag);
    b.mesh(rbox(0.038, 0.01, 0.094, 0.003), m.accent, 0, -0.072, 0, 0, 0, 0, mag);
    const bolt = b.group('bolt', 0.04, 0.05, 0.04);
    b.mesh(cyl(0.006, 0.006, 0.05, 8), m.brightSteel, 0.02, 0, 0, 0, Math.PI / 2, 0, bolt);
    b.mesh(new THREE.SphereGeometry(0.011, 12, 8), m.accent, 0.048, 0, 0, 0, 0, 0, bolt);
    b.stripe(0.037, 0.03, -0.42, 0.002, 0.016, 0.32);
    const sy = b.scope(0, 0.13, -0.08, 0.3, 0.021, 0.034);
    b.mesh(rbox(0.032, 0.05, 0.03, 0.004), m.steel, 0, 0.088, -0.16);
    b.mesh(rbox(0.032, 0.05, 0.03, 0.004), m.steel, 0, 0.088, 0.0);
    b.anchor('grip', 0, -0.075, 0.065);
    b.anchor('fore', 0, -0.01, -0.42);
    b.anchor('magHand', 0, -0.09, -0.12);
    b.anchor('muzzle', 0, 0.04, -1.13);
    b.anchor('eject', 0.04, 0.05, -0.02);
    b.anchor('sight', 0, sy, -0.08);
  },
  vesper(b) {
    const m = b.m;
    const slide = b.group('slide', 0, 0.025, -0.06);
    b.mesh(rbox(0.03, 0.034, 0.19, 0.006), m.base, 0, 0, 0, 0, 0, 0, slide);
    for (let i = 0; i < 6; i++) b.mesh(rbox(0.032, 0.026, 0.003, 0.0008), m.steel, 0, -0.002, 0.07 + i * 0.006, 0, 0, 0, slide);
    b.mesh(rbox(0.006, 0.008, 0.006, 0.001), m.accent, 0, 0.021, -0.088, 0, 0, 0, slide);
    b.mesh(rbox(0.02, 0.008, 0.006, 0.001), m.steel, 0, 0.021, 0.085, 0, 0, 0, slide);
    b.mesh(rbox(0.008, 0.012, 0.03, 0.002), m.steel, 0.014, 0.004, -0.0, 0, 0, 0, slide);
    b.stripe(0.0155, 0.004, -0.04, 0.001, 0.006, 0.09);
    b.mesh(rbox(0.028, 0.02, 0.17, 0.005), m.polymer, 0, -0.002, -0.07);
    b.mesh(rbox(0.012, 0.022, 0.04, 0.004), m.polymer, 0, -0.024, -0.03);
    b.mesh(rbox(0.03, 0.11, 0.045, 0.012), m.grip, 0, -0.062, 0.035, -0.22);
    b.mesh(cyl(0.007, 0.007, 0.012, 10), m.steel, 0, 0.026, -0.158);
    const mag = b.group('mag', 0, -0.06, 0.035);
    b.mesh(rbox(0.024, 0.1, 0.036, 0.004), m.steel, 0, -0.01, 0.0, -0.22, 0, 0, mag);
    b.mesh(rbox(0.032, 0.012, 0.048, 0.004), m.accent, 0, -0.06, 0.012, -0.22, 0, 0, mag);
    b.anchor('grip', 0, -0.06, 0.04);
    b.anchor('fore', -0.012, -0.075, 0.03);
    b.anchor('magHand', 0, -0.13, 0.05);
    b.anchor('muzzle', 0, 0.026, -0.17);
    b.anchor('eject', 0.016, 0.035, -0.04);
    b.anchor('sight', 0, 0.05, 0.03);
  },
  mako(b) {
    const m = b.m;
    b.mesh(rbox(0.03, 0.06, 0.1, 0.008), m.base, 0, 0.012, -0.02);
    b.mesh(rbox(0.026, 0.03, 0.2, 0.006), m.base, 0, 0.03, -0.17);
    b.mesh(rbox(0.012, 0.012, 0.2, 0.003), m.steel, 0, 0.05, -0.17);
    b.mesh(cyl(0.011, 0.011, 0.2, 14), m.steel, 0, 0.022, -0.17);
    b.mesh(rbox(0.028, 0.02, 0.18, 0.004), m.base, 0, 0.004, -0.17);
    b.stripe(0.0135, 0.03, -0.17, 0.001, 0.008, 0.18);
    const cylg = b.group('cylinder', 0, 0.012, -0.025);
    b.mesh(cyl(0.024, 0.024, 0.055, 6), m.steel, 0, 0, 0, 0, 0, 0, cylg);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.mesh(cyl(0.004, 0.004, 0.056, 6), m.brass, Math.cos(a) * 0.014, Math.sin(a) * 0.014, 0.0005, 0, 0, 0, cylg); }
    b.mesh(rbox(0.032, 0.1, 0.05, 0.014), m.wood, 0, -0.06, 0.04, -0.28);
    b.mesh(rbox(0.012, 0.025, 0.04, 0.004), m.steel, 0, -0.025, 0.0);
    const ham = b.group('bolt', 0, 0.045, 0.035);
    b.mesh(rbox(0.008, 0.02, 0.012, 0.002), m.accent, 0, 0, 0, 0, 0, 0, ham);
    b.mesh(rbox(0.004, 0.014, 0.008, 0.001), m.accent, 0, 0.062, -0.26);
    const mag = b.group('mag', 0, 0, 0);
    b.anchor('grip', 0, -0.055, 0.045);
    b.anchor('fore', -0.012, -0.07, 0.035);
    b.anchor('magHand', -0.02, 0.0, -0.025);
    b.anchor('muzzle', 0, 0.022, -0.27);
    b.anchor('eject', 0.0, 0.012, -0.025);
    b.anchor('sight', 0, 0.066, 0.03);
    mag.visible = true;
  },
};

/**
 * Build a weapon model.
 * Returns { root, parts, anchors, id, rest } where rest stores part rest positions.
 */
export function buildWeapon(id, skinId = 'factory') {
  const m = weaponMaterials(skinId);
  const b = new Builder(m);
  (BUILDERS[id] || BUILDERS.vk7)(b);
  mergeStatic(b.root);
  const rest = {};
  for (const [k, p] of Object.entries(b.parts)) rest[k] = { pos: p.position.clone(), rot: p.rotation.clone() };
  b.root.name = `weapon-${id}`;
  return { root: b.root, parts: b.parts, anchors: b.anchors, id, skin: skinId, rest };
}

/** Animate mechanical parts. phase: {bolt:0..1, mag:0..1(out), pump:0..1, cyl:angle} */
export function poseWeaponParts(w, phase) {
  const P = w.parts, R = w.rest;
  if (P.bolt && R.bolt) {
    if (w.id === 'longshot') { P.bolt.rotation.z = R.bolt.rot.z + Math.min(1, phase.bolt * 2) * 1.2; P.bolt.position.z = R.bolt.pos.z + Math.max(0, phase.bolt * 2 - 1) * 0.07; }
    else if (w.id === 'mako') P.bolt.rotation.x = -phase.bolt * 0.6;
    else P.bolt.position.z = R.bolt.pos.z + phase.bolt * 0.06;
  }
  if (P.slide && R.slide) P.slide.position.z = R.slide.pos.z + phase.bolt * 0.045;
  if (P.pump && R.pump) P.pump.position.z = R.pump.pos.z + phase.pump * 0.09;
  if (P.cylinder) { P.cylinder.rotation.z = phase.cyl || 0; P.cylinder.position.x = (phase.mag || 0) * 0.03; }
  if (P.mag && R.mag && w.id !== 'mako') {
    const t = phase.mag || 0;
    P.mag.position.y = R.mag.pos.y - t * 0.35;
    P.mag.position.z = R.mag.pos.z + t * 0.02;
    P.mag.rotation.x = R.mag.rot.x + t * 0.4;
    P.mag.visible = w.id === 'breacher' ? !!phase.shell : t < 0.98;
  }
}

export function disposeWeapon(w) {
  w.root.traverse((o) => { if (o.isMesh && (o.userData.merged || !cachedGeos.has(o.geometry))) o.geometry.dispose?.(); });
}
