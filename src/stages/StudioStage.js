import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Character } from '../models/character.js';
import { buildWeapon, poseWeaponParts } from '../models/weapon.js';
import { createSkyDome, createSmoke } from '../world/atmosphere.js';
import { createBarrierMesh, createPulseRing, createAura, createRingBurst, createMuzzleFlash, createRevealMarker } from '../models/fx.js';
import { MAT, scaleUV } from '../engine/materials.js';
import { WEAPONS, fireInterval } from '../shared/weapons.js';
import { audio } from '../engine/audio.js';

// Dark presentation studio for operator and weapon inspection. Drag rotates with
// inertia, the wheel zooms (weapons), and demos run real animation/sfx code.

let envCache = null;

export class StudioStage {
  constructor(engine, mode = 'operator') {
    this.engine = engine;
    this.mode = mode;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07080a);
    scene.fog = new THREE.Fog(0x07080a, 7, 16);
    if (!envCache) envCache = engine.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envCache;
    scene.environmentIntensity = 0.75;
    scene.add(createSkyDome({ top: 0x050608, mid: 0x0a0b0e, horizon: 0x16130f, glow: 0x24180a, glowDir: [0, 0.2, -1] }));

    // floor + platform
    const floor = new THREE.Mesh(scaleUV(new THREE.CircleGeometry(16, 64), 32, 32), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.32, metalness: 0.1, map: MAT.concreteDark().map, normalMap: MAT.concreteDark().normalMap }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.4, metalness: 0.6 }));
    plat.position.y = 0.04; plat.receiveShadow = true; plat.castShadow = true; scene.add(plat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.27, 0.008, 8, 96), new THREE.MeshBasicMaterial({ color: 0xe8a33d, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.081; scene.add(ring);
    this.ring = ring;
    for (let i = 0; i < 24; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.002, i % 6 ? 0.05 : 0.12), new THREE.MeshBasicMaterial({ color: i % 6 ? 0x3a3d44 : 0xe8a33d, toneMapped: false }));
      const a = (i / 24) * Math.PI * 2; tick.position.set(Math.cos(a) * 1.42, 0.005, Math.sin(a) * 1.42); tick.rotation.y = -a; scene.add(tick);
    }

    // lights
    const key = this.key = new THREE.SpotLight(0xffd1a0, 55, 14, 0.5, 0.6, 1.4);
    key.position.set(2.6, 4.2, 3.4); key.target.position.set(0, 1, 0);
    key.castShadow = engine.quality.shadows > 0; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02;
    scene.add(key, key.target);
    const rim = new THREE.SpotLight(0x5aa9e6, 120, 14, 0.55, 0.7, 1.4);
    rim.position.set(-2.4, 3.2, -3.4); rim.target.position.set(0, 1.1, 0); scene.add(rim, rim.target);
    const rim2 = new THREE.SpotLight(0xe8a33d, 40, 12, 0.6, 0.8, 1.4);
    rim2.position.set(3, 1.6, -3); rim2.target.position.set(0, 1, 0); scene.add(rim2, rim2.target);
    scene.add(new THREE.HemisphereLight(0x7c8696, 0x0b0b0c, 0.35));
    this.smoke = createSmoke({ count: 18, center: [0, 0.1, -2], spread: [10, 0.5, 4], color: 0x50565f, size: 6, rise: 0.02, opacity: 0.12 });
    scene.add(this.smoke);

    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
    this.pivot = new THREE.Group(); scene.add(this.pivot);
    this.rotY = mode === 'weapon' ? 0.35 : -0.75; this.velY = 0; this.rotX = 0;
    this.zoom = 1; this.zoomT = 1;
    this.fx = [];
    this.post = { bloom: 0.55, bloomThreshold: 0.8, exposure: 1.1, vignette: 0.55, dof: { focus: 4.4, aperture: 0.0012, maxblur: 0.005 }, grain: 0.03 };
    this.demo = null;
    this.shells = [];
    if (mode === 'operator') { this.camera.position.set(0, 1.05, 4.6); this.camera.lookAt(0, 0.95, 0); }
  }

  // ---------- operator ----------
  setOperator(opId, outfit = 'standard', weaponId = 'vk7', skin = 'factory') {
    if (this.char) { this.pivot.remove(this.char.root); this.char.dispose(); }
    this.char = new Character({ operator: opId, outfit, weapon: weaponId, skin });
    this.char.root.position.y = 0.08;
    this.pivot.add(this.char.root);
    this.entry = 0;
    this.clearFx();
  }

  previewAbility(id) {
    if (!this.char) return;
    this.clearFx();
    this.char.ability();
    audio.ability(id);
    if (id === 'recon') {
      const ring = createPulseRing(0x5aa9e6, 6); ring.position.y = 0.09; this.addFx(ring);
      for (const [x, z] of [[-2.6, -2.2], [2.9, -1.4], [1.4, -3.4]]) {
        const mk = createRevealMarker(); mk.position.set(x, 2.0, z); mk.userData.life = 4; this.addFx(mk);
      }
    } else if (id === 'barrier') {
      const b = createBarrierMesh(); b.position.set(0, 0.08, 1.35); b.userData.life = 5; this.addFx(b);
    } else if (id === 'overdrive') {
      const a = createAura(0xe8a33d, 90, 4); a.position.y = 0.1; this.addFx(a);
      this.addFx(createRingBurst(0xe8a33d, 2));
      this.overdrive = 4;
    } else if (id === 'stim') {
      const a = createAura(0x4fc3b0, 80, 2.4); a.position.y = 0.1; this.addFx(a);
      this.addFx(createRingBurst(0x4fc3b0, 1.6));
    }
  }

  addFx(o) { this.scene.add(o); this.fx.push(o); }
  clearFx() { for (const o of this.fx) this.scene.remove(o); this.fx = []; this.overdrive = 0; }

  // ---------- weapon ----------
  setWeapon(id, skin = 'factory') {
    if (this.weapon) { this.pivot.remove(this.weapon.root); }
    this.weaponId = id;
    this.weapon = buildWeapon(id, skin);
    this.weapon.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const holder = new THREE.Group();
    holder.add(this.weapon.root);
    // centre the weapon on the pedestal, barrel pointing left
    const box = new THREE.Box3().setFromObject(this.weapon.root);
    const c = box.getCenter(new THREE.Vector3());
    this.weapon.root.position.sub(c);
    this.weaponLen = box.getSize(new THREE.Vector3()).z;
    holder.rotation.y = -Math.PI / 2;
    holder.position.y = 1.05;
    if (this.weaponHolder) this.pivot.remove(this.weaponHolder);
    this.weaponHolder = holder;
    this.pivot.add(holder);
    if (!this.flash) { this.flash = createMuzzleFlash(); }
    this.weapon.anchors.muzzle.add(this.flash);
    this.phase = { bolt: 0, mag: 0, pump: 0, cyl: 0, shell: false };
    this.recoil = 0;
    this.entry = 0;
    this.demo = null;
    if (!this.stand) {
      const stand = new THREE.Group();
      const sm = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.8, roughness: 0.35 });
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.86, 16), sm); post.position.y = 0.51; post.castShadow = true; stand.add(post);
      const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.05), sm); cradle.position.y = 0.95; stand.add(cradle);
      this.scene.add(stand); this.stand = stand;
    }
  }

  fireDemo() {
    if (!this.weapon || this.demo) return;
    const w = WEAPONS[this.weaponId];
    const shots = w.auto ? 6 : w.pellets > 1 ? 1 : w.bolt ? 1 : 3;
    this.demo = { kind: 'fire', shots, next: 0, interval: fireInterval(w), w, t: 0 };
  }
  reloadDemo() {
    if (!this.weapon || this.demo) return;
    const w = WEAPONS[this.weaponId];
    this.demo = { kind: 'reload', t: 0, dur: w.perShell ? w.reload * 3 + 0.6 : w.reloadEmpty, w, sounds: new Set() };
  }

  _shell() {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.022, 8), new THREE.MeshStandardMaterial({ color: this.weaponId === 'breacher' ? 0x8a2a20 : 0xc9a050, metalness: 0.9, roughness: 0.3 }));
    const p = this.weapon.anchors.eject.getWorldPosition(new THREE.Vector3());
    s.position.copy(p);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(this.pivot.quaternion);
    s.userData.v = right.multiplyScalar(1.4 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.8 + Math.random(), 0));
    s.userData.av = new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0);
    s.userData.life = 2.5;
    s.castShadow = true;
    this.scene.add(s); this.shells.push(s);
    audio.casing(null);
  }

  // ---------- input ----------
  drag(dx, dy) { this.velY = dx * 0.012; this.rotY += dx * 0.008; if (this.mode === 'weapon') this.rotX = Math.max(-0.6, Math.min(0.6, this.rotX + dy * 0.005)); }
  wheel(d) { if (this.mode === 'weapon') this.zoomT = Math.max(0.55, Math.min(1.5, this.zoomT + d * 0.001)); }

  update(dt, t) {
    this.velY *= Math.exp(-dt * 3);
    this.rotY += this.velY * dt * 20 + (Math.abs(this.velY) < 0.001 ? dt * 0.12 : 0);
    this.pivot.rotation.y = this.rotY;
    this.pivot.rotation.x += (this.rotX - this.pivot.rotation.x) * (1 - Math.exp(-dt * 6));
    this.zoom += (this.zoomT - this.zoom) * (1 - Math.exp(-dt * 6));
    this.entry = Math.min(1, (this.entry || 0) + dt * 1.2);
    const e = 1 - Math.pow(1 - this.entry, 3);
    const cam = this.camera;

    if (this.mode === 'operator' && this.char) {
      const od = this.overdrive > 0;
      if (od) this.overdrive -= dt;
      this.char.update(dt, { speed: od ? 6 : 0, sprint: od ? 1 : 0, fwd: 1, idle: 1, aim: od ? 0.6 : 0.1, pitch: 0 });
      cam.position.set(Math.sin(t * 0.2) * 0.08, 1.05 + (1 - e) * 0.3, 4.6 - (1 - e) * -1.2);
      cam.lookAt(0, 0.98, 0);
      this.post.dof.focus = 4.6;
      if (this.stand) this.stand.visible = false;
    }
    if (this.mode === 'weapon' && this.weapon) {
      if (this.stand) this.stand.visible = true;
      const dist = (0.7 + this.weaponLen * 1.6) * this.zoom;
      cam.position.set(Math.sin(t * 0.25) * 0.04, 1.12 + (1 - e) * 0.2, dist + (1 - e) * 1.5);
      cam.lookAt(0, 1.05, 0);
      this.post.dof.focus = dist;
      this.weaponHolder.position.y = 1.05 + Math.sin(t * 0.8) * 0.006;
      // demos
      const d = this.demo;
      if (d?.kind === 'fire') {
        d.t += dt; d.next -= dt;
        if (d.next <= 0 && d.shots > 0) {
          d.shots--; d.next = d.interval;
          this.flash.userData.fire(d.w.pellets > 1 ? 1.4 : 1);
          this.recoil = 1;
          this.phase.bolt = 1;
          audio.shot(d.w.sound);
          if (!d.w.pump && !d.w.bolt && !d.w.revolver) this._shell();
          if (d.w.revolver) this.phase.cyl += Math.PI / 3;
        }
        if (d.shots <= 0 && d.next <= -0.2) {
          if (d.w.pump && !d.pumped) { d.pumped = true; d.next = 0.4; audio.mech('pump'); this.phase.pump = 1; this._shell(); }
          else if (d.w.bolt && !d.pumped) { d.pumped = true; d.next = 0.6; audio.mech('boltBack'); this.phase.bolt = 1; this._shell(); this.boltHold = 0.5; }
          else this.demo = null;
        }
      } else if (d?.kind === 'reload') {
        d.t += dt; const r = d.t / d.dur;
        const once = (k, fn) => { if (!d.sounds.has(k)) { d.sounds.add(k); fn(); } };
        if (d.w.perShell) {
          const n = Math.floor(d.t / d.w.reload);
          if (n < 3) once(`s${n}`, () => audio.mech('shell'));
          this.phase.shell = (d.t % d.w.reload) < d.w.reload * 0.5;
          this.phase.mag = 1 - ((d.t % d.w.reload) / d.w.reload);
          if (r > 0.85) { once('pump', () => audio.mech('pump')); this.phase.pump = 1; this.phase.shell = false; this.phase.mag = 0; }
        } else if (d.w.revolver) {
          this.phase.mag = r < 0.15 ? r / 0.15 : r < 0.8 ? 1 : 1 - (r - 0.8) / 0.2;
          if (r > 0.1) once('open', () => audio.mech('cylinder'));
          if (r > 0.75) once('close', () => audio.mech('magIn'));
          this.phase.cyl += dt * (r > 0.3 && r < 0.7 ? 8 : 0);
        } else {
          this.phase.mag = r < 0.25 ? r / 0.25 : r < 0.55 ? 1 : Math.max(0, 1 - (r - 0.55) / 0.2);
          if (r > 0.05) once('out', () => audio.mech('magOut'));
          if (r > 0.68) once('in', () => audio.mech('magIn'));
          if (r > 0.82) { once('bolt', () => audio.mech(d.w.slide ? 'boltFwd' : 'boltBack')); this.phase.bolt = r < 0.92 ? 1 : this.phase.bolt; }
        }
        this.weaponHolder.rotation.z = Math.sin(Math.min(1, r) * Math.PI) * 0.35;
        if (r >= 1) { this.demo = null; this.weaponHolder.rotation.z = 0; this.phase.mag = 0; }
      }
      this.recoil = Math.max(0, this.recoil - dt * 10);
      if (this.boltHold > 0) this.boltHold -= dt; else this.phase.bolt = Math.max(0, this.phase.bolt - dt * 9);
      this.phase.pump = Math.max(0, this.phase.pump - dt * 3);
      poseWeaponParts(this.weapon, this.phase);
      this.weapon.root.parent.position.x = this.recoil * 0.03;
      this.weapon.root.parent.rotation.z = (this.demo?.kind === 'reload' ? this.weaponHolder.rotation.z : 0) - this.recoil * 0.06;
      this.flash.userData.update(dt);
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i], u = s.userData;
      u.v.y -= 9.8 * dt; s.position.addScaledVector(u.v, dt);
      s.rotation.x += u.av.x * dt; s.rotation.y += u.av.y * dt;
      if (s.position.y < 0.09) { s.position.y = 0.09; u.v.y *= -0.35; u.v.x *= 0.6; u.v.z *= 0.6; u.av.multiplyScalar(0.6); }
      u.life -= dt;
      if (u.life <= 0) { this.scene.remove(s); s.geometry.dispose(); s.material.dispose(); this.shells.splice(i, 1); }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const o = this.fx[i];
      o.userData.update?.(dt, t);
      if (o.userData.life !== undefined) { o.userData.life -= dt; if (o.userData.life <= 0) o.userData.done = true; }
      if (o.userData.done) { this.scene.remove(o); this.fx.splice(i, 1); }
    }
    this.ring.material.color.setHSL(0.1, 0.8, 0.5 + Math.sin(t * 2) * 0.05);
    this.smoke.userData.update(dt, t);
    this.engine.bokeh.uniforms.focus.value = this.post.dof.focus;
  }

  dispose() {
    if (this.char) this.char.dispose();
    this.scene.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.parameters?.cached) { /* geometry may be shared/cached */ } });
  }
}
