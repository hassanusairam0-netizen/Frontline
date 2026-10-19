import * as THREE from 'three';
import { buildWeapon, poseWeaponParts } from '../models/weapon.js';
import { createMuzzleFlash } from '../models/fx.js';
import { operatorPalette } from '../shared/operators.js';
import { TEX } from '../engine/textures.js';

// First-person weapon rendered in its own scene/camera (never clips into walls).
// Procedural animation: sway, bob, sprint pose, ADS alignment, recoil springs,
// reload choreography per weapon family, switch lower/raise, bolt/pump cycles.

const HIP = {
  default: new THREE.Vector3(0.165, -0.19, -0.5),
  pistol: new THREE.Vector3(0.14, -0.15, -0.4),
};
const ADS_DIST = { vk7: 0.2, hornet: 0.2, breacher: 0.3, ridgeline: 0.16, longshot: 0.14, vesper: 0.32, mako: 0.34 };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Viewmodel {
  constructor(envMap, lightColor = 0xffffff, palette) {
    this.scene = new THREE.Scene();
    this.scene.environment = envMap;
    this.camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xc8d0dc, 0x3a3430, 1.3));
    const key = new THREE.DirectionalLight(lightColor, 2.2); key.position.set(0.6, 1, 0.4); this.camera.add(key); this.camera.add(key.target); key.target.position.set(0, 0, -1);
    const rim = new THREE.DirectionalLight(0x5aa9e6, 0.6); rim.position.set(-1, 0.3, -0.5); this.camera.add(rim);
    this.root = new THREE.Group(); this.camera.add(this.root);
    this.sway = new THREE.Group(); this.root.add(this.sway);
    this.kick = new THREE.Group(); this.sway.add(this.kick);
    this.holder = new THREE.Group(); this.kick.add(this.holder);
    this.palette = palette;
    this.buildArms();
    this.flash = createMuzzleFlash();
    this.state = { adsT: 0, bob: 0, bobAmp: 0, sprintT: 0, swayX: 0, swayY: 0, swayVX: 0, swayVY: 0, kickZ: 0, kickRX: 0, kickV: 0, kickRV: 0, roll: 0, switchT: 0, lowered: 0, reloadT: -1, reloadKind: null, landT: 0, crouchT: 0, inspect: -1 };
    this.phase = { bolt: 0, mag: 0, pump: 0, cyl: 0, shell: false };
    this.shells = [];
    this.weapon = null;
    this.visible = true;
  }

  buildArms() {
    const pal = this.palette || operatorPalette('volt');
    const fab = TEX.fabric(10, [1, 1, 1]);
    const sleeve = new THREE.MeshStandardMaterial({ color: pal.fabric, roughness: 0.92, normalMap: fab.normalMap });
    sleeve.normalScale.set(0.6, 0.6);
    const glove = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.accent).multiplyScalar(0.6), roughness: 0.6 });
    const knuckle = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.2 });
    this.arms = [];
    for (let i = 0; i < 2; i++) {
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 1, 4, 12), sleeve);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.05, 12), glove);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 12), accent);
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.035, 0.09), glove); hand.add(palm);
      for (let f = 0; f < 4; f++) { const fg = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.022, 0.05), glove); fg.position.set(-0.027 + f * 0.018, -0.02, -0.055); fg.rotation.x = 0.9; hand.add(fg); }
      const kn = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.025), knuckle); kn.position.set(0, 0.022, -0.03); hand.add(kn);
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.05), glove); thumb.position.set(i === 0 ? -0.045 : 0.045, 0.0, -0.02); thumb.rotation.y = i === 0 ? 0.6 : -0.6; hand.add(thumb);
      this.root.add(fore, cuff, band, hand);
      this.arms.push({ fore, cuff, band, hand });
    }
  }

  setWeapon(id, skin = 'factory') {
    if (this.weapon) { this.holder.remove(this.weapon.root); }
    this.weapon = buildWeapon(id, skin);
    this.weapon.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; if (o.material?.opacity === 0.85) { o.material = o.material.clone(); o.material.opacity = 0.18; } } });
    this.holder.add(this.weapon.root);
    this.weapon.anchors.muzzle.add(this.flash);
    this.id = id;
    this.isPistol = id === 'vesper' || id === 'mako';
    this.hip = this.isPistol ? HIP.pistol : HIP.default;
    const s = this.weapon.anchors.sight.position;
    this.ads = new THREE.Vector3(-s.x, -s.y, -s.z - (ADS_DIST[id] || 0.2));
    this.phase = { bolt: 0, mag: 0, pump: 0, cyl: 0, shell: false };
    this.state.reloadT = -1;
  }

  // ---- events ----
  fire(def) {
    const s = this.state;
    const k = def.recoil.kick * (s.adsT > 0.5 ? 0.6 : 1);
    s.kickV += k * 28; s.kickRV += k * 14 * (0.8 + Math.random() * 0.4);
    s.roll += (Math.random() - 0.5) * k * 2;
    this.flash.userData.fire(def.pellets > 1 ? 1.5 : def.sound === 'sniper' ? 1.6 : 1);
    this.phase.bolt = 1;
    if (def.revolver) this.phase.cyl += Math.PI / 3;
    if (!def.pump && !def.bolt && !def.revolver) this.ejectShell(def);
  }
  cycle(def) { // bolt or pump after a shot
    this.state.cycleT = 0; this.state.cycleKind = def.pump ? 'pump' : 'bolt'; this.state.cycleDur = def.bolt ? 0.7 : 0.5;
  }
  reload(def, dur) { this.state.reloadT = 0; this.state.reloadDur = dur; this.state.reloadKind = def.perShell ? 'shell' : def.revolver ? 'revolver' : 'mag'; }
  shellLoaded() { this.state.shellPulse = 1; }
  reloadCancel() { this.state.reloadT = -1; this.phase.mag = 0; this.phase.shell = false; }
  switchOut() { this.state.switchT = 0.0001; }
  land(v) { this.state.landT = Math.min(1, v / 10); }
  inspect() { if (this.state.reloadT < 0) this.state.inspect = 0; }

  ejectShell(def) {
    if (!this.weapon) return;
    const geo = new THREE.CylinderGeometry(0.004, 0.004, def.pellets > 1 ? 0.03 : 0.018, 8);
    const mat = new THREE.MeshStandardMaterial({ color: def.pellets > 1 ? 0x8a2a20 : 0xc9a050, metalness: 0.95, roughness: 0.3 });
    const m = new THREE.Mesh(geo, mat);
    this.weapon.anchors.eject.getWorldPosition(m.position);
    this.camera.worldToLocal(m.position);
    this.root.add(m);
    m.userData = { v: new THREE.Vector3(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.2), av: new THREE.Vector3(Math.random() * 30, 0, Math.random() * 30), life: 0.7 };
    this.shells.push(m);
  }

  /**
   * ctx: { dt, t, lookDX, lookDY, speed, onGround, sprint, ads, crouch }
   * Returns current adsT so the camera can blend FOV.
   */
  update(ctx) {
    if (!this.weapon) return 0;
    const s = this.state, dt = ctx.dt;
    const reloading = s.reloadT >= 0;
    const adsTarget = ctx.ads && !ctx.sprint && !reloading && s.switchT === 0 ? 1 : 0;
    const adsSpeed = 1 / Math.max(0.08, ctx.adsTime || 0.2);
    s.adsT += Math.sign(adsTarget - s.adsT) * Math.min(Math.abs(adsTarget - s.adsT), dt * adsSpeed);
    s.sprintT += ((ctx.sprint ? 1 : 0) - s.sprintT) * (1 - Math.exp(-dt * 10));
    s.crouchT += ((ctx.crouch ? 1 : 0) - s.crouchT) * (1 - Math.exp(-dt * 8));
    const adsE = s.adsT * s.adsT * (3 - 2 * s.adsT);

    // sway (spring toward mouse-lag target)
    const swayAmt = 1 - adsE * 0.85;
    const tx = THREE.MathUtils.clamp(-ctx.lookDY * 0.0012, -0.08, 0.08) * swayAmt;
    const ty = THREE.MathUtils.clamp(-ctx.lookDX * 0.0012, -0.08, 0.08) * swayAmt;
    s.swayVX += ((tx - s.swayX) * 120 - s.swayVX * 14) * dt; s.swayX += s.swayVX * dt;
    s.swayVY += ((ty - s.swayY) * 120 - s.swayVY * 14) * dt; s.swayY += s.swayVY * dt;

    // bob
    const moving = ctx.onGround ? Math.min(1, ctx.speed / 5) : 0;
    s.bobAmp += (moving - s.bobAmp) * (1 - Math.exp(-dt * 8));
    s.bob += dt * ctx.speed * (ctx.sprint ? 1.25 : 1.6);
    const bobK = s.bobAmp * (1 - adsE * 0.9) * (ctx.sprint ? 1.8 : 1);
    const bx = Math.sin(s.bob) * 0.012 * bobK, by = -Math.abs(Math.cos(s.bob)) * 0.012 * bobK;
    const idle = Math.sin(ctx.t * 1.4) * 0.002 * (1 - adsE);

    // recoil springs
    s.kickV += (-s.kickZ * 260 - s.kickV * 22) * dt; s.kickZ += s.kickV * dt;
    s.kickRV += (-s.kickRX * 200 - s.kickRV * 18) * dt; s.kickRX += s.kickRV * dt;
    s.roll *= Math.exp(-dt * 10);
    s.landT = Math.max(0, s.landT - dt * 3);

    // switch lower/raise
    if (s.switchT > 0) { s.switchT += dt; }
    const lowered = s.switchT > 0 ? Math.min(1, s.switchT / 0.18) : Math.max(0, (s.lowered || 0) - dt * 5);
    s.lowered = lowered;

    // reload choreography
    let rTilt = 0, rRoll = 0, rDown = 0, leftT = null;
    if (reloading) {
      s.reloadT += dt;
      const r = Math.min(1, s.reloadT / s.reloadDur);
      const env = Math.sin(Math.min(1, r * 1.15) * Math.PI);
      if (s.reloadKind === 'mag') {
        rTilt = env * 0.25; rRoll = env * 0.55; rDown = env * 0.04;
        this.phase.mag = r < 0.22 ? r / 0.22 : r < 0.5 ? 1 : Math.max(0, 1 - (r - 0.5) / 0.2);
        leftT = r < 0.15 ? r / 0.15 : r < 0.75 ? 1 : 1 - (r - 0.75) / 0.25;
        if (r > 0.8 && r < 0.92) this.phase.bolt = 1;
      } else if (s.reloadKind === 'shell') {
        rTilt = 0.15; rRoll = 0.45; rDown = 0.02;
        this.phase.shell = r < 0.6; this.phase.mag = 1 - r;
        leftT = r < 0.7 ? 1 : 0.4;
      } else {
        rTilt = env * 0.6; rRoll = env * -0.3;
        this.phase.mag = r < 0.15 ? r / 0.15 : r < 0.8 ? 1 : 1 - (r - 0.8) / 0.2;
        this.phase.cyl += dt * (r > 0.3 && r < 0.7 ? 10 : 0);
        leftT = r > 0.2 && r < 0.75 ? 1 : 0;
      }
      if (s.reloadT >= s.reloadDur) { if (s.reloadKind !== 'shell') { s.reloadT = -1; this.phase.mag = 0; } else { s.reloadT = -1; this.phase.shell = false; this.phase.mag = 0; } }
    }
    // bolt / pump cycle
    let cTilt = 0;
    if (s.cycleKind) {
      s.cycleT += dt; const c = s.cycleT / s.cycleDur;
      if (s.cycleKind === 'pump') { this.phase.pump = Math.sin(Math.min(1, c) * Math.PI); }
      else { this.phase.bolt = Math.sin(Math.min(1, c) * Math.PI); cTilt = this.phase.bolt * 0.15; }
      if (c >= 1) { s.cycleKind = null; this.phase.pump = 0; }
    } else this.phase.bolt = Math.max(0, this.phase.bolt - dt * 12);
    // inspect
    let iRot = 0;
    if (s.inspect >= 0) { s.inspect += dt / 2.6; iRot = Math.sin(Math.min(1, s.inspect) * Math.PI); if (s.inspect >= 1 || ctx.ads) s.inspect = -1; }

    poseWeaponParts(this.weapon, this.phase);

    // compose transforms
    const pos = _v.copy(this.hip).lerp(this.ads, adsE);
    pos.x += bx + s.sprintT * 0.05 - iRot * 0.05; pos.y += by + idle - s.sprintT * 0.05 - lowered * 0.3 - rDown - s.landT * 0.03 - s.crouchT * 0.01 * (1 - adsE);
    pos.z += s.kickZ * 0.04 + s.sprintT * 0.02;
    this.holder.position.copy(pos);
    this.holder.rotation.set(
      s.kickRX * 0.06 + s.sprintT * -0.25 + rTilt + cTilt - lowered * 0.6 + s.landT * 0.05,
      s.sprintT * 0.65 + iRot * 0.9,
      s.roll * 0.05 + s.sprintT * 0.35 + rRoll + iRot * 0.4 + s.crouchT * 0.08 * (1 - adsE));
    this.sway.rotation.set(s.swayX, s.swayY, s.swayY * 0.6);
    this.kick.position.set(0, 0, 0);

    this.updateArms(leftT);
    this.flash.userData.update(dt);
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const m = this.shells[i], u = m.userData;
      u.v.y -= 6 * dt; m.position.addScaledVector(u.v, dt); m.rotation.x += u.av.x * dt; m.rotation.z += u.av.z * dt;
      u.life -= dt;
      if (u.life <= 0) { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); this.shells.splice(i, 1); }
    }
    this.root.visible = this.visible;
    return s.adsT;
  }

  updateArms(leftT) {
    const W = this.weapon;
    this.camera.updateMatrixWorld(true);
    const toLocal = (anchor, out) => { anchor.getWorldPosition(out); return this.camera.worldToLocal(out); };
    const grip = toLocal(W.anchors.grip, new THREE.Vector3());
    let fore = toLocal(W.anchors.fore, new THREE.Vector3());
    if (leftT != null && leftT > 0) {
      const mh = toLocal(W.anchors.magHand, new THREE.Vector3());
      fore = fore.lerp(mh, leftT);
    }
    const wq = new THREE.Quaternion();
    W.root.getWorldQuaternion(wq);
    const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion()).invert();
    wq.premultiply(camQ);
    const elbows = [grip.clone().add(new THREE.Vector3(0.1, -0.24, 0.32)), fore.clone().add(new THREE.Vector3(-0.2, -0.26, 0.26))];
    const hands = [grip, fore];
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], hpos = hands[i], e = elbows[i];
      const wrist = _v2.copy(hpos).add(new THREE.Vector3(0, -0.01, 0.06).applyQuaternion(wq));
      const len = wrist.distanceTo(e);
      A.fore.position.copy(wrist).add(e).multiplyScalar(0.5);
      A.fore.scale.set(1, Math.max(0.1, (len - 0.076) / 1), 1);
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v.copy(wrist).sub(e).normalize());
      A.fore.quaternion.copy(_q);
      A.cuff.position.copy(wrist); A.cuff.quaternion.copy(_q);
      A.band.position.copy(wrist).addScaledVector(_v, -0.035); A.band.quaternion.copy(_q);
      A.hand.position.copy(hpos);
      A.hand.quaternion.copy(wq);
      if (i === 0) A.hand.rotateX(-0.3); else A.hand.rotateZ(0.3);
    }
  }

  onResize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  dispose() { this.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose?.(); } }); }
}
