import * as THREE from 'three';

// Procedural, tileable PBR texture sets generated on a canvas at load time.
// Every set yields albedo + normal + roughness so surfaces respond to light properly.

const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Tileable value noise with integer period. */
function makeNoise(seed, period) {
  const r = rng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Fractal noise sampled in [0,1)² tile space. */
function makeFbm(seed, base = 4, octaves = 5) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise(seed + o * 101, base << o));
  return (u, v) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = base << o;
      sum += layers[o](u * p, v * p) * amp; norm += amp; amp *= 0.5;
    }
    return sum / norm;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Generate a texture set. fn(u, v, out) fills out.r/g/b (0..1), out.h (height 0..1), out.ro (roughness 0..1), out.m (metal 0..1).
 */
function generate(key, size, fn, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const albedo = canvas(size), normal = canvas(size), rough = canvas(size);
  const ca = albedo.getContext('2d'), cn = normal.getContext('2d'), cr = rough.getContext('2d');
  const ia = ca.createImageData(size, size), inn = cn.createImageData(size, size), ir = cr.createImageData(size, size);
  const H = new Float32Array(size * size);
  const out = { r: 0, g: 0, b: 0, h: 0, ro: 0.8, m: 0, a: 1 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.a = 1; out.m = 0;
      fn(x / size, y / size, out);
      const i = (y * size + x) * 4;
      ia.data[i] = Math.max(0, Math.min(255, out.r * 255));
      ia.data[i + 1] = Math.max(0, Math.min(255, out.g * 255));
      ia.data[i + 2] = Math.max(0, Math.min(255, out.b * 255));
      ia.data[i + 3] = out.a * 255;
      ir.data[i] = 255; ir.data[i + 1] = out.ro * 255; ir.data[i + 2] = out.m * 255; ir.data[i + 3] = 255;
      H[y * size + x] = out.h;
    }
  }
  const strength = opts.normalStrength ?? 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hx = H[y * size + ((x + 1) % size)] - H[y * size + ((x - 1 + size) % size)];
      const hy = H[((y + 1) % size) * size + x] - H[((y - 1 + size) % size) * size + x];
      let nx = -hx * strength * size / 256, ny = hy * strength * size / 256, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      inn.data[i] = (nx * 0.5 + 0.5) * 255; inn.data[i + 1] = (ny * 0.5 + 0.5) * 255; inn.data[i + 2] = (nz * 0.5 + 0.5) * 255; inn.data[i + 3] = 255;
    }
  }
  ca.putImageData(ia, 0, 0); cn.putImageData(inn, 0, 0); cr.putImageData(ir, 0, 0);
  const set = { map: toTex(albedo, true), normalMap: toTex(normal, false), roughnessMap: toTex(rough, false), metalnessMap: null };
  set.roughnessMap.userData.hasMetal = true;
  cache.set(key, set);
  return set;
}

const mix = (a, b, t) => a + (b - a) * t;
const sat = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

let SIZE = 512;
export function setTextureSize(s) { SIZE = s; }

export const TEX = {
  concrete(tint = [0.52, 0.51, 0.49], seed = 1) {
    const f = makeFbm(seed, 4, 6), f2 = makeFbm(seed + 9, 16, 3), pits = makeNoise(seed + 3, 128);
    return generate(`concrete-${tint}-${seed}`, SIZE, (u, v, o) => {
      const n = f(u, v), d = f2(u, v), p = pits(u * 128, v * 128);
      const stain = smooth(0.55, 0.75, n);
      const k = 0.82 + (n - 0.5) * 0.35 + (d - 0.5) * 0.12 - stain * 0.18 - (p > 0.93 ? 0.2 : 0);
      o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
      o.h = n * 0.5 + d * 0.3 - (p > 0.93 ? 0.4 : 0);
      o.ro = 0.86 + d * 0.1 - stain * 0.1;
    }, { normalStrength: 2.2 });
  },

  asphalt(wet = 1, seed = 2) {
    const f = makeFbm(seed, 3, 5), grit = makeNoise(seed + 5, 256), g2 = makeNoise(seed + 6, 128);
    return generate(`asphalt-${wet}-${seed}`, SIZE, (u, v, o) => {
      const n = f(u, v), gr = grit(u * 256, v * 256), g = g2(u * 128, v * 128);
      const puddle = wet ? smooth(0.52, 0.6, n) : 0;
      let k = 0.16 + gr * 0.08 + g * 0.05 + (gr > 0.86 ? 0.08 : 0);
      k *= 1 - puddle * 0.45;
      o.r = k * 0.98; o.g = k; o.b = k * 1.04;
      o.h = (gr * 0.4 + g * 0.3) * (1 - puddle);
      o.ro = mix(wet ? 0.5 : 0.88, 0.06, puddle) + gr * 0.08 * (1 - puddle);
    }, { normalStrength: 0.9 });
  },

  brick(seed = 3, tint = [0.42, 0.2, 0.15]) {
    const f = makeFbm(seed, 8, 4), r = rng(seed);
    const rows = 16, cols = 8, colorTable = [];
    for (let i = 0; i < rows * cols * 2; i++) colorTable.push(0.75 + r() * 0.4);
    return generate(`brick-${seed}-${tint}`, SIZE, (u, v, o) => {
      const row = Math.floor(v * rows);
      const off = row % 2 ? 0.5 / cols : 0;
      const cu = ((u + off) * cols) % cols, cv = v * rows;
      const bu = cu - Math.floor(cu), bv = cv - Math.floor(cv);
      const mortar = bu < 0.06 || bv < 0.12;
      const id = row * cols + Math.floor(cu);
      const n = f(u, v);
      if (mortar) { const m = 0.38 + n * 0.1; o.r = m; o.g = m * 0.97; o.b = m * 0.92; o.h = 0; o.ro = 0.95; }
      else {
        const c = colorTable[id % colorTable.length] * (0.85 + n * 0.3);
        o.r = tint[0] * c; o.g = tint[1] * c; o.b = tint[2] * c;
        o.h = 0.6 + n * 0.3; o.ro = 0.82 + n * 0.1;
      }
    }, { normalStrength: 2.6 });
  },

  metal(tint = [0.3, 0.31, 0.33], seed = 4, wear = 0.5) {
    const f = makeFbm(seed, 4, 5), scratch = makeNoise(seed + 2, 64);
    return generate(`metal-${tint}-${seed}-${wear}`, SIZE, (u, v, o) => {
      const n = f(u, v), s = scratch(u * 512, v * 8);
      const worn = smooth(0.62 - wear * 0.15, 0.75, n);
      const k = 0.9 + (n - 0.5) * 0.25;
      o.r = mix(tint[0] * k, 0.55, worn); o.g = mix(tint[1] * k, 0.55, worn); o.b = mix(tint[2] * k, 0.56, worn);
      o.h = n * 0.3 + (s > 0.9 ? 0.15 : 0);
      o.ro = mix(0.55, 0.32, worn) + (s > 0.9 ? -0.15 : 0) + n * 0.1;
      o.m = mix(0.35, 0.95, worn);
    }, { normalStrength: 1.2 });
  },

  corrugated(tint = [0.5, 0.3, 0.2], seed = 5) {
    const f = makeFbm(seed, 4, 5), rust = makeFbm(seed + 1, 8, 4);
    return generate(`corr-${tint}-${seed}`, SIZE, (u, v, o) => {
      const wave = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5;
      const n = f(u, v), r = rust(u, v);
      const rusty = smooth(0.58, 0.72, r * 0.7 + (1 - v) * 0.2 + n * 0.15);
      const k = 0.8 + wave * 0.25 + (n - 0.5) * 0.2;
      o.r = mix(tint[0] * k, 0.36, rusty); o.g = mix(tint[1] * k, 0.19, rusty); o.b = mix(tint[2] * k, 0.1, rusty);
      o.h = wave * 0.8 + n * 0.1;
      o.ro = mix(0.55, 0.9, rusty); o.m = mix(0.5, 0.2, rusty);
    }, { normalStrength: 2.5 });
  },

  sand(seed = 6) {
    const f = makeFbm(seed, 3, 5), grain = makeNoise(seed + 4, 256), rip = makeFbm(seed + 2, 6, 3);
    return generate(`sand-${seed}`, SIZE, (u, v, o) => {
      const n = f(u, v), g = grain(u * 256, v * 256), r = rip(u, v);
      const ripple = Math.sin((v * 22 + r * 3.5) * Math.PI * 2) * 0.5 + 0.5;
      const k = 0.85 + (n - 0.5) * 0.3 + (g - 0.5) * 0.12;
      o.r = 0.78 * k; o.g = 0.62 * k; o.b = 0.44 * k;
      o.h = ripple * 0.35 + n * 0.4 + g * 0.1;
      o.ro = 0.92 + g * 0.06;
    }, { normalStrength: 2.2 });
  },

  snow(seed = 7) {
    const f = makeFbm(seed, 3, 6), sp = makeNoise(seed + 8, 256);
    return generate(`snow-${seed}`, SIZE, (u, v, o) => {
      const n = f(u, v), s = sp(u * 256, v * 256);
      const k = 0.88 + (n - 0.5) * 0.12;
      o.r = 0.86 * k; o.g = 0.9 * k; o.b = 0.97 * k;
      o.h = n * 0.8;
      o.ro = s > 0.96 ? 0.25 : 0.82 + n * 0.1;
    }, { normalStrength: 1.6 });
  },

  wood(seed = 8, tint = [0.45, 0.33, 0.21]) {
    const f = makeFbm(seed, 2, 4), g = makeNoise(seed + 1, 32);
    return generate(`wood-${seed}-${tint}`, SIZE, (u, v, o) => {
      const plank = Math.floor(v * 6);
      const pv = v * 6 - plank;
      const grain = Math.sin((u * 40 + f(u, v + plank * 0.17) * 8) * Math.PI) * 0.5 + 0.5;
      const gap = pv < 0.04 ? 1 : 0;
      const k = (0.75 + grain * 0.2 + (g(u * 32, plank * 3) - 0.5) * 0.25) * (gap ? 0.35 : 1);
      o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
      o.h = gap ? 0 : 0.5 + grain * 0.2; o.ro = 0.78 + grain * 0.12;
    }, { normalStrength: 2 });
  },

  rock(seed = 9, tint = [0.55, 0.47, 0.38]) {
    const f = makeFbm(seed, 4, 6), c = makeFbm(seed + 3, 16, 3);
    return generate(`rock-${seed}-${tint}`, SIZE, (u, v, o) => {
      const n = f(u, v), d = c(u, v);
      const k = 0.7 + n * 0.45 + (d - 0.5) * 0.2;
      o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
      o.h = n * 0.7 + d * 0.3; o.ro = 0.9;
    }, { normalStrength: 3.2 });
  },

  fabric(seed = 10, tint = [0.5, 0.5, 0.5]) {
    const f = makeFbm(seed, 4, 3);
    return generate(`fabric-${seed}-${tint}`, 256, (u, v, o) => {
      const wx = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5, wy = Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5;
      const weave = (Math.floor(u * 64) + Math.floor(v * 64)) % 2 ? wx : wy;
      const n = f(u, v);
      const k = 0.85 + weave * 0.15 + (n - 0.5) * 0.15;
      o.r = tint[0] * k; o.g = tint[1] * k; o.b = tint[2] * k;
      o.h = weave * 0.6 + n * 0.2; o.ro = 0.92;
    }, { normalStrength: 1.6 });
  },

  molle(seed = 15) {
    const f = makeFbm(seed, 6, 3);
    return generate(`molle-${seed}`, 256, (u, v, o) => {
      const band = (v * 10) % 1;
      const web = band > 0.55 && band < 0.92;
      const stitch = web && ((u * 40) % 1) < 0.08;
      const weave = Math.sin(u * Math.PI * 2 * 90) * 0.5 + 0.5;
      const n = f(u, v);
      const k = (web ? 0.95 : 0.82) + weave * 0.06 + (n - 0.5) * 0.12 - (stitch ? 0.25 : 0);
      o.r = o.g = o.b = k;
      o.h = (web ? 0.7 : 0.3) + weave * 0.1 - (stitch ? 0.3 : 0); o.ro = 0.9;
    }, { normalStrength: 2.2 });
  },

  grip(seed = 11) {
    const g = makeNoise(seed, 64);
    return generate(`grip-${seed}`, 256, (u, v, o) => {
      const s = g(u * 64, v * 64);
      const dots = s > 0.55 ? 1 : 0;
      o.r = o.g = o.b = 0.5; o.h = dots * 0.6 + s * 0.2; o.ro = 0.7 + dots * 0.2;
    }, { normalStrength: 2.4 });
  },

  tread(seed = 12) {
    const f = makeFbm(seed, 4, 4);
    return generate(`tread-${seed}`, SIZE, (u, v, o) => {
      const cu = (u * 24) % 1, cv = (v * 24) % 1;
      const row = Math.floor(v * 24) % 2;
      const a = row ? cu - cv : cu + cv - 1;
      const diamond = Math.abs(a) < 0.12 && cu > 0.15 && cu < 0.85 ? 1 : 0;
      const n = f(u, v);
      const worn = diamond * 0.3;
      const k = 0.36 + n * 0.14 + worn;
      o.r = k; o.g = k * 0.98; o.b = k * 0.95;
      o.h = diamond * 0.8; o.ro = 0.6 - worn + n * 0.2; o.m = 0.8;
    }, { normalStrength: 2.5 });
  },

  grate() {
    const key = 'grate';
    if (cache.has(key)) return cache.get(key);
    const c = canvas(256), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 16; i++) { ctx.fillRect(i * 16, 0, 4, 256); }
    for (let i = 0; i < 8; i++) { ctx.fillRect(0, i * 32, 256, 3); }
    const alpha = toTex(c, false);
    const set = { alphaMap: alpha };
    cache.set(key, set);
    return set;
  },

  ice(seed = 13) {
    const f = makeFbm(seed, 3, 5), cr = makeFbm(seed + 1, 12, 2);
    return generate(`ice-${seed}`, SIZE, (u, v, o) => {
      const n = f(u, v), c = cr(u, v);
      const crack = Math.abs(c - 0.5) < 0.015 ? 1 : 0;
      o.r = 0.62 + n * 0.15 + crack * 0.2; o.g = 0.78 + n * 0.12 + crack * 0.15; o.b = 0.9 + n * 0.08;
      o.h = n * 0.3 - crack * 0.4; o.ro = 0.08 + n * 0.12 + crack * 0.4;
    }, { normalStrength: 1.4 });
  },

  hazard(seed = 14) {
    const f = makeFbm(seed, 8, 4);
    return generate(`hazard-${seed}`, 256, (u, v, o) => {
      const s = ((u + v) * 8) % 1 < 0.5;
      const n = f(u, v);
      const worn = smooth(0.62, 0.75, n);
      const base = s ? [0.85, 0.6, 0.15] : [0.08, 0.08, 0.08];
      o.r = mix(base[0], 0.35, worn); o.g = mix(base[1], 0.34, worn); o.b = mix(base[2], 0.32, worn);
      o.h = n * 0.2; o.ro = 0.6 + worn * 0.3;
    }, { normalStrength: 1 });
  },
};

/** Facade window texture: emissive lit windows for night buildings. */
export function windowTexture(seed, litRatio = 0.35, warm = true) {
  const key = `win-${seed}-${litRatio}-${warm}`;
  if (cache.has(key)) return cache.get(key);
  const r = rng(seed);
  const c = canvas(256), ctx = c.getContext('2d');
  const e = canvas(256), ex = e.getContext('2d');
  ctx.fillStyle = '#111215'; ctx.fillRect(0, 0, 256, 256);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, 256, 256);
  const cols = 4, rows = 4;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = x * 64 + 10, py = y * 64 + 12, w = 44, h = 38;
    ctx.fillStyle = '#1b1e23'; ctx.fillRect(px, py, w, h);
    ctx.fillStyle = '#2a2e35'; ctx.fillRect(px, py + h - 3, w, 3);
    if (r() < litRatio) {
      const hue = warm ? (r() < 0.7 ? [255, 190, 120] : [190, 215, 255]) : [200, 225, 255];
      const k = 0.35 + r() * 0.65;
      ex.fillStyle = `rgb(${hue[0] * k | 0},${hue[1] * k | 0},${hue[2] * k | 0})`;
      ex.fillRect(px, py, w, h);
      if (r() < 0.5) { ex.fillStyle = 'rgba(0,0,0,0.6)'; ex.fillRect(px + w * r(), py, 4 + r() * 10, h); }
      ctx.fillStyle = '#3a3d42'; ctx.fillRect(px, py, w, h);
    }
  }
  const set = { map: toTex(c, true), emissiveMap: toTex(e, true) };
  cache.set(key, set);
  return set;
}

/** Text panel (neon signs, markings). Returns a texture drawn with glow. */
export function textTexture(text, color = '#e8a33d', opts = {}) {
  const key = `txt-${text}-${color}-${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(1);
  const ctx = c.getContext('2d');
  const font = `${opts.weight || 700} ${opts.size || 96}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + 80), h = (opts.size || 96) + 60;
  c.width = w; c.height = h;
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, w, h); }
  ctx.shadowColor = color; ctx.shadowBlur = opts.glow ?? 24;
  ctx.fillStyle = opts.fill || color;
  ctx.fillText(text, w / 2, h / 2 + 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = opts.core || '#fff8ec';
  ctx.globalAlpha = opts.coreAlpha ?? 0.55;
  ctx.fillText(text, w / 2, h / 2 + 4);
  const t = toTex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.userData.aspect = w / h;
  cache.set(key, t);
  return t;
}

/** Soft radial sprite (smoke, glow, flash). */
export function radialTexture(kind = 'soft') {
  const key = `rad-${kind}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(128), ctx = c.getContext('2d');
  if (kind === 'smoke') {
    const f = makeFbm(77, 4, 5);
    const img = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const dx = x / 64 - 1, dy = y / 64 - 1, d = Math.sqrt(dx * dx + dy * dy);
      const a = sat(1 - d) ** 1.6 * (0.45 + f(x / 128, y / 128) * 0.9);
      const i = (y * 128 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = sat(a) * 255;
    }
    ctx.putImageData(img, 0, 0);
  } else if (kind === 'flash') {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.2, 'rgba(255,210,140,0.9)'); g.addColorStop(0.5, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(64, 64);
    for (let i = 0; i < 5; i++) { ctx.rotate((Math.PI * 2) / 5 + 0.3); const gg = ctx.createLinearGradient(0, 0, 60, 0); gg.addColorStop(0, 'rgba(255,230,180,0.8)'); gg.addColorStop(1, 'rgba(255,160,60,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(62, 0); ctx.lineTo(0, 5); ctx.fill(); }
  } else {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  const t = toTex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

/** Bullet-hole decal texture. */
export function decalTexture() {
  const key = 'decal-hole';
  if (cache.has(key)) return cache.get(key);
  const c = canvas(64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(5,5,5,1)'); g.addColorStop(0.18, 'rgba(10,10,10,0.95)'); g.addColorStop(0.3, 'rgba(40,38,35,0.6)'); g.addColorStop(1, 'rgba(60,55,50,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = toTex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

/** Pattern textures for weapon skins. */
export function skinPattern(kind, accentHex) {
  const key = `skin-${kind}-${accentHex}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(256), ctx = c.getContext('2d');
  const acc = `#${accentHex.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
  if (kind === 'carbon') {
    for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) {
      const odd = ((x + y) / 16) % 2;
      const g = ctx.createLinearGradient(x, y, odd ? x + 16 : x, odd ? y : y + 16);
      g.addColorStop(0, '#9a9a9a'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#9a9a9a');
      ctx.fillStyle = g; ctx.fillRect(x, y, 16, 16);
    }
  } else if (kind === 'splinter') {
    const r = rng(42);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = ['#c9c9c9', '#8d8d8d', '#e6e6e6'][i % 3];
      ctx.beginPath(); const x = r() * 256, y = r() * 256;
      ctx.moveTo(x, y); ctx.lineTo(x + 40 + r() * 60, y + (r() - 0.5) * 30); ctx.lineTo(x + 20 + r() * 30, y + 20 + r() * 30); ctx.fill();
    }
  } else if (kind === 'brushed') {
    for (let y = 0; y < 256; y++) { const k = 220 + Math.random() * 35; ctx.fillStyle = `rgb(${k},${k},${k})`; ctx.fillRect(0, y, 256, 1); }
  } else if (kind === 'stripe' || kind === 'gilded') {
    ctx.fillStyle = acc;
    ctx.fillRect(0, 118, 256, kind === 'gilded' ? 20 : 8);
    if (kind === 'gilded') { ctx.fillRect(0, 20, 256, 3); ctx.fillRect(0, 230, 256, 3); }
  }
  const t = toTex(c, true);
  cache.set(key, t);
  return t;
}
