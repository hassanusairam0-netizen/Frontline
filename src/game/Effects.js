import * as THREE from 'three';
import { decalTexture, radialTexture } from '../engine/textures.js';

// Pooled world effects: tracers, impact sparks and dust, bullet-hole decals.
// Pools are preallocated so firing never allocates or triggers recompiles.

export class Effects {
  constructor(scene, theme) {
    this.scene = scene;
    this.theme = theme;
    this.group = new THREE.Group();
    scene.add(this.group);

    // tracers: one LineSegments buffer, 64 slots
    this.tracerMax = 64;
    const tp = new Float32Array(this.tracerMax * 6), tc = new Float32Array(this.tracerMax * 8);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(tc, 4));
    this.tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.tracers.frustumCulled = false;
    this.group.add(this.tracers);
    this.tracerLife = new Float32Array(this.tracerMax);
    this.tracerIdx = 0;

    // sparks / debris: points pool
    this.pMax = 600;
    const pp = new Float32Array(this.pMax * 3), pc = new Float32Array(this.pMax * 3), ps = new Float32Array(this.pMax);
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.pGeo.setAttribute('size', new THREE.BufferAttribute(ps, 1));
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: radialTexture('soft') }, uScale: { value: innerHeight / 2 } },
      vertexShader: /* glsl */ `attribute vec3 color; attribute float size; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uScale / -mv.z; }`,
      fragmentShader: /* glsl */ `uniform sampler2D uMap; varying vec3 vC; void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vC * a, 1.0); }`,
    });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.parts = Array.from({ length: this.pMax }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, size: 0.05, grav: 9 }));
    this.pIdx = 0;

    // dust puffs (normal blending, smoke sprites)
    this.puffMax = 40;
    this.puffs = [];
    const puffMat = new THREE.SpriteMaterial({ map: radialTexture('smoke'), transparent: true, depthWrite: false, color: theme === 'arctic' ? 0xe8eef4 : theme === 'desert' ? 0xcbb08a : 0x8a8a88 });
    for (let i = 0; i < this.puffMax; i++) { const s = new THREE.Sprite(puffMat.clone()); s.visible = false; this.group.add(s); this.puffs.push({ s, life: 0 }); }
    this.puffIdx = 0;

    // decals
    this.decalMax = 80;
    const dGeo = new THREE.PlaneGeometry(0.11, 0.11);
    const dMat = new THREE.MeshStandardMaterial({ map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
    this.decals = new THREE.InstancedMesh(dGeo, dMat, this.decalMax);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.receiveShadow = true;
    this.group.add(this.decals);
    this.decalIdx = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  tracer(from, to, color = [1, 0.75, 0.4], life = 0.07) {
    const i = this.tracerIdx; this.tracerIdx = (i + 1) % this.tracerMax;
    const p = this.tracerGeo.attributes.position.array, c = this.tracerGeo.attributes.color.array;
    // start the visible streak a little ahead of the muzzle and keep it short
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const a = Math.min(1.5, len * 0.1) / len, b = Math.min(1, (Math.min(len, 18) + 1.5) / len);
    p.set([from[0] + dx * a, from[1] + dy * a, from[2] + dz * a, from[0] + dx * b, from[1] + dy * b, from[2] + dz * b], i * 6);
    c.set([color[0] * 0.2, color[1] * 0.2, color[2] * 0.2, 1, color[0] * 2.5, color[1] * 2.5, color[2] * 2.5, 1], i * 8);
    this.tracerLife[i] = life;
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
  }

  spark(pos, normal, n = 10, color = [1, 0.7, 0.35], speed = 4, size = 0.05, life = 0.35, grav = 9) {
    for (let k = 0; k < n; k++) {
      const P = this.parts[this.pIdx]; const idx = this.pIdx; this.pIdx = (this.pIdx + 1) % this.pMax;
      const rx = (Math.random() - 0.5) * 2, ry = (Math.random() - 0.5) * 2, rz = (Math.random() - 0.5) * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      P.vx = (normal[0] + rx * 0.7) * sp; P.vy = (normal[1] + ry * 0.7 + 0.3) * sp; P.vz = (normal[2] + rz * 0.7) * sp;
      P.life = P.max = life * (0.6 + Math.random() * 0.6); P.r = color[0]; P.g = color[1]; P.b = color[2]; P.size = size * (0.6 + Math.random() * 0.8); P.grav = grav;
      this.pGeo.attributes.position.array.set(pos, idx * 3);
    }
  }

  puff(pos, normal, scale = 0.5) {
    const P = this.puffs[this.puffIdx]; this.puffIdx = (this.puffIdx + 1) % this.puffMax;
    P.s.visible = true; P.life = 1; P.s.position.set(pos[0] + normal[0] * 0.1, pos[1] + normal[1] * 0.1, pos[2] + normal[2] * 0.1);
    P.n = normal; P.scale = scale; P.s.material.rotation = Math.random() * 6;
  }

  decal(pos, normal) {
    const i = this.decalIdx; this.decalIdx = (i + 1) % this.decalMax;
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal));
    const s = 0.7 + Math.random() * 0.6;
    this._m.compose(new THREE.Vector3(pos[0] + normal[0] * 0.006, pos[1] + normal[1] * 0.006, pos[2] + normal[2] * 0.006), this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6)), new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(i, this._m);
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Surface impact composite. */
  impact(pos, normal, surface) {
    if (surface === 'metal') { this.spark(pos, normal, 12, [1, 0.72, 0.38], 5, 0.04, 0.3); this.spark(pos, normal, 3, [1, 0.9, 0.7], 1, 0.16, 0.06, 0); }
    else if (surface === 'flesh') { this.spark(pos, normal, 6, [0.25, 0.22, 0.2], 1.5, 0.08, 0.3, 4); }
    else {
      this.spark(pos, normal, 5, [0.9, 0.7, 0.45], 3, 0.03, 0.25);
      this.puff(pos, normal, surface === 'snow' || surface === 'sand' ? 0.8 : 0.45);
    }
    if (surface !== 'flesh') this.decal(pos, normal);
  }

  update(dt) {
    // tracers fade
    const c = this.tracerGeo.attributes.color.array;
    let dirty = false;
    for (let i = 0; i < this.tracerMax; i++) {
      if (this.tracerLife[i] > 0) {
        this.tracerLife[i] -= dt; dirty = true;
        if (this.tracerLife[i] <= 0) { for (let k = 0; k < 8; k++) c[i * 8 + k] = 0; }
        else { const f = 0.85; for (const o of [0, 1, 2, 4, 5, 6]) c[i * 8 + o] *= f; }
      }
    }
    if (dirty) this.tracerGeo.attributes.color.needsUpdate = true;
    // particles
    const pa = this.pGeo.attributes.position.array, ca = this.pGeo.attributes.color.array, sa = this.pGeo.attributes.size.array;
    for (let i = 0; i < this.pMax; i++) {
      const P = this.parts[i];
      if (P.life <= 0) { if (sa[i] !== 0) { sa[i] = 0; } continue; }
      P.life -= dt; P.vy -= P.grav * dt;
      pa[i * 3] += P.vx * dt; pa[i * 3 + 1] += P.vy * dt; pa[i * 3 + 2] += P.vz * dt;
      if (pa[i * 3 + 1] < 0.01) { pa[i * 3 + 1] = 0.01; P.vy *= -0.3; P.vx *= 0.6; P.vz *= 0.6; }
      const f = Math.max(0, P.life / P.max);
      ca[i * 3] = P.r * f * 2; ca[i * 3 + 1] = P.g * f * 2; ca[i * 3 + 2] = P.b * f * 2;
      sa[i] = P.size;
    }
    this.pGeo.attributes.position.needsUpdate = true; this.pGeo.attributes.color.needsUpdate = true; this.pGeo.attributes.size.needsUpdate = true;
    // puffs
    for (const P of this.puffs) {
      if (P.life <= 0) continue;
      P.life -= dt * 1.4;
      if (P.life <= 0) { P.s.visible = false; continue; }
      const k = 1 - P.life;
      const sc = P.scale * (0.3 + k * 1.4);
      P.s.scale.set(sc, sc, 1);
      P.s.position.x += P.n[0] * dt * 0.4; P.s.position.y += (P.n[1] * 0.4 + 0.2) * dt; P.s.position.z += P.n[2] * dt * 0.4;
      P.s.material.opacity = P.life * 0.5;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.tracerGeo.dispose(); this.pGeo.dispose(); this.pMat.dispose(); this.decals.dispose();
  }
}
