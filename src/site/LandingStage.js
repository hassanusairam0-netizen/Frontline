import * as THREE from 'three';
import { MenuStage } from '../stages/MenuStage.js';
import { StudioStage } from '../stages/StudioStage.js';
import { MapStage } from '../stages/MapStage.js';
import { WEAPON_LIST } from '../shared/weapons.js';
import { OPERATOR_LIST } from '../shared/operators.js';
import { MAP_LIST } from '../shared/maps/index.js';

// Scroll-driven presentation stage. It delegates to real game sets — the Neon
// District menu set, the armory and operator studios, and the actual maps —
// switching between them with graded fades. The Neon set is handed to the
// game menu on entry so the transition into the playable game is seamless.

// Camera rails stay inside the open street volume (z within ±6, west plaza) so
// the crane never clips through the city blocks.
const NEON_PATH = [
  [new THREE.Vector3(-6.15, 1.5, 5.2), new THREE.Vector3(-6.15, 1.35, 0.8)],
  [new THREE.Vector3(-8.5, 2.6, 5.6), new THREE.Vector3(-5.2, 1.4, 0)],
  [new THREE.Vector3(-17, 7, 4.5), new THREE.Vector3(-2, 1.5, 0)],
  [new THREE.Vector3(-27, 13, 3), new THREE.Vector3(6, 0, 0)],
];
const FINALE_PATH = [
  [new THREE.Vector3(-27, 13, 3), new THREE.Vector3(6, 0, 0)],
  [new THREE.Vector3(-17, 5, 5.5), new THREE.Vector3(-6, 1.3, 0.5)],
  [new THREE.Vector3(-9.9, 1.45, 6.9), new THREE.Vector3(-7.7, 1.3, 0.8)],
];

function curve(path, i) { return new THREE.CatmullRomCurve3(path.map((p) => p[i]), false, 'centripetal'); }

export class LandingStage {
  constructor(engine) {
    this.engine = engine;
    this.menu = new MenuStage(engine);
    this.menu.external = true;
    this.studioW = null; this.studioO = null;
    this.maps = {};
    this.active = this.menu; this.activeKey = 'neon';
    this.state = { section: 'intro', neon: 0, weapon: 0, op: 0, map: 0, finale: 0 };
    this.neonPos = curve(NEON_PATH, 0); this.neonTgt = curve(NEON_PATH, 1);
    this.finPos = curve(FINALE_PATH, 0); this.finTgt = curve(FINALE_PATH, 1);
    this.fade = null;
    this.camPos = new THREE.Vector3(); this.camTgt = new THREE.Vector3();
    this.lastW = -1; this.lastO = -1; this.lastM = -1;
    this.mouse = new THREE.Vector2();
    this._mm = (e) => this.mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
    addEventListener('pointermove', this._mm);
  }

  get scene() { return this.active.scene; }
  get camera() { return this.active.camera; }
  get post() { return this.active.post; }

  desiredKey() {
    const s = this.state;
    if (s.section === 'armory') return 'weapons';
    if (s.section === 'operators') return 'operators';
    if (s.section === 'maps') { const m = MAP_LIST[Math.min(3, Math.floor(s.map))].id; return m === 'neon' ? 'neon-orbit' : `map-${m}`; }
    return 'neon';
  }

  stageFor(key) {
    if (key === 'neon' || key === 'neon-orbit') return this.menu;
    if (key === 'weapons') return this.studioW || (this.studioW = new StudioStage(this.engine, 'weapon'));
    if (key === 'operators') return this.studioO || (this.studioO = new StudioStage(this.engine, 'operator'));
    if (key.startsWith('map-')) { const id = key.slice(4); return this.maps[id] || null; }
    return this.menu;
  }

  /** Build heavier sets ahead of time so scrolling into them is smooth. */
  prewarm(section) {
    const order = ['intro', 'arena', 'armory', 'operators', 'maps', 'play', 'credits'];
    const idx = order.indexOf(section);
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
    if (idx >= 1 && !this.studioW) idle(() => { this.studioW = this.studioW || new StudioStage(this.engine, 'weapon'); this.studioW.setWeapon(WEAPON_LIST[0].id); });
    if (idx >= 2 && !this.studioO) idle(() => { this.studioO = this.studioO || new StudioStage(this.engine, 'operator'); this.studioO.setOperator(OPERATOR_LIST[0].id); });
    if (idx >= 3 && !this._mapsQueued) {
      this._mapsQueued = true;
      const ids = MAP_LIST.map((m) => m.id).filter((id) => id !== 'neon');
      const next = () => { const id = ids.shift(); if (!id) return; idle(() => { try { this.maps[id] = new MapStage(this.engine, id); } catch (e) { console.warn(e); } setTimeout(next, 250); }); };
      next();
    }
  }

  switchTo(key) {
    if (this.fade?.to === key || (!this.fade && this.activeKey === key)) return;
    const st = this.stageFor(key);
    if (!st) return; // map still building: stay on the current set
    this.fade = { to: key, t: this.fade ? Math.min(this.fade.t, 0.25) : 0, swapped: false };
  }

  update(dt, t) {
    const s = this.state;
    this.switchTo(this.desiredKey());
    if (this.fade) {
      this.fade.t += dt;
      const f = this.fade;
      if (f.t >= 0.25 && !f.swapped) {
        f.swapped = true;
        this.active = this.stageFor(f.to); this.activeKey = f.to;
        if (this.active.intro !== undefined && this.active !== this.menu) this.active.intro = 0;
        this.engine.applyStagePost();
      }
      const v = f.t < 0.25 ? f.t / 0.25 : Math.max(0, 1 - (f.t - 0.25) / 0.4);
      this.engine.grade.uniforms.uFade.value = v;
      if (f.t >= 0.65) { this.fade = null; this.engine.grade.uniforms.uFade.value = 0; }
    }

    if (this.active === this.menu) {
      const cam = this.menu.camera;
      if (this.activeKey === 'neon-orbit') {
        const a = t * 0.06 + 0.8;
        this.camPos.set(Math.cos(a) * 25, 9 + Math.sin(a * 2) * 2, Math.sin(a) * 5); this.camTgt.set(Math.cos(a + 0.6) * 8, 1.5, 0);
      } else if (s.section === 'play' || s.section === 'credits') {
        const k = Math.min(1, s.finale);
        this.finPos.getPoint(k, this.camPos); this.finTgt.getPoint(k, this.camTgt);
      } else {
        const k = Math.min(1, s.neon);
        this.neonPos.getPoint(k, this.camPos); this.neonTgt.getPoint(k, this.camTgt);
      }
      this.camPos.x += this.mouse.x * 0.4 + Math.sin(t * 0.2) * 0.05; this.camPos.y -= this.mouse.y * 0.2;
      this.camTgt.x += this.mouse.x * 0.15;
      if (!this._init) { this._init = true; cam.position.copy(this.camPos); this._tgt = this.camTgt.clone(); }
      cam.position.lerp(this.camPos, 1 - Math.exp(-dt * 4));
      this._tgt.lerp(this.camTgt, 1 - Math.exp(-dt * 4));
      cam.lookAt(this._tgt);
      this.menu.update(dt, t);
    } else if (this.active === this.studioW) {
      const i = Math.min(WEAPON_LIST.length - 1, Math.floor(s.weapon));
      if (i !== this.lastW) { this.lastW = i; this.studioW.setWeapon(WEAPON_LIST[i].id, ['factory', 'graphite', 'amberline', 'carbon', 'glacier', 'gilded', 'dune'][i % 7]); this.wDemo = 0.9; }
      if (this.wDemo > 0) { this.wDemo -= dt; if (this.wDemo <= 0) this.studioW.fireDemo(); }
      this.studioW.rotY = -0.5 + (s.weapon % 1) * 1.2;
      this.studioW.update(dt, t);
    } else if (this.active === this.studioO) {
      const i = Math.min(OPERATOR_LIST.length - 1, Math.floor(s.op));
      if (i !== this.lastO) { this.lastO = i; this.studioO.setOperator(OPERATOR_LIST[i].id, 'standard', ['vk7', 'ridgeline', 'breacher', 'hornet'][i % 4]); this.oDemo = 1.0; }
      if (this.oDemo > 0) { this.oDemo -= dt; if (this.oDemo <= 0) this.studioO.previewAbility(OPERATOR_LIST[i].ability.id); }
      this.studioO.rotY = -0.6 + (s.op % 1) * 1.1;
      this.studioO.update(dt, t);
    } else this.active.update(dt, t);
  }

  /** Hand the Neon set to the game menu. Returns the MenuStage. */
  handoff() {
    const cam = this.menu.camera;
    const target = this._tgt ? this._tgt.clone() : new THREE.Vector3(-6.9, 1.32, 1);
    this.menu.handoff(cam.position.clone(), target);
    this.engine.grade.uniforms.uFade.value = 0;
    this.disposeExtras();
    return this.menu;
  }

  disposeExtras() {
    removeEventListener('pointermove', this._mm);
    this.studioW?.dispose(); this.studioO?.dispose();
    for (const m of Object.values(this.maps)) m.dispose();
    this.studioW = this.studioO = null; this.maps = {};
  }

  dispose() { this.disposeExtras(); this.menu.dispose(); }
}
