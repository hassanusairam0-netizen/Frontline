import * as THREE from 'three';
import { MapWorld } from '../world/MapWorld.js';
import { Character } from '../models/character.js';
import { createSmoke } from '../world/atmosphere.js';
import { profile } from '../state/profile.js';

// Cinematic main-menu set: two operators in a standoff on the rain-soaked main
// street of Neon District, framed for the title block, with mouse parallax.

const RIVALS = { volt: 'bulwark', phantom: 'volt', bulwark: 'phantom', medic: 'phantom' };

export class MenuStage {
  constructor(engine) {
    this.engine = engine;
    this.map = new MapWorld(engine, 'neon', { menu: true });
    this.scene = this.map.scene;
    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 600);
    this.mouse = new THREE.Vector2();
    this.smoothMouse = new THREE.Vector2();
    this.base = { pos: new THREE.Vector3(-9.9, 1.45, 6.9), target: new THREE.Vector3(-7.7, 1.3, 0.8) };
    this.intro = 0;

    // Fighters
    const lo = profile.loadout();
    this.a = new Character({ operator: lo.operator, outfit: lo.outfit, weapon: lo.primary, skin: lo.skins[lo.primary] });
    this.a.root.position.set(-7.75, 0, 1.0);
    this.a.root.rotation.y = Math.PI / 2 - 0.25;
    this.scene.add(this.a.root);
    const rival = RIVALS[lo.operator] || 'bulwark';
    this.b = new Character({ operator: rival, weapon: rival === 'bulwark' ? 'breacher' : 'ridgeline', skin: 'graphite' });
    this.b.root.position.set(-4.6, 0, 0.6);
    this.b.root.rotation.y = -Math.PI / 2 - 0.3;
    this.scene.add(this.b.root);

    // Cinematic key / rim lights
    const key = new THREE.SpotLight(0xffb76a, 60, 22, 0.55, 0.7, 1.5);
    key.position.set(-11, 5.5, 6); key.target.position.set(-6.4, 1, 0.8);
    key.castShadow = engine.quality.shadows > 0; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005;
    this.scene.add(key, key.target);
    const rim = new THREE.SpotLight(0x5aa9e6, 80, 20, 0.6, 0.6, 1.4);
    rim.position.set(-5, 4.5, -5); rim.target.position.set(-6.2, 1.2, 1);
    this.scene.add(rim, rim.target);
    // the key light carries the hero shadows here; the wide moon shadow pass is unnecessary
    this.map.sun.castShadow = false;
    this.flicker = new THREE.PointLight(0xdfe9ff, 0, 7, 2);
    this.flicker.position.set(-3.6, 3.4, -5.6);
    this.scene.add(this.flicker);

    this.smoke = createSmoke({ count: 26, center: [-6.5, 0.2, 1], spread: [9, 0.6, 5], color: 0x7a8494, size: 7, rise: 0.05, opacity: 0.16, wind: [0.25, 0, 0.05] });
    this.scene.add(this.smoke);

    this.post = { ...this.map.post(), dof: { focus: 6.6, aperture: 0.0022, maxblur: 0.008 }, vignette: 0.5, exposure: 1.2 };
    this._onMove = (e) => { this.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); };
    addEventListener('pointermove', this._onMove);
    this.camera.position.copy(this.base.pos);
    this.camera.lookAt(this.base.target);
  }

  /** Swap the player's fighter when the loadout changes. */
  refreshFighter() {
    const lo = profile.loadout();
    const old = this.a;
    this.a = new Character({ operator: lo.operator, outfit: lo.outfit, weapon: lo.primary, skin: lo.skins[lo.primary] });
    this.a.root.position.copy(old.root.position); this.a.root.rotation.copy(old.root.rotation);
    this.scene.remove(old.root); old.dispose();
    this.scene.add(this.a.root);
  }

  /** Continue from wherever the camera currently is (used when the site hands over). */
  handoff(fromPos, fromTarget) {
    this.handFrom = { pos: fromPos.clone(), target: fromTarget.clone() };
    this.intro = 0;
    this.external = false;
  }

  update(dt, t) {
    this.intro = Math.min(1, this.intro + dt * (this.handFrom ? 0.45 : 0.35));
    const ease = 1 - Math.pow(1 - this.intro, 3);
    this.smoothMouse.lerp(this.mouse, 1 - Math.exp(-dt * 3));
    const m = this.smoothMouse;
    const cam = this.camera;
    if (!this.external) {
      const pos = new THREE.Vector3(
        this.base.pos.x + m.x * 0.35 + Math.sin(t * 0.21) * 0.08,
        this.base.pos.y - m.y * 0.16 + Math.sin(t * 0.33) * 0.03,
        this.base.pos.z + (this.handFrom ? 0 : (1 - ease) * 2.4),
      );
      const tg = this.base.target.clone(); tg.x += m.x * 0.15; tg.y -= m.y * 0.06;
      if (this.handFrom) { pos.lerpVectors(this.handFrom.pos, pos, ease); tg.lerpVectors(this.handFrom.target, tg, ease); if (this.intro >= 1) this.handFrom = null; }
      cam.position.copy(pos);
      cam.lookAt(tg);
    }
    this.post.dof.focus = cam.position.distanceTo(new THREE.Vector3(-6.2, 1.3, 0.8));
    this.engine.bokeh.uniforms.focus.value = this.post.dof.focus;

    this.a.update(dt, { speed: 0, crouch: 0, pitch: -0.05, aim: 0.25 + Math.sin(t * 0.4) * 0.05, idle: 1 });
    this.b.update(dt, { speed: 0, crouch: 0, pitch: -0.02, aim: 0.15, idle: 1 });
    this.flicker.intensity = Math.sin(t * 31) > 0.7 && Math.sin(t * 0.8) > 0.6 ? 0 : 3;
    this.smoke.userData.update(dt, t);
    this.map.update(dt, t, cam);
  }

  dispose() {
    removeEventListener('pointermove', this._onMove);
    this.scene.remove(this.a.root, this.b.root);
    this.a.dispose(); this.b.dispose();
    this.map.dispose();
  }
}
