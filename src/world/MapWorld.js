import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { getLayout, MAPS } from '../shared/maps/index.js';
import { createWorld } from '../shared/collision.js';
import { Batcher, MAT, boxGeo, scaleUV } from '../engine/materials.js';
import { PROPS, buildPerimeter } from './props.js';
import { createRain, createSplashes, createDrift, createSmoke, createLightShaft, createSkyDome } from './atmosphere.js';
import { settings } from '../state/settings.js';

// Builds a complete, lit, atmospheric map from the shared layout. The collision
// world comes from the same layout the server uses.

const THEMES = {
  neon: {
    night: true, fog: [0x0c1018, 0.021], exposure: 1.15, bloom: 0.7, bloomThreshold: 0.72,
    hemi: [0x2c3c58, 0x0b0b0c, 0.45], sun: { color: 0x8fa8d0, intensity: 0.55, pos: [-25, 45, 18] },
    sky: { top: 0x03050a, mid: 0x0a0f18, horizon: 0x2b2117, glow: 0x3a2610, glowDir: [0.2, 0.05, -1] },
    envPos: [0, 4.5, 3], ambience: 'rain', surface: 'wet', grade: { saturation: 1.05, vignette: 0.42 },
  },
  desert: {
    night: false, fog: [0xd8c4a2, 0.0062], exposure: 0.62, bloom: 0.28, bloomThreshold: 0.9,
    hemi: [0xbcd4ff, 0xa88358, 0.55], sun: { color: 0xffdcb0, intensity: 3.4, pos: [38, 26, -22] },
    skyShader: { turbidity: 7, rayleigh: 1.4, mie: 0.005, g: 0.8, elevation: 24, azimuth: 120 },
    envPos: [0, 5, 0], ambience: 'desert', surface: 'sand', grade: { saturation: 1.0, vignette: 0.32 },
  },
  arctic: {
    night: false, fog: [0xa9b7c6, 0.022], exposure: 0.78, bloom: 0.3, bloomThreshold: 0.9,
    hemi: [0xdfe8f5, 0x6d7a88, 0.9], sun: { color: 0xdfe8ff, intensity: 1.4, pos: [-20, 30, -30] },
    sky: { top: 0x8293a6, mid: 0x9fadbc, horizon: 0xb4c0cc },
    envPos: [0, 5, 6], ambience: 'arctic', surface: 'snow', grade: { saturation: 0.85, vignette: 0.3 },
  },
  industrial: {
    night: false, fog: [0x2e2a24, 0.017], exposure: 1.05, bloom: 0.5, bloomThreshold: 0.78,
    hemi: [0x6c665a, 0x181614, 0.42], sun: { color: 0xffd6a0, intensity: 4.2, pos: [10, 34, 8] },
    sky: { top: 0x7aa0c8, mid: 0xb8c8d8, horizon: 0xe8dcc8 },
    envPos: [0, 6, 5], ambience: 'industrial', surface: 'concrete', grade: { saturation: 0.95, vignette: 0.4 },
  },
};

export class MapWorld {
  constructor(engine, mapId, { menu = false } = {}) {
    this.engine = engine;
    this.id = MAPS[mapId] ? mapId : 'neon';
    this.meta = MAPS[this.id];
    this.theme = THEMES[this.id];
    this.layout = getLayout(this.id);
    this.world = createWorld(this.layout.colliders, this.layout.bounds);
    this.scene = new THREE.Scene();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.anim = [];
    this.updaters = [];
    this.menu = menu;
    this.build();
  }

  build() {
    const T = this.theme, scene = this.scene, q = settings.quality();
    scene.fog = new THREE.FogExp2(T.fog[0], T.fog[1]);
    scene.background = new THREE.Color(T.fog[0]);

    // Sky
    if (T.skyShader) {
      const sky = new Sky(); sky.scale.setScalar(450000);
      const u = sky.material.uniforms, S = T.skyShader;
      u.turbidity.value = S.turbidity; u.rayleigh.value = S.rayleigh; u.mieCoefficient.value = S.mie; u.mieDirectionalG.value = S.g;
      const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - S.elevation), THREE.MathUtils.degToRad(S.azimuth));
      u.sunPosition.value.copy(sun);
      this.sunDir = sun.clone();
      scene.add(sky);
      scene.background = null;
    } else {
      scene.add(createSkyDome(T.sky));
    }

    // Lights
    const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]);
    scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(T.sun.color, T.sun.intensity);
    const sp = this.sunDir ? this.sunDir.clone().multiplyScalar(60) : new THREE.Vector3(...T.sun.pos);
    sun.position.copy(sp);
    sun.castShadow = q.shadows > 0;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const B = this.layout.bounds;
    const ext = Math.max(B.maxX - B.minX, B.maxZ - B.minZ) * 0.62;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 160 });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun); scene.add(sun.target);

    // Ground & map objects
    const B2 = new Batcher();
    const lightReqs = [];
    const ctx = { B: B2, group: this.group, theme: this.id, night: T.night, anim: this.anim, light: (l) => lightReqs.push(l), skylights: null };
    this.buildGround(ctx);
    for (const o of this.layout.objects) {
      const fn = PROPS[o.kind];
      if (fn) { try { fn(ctx, o); } catch (e) { console.warn('prop failed', o.kind, e); } }
    }
    buildPerimeter(ctx, B);
    B2.build(this.group);
    // Second pass: fold every static decorative piece (signs, glass, light pools,
    // windows...) into the batch too; only animated objects stay separate.
    const B3 = new Batcher();
    for (const ch of [...this.group.children]) {
      if (ch.userData.dynamic || ch.userData.batched || ch.isPoints || ch.isLineSegments) continue;
      let animated = false;
      ch.traverse((o) => { if (o.userData.dynamic) animated = true; });
      if (animated) continue;
      B3.addObject(ch);
      this.group.remove(ch);
    }
    B3.build(this.group);

    // Light budget: keep the shader cheap, prefer high-priority lights near the action.
    const budget = q.label === 'LOW' ? 3 : q.label === 'MEDIUM' ? 6 : 10;
    lightReqs.sort((a, b) => (b.priority - a.priority) || (Math.hypot(a.pos[0], a.pos[2]) - Math.hypot(b.pos[0], b.pos[2])));
    for (const l of lightReqs.slice(0, budget)) {
      let L;
      if (l.type === 'spot') {
        L = new THREE.SpotLight(l.color, l.intensity, l.distance, l.angle, 0.6, 1.6);
        L.target.position.set(...l.target); scene.add(L.target);
      } else L = new THREE.PointLight(l.color, l.intensity, l.distance, 1.8);
      L.position.set(...l.pos);
      scene.add(L);
    }

    // Industrial: sun shafts through the skylights
    if (this.id === 'industrial' && ctx.skylights) {
      const dir = sun.position.clone().normalize();
      for (const gx of ctx.skylights) for (const z of [-15, -6, 6, 15]) {
        const shaft = createLightShaft({ width: 3.6, depth: 2.4, length: 16, color: 0xffd9a8, intensity: 0.11 });
        shaft.position.set(gx, 12, z);
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.group.add(shaft); this.updaters.push(shaft);
      }
    }

    // Environment reflections captured from the finished set (before weather)
    const ep = T.envPos;
    this.group.position.set(-ep[0], -ep[1], -ep[2]);
    this.scene.updateMatrixWorld(true);
    const oldFog = scene.fog; scene.fog = null;
    this.envRT = this.engine.pmrem.fromScene(scene, 0.03, 0.1, 400);
    scene.fog = oldFog;
    this.group.position.set(0, 0, 0);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = this.id === 'neon' ? 1.6 : 1;

    // Weather
    const pk = q.particles;
    if (this.id === 'neon') {
      this.addFx(createRain({ count: Math.round(6000 * pk) }));
      this.addFx(createSplashes({ count: Math.round(700 * pk) }));
      this.addFx(createSmoke({ count: 14, center: [-18, 0, 0], spread: [3, 1, 3], color: 0x6b7480, size: 5, rise: 0.4, opacity: 0.12 }));
      this.addFx(createSmoke({ count: 14, center: [18, 0, 0], spread: [3, 1, 3], color: 0x6b7480, size: 5, rise: 0.4, opacity: 0.12 }));
      this.addFx(createSmoke({ count: 30, center: [0, 0.5, 0], spread: [60, 2, 40], color: 0x404a58, size: 14, rise: 0.02, opacity: 0.07 }));
    } else if (this.id === 'desert') {
      this.addFx(createDrift({ count: Math.round(1500 * pk), color: 0xe8d2aa, size: 0.06, wind: [4, 0.2, 1.5], swirl: 1.2, opacity: 0.5 }));
      this.addFx(createSmoke({ count: 24, center: [0, 0.3, 0], spread: [70, 1, 56], color: 0xc9b08a, size: 16, rise: 0.01, opacity: 0.08, wind: [0.8, 0, 0.3] }));
    } else if (this.id === 'arctic') {
      this.addFx(createDrift({ count: Math.round(5000 * pk), color: 0xffffff, size: 0.11, wind: [7, -1.6, 2.5], swirl: 1.4, opacity: 0.9 }));
      this.addFx(createSmoke({ count: 30, center: [0, 0.4, 0], spread: [64, 1.5, 52], color: 0xe6eef6, size: 18, rise: 0.01, opacity: 0.12, wind: [1.5, 0, 0.5] }));
    } else if (this.id === 'industrial') {
      this.addFx(createDrift({ count: Math.round(2500 * pk), area: 40, height: 12, color: 0xffd9a0, size: 0.045, wind: [0.2, 0.05, 0.1], swirl: 0.6, opacity: 0.55, additive: true }));
      this.addFx(createSmoke({ count: 20, center: [0, 1, 0], spread: [56, 3, 40], color: 0x6a6052, size: 14, rise: 0.02, opacity: 0.08 }));
    }
  }

  addFx(obj) { this.scene.add(obj); this.updaters.push(obj); }

  buildGround(ctx) {
    const id = this.id;
    const groundMat = { neon: MAT.asphaltWet(), desert: MAT.sand(), arctic: MAT.snow(), industrial: MAT.concrete([0.46, 0.45, 0.43], 90) }[id];
    const size = id === 'industrial' ? 80 : 320;
    const geo = scaleUV(new THREE.PlaneGeometry(size, size), size, size);
    const ground = new THREE.Mesh(geo, groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    this.group.add(ground);
    const flat = (w, d, mat, x, z, y = 0.012, ry = 0) => {
      const m = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(w, d), w, d), mat);
      m.rotation.set(-Math.PI / 2, 0, ry); m.position.set(x, y, z); m.receiveShadow = true; this.group.add(m); return m;
    };
    if (id === 'neon') {
      const walk = MAT.sidewalk();
      for (const z of [-6, 6]) flat(64, 2, walk, 0, z, 0.03);
      for (const z of [-15.8, 15.8]) { flat(25, 1.6, walk, -9.75, z, 0.03); flat(25, 1.6, walk, 9.75, z, 0.03); }
      const curb = MAT.concrete([0.5, 0.5, 0.5], 91);
      for (const z of [-5, 5]) { const c = new THREE.Mesh(boxGeo(64, 0.06, 0.15), curb); c.position.set(0, 0.03, z); c.receiveShadow = true; this.group.add(c); }
      const paint = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.4, transparent: true, opacity: 0.75 });
      const white = new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.4, transparent: true, opacity: 0.7 });
      for (let x = -30; x < 30; x += 4) if (Math.abs(x) > 2) flat(2, 0.14, paint, x + 1, 0, 0.02);
      for (const cx of [-17.5, 17.5]) for (let i = 0; i < 8; i++) flat(0.5, 3.5, white, cx + (i - 3.5) * 0.9, -2.6, 0.02).position.z = i % 2 ? -2.4 : 2.4;
      const manhole = MAT.metal([0.25, 0.25, 0.26], 92, 0.7);
      for (const x of [-18, 18]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), manhole); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.022, 0); this.group.add(m); }
    } else if (id === 'desert') {
      flat(17, 13, MAT.concrete([0.62, 0.58, 0.52], 93), 0, 0, 0.02);
      flat(6, 64, MAT.asphaltDry(), 0, 0, 0.015).material.transparent = false;
    } else if (id === 'arctic') {
      flat(26, 8, MAT.concreteDark(), 0, 0, 0.02);
      const path = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.9, transparent: true, opacity: 0.45 });
      flat(64, 3, path, 0, 0, 0.015);
    } else if (id === 'industrial') {
      const line = new THREE.MeshStandardMaterial({ color: 0xd9a33a, roughness: 0.6 });
      for (const z of [-19.5, 19.5, -3.5, 3.5]) flat(60, 0.15, line, 0, z, 0.015);
      for (const x of [-20, 20]) flat(0.15, 40, line, x, 0, 0.015);
      const oil = new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.1, transparent: true, opacity: 0.6 });
      for (const [x, z, s] of [[-4, 3, 2.2], [6, -5, 1.6], [-14, -14, 2.8], [14, 14, 2], [22, -2, 1.4]]) { const m = new THREE.Mesh(new THREE.CircleGeometry(s, 20), oil); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.018, z); m.scale.set(1, 0.6, 1); this.group.add(m); }
    }
  }

  /** Footstep surface at a position. */
  surfaceAt(x, y, z) {
    if (y > 3) return 'metal';
    if (this.id === 'desert') return Math.abs(x) < 8 && Math.abs(z) < 6 ? 'concrete' : 'sand';
    if (this.id === 'arctic') return Math.abs(x) < 12 && Math.abs(z) < 3.4 ? 'metal' : 'snow';
    return this.theme.surface;
  }

  impactSurface(box) {
    if (box === 'ground') return this.id === 'desert' ? 'sand' : this.id === 'arctic' ? 'snow' : 'concrete';
    const k = box?.kind || '';
    if (/container|car|van|tank|pipes|module|dumpster|crate_metal|machine|press|walkway|stairs|barrier$|lockers|truck|iwall|post|rail/.test(k) && k !== 'barrier') return 'metal';
    return 'concrete';
  }

  post() {
    const T = this.theme;
    return { bloom: T.bloom, bloomThreshold: T.bloomThreshold, exposure: T.exposure, vignette: T.grade.vignette, saturation: T.grade.saturation, grain: 0.035 };
  }

  update(dt, t, camera) {
    for (const fn of this.anim) fn(dt, t);
    for (const o of this.updaters) o.userData.update?.(dt, t, camera);
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints || o.isLineSegments) {
        o.geometry?.dispose();
        // shared library materials are cached; only dispose per-instance shader/standard mats not in the library
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && !m.userData?.key) m.dispose();
      }
    });
    this.envRT?.dispose();
  }
}
