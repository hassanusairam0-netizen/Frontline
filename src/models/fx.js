import * as THREE from 'three';
import { radialTexture } from '../engine/textures.js';

// Ability and combat visuals reused by gameplay and the operator/armory previews.

/** Bulwark's ballistic barrier: hex-panelled energy shield on a metal frame. */
export function createBarrierMesh(width = 2.6, height = 1.9) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uDeploy: { value: 0 }, uHit: { value: 0 }, uHp: { value: 1 }, uColor: { value: new THREE.Color(0xe8a33d) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDeploy, uHit, uHp; uniform vec3 uColor; varying vec2 vUv;
      float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
      void main(){
        if (vUv.y > uDeploy) discard;
        float h = hex(vUv * vec2(9.0, 7.0));
        float edge = smoothstep(0.08, 0.0, h);
        float border = smoothstep(0.03, 0.0, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
        float scan = smoothstep(0.02, 0.0, abs(fract(vUv.y * 1.0 - uTime * 0.4) - 0.5) - 0.48);
        float front = smoothstep(0.06, 0.0, abs(vUv.y - uDeploy)) * step(uDeploy, 0.99);
        float a = 0.07 + edge * 0.35 + border * 0.8 + scan * 0.25 + front + uHit * 0.5;
        a *= mix(0.45, 1.0, uHp) * (0.9 + 0.1 * sin(uTime * 20.0));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  panel.position.y = height / 2;
  g.add(panel);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.35 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.12, 0.3), frameMat);
  base.position.y = 0.06; base.castShadow = true; g.add(base);
  for (const x of [-width / 2, width / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, height, 0.12), frameMat);
    post.position.set(x, height / 2, 0); post.castShadow = true; g.add(post);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.13), new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }));
    lamp.position.set(x, height - 0.15, 0); g.add(lamp);
  }
  g.userData = { mat, deploy: 0, hit: 0, update(dt, t) { this.deploy = Math.min(1, this.deploy + dt * 2.5); mat.uniforms.uDeploy.value = this.deploy; this.hit = Math.max(0, this.hit - dt * 4); mat.uniforms.uHit.value = this.hit; mat.uniforms.uTime.value = t; } };
  return g;
}

/** Expanding sonar ring (Phantom recon pulse). */
export function createPulseRing(color = 0x5aa9e6, maxRadius = 32) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform float uT; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float r = uT;
        float ring = smoothstep(0.035, 0.0, abs(d - r)) + smoothstep(0.25, 0.0, r - d) * step(d, r) * 0.15;
        float grid = step(0.97, fract(d * 24.0)) * step(d, r) * 0.15;
        gl_FragColor = vec4(uColor * (ring + grid) * (1.0 - uT), 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(maxRadius * 2, maxRadius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  m.userData = { t: 0, done: false, update(dt) { this.t += dt / 1.4; mat.uniforms.uT.value = Math.min(1, this.t); if (this.t >= 1) this.done = true; } };
  return m;
}

/** Rising particle column (Medic stim / Volt overdrive aura). */
export function createAura(color = 0x4fc3b0, count = 60, duration = 2) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.35; pos.set([Math.cos(a) * r, Math.random() * 0.3, Math.sin(a) * r], i * 3); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uMap: { value: radialTexture('soft') }, uScale: { value: innerHeight / 2 }, uFade: { value: 1 } },
    vertexShader: /* glsl */ `uniform float uT, uScale; attribute float aSeed; varying float vA;
      void main(){ float life = fract(uT * (0.5 + aSeed * 0.6) + aSeed);
        vec3 p = position; p.y += life * 2.0; p.xz *= 1.0 - life * 0.4;
        vA = sin(life * 3.14159);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (0.06 + aSeed * 0.06) * uScale / -mv.z; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform sampler2D uMap; uniform float uFade; varying float vA;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(uColor * a * vA * uFade * 1.6, 1.0); }`,
  });
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  p.userData = { t: 0, life: duration, done: false, update(dt) { this.t += dt; mat.uniforms.uT.value = this.t; mat.uniforms.uFade.value = Math.min(1, (this.life - this.t) * 2, this.t * 4); if (this.t >= this.life) this.done = true; } };
  return p;
}

/** Ground ring burst. */
export function createRingBurst(color = 0x4fc3b0, radius = 1.4) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.04;
  m.userData = { t: 0, done: false, update(dt) { this.t += dt * 1.6; const s = 0.2 + this.t * radius; m.scale.set(s, s, s); mat.opacity = Math.max(0, 1 - this.t); if (this.t >= 1) this.done = true; } };
  return m;
}

/** Reveal marker shown above enemies revealed by recon (renders through walls). */
export function createRevealMarker(color = 0x5aa9e6) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, opacity: 0.9, toneMapped: false });
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), mat);
  diamond.scale.set(1, 1.5, 1);
  g.add(diamond);
  const ghostMat = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, opacity: 0.25, toneMapped: false });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 10), ghostMat);
  body.position.y = -1.0;
  g.add(body);
  g.renderOrder = 999;
  diamond.renderOrder = 999; body.renderOrder = 998;
  g.userData = { body, update(dt, t) { diamond.rotation.y = t * 2; diamond.position.y = Math.sin(t * 3) * 0.05; } };
  return g;
}

/** Speed streaks around the camera (first person Overdrive). Screen-space DOM is used instead in HUD. */
export function createMuzzleFlash() {
  const g = new THREE.Group();
  const mat = new THREE.SpriteMaterial({ map: radialTexture('flash'), color: 0xffd9a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const s1 = new THREE.Sprite(mat); s1.scale.set(0.32, 0.32, 1); g.add(s1);
  const mat2 = mat.clone();
  const s2 = new THREE.Sprite(mat2); s2.scale.set(0.18, 0.18, 1); s2.position.z = -0.08; g.add(s2);
  const light = new THREE.PointLight(0xffb560, 0, 7, 2);
  g.add(light);
  s1.visible = s2.visible = false;
  // The light stays in the scene permanently (intensity 0 when idle) so toggling
  // the flash never changes the light count and never triggers a shader recompile.
  g.userData = {
    t: 0, light,
    fire(scale = 1) { this.t = 0.05; s1.visible = s2.visible = true; light.intensity = 18 * scale; s1.material.rotation = Math.random() * 6; mat2.rotation = Math.random() * 6; const k = (0.8 + Math.random() * 0.4) * scale; s1.scale.set(0.34 * k, 0.34 * k, 1); s2.scale.set(0.22 * k, 0.22 * k, 1); },
    update(dt) { if (this.t > 0) { this.t -= dt; if (this.t <= 0) { s1.visible = s2.visible = false; light.intensity = 0; } else light.intensity *= 0.7; } },
  };
  return g;
}
