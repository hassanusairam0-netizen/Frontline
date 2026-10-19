import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';

// Shared material library. Texture UVs are authored in metres (see boxGeo), so a
// material's `repeat` is "tiles per metre" and merged geometry tiles consistently.

const mats = new Map();

function pbr(key, set, params = {}, metresPerTile = 2) {
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap,
    metalnessMap: params.metalness !== undefined && params.useMetalMap ? set.roughnessMap : null,
    roughness: 1, metalness: params.metalness ?? 0, color: params.color ?? 0xffffff,
    envMapIntensity: params.envMapIntensity ?? 1,
  });
  if (params.normalScale) m.normalScale.set(params.normalScale, params.normalScale);
  const rep = 1 / metresPerTile;
  for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) { t.repeat.set(rep, rep); }
  m.userData.key = key;
  mats.set(key, m);
  return m;
}

export function plain(key, params) {
  if (mats.has(key)) return mats.get(key);
  const m = params.physical ? new THREE.MeshPhysicalMaterial(params.props) : new THREE.MeshStandardMaterial(params.props);
  m.userData.key = key;
  mats.set(key, m);
  return m;
}

export const MAT = {
  concrete: (tint, seed) => pbr(`concrete-${tint}-${seed}`, TEX.concrete(tint, seed), {}, 3),
  concreteDark: () => pbr('concreteDark', TEX.concrete([0.34, 0.34, 0.34], 21), {}, 3),
  asphaltWet: () => pbr('asphaltWet', TEX.asphalt(1), { envMapIntensity: 1.6 }, 4),
  asphaltDry: () => pbr('asphaltDry', TEX.asphalt(0, 31), {}, 4),
  sidewalk: () => pbr('sidewalk', TEX.concrete([0.42, 0.42, 0.43], 5), { envMapIntensity: 1.3 }, 2),
  brick: (seed = 3, tint) => pbr(`brick-${seed}-${tint}`, TEX.brick(seed, tint), {}, 3),
  metal: (tint = [0.3, 0.31, 0.33], seed = 4, wear = 0.5) => pbr(`metal-${tint}-${seed}-${wear}`, TEX.metal(tint, seed, wear), { metalness: 1, useMetalMap: true }, 2),
  corrugated: (tint, seed) => pbr(`corr-${tint}-${seed}`, TEX.corrugated(tint, seed), { metalness: 1, useMetalMap: true }, 2.5),
  sand: () => pbr('sand', TEX.sand(), {}, 4),
  snow: () => pbr('snow', TEX.snow(), { envMapIntensity: 0.6 }, 4),
  wood: (tint) => pbr(`wood-${tint}`, TEX.wood(8, tint), {}, 1.4),
  rock: (tint, seed = 9) => pbr(`rock-${tint}-${seed}`, TEX.rock(seed, tint), {}, 3),
  tread: () => pbr('tread', TEX.tread(), { metalness: 1, useMetalMap: true }, 1.5),
  ice: () => pbr('ice', TEX.ice(), { envMapIntensity: 1.8, color: 0xd8ecff }, 3),
  hazard: () => pbr('hazard', TEX.hazard(), {}, 1),
  rubber: () => plain('rubber', { props: { color: 0x141414, roughness: 0.92, metalness: 0 } }),
  glass: () => plain('glass', { physical: true, props: { color: 0x1a2430, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, envMapIntensity: 2, clearcoat: 1 } }),
  chrome: () => plain('chrome', { props: { color: 0xcfd4da, roughness: 0.18, metalness: 1 } }),
  darkMetal: () => plain('darkMetal', { props: { color: 0x1c1d20, roughness: 0.45, metalness: 0.9 } }),
  paint: (hex, rough = 0.5) => plain(`paint-${hex}-${rough}`, { props: { color: hex, roughness: rough, metalness: 0.2 } }),
  emissive: (hex, intensity = 3) => plain(`emi-${hex}-${intensity}`, { props: { color: 0x000000, emissive: hex, emissiveIntensity: intensity, roughness: 1 } }),
  sandbag: () => pbr('sandbag', TEX.fabric(31, [0.62, 0.53, 0.38]), {}, 0.6),
};

/** Box with UVs scaled to metres on every face. */
export function boxGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const idx = f * 4 + i;
    uv.setXY(idx, uv.getX(idx) * dims[f][0], uv.getY(idx) * dims[f][1]);
  }
  return g;
}

/** Scale any geometry's uv attribute. */
export function scaleUV(g, su, sv = su) {
  const uv = g.attributes.uv; if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/**
 * Static batcher: collects geometries per material in world space and merges them
 * into a handful of meshes. Massive draw-call savings for map props.
 */
export class Batcher {
  constructor() { this.groups = new Map(); }
  add(geo, mat, matrix, { cast = true, receive = true } = {}) {
    const key = `${mat.uuid}|${cast}|${receive}`;
    if (!this.groups.has(key)) this.groups.set(key, { mat, cast, receive, geos: [] });
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    this.groups.get(key).geos.push(g);
  }
  /** Add a whole object tree (meshes only) using their world matrices. */
  addObject(obj, opts) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if (o.isMesh && !o.userData.noBatch) this.add(o.geometry, o.material, o.matrixWorld, { cast: o.castShadow, receive: o.receiveShadow, ...opts }); });
  }
  build(parent) {
    for (const { mat, cast, receive, geos } of this.groups.values()) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      mesh.userData.batched = true;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}
