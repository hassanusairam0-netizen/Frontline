import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { operatorPalette, OPERATORS } from '../shared/operators.js';
import { TEX } from '../engine/textures.js';
import { buildWeapon, poseWeaponParts } from './weapon.js';
import { mergeStatic } from './merge.js';

// Procedural tactical operator. Faces +Z, feet at the origin, ~1.8 m tall.
// Arms are solved with analytic two-bone IK onto the weapon's grip/fore anchors,
// legs and torso are driven procedurally (gait, crouch, breathing, weight shift).

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

const geo = new Map();
const G = (key, make) => { if (!geo.has(key)) geo.set(key, make()); return geo.get(key); };
const rb = (w, h, d, r = 0.02) => G(`rb${w}${h}${d}${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)));
const cap = (r, l) => G(`cap${r}${l}`, () => new THREE.CapsuleGeometry(r, l, 6, 14));
const sph = (r, ws = 20, hs = 14, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => G(`sp${r}${ws}${hs}${ps}${pl}${ts}${tl}`, () => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl));
const cyl = (r1, r2, h, s = 16) => G(`cy${r1}${r2}${h}${s}`, () => new THREE.CylinderGeometry(r1, r2, h, s));
/** Tapered limb segment hanging down from the joint: top radius r1, bottom r2, with rounded ends. */
const limb = (r1, r2, len) => G(`lb${r1}${r2}${len}`, () => {
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r2, -len - Math.cos(a) * r2 * 0.6 + r2 * 0.6)); }
  for (let i = 1; i < 6; i++) { const t = i / 6; const bulge = Math.sin(t * Math.PI) * 0.12; pts.push(new THREE.Vector2((r2 + (r1 - r2) * t) * (1 + bulge), -len + len * t)); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 - (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r1, Math.cos(a) * r1 * 0.6)); }
  pts.reverse();
  return new THREE.LatheGeometry(pts, 18);
});

function materials(pal, opId) {
  const fab = TEX.fabric(10, [1, 1, 1]);
  const fabric = new THREE.MeshStandardMaterial({ color: pal.fabric, roughness: 0.95, normalMap: fab.normalMap, map: fab.map, envMapIntensity: 0.7 });
  fabric.normalScale.set(0.6, 0.6);
  for (const t of [fabric.normalMap, fabric.map]) t.repeat.set(6, 6);
  const armor = new THREE.MeshStandardMaterial({ color: pal.armor, roughness: 0.6, metalness: 0.15, envMapIntensity: 0.9 });
  const gear = new THREE.MeshStandardMaterial({ color: pal.gear, roughness: 0.88, normalMap: fab.normalMap, envMapIntensity: 0.6 });
  gear.normalScale.set(0.9, 0.9);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.82 });
  const molleTex = TEX.molle();
  const pants = new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.fabric).multiplyScalar(0.82), roughness: 0.95, normalMap: fab.normalMap, map: fab.map, envMapIntensity: 0.6 });
  pants.normalScale.set(0.7, 0.7);
  const boots = new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: 0.7, envMapIntensity: 0.5 });
  const molle = new THREE.MeshStandardMaterial({ color: pal.gear, roughness: 0.9, normalMap: molleTex.normalMap, map: molleTex.map, envMapIntensity: 0.6 });
  molle.normalScale.set(1.2, 1.2);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.35, metalness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.62 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.04, metalness: 0.6, clearcoat: 1, envMapIntensity: 2.4 });
  const accent = new THREE.MeshStandardMaterial({ color: pal.accent, emissive: pal.accent, emissiveIntensity: 1.6, roughness: 0.4 });
  const accentFlat = new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.6, metalness: 0.1 });
  const lens = new THREE.MeshPhysicalMaterial({ color: opId === 'volt' ? 0x7a4a10 : 0x0d1a24, roughness: 0.05, metalness: 0.5, clearcoat: 1, envMapIntensity: 2.5, emissive: pal.accent, emissiveIntensity: 0.12 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe6e8e9, roughness: 0.7 });
  const med = new THREE.MeshStandardMaterial({ color: 0x4fc3b0, emissive: 0x2a8f80, emissiveIntensity: 0.6, roughness: 0.5 });
  return { fabric, armor, gear, rubber, metal, skin, visor, accent, accentFlat, lens, white, med, pants, boots, molle };
}

export class Character {
  constructor({ operator = 'volt', outfit = 'standard', weapon = 'vk7', skin = 'factory', shadows = true } = {}) {
    this.opId = operator;
    this.op = OPERATORS[operator] || OPERATORS.volt;
    this.outfit = outfit;
    this.pal = operatorPalette(this.op.id, outfit);
    this.M = materials(this.pal, this.op.id);
    this.root = new THREE.Group();
    this.root.name = `char-${operator}`;
    this.shadows = shadows;
    this.t = Math.random() * 10;
    this.gait = 0;
    this.state = { speed: 0, fwd: 0, side: 0, crouch: 0, pitch: 0, aim: 1, sprint: 0, dead: 0, idle: 0 };
    this.anim = { recoil: 0, flinch: 0, flinchDir: 1, reload: -1, reloadDur: 2, deathT: 0, shift: 0, look: 0, ability: 0 };
    this.build();
    mergeStatic(this.root);
    // tiny details don't need their own shadow draw
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius < 0.05) o.castShadow = false; } });
    this.setWeapon(weapon, skin);
  }

  mesh(g, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
    m.castShadow = this.shadows; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  grp(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

  build() {
    const M = this.M, b = this.op.build;
    const heavy = b === 'heavy', light = b === 'light', slim = b === 'slim';
    const W = heavy ? 1.12 : slim ? 0.94 : light ? 0.96 : 1;
    this.W = W;

    const hips = this.hips = this.grp(this.root, 0, 0.98, 0);
    this.mesh(rb(0.3 * W, 0.17, 0.2, 0.05), M.fabric, hips, 0, -0.02, 0);
    this.mesh(rb(0.33 * W, 0.05, 0.22, 0.015), M.gear, hips, 0, 0.06, 0); // belt
    this.mesh(rb(0.05, 0.04, 0.025, 0.006), M.metal, hips, 0, 0.06, 0.112); // buckle
    for (const sx of [-1, 1]) this.mesh(rb(0.06, 0.07, 0.05, 0.012), M.gear, hips, sx * 0.13 * W, 0.04, 0.09);
    this.mesh(rb(0.12, 0.09, 0.06, 0.02), M.gear, hips, 0.04, 0.02, -0.12); // dump pouch

    // Legs
    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = this.grp(hips, side * 0.1 * W, -0.04, 0);
      this.mesh(limb(0.09 * W, 0.062 * W, 0.42), M.pants, thigh, 0, 0, 0);
      this.mesh(rb(0.035, 0.09, 0.12, 0.01), M.pants, thigh, side * 0.075 * W, -0.24, 0.01); // cargo pocket
      if (side === -1) { // right thigh holster
        this.mesh(rb(0.05, 0.16, 0.09, 0.015), M.gear, thigh, side * 0.08, -0.17, 0.0);
        this.mesh(rb(0.03, 0.09, 0.05, 0.01), M.rubber, thigh, side * 0.1, -0.1, 0.0);
      } else this.mesh(rb(0.045, 0.12, 0.1, 0.015), M.gear, thigh, side * 0.08, -0.2, 0.01);
      const knee = this.grp(thigh, 0, -0.44, 0);
      this.mesh(limb(0.06 * W, 0.045 * W, 0.4), M.pants, knee, 0, 0, 0);
      this.mesh(rb(0.1, 0.12, 0.05, 0.02), M.armor, knee, 0, -0.03, 0.06);
      const ankle = this.grp(knee, 0, -0.44, 0);
      this.mesh(rb(0.105, 0.11, 0.26, 0.035), M.boots, ankle, 0, -0.04, 0.035);
      this.mesh(rb(0.11, 0.035, 0.27, 0.012), M.rubber, ankle, 0, -0.085, 0.04);
            this.mesh(cyl(0.055, 0.06, 0.12), M.boots, ankle, 0, 0.04, 0);
      this.legs.push({ thigh, knee, ankle, side });
    }

    // Torso
    const spine = this.spine = this.grp(hips, 0, 0.1, 0);
    this.mesh(cap(0.12 * W, 0.12), M.fabric, spine, 0, 0.1, 0, 0, 0, 0, 1.15, 1, 0.82);
    const chest = this.chest = this.grp(spine, 0, 0.26, 0);
    this.mesh(rb(0.36 * W, 0.24, 0.22, 0.08), M.fabric, chest, 0, 0.04, 0);
    // plate carrier
    const plateW = (light ? 0.3 : 0.34) * W, plateD = heavy ? 0.075 : 0.055;
    this.mesh(rb(plateW, 0.3, plateD, 0.02), M.armor, chest, 0, 0.0, 0.11 + plateD / 2 - 0.01);
    this.mesh(rb(plateW, 0.32, plateD, 0.02), M.armor, chest, 0, 0.0, -0.11 - plateD / 2 + 0.01);
    for (const sx of [-1, 1]) this.mesh(rb(0.06, 0.05, 0.25, 0.015), M.gear, chest, sx * 0.12 * W, 0.15, 0);
    this.mesh(rb(0.07, 0.22, 0.2, 0.02), M.molle, chest, 0.17 * W, -0.04, 0); // cummerbund L
    this.mesh(rb(0.07, 0.22, 0.2, 0.02), M.molle, chest, -0.17 * W, -0.04, 0);
    // front pouches
    const pz = 0.11 + plateD;
    const nP = light ? 2 : 3;
    for (let i = 0; i < nP; i++) {
      const x = (i - (nP - 1) / 2) * 0.085;
      this.mesh(rb(0.075, 0.11, 0.05, 0.012), M.molle, chest, x, -0.09, pz);
      this.mesh(rb(0.077, 0.03, 0.054, 0.008), M.gear, chest, x, -0.03, pz);
    }
    this.mesh(rb(0.05, 0.08, 0.04, 0.01), M.gear, chest, 0.1, 0.08, pz - 0.005); // radio pouch
    this.mesh(cyl(0.004, 0.004, 0.16, 6), M.rubber, chest, 0.105, 0.19, pz - 0.01); // antenna
    // accent strips
    this.mesh(rb(plateW * 0.7, 0.008, 0.004, 0.002), M.accent, chest, 0, 0.12, pz - 0.023);
    this.mesh(rb(0.008, 0.07, 0.004, 0.002), M.accent, chest, -0.12 * W, 0.03, pz - 0.023);
    // back panel
    if (b === 'medium') {
      const pack = this.grp(chest, 0, -0.02, -0.2);
      this.mesh(rb(0.3, 0.38, 0.16, 0.05), M.gear, pack, 0, 0, -0.03);
      this.mesh(rb(0.26, 0.12, 0.06, 0.02), M.gear, pack, 0, -0.1, -0.12);
      this.mesh(rb(0.12, 0.03, 0.006, 0.003), M.white, pack, 0, 0.04, -0.115);
      this.mesh(rb(0.03, 0.12, 0.006, 0.003), M.white, pack, 0, 0.04, -0.115);
      this.mesh(rb(0.09, 0.022, 0.008, 0.003), M.med, pack, 0, 0.04, -0.117);
      this.mesh(rb(0.022, 0.09, 0.008, 0.003), M.med, pack, 0, 0.04, -0.117);
      this.mesh(cyl(0.035, 0.035, 0.18), M.metal, pack, 0.18, 0.02, -0.02);
    } else if (heavy) {
      this.mesh(rb(0.3, 0.3, 0.1, 0.03), M.gear, chest, 0, -0.02, -0.2);
      this.mesh(rb(0.2, 0.05, 0.12, 0.01), M.hazard || M.accentFlat, chest, 0, 0.12, -0.2);
    } else {
      this.mesh(rb(0.2, 0.22, 0.07, 0.025), M.gear, chest, 0, -0.03, -0.18);
      this.mesh(cyl(0.025, 0.025, 0.25, 10), M.rubber, chest, 0.05, 0.05, -0.2, 0, 0, 0.2); // hydration tube
    }
    if (heavy) {
      // collar + groin protection
      this.mesh(rb(0.36 * W, 0.08, 0.27, 0.035), M.armor, chest, 0, 0.17, 0);
      this.mesh(rb(0.2, 0.16, 0.05, 0.02), M.armor, hips, 0, -0.08, 0.12);
    }
    if (slim) {
      // long coat tails that sway with movement
      this.coat = [];
      for (const sx of [-1, 1]) {
        const tail = this.grp(hips, sx * 0.1, 0.06, -0.09);
        this.mesh(rb(0.17, 0.62, 0.025, 0.01), M.fabric, tail, 0, -0.3, 0, 0.05, 0, sx * 0.04);
        this.coat.push(tail);
      }
      const front = this.grp(hips, 0, 0.04, 0.12);
      for (const sx of [-1, 1]) this.mesh(rb(0.12, 0.45, 0.02, 0.008), M.fabric, front, sx * 0.1, -0.24, 0, -0.04, 0, -sx * 0.03);
      this.coat.push(front);
    }

    // Neck & head
    const neck = this.neck = this.grp(chest, 0, 0.17, 0.01);
    this.mesh(cyl(0.05, 0.055, 0.09), M.gear, neck, 0, 0.02, 0);
    const head = this.head = this.grp(neck, 0, 0.12, 0.01);
    this.mesh(sph(0.105), M.skin, head, 0, 0, 0, 0, 0, 0, 0.92, 1.05, 1.0);
    this.buildHeadgear(head);

    // Arms
    this.arms = {};
    for (const side of [-1, 1]) {
      const shoulder = this.grp(chest, side * 0.215 * W, 0.11, 0);
      const ua = 0.29, fa = 0.27;
      this.mesh(sph(0.062 * W, 14, 10), M.fabric, shoulder, 0, -0.01, 0);
      this.mesh(limb(0.058 * W, 0.046 * W, ua - 0.02), M.fabric, shoulder, 0, 0, 0);
      if (heavy) this.mesh(rb(0.14, 0.09, 0.16, 0.035), M.armor, shoulder, side * 0.02, -0.02, 0, 0, 0, side * 0.35);
      else this.mesh(rb(0.09, 0.08, 0.1, 0.03), M.fabric, shoulder, side * 0.01, -0.03, 0);
      this.mesh(rb(0.06, 0.07, 0.03, 0.008), M.accentFlat, shoulder, side * 0.055 * W, -0.1, 0, 0, Math.PI / 2 * side, 0); // patch
      const elbow = this.grp(shoulder, 0, -ua, 0);
      this.mesh(limb(0.046 * W, 0.036 * W, fa - 0.05), M.fabric, elbow, 0, 0, 0);
      if (light) this.mesh(cyl(0.05 * W, 0.05 * W, 0.05), M.fabric, elbow, 0, -0.07, 0); // rolled cuff
      this.mesh(rb(0.075, 0.06, 0.07, 0.02), M.armor, elbow, 0, -0.01, -0.035);
      this.mesh(cyl(0.052, 0.048, 0.06), M.rubber, elbow, 0, -fa + 0.04, 0); // glove cuff
      const hand = this.grp(elbow, 0, -fa, 0);
      this.mesh(rb(0.075, 0.095, 0.04, 0.016), M.rubber, hand, 0, -0.04, 0);
      this.mesh(rb(0.022, 0.06, 0.022, 0.009), M.rubber, hand, side * -0.035, -0.025, 0.02, 0.4, 0, 0);
      if (side === 1 && this.op.id === 'phantom') this.mesh(rb(0.06, 0.02, 0.06, 0.008), M.accent, elbow, 0, -0.15, 0);
      if (side === 1 && this.op.id === 'medic') this.mesh(cyl(0.058, 0.058, 0.05), M.white, shoulder, 0, -0.12, 0);
      this.arms[side < 0 ? 'R' : 'L'] = { shoulder, elbow, hand, ua, fa, side };
    }

    // Weapon pivot (child of chest so the whole upper body aims together)
    this.weaponPivot = this.grp(chest, -0.1 * W, 0.04, 0.24);
    this.weaponPivot.rotation.y = Math.PI;
  }

  buildHeadgear(head) {
    const M = this.M, id = this.op.id;
    if (id === 'volt') {
      // ball cap, headset, amber eyepro, gaiter
      this.mesh(sph(0.112, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.gear, head, 0, 0.005, 0, -0.1);
      this.mesh(rb(0.16, 0.012, 0.09, 0.006), M.gear, head, 0, 0.02, 0.12, -0.15);
      this.mesh(rb(0.18, 0.04, 0.05, 0.02), M.lens, head, 0, 0.01, 0.085);
      for (const sx of [-1, 1]) this.mesh(cyl(0.04, 0.04, 0.035), M.rubber, head, sx * 0.1, -0.01, 0, 0, 0, Math.PI / 2);
      this.mesh(rb(0.012, 0.012, 0.2, 0.005), M.rubber, head, -0.1, -0.04, 0.06, 0.3, 0, 0);
      this.mesh(sph(0.108, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.gear, head, 0, 0.0, 0.004, 0, 0, 0, 1.0, 1.0, 1.04);
      this.mesh(rb(0.03, 0.015, 0.01, 0.004), M.accent, head, 0.07, 0.07, 0.07);
    } else if (id === 'phantom') {
      // hood + full mask with visor slit
      this.mesh(sph(0.135, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.68), M.fabric, head, 0, 0.0, -0.012, -0.25, 0, 0, 1, 1.08, 1.12);
      this.mesh(sph(0.11, 20, 14), M.armor, head, 0, -0.005, 0.008, 0, 0, 0, 0.95, 1.08, 1.02);
      this.mesh(rb(0.15, 0.022, 0.06, 0.01), M.accent, head, 0, 0.01, 0.085);
      this.mesh(rb(0.06, 0.05, 0.04, 0.012), M.armor, head, 0, -0.07, 0.085);
      for (const sx of [-1, 1]) this.mesh(cyl(0.012, 0.012, 0.03), M.metal, head, sx * 0.03, -0.075, 0.105, Math.PI / 2);
    } else if (id === 'bulwark') {
      // heavy helmet, face shield, neck guard
      this.mesh(sph(0.138, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), M.armor, head, 0, 0.0, -0.006);
      this.mesh(cyl(0.142, 0.142, 0.03, 24), M.armor, head, 0, 0.0, -0.006);
      this.mesh(sph(0.15, 22, 12, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.4, Math.PI * 0.32), M.visor, head, 0, 0.005, -0.005);
      this.mesh(rb(0.24, 0.07, 0.07, 0.02), M.armor, head, 0, -0.08, -0.07);
      for (const sx of [-1, 1]) this.mesh(rb(0.03, 0.08, 0.06, 0.01), M.metal, head, sx * 0.135, 0.02, 0.0);
      this.mesh(rb(0.05, 0.04, 0.06, 0.01), M.metal, head, 0, 0.12, 0.08);
      this.mesh(rb(0.1, 0.012, 0.004, 0.003), M.accent, head, 0, 0.09, 0.11, -0.6);
    } else {
      // medic: high-cut helmet, goggles, mask
      this.mesh(sph(0.128, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.armor, head, 0, 0.012, -0.004);
      for (const sx of [-1, 1]) { this.mesh(rb(0.012, 0.05, 0.1, 0.004), M.metal, head, sx * 0.125, 0.03, 0); this.mesh(cyl(0.034, 0.034, 0.03), M.rubber, head, sx * 0.11, -0.01, 0, 0, 0, Math.PI / 2); }
      this.mesh(rb(0.17, 0.045, 0.05, 0.02), M.lens, head, 0, 0.11, 0.07, -0.5);
      this.mesh(sph(0.108, 18, 10, -Math.PI * 0.55, Math.PI * 1.1, Math.PI * 0.52, Math.PI * 0.3), M.gear, head, 0, 0.0, 0.004);
      this.mesh(rb(0.16, 0.035, 0.04, 0.015), M.visor, head, 0, 0.012, 0.085);
      this.mesh(rb(0.05, 0.05, 0.004, 0.003), M.white, head, 0, 0.07, -0.128);
      this.mesh(rb(0.03, 0.008, 0.006, 0.002), M.med, head, 0, 0.07, -0.131);
      this.mesh(rb(0.008, 0.03, 0.006, 0.002), M.med, head, 0, 0.07, -0.131);
    }
  }

  setWeapon(id, skin = 'factory') {
    if (this.weapon) { this.weaponPivot.remove(this.weapon.root); }
    this.weapon = buildWeapon(id, skin);
    this.weapon.root.traverse((o) => { if (o.isMesh) { o.castShadow = this.shadows; } });
    // Hold point: the grip sits at the pivot; pistols are held more centrally.
    const pistol = id === 'vesper' || id === 'mako';
    this.isPistol = pistol;
    this.weapon.root.position.set(pistol ? 0.08 : 0, pistol ? 0.06 : 0, pistol ? 0.16 : 0);
    this.weaponPivot.add(this.weapon.root);
    this.weaponPhase = { bolt: 0, mag: 0, pump: 0, cyl: 0, shell: false };
  }

  // ---- animation hooks ----
  fire() { this.anim.recoil = 1; this.weaponPhase.bolt = 1; }
  flinch(dir = 1) { this.anim.flinch = 1; this.anim.flinchDir = dir; }
  reload(dur) { this.anim.reload = 0; this.anim.reloadDur = dur; }
  die() { if (!this.state.dead) { this.state.dead = 1; this.anim.deathT = 0; this.anim.deathDir = Math.random() < 0.5 ? -1 : 1; } }
  revive() { this.state.dead = 0; this.anim.deathT = 0; this.root.rotation.x = 0; this.root.rotation.z = 0; this.hips.position.y = 0.98; }
  ability() { this.anim.ability = 1; }

  /** Two-bone IK in chest space. target is a chest-local Vector3. */
  solveArm(arm, target, pole) {
    const S = arm.shoulder.position;
    const L1 = arm.ua, L2 = arm.fa + 0.045;
    const toT = _v1.copy(target).sub(S);
    let d = toT.length();
    d = Math.min(Math.max(d, Math.abs(L1 - L2) + 0.01), L1 + L2 - 0.001);
    const dir = toT.normalize();
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const a = Math.acos(Math.min(1, Math.max(-1, cosA)));
    // bend plane normal
    const n = _v2.copy(dir).cross(pole).normalize();
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    const upper = _v3.copy(dir).applyAxisAngle(n, -a);
    // test which side gets the elbow toward the pole; flip if needed
    if (upper.dot(pole) < dir.dot(pole)) upper.copy(dir).applyAxisAngle(n, a);
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, upper);
    const elbowPos = _v4.copy(upper).multiplyScalar(L1).add(S);
    const fore = _v5.copy(dir).multiplyScalar(d).add(S).sub(elbowPos).normalize();
    // forearm direction in shoulder space
    _q1.copy(arm.shoulder.quaternion).invert();
    fore.applyQuaternion(_q1);
    arm.elbow.quaternion.setFromUnitVectors(DOWN, fore);
    arm.hand.rotation.set(0.2, 0, 0);
  }

  anchorInChest(anchor, out) {
    anchor.getWorldPosition(out);
    return this.chest.worldToLocal(out);
  }

  /**
   * state: { speed m/s, fwd, side (-1..1 local movement), crouch 0..1, pitch rad, sprint 0..1, aim 0..1, idle 0..1 }
   */
  update(dt, state = {}) {
    Object.assign(this.state, state);
    const s = this.state, A = this.anim;
    this.t += dt;
    const t = this.t;

    // --- death ---
    if (s.dead) {
      A.deathT = Math.min(1, A.deathT + dt * 1.6);
      const e = 1 - Math.pow(1 - A.deathT, 3);
      this.root.rotation.x = -e * 1.45;
      this.root.rotation.z = e * 0.15 * (A.deathDir || 1);
      this.hips.position.y = 0.98 - e * 0.75;
      this.spine.rotation.x = e * 0.3;
      for (const L of this.legs) { L.thigh.rotation.x = -e * 0.3; L.knee.rotation.x = e * 0.6; }
      this.arms.R.shoulder.rotation.set(-e * 1.2, 0, -0.4);
      this.arms.L.shoulder.rotation.set(-e * 1.4, 0, 0.5);
      this.weaponPivot.visible = A.deathT < 0.4;
      return;
    }
    this.weaponPivot.visible = true;
    this.root.rotation.x = 0; this.root.rotation.z = 0;

    // --- locomotion ---
    const moving = Math.min(1, s.speed / 4.5);
    const sprint = s.sprint || 0;
    this.gait += dt * (s.speed * (sprint ? 1.55 : 1.85) / (1 + s.crouch * 0.4));
    const ph = this.gait;
    const crouch = s.crouch;
    const stride = moving * (0.55 + sprint * 0.25) * (1 - crouch * 0.45);
    const bob = Math.abs(Math.sin(ph)) * 0.035 * moving;
    const breathe = Math.sin(t * 1.7) * 0.006 * (1 - moving);

    // idle weight shift (menu / standing still)
    A.shift = Math.sin(t * 0.45) * 0.5 + Math.sin(t * 0.17 + 1.3) * 0.5;
    const shift = A.shift * (1 - moving) * (s.idle || 0.4);

    const hipY = 0.98 - crouch * 0.38 - bob + breathe + Math.abs(shift) * -0.01;
    this.hips.position.set(shift * 0.03, hipY, 0);
    this.hips.rotation.set(0, Math.sin(ph) * 0.12 * moving, shift * 0.04);

    const dirSign = s.fwd < -0.2 ? -1 : 1;
    for (const L of this.legs) {
      const p = ph + (L.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(p) * stride * dirSign;
      const lift = Math.max(0, Math.cos(p)) * stride * 1.3;
      const crouchThigh = -1.05 * crouch, crouchKnee = 1.65 * crouch;
      const standKnee = shift * L.side > 0 ? 0.12 : 0.03;
      L.thigh.rotation.x = -swing + crouchThigh - 0.05 + (L.side > 0 && crouch > 0.5 ? 0.35 * crouch : 0);
      L.thigh.rotation.z = L.side * (0.04 + Math.abs(s.side) * 0.08 * moving);
      L.knee.rotation.x = lift + crouchKnee + standKnee * (1 - moving) + 0.06;
      L.ankle.rotation.x = -(L.thigh.rotation.x + L.knee.rotation.x) * 0.9;
    }

    // coat sway
    if (this.coat) {
      const sway = Math.sin(t * 2.1) * 0.04 + moving * 0.25 + Math.sin(ph * 2) * 0.06 * moving;
      this.coat[0].rotation.x = sway + crouch * 0.9; this.coat[1].rotation.x = sway * 0.9 + crouch * 0.9;
      this.coat[0].rotation.z = -0.05 + Math.sin(t * 1.3) * 0.02; this.coat[1].rotation.z = 0.05 + Math.sin(t * 1.5) * 0.02;
      this.coat[2].rotation.x = -moving * 0.3 - crouch * 0.6;
    }

    // --- upper body ---
    A.recoil = Math.max(0, A.recoil - dt * 9);
    A.flinch = Math.max(0, A.flinch - dt * 4);
    A.ability = Math.max(0, A.ability - dt * 1.5);
    const pitch = Math.max(-1.1, Math.min(1.1, s.pitch || 0));
    const lean = sprint * 0.25 + crouch * 0.15;
    this.spine.rotation.set(lean - pitch * 0.35 - A.recoil * 0.04 + A.flinch * 0.25, -Math.sin(ph) * 0.08 * moving + A.flinch * 0.3 * A.flinchDir, -shift * 0.03);
    this.chest.rotation.set(-pitch * 0.45 + breathe * 2, sprint ? 0 : 0.0, 0);
    this.neck.rotation.set(-pitch * 0.2, 0, 0);
    A.look = Math.sin(t * 0.31) * 0.25 * (s.idle || 0);
    this.head.rotation.set(-lean * 0.6, A.look, 0);

    // weapon pose
    const aim = s.aim ?? 1;
    const low = 1 - aim; // low ready
    const wp = this.weaponPivot;
    wp.position.set((this.isPistol ? -0.02 : -0.1) * this.W, 0.04 - low * 0.12 - sprint * 0.08, 0.24 - low * 0.05);
    wp.rotation.set(low * 0.75 + sprint * 0.6 - A.recoil * 0.12, Math.PI + low * 0.55 + sprint * 0.5, low * 0.35 + sprint * 0.4);
    wp.position.z -= A.recoil * 0.04;

    // reload: left hand travels to the magazine, mag drops, new mag inserted
    let leftTarget = this.weapon.anchors.fore;
    const W = this.weapon;
    if (A.reload >= 0) {
      A.reload += dt / A.reloadDur;
      const r = A.reload;
      this.weaponPhase.mag = r < 0.25 ? r / 0.25 : r < 0.55 ? 1 : Math.max(0, 1 - (r - 0.55) / 0.2);
      this.weaponPhase.bolt = r > 0.82 && r < 0.95 ? 1 : this.weaponPhase.bolt;
      wp.rotation.z += Math.sin(Math.min(1, r) * Math.PI) * 0.45;
      wp.rotation.x += Math.sin(Math.min(1, r) * Math.PI) * 0.2;
      leftTarget = r < 0.8 ? W.anchors.magHand : W.anchors.fore;
      if (r >= 1) { A.reload = -1; this.weaponPhase.mag = 0; }
    }
    this.weaponPhase.bolt = Math.max(0, this.weaponPhase.bolt - dt * 8);
    poseWeaponParts(W, this.weaponPhase);

    // IK
    this.root.updateMatrixWorld(true);
    const R = this.arms.R, L = this.arms.L;
    const gripT = this.anchorInChest(W.anchors.grip, new THREE.Vector3());
    const foreT = this.anchorInChest(leftTarget, new THREE.Vector3());
    if (A.ability > 0 && this.op.id !== 'bulwark') {
      // ability gesture: left hand raised to the wrist device / chest
      foreT.lerp(new THREE.Vector3(0.05, 0.05, 0.25), Math.sin(A.ability * Math.PI));
    }
    this.solveArm(R, gripT, new THREE.Vector3(-0.7, -1, -0.4).normalize());
    this.solveArm(L, foreT, new THREE.Vector3(0.7, -1, -0.2).normalize());
  }

  setVisible(v) { this.root.visible = v; }

  /** World position of the head (for nameplates / reveal markers). */
  headWorld(out = new THREE.Vector3()) { return this.head.getWorldPosition(out); }
  muzzleWorld(out = new THREE.Vector3()) { return this.weapon.anchors.muzzle.getWorldPosition(out); }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh && o.userData.merged) o.geometry.dispose(); });
    Object.values(this.M).forEach((m) => m.dispose?.());
  }
}
