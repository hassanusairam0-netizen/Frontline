import * as THREE from 'three';
import { radialTexture } from '../engine/textures.js';

// GPU-animated atmosphere. Each system keeps a camera-centred volume and wraps
// particles in the vertex shader so thousands of drops cost a single draw call.

const wrapChunk = /* glsl */ `
  vec3 wrapBox(vec3 p, vec3 center, vec3 size) {
    return center + mod(p - center + size * 0.5, size) - size * 0.5;
  }
`;

export function createRain({ count = 5000, area = 50, height = 24, color = 0x9fb6cc, wind = [1.2, 0, 0.6], speed = 22, opacity = 0.32 } = {}) {
  const pos = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * area, y = Math.random() * height, z = (Math.random() - 0.5) * area;
    for (let j = 0; j < 2; j++) { pos.set([x, y, z], (i * 2 + j) * 3); end[i * 2 + j] = j; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector3(area, height, area) },
      uVel: { value: new THREE.Vector3(wind[0], -speed, wind[2]) }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime; uniform vec3 uCam, uSize, uVel; attribute float aEnd; varying float vA;
      ${wrapChunk}
      void main(){
        vec3 p = position + uVel * uTime;
        p = wrapBox(p, uCam + vec3(0.0, uSize.y * 0.3, 0.0), uSize);
        p -= normalize(uVel) * aEnd * 0.55;
        vA = 1.0 - aEnd * 0.8;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; varying float vA;
      void main(){ gl_FragColor = vec4(uColor, uOpacity * vA);
        #include <fog_fragment>
      }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  lines.userData.update = (dt, t, cam) => { mat.uniforms.uTime.value = t; mat.uniforms.uCam.value.copy(cam.position); };
  return lines;
}

/** Ground splashes: tiny expanding rings flashing at random spots near the camera. */
export function createSplashes({ count = 600, area = 30, color = 0xb8cde0, groundY = 0.02 } = {}) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([(Math.random() - 0.5) * area, groundY, (Math.random() - 0.5) * area], i * 3); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uArea: { value: area }, uColor: { value: new THREE.Color(color) }, uScale: { value: innerHeight / 2 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uArea, uScale; uniform vec3 uCam; attribute float aSeed; varying float vLife;
      void main(){
        float cycle = fract(uTime * (1.4 + aSeed) + aSeed * 13.0);
        vLife = cycle;
        vec3 p = position;
        p.xz = uCam.xz + mod(p.xz + floor(uTime * (1.4 + aSeed) + aSeed * 13.0) * vec2(7.13, 3.71) - uCam.xz + uArea * 0.5, uArea) - uArea * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.0 + cycle * 5.0) * uScale / -mv.z * 0.05;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vLife;
      void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
        float ring = smoothstep(0.5, 0.38, d) * smoothstep(0.2, 0.36, d);
        gl_FragColor = vec4(uColor, ring * (1.0 - vLife) * 0.28); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.userData.update = (dt, t, cam) => { mat.uniforms.uTime.value = t; mat.uniforms.uCam.value.copy(cam.position); };
  return pts;
}

/** Snow / dust: soft sprite points drifting with wind and swirl. */
export function createDrift({ count = 3000, area = 46, height = 18, color = 0xffffff, size = 0.12, wind = [3, -1.2, 1], swirl = 0.8, opacity = 0.85, additive = false } = {}) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pos.set([(Math.random() - 0.5) * area, Math.random() * height, (Math.random() - 0.5) * area], i * 3); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector3(area, height, area) },
      uWind: { value: new THREE.Vector3(...wind) }, uSwirl: { value: swirl }, uColor: { value: new THREE.Color(color) },
      uPt: { value: size }, uScale: { value: innerHeight / 2 }, uOpacity: { value: opacity }, uMap: { value: radialTexture('soft') },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime, uSwirl, uPt, uScale; uniform vec3 uCam, uSize, uWind; attribute float aSeed; varying float vA;
      ${wrapChunk}
      void main(){
        vec3 p = position + uWind * uTime * (0.6 + aSeed * 0.8);
        p.x += sin(uTime * (0.6 + aSeed) + aSeed * 40.0) * uSwirl;
        p.z += cos(uTime * (0.5 + aSeed) + aSeed * 23.0) * uSwirl;
        p = wrapBox(p, uCam + vec3(0.0, uSize.y * 0.25, 0.0), uSize);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uPt * (0.5 + aSeed) * uScale / -mvPosition.z;
        vA = smoothstep(0.5, 2.5, -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap; varying float vA;
      void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * uOpacity * vA);
        #include <fog_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  pts.userData.update = (dt, t, cam) => { mat.uniforms.uTime.value = t; mat.uniforms.uCam.value.copy(cam.position); mat.uniforms.uScale.value = innerHeight / 2; };
  return pts;
}

/** Drifting smoke volume made of rotating soft sprites. */
export function createSmoke({ count = 40, center = [0, 0, 0], spread = [10, 2, 10], color = 0x8a8f96, size = 6, rise = 0.25, opacity = 0.18, wind = [0.3, 0, 0.1] } = {}) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([center[0] + (Math.random() - 0.5) * spread[0], center[1] + Math.random() * spread[1], center[2] + (Math.random() - 0.5) * spread[2]], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uScale: { value: innerHeight / 2 },
      uRise: { value: rise }, uOpacity: { value: opacity }, uWind: { value: new THREE.Vector3(...wind) }, uMap: { value: radialTexture('smoke') },
      uSpread: { value: new THREE.Vector3(...spread) },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime, uSize, uScale, uRise; uniform vec3 uWind, uSpread; attribute float aSeed; varying float vRot; varying float vA;
      void main(){
        float life = fract(uTime * 0.03 * (0.6 + aSeed) + aSeed);
        vec3 p = position + uWind * life * 20.0 + vec3(0.0, life * uRise * 20.0, 0.0);
        vRot = aSeed * 6.28 + uTime * 0.05 * (aSeed - 0.5);
        vA = sin(life * 3.14159);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize * (0.7 + life * 0.8) * uScale / -mvPosition.z;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap; varying float vRot; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float s = sin(vRot), co = cos(vRot);
        vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
        float a = texture2D(uMap, uv).a;
        gl_FragColor = vec4(uColor, a * uOpacity * vA);
        #include <fog_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  pts.userData.update = (dt, t) => { mat.uniforms.uTime.value = t; mat.uniforms.uScale.value = innerHeight / 2; };
  return pts;
}

/** Volumetric light shaft (additive, soft-edged, slowly shimmering). */
export function createLightShaft({ width = 3, depth = 3, length = 14, color = 0xffd9a0, intensity = 0.22 } = {}) {
  const geo = new THREE.BoxGeometry(width, length, depth, 1, 1, 1);
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uInt: { value: intensity }, uTime: { value: 0 }, uLen: { value: length } },
    vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vView;
      void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uInt, uTime, uLen; varying vec3 vP; varying vec3 vN; varying vec3 vView;
      void main(){
        float h = clamp(-vP.y / uLen, 0.0, 1.0);
        float fall = smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.55, 1.0, h));
        float edge = pow(abs(dot(vN, vView)), 1.5);
        float shimmer = 0.85 + 0.15 * sin(uTime * 0.7 + vP.x * 2.0 + vP.z * 1.3);
        gl_FragColor = vec4(uColor * uInt * fall * edge * shimmer, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  m.userData.update = (dt, t) => { mat.uniforms.uTime.value = t; };
  return m;
}

/** Additive light pool decal on the ground — fakes local light cheaply. */
const poolMats = new Map();
export function createLightPool(color, radius = 4, intensity = 0.5) {
  const key = `${color}-${intensity}`;
  const mat = poolMats.get(key) || new THREE.MeshBasicMaterial({ map: radialTexture('soft'), color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });
  mat.userData.key = `pool-${key}`;
  poolMats.set(key, mat);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Light cone for lamps in rain/fog. */
const coneMats = new Map();
export function createLightCone(color, height = 5, radius = 2.2, intensity = 0.12) {
  const geo = new THREE.ConeGeometry(radius, height, 24, 1, true);
  geo.translate(0, -height / 2, 0);
  const ck = `${color}-${height}-${intensity}`;
  const mat = coneMats.get(ck) || new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uInt: { value: intensity }, uH: { value: height } },
    vertexShader: /* glsl */ `varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ vH = -position.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uInt, uH; varying float vH; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - clamp(vH / uH, 0.0, 1.0); float e = pow(abs(dot(vN, vV)), 2.0);
        gl_FragColor = vec4(uColor * uInt * f * e, 1.0); }`,
  });
  mat.userData.key = `cone-${ck}`;
  coneMats.set(ck, mat);
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 3;
  return m;
}

/** Gradient sky dome. */
export function createSkyDome({ top = 0x05070b, mid = 0x10151d, horizon = 0x2a2420, radius = 400, glow = 0x000000, glowDir = [0, 0.1, -1] } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uMid: { value: new THREE.Color(mid) }, uHor: { value: new THREE.Color(horizon) }, uGlow: { value: new THREE.Color(glow) }, uGlowDir: { value: new THREE.Vector3(...glowDir).normalize() } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop, uMid, uHor, uGlow, uGlowDir; varying vec3 vDir;
      void main(){ float h = vDir.y;
        vec3 c = mix(uHor, uMid, smoothstep(-0.02, 0.18, h));
        c = mix(c, uTop, smoothstep(0.18, 0.7, h));
        c += uGlow * pow(max(dot(vDir, uGlowDir), 0.0), 8.0);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
