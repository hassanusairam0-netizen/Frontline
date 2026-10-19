import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MAT, boxGeo, scaleUV } from '../engine/materials.js';
import { windowTexture, textTexture, TEX } from '../engine/textures.js';
import { createLightPool, createLightCone } from './atmosphere.js';

// Visual builders for every layout object kind. Static meshes go into the batcher;
// emissive/animated pieces and light requests go into ctx.group / ctx.lights.

function rand(seed) { let s = (seed * 9301 + 49297) % 233280; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

class P {
  constructor(ctx, o) { this.ctx = ctx; this.o = o; this.g = new THREE.Group(); }
  m(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const me = new THREE.Mesh(geo, mat);
    me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.scale.set(sx, sy, sz);
    me.castShadow = true; me.receiveShadow = true;
    this.g.add(me); return me;
  }
  box(w, h, d, mat, x, y, z, ry = 0) { return this.m(boxGeo(w, h, d), mat, x, y + h / 2, z, 0, ry); }
  rb(w, h, d, r, mat, x, y, z, rx = 0, ry = 0, rz = 0) { return this.m(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)), mat, x, y, z, rx, ry, rz); }
  cyl(r1, r2, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 18) { return this.m(scaleUV(new THREE.CylinderGeometry(r1, r2, h, seg), Math.PI * 2 * r1, h), mat, x, y, z, rx, ry, rz); }
  /** Commit static meshes at the object's transform. rot rotates around Y. */
  commit(rot = 0, x = this.o.x, y = this.o.y || 0, z = this.o.z) {
    this.g.position.set(x, y, z); this.g.rotation.y = rot;
    this.ctx.B.addObject(this.g);
  }
  /** Long axis: build along X with length L, rotate if the object runs along Z. */
  get along() { const o = this.o; return o.w >= o.d ? { L: o.w, W: o.d, rot: 0 } : { L: o.d, W: o.w, rot: Math.PI / 2 }; }
  dyn(obj) { this.ctx.group.add(obj); return obj; }
}

const PAINT = {
  dark: () => MAT.paint(0x22252a, 0.55),
  frame: () => MAT.paint(0x2c2f34, 0.4),
};

export const PROPS = {
  building(ctx, o) {
    const p = new P(ctx, o), r = rand(o.seed || 1);
    const night = ctx.night;
    const wall = o.style === 'brick' ? MAT.brick(3 + (o.seed % 3), [0.36 + r() * 0.12, 0.18 + r() * 0.05, 0.13]) : MAT.concrete([0.42, 0.42, 0.43], 30 + (o.seed % 4));
    p.box(o.w, o.h, o.d, wall, 0, 0, 0);
    // floor ledges + parapet
    const ledge = MAT.concrete([0.5, 0.49, 0.47], 11);
    for (let y = 4; y < o.h - 1; y += 3.2) p.box(o.w + 0.24, 0.16, o.d + 0.24, ledge, 0, y, 0);
    p.box(o.w + 0.3, 0.6, o.d + 0.3, ledge, 0, o.h, 0);
    // rooftop clutter
    const metal = MAT.metal([0.45, 0.46, 0.47], 4, 0.7);
    p.box(2.2, 1.4, 1.6, metal, -o.w * 0.25, o.h + 0.6, o.d * 0.1);
    p.cyl(1.0, 1.0, 2.4, MAT.wood([0.3, 0.24, 0.18]), o.w * 0.25, o.h + 1.9, -o.d * 0.15);
    for (let i = 0; i < 4; i++) p.cyl(0.06, 0.06, 1.4, metal, o.w * 0.25 + (i % 2 - 0.5) * 1.3, o.h + 0.7, -o.d * 0.15 + (i > 1 ? 0.65 : -0.65));
    // facades
    for (const f of o.facades || []) {
      const alongX = f === '+z' || f === '-z';
      const fw = alongX ? o.w : o.d, s = f[0] === '+' ? 1 : -1;
      const nx = alongX ? 0 : s, nz = alongX ? s : 0;
      const off = (alongX ? o.d : o.w) / 2;
      const ry = alongX ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
      const fx = nx * (off + 0.02), fz = nz * (off + 0.02);
      // window band (emissive at night), per-facade material because repeats differ
      const wt = windowTexture(o.seed * 7 + fw, night ? 0.35 : 0.05, true);
      const upperH = o.h - 4.6;
      if (upperH > 2) {
        const map = wt.map.clone(); map.needsUpdate = true; map.repeat.set(Math.round(fw / 2.6) / 4, Math.round(upperH / 3.2) / 4);
        const emap = wt.emissiveMap.clone(); emap.needsUpdate = true; emap.repeat.copy(map.repeat);
        const wm = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: night ? 0xffffff : 0x000000, emissiveIntensity: night ? 0.85 : 0, roughness: 0.25, metalness: 0.4, envMapIntensity: 1.5 });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(fw - 0.6, upperH), wm);
        plane.position.set(o.x + fx * 1.01, (o.y || 0) + 4.4 + upperH / 2, o.z + fz * 1.01); plane.rotation.y = ry;
        plane.receiveShadow = true;
        p.dyn(plane);
      }
      // storefront at street level
      if (o.solid !== false) {
        const sf = new THREE.Group();
        const glass = MAT.glass();
        const frame = PAINT.frame();
        const n = Math.max(1, Math.floor(fw / 4.2));
        for (let i = 0; i < n; i++) {
          const cx = -fw / 2 + (i + 0.5) * (fw / n);
          const sw = fw / n - 0.7;
          const shut = r() < 0.4;
          const gm = new THREE.Mesh(new THREE.PlaneGeometry(sw, 2.6), shut ? MAT.corrugated([0.35, 0.36, 0.37], 70 + i) : glass);
          gm.position.set(cx, 1.5, 0.05); sf.add(gm);
          const fr = new THREE.Mesh(boxGeo(sw + 0.16, 0.14, 0.16), frame); fr.position.set(cx, 2.86, 0.06); sf.add(fr);
          const fr2 = new THREE.Mesh(boxGeo(sw + 0.16, 0.2, 0.18), frame); fr2.position.set(cx, 0.1, 0.06); sf.add(fr2);
          if (!shut && night) {
            const inner = new THREE.Mesh(new THREE.PlaneGeometry(sw, 2.4), MAT.emissive(r() < 0.5 ? 0xffb874 : 0xa8c8ff, 0.5 + r() * 0.6));
            inner.position.set(cx, 1.5, -0.25); sf.add(inner);
            const pool = createLightPool(0xffc890, 2.4, 0.25); pool.position.set(cx, 0.03, 1.6); sf.add(pool);
          }
          // awning
          if (r() < 0.6) {
            const aw = new THREE.Mesh(boxGeo(sw + 0.3, 0.08, 1.3), MAT.paint([0x3b2a1c, 0x1f2a33, 0x2a2b2e][i % 3], 0.85));
            aw.position.set(cx, 3.15, 0.65); aw.rotation.x = 0.28; aw.castShadow = true; sf.add(aw);
          }
        }
        sf.position.set(o.x + fx, o.y || 0, o.z + fz); sf.rotation.y = ry;
        sf.traverse((m) => { if (m.isMesh) m.receiveShadow = true; });
        // emissive & transparent pieces stay dynamic; frames go to the batcher
        sf.updateMatrixWorld(true);
        for (const ch of [...sf.children]) {
          if (ch.material === frame || ch.material.userData.key?.startsWith('paint')) { ctx.B.add(ch.geometry, ch.material, ch.matrixWorld, { cast: true }); sf.remove(ch); }
        }
        p.dyn(sf);
        // fire escape on brick facades
        if (o.style === 'brick' && fw > 8) {
          const fe = new THREE.Group(); const em = MAT.darkMetal();
          for (let y = 5.6; y < o.h - 2; y += 3.2) {
            const plat = new THREE.Mesh(boxGeo(3.2, 0.06, 1.1), em); plat.position.set(fw * 0.22, y, 0.6); fe.add(plat);
            const rail = new THREE.Mesh(boxGeo(3.2, 0.05, 0.05), em); rail.position.set(fw * 0.22, y + 0.95, 1.12); fe.add(rail);
            for (let k = 0; k < 5; k++) { const post = new THREE.Mesh(boxGeo(0.04, 0.95, 0.04), em); post.position.set(fw * 0.22 - 1.6 + k * 0.8, y + 0.48, 1.12); fe.add(post); }
            const ladder = new THREE.Mesh(boxGeo(0.5, 3.3, 0.05), em); ladder.position.set(fw * 0.22 + 1.2, y - 1.6, 0.9); ladder.rotation.x = -0.35; fe.add(ladder);
          }
          fe.position.set(o.x + fx, 0, o.z + fz); fe.rotation.y = ry;
          ctx.B.addObject(fe);
        }
        // drain pipe
        const dp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, o.h, 8), MAT.darkMetal());
        dp.position.set(o.x + fx + (alongX ? fw / 2 - 0.4 : 0) * (alongX ? 1 : 0), o.h / 2, o.z + fz + (alongX ? 0 : fw / 2 - 0.4)); dp.castShadow = true;
        ctx.B.addObject(dp);
        // AC units
        for (let k = 0; k < 3; k++) {
          const ac = new THREE.Mesh(boxGeo(0.8, 0.55, 0.5), MAT.metal([0.6, 0.6, 0.58], 9, 0.6));
          const lx = -fw / 2 + 1.5 + r() * (fw - 3);
          const ly = 5 + Math.floor(r() * Math.max(1, (o.h - 7) / 3.2)) * 3.2 + 1;
          const g = new THREE.Group(); g.add(ac); ac.position.set(lx, ly, 0.3); g.position.set(o.x + fx, 0, o.z + fz); g.rotation.y = ry; ac.castShadow = true;
          ctx.B.addObject(g);
        }
      }
    }
    p.commit(0);
  },

  kiosk(ctx, o) {
    const p = new P(ctx, o);
    const frame = PAINT.frame();
    p.box(2.4, 1.0, 2.4, MAT.metal([0.2, 0.22, 0.24], 6, 0.4), 0, 0, 0);
    p.box(2.5, 0.12, 2.5, frame, 0, 1.0, 0);
    for (const [x, z] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]]) p.box(0.1, 1.5, 0.1, frame, x, 1.1, z);
    p.box(3.2, 0.14, 3.2, frame, 0, 2.6, 0);
    p.box(2.3, 0.2, 2.3, PAINT.dark(), 0, 2.4, 0);
    // racks of magazines
    const r = rand(5);
    for (let i = 0; i < 10; i++) p.box(0.2, 0.28, 0.02, MAT.paint([0xe8a33d, 0x5aa9e6, 0xd9d4c7, 0x8a3a2a, 0x2a4a6a][i % 5], 0.6), -0.9 + i * 0.2, 1.3 + (i % 2) * 0.35, 1.2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.45, 2.3), MAT.glass()); glass.position.set(o.x, 1.85, o.z); p.dyn(glass);
    if (ctx.night) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.05, 3.1), MAT.emissive(0xffc27a, 2.5)); strip.position.set(o.x, 2.55, o.z); p.dyn(strip);
      const pool = createLightPool(0xffb060, 4, 0.45); pool.position.set(o.x, 0.03, o.z); p.dyn(pool);
      ctx.light({ type: 'point', color: 0xffb060, intensity: 6, distance: 9, pos: [o.x, 2.3, o.z], priority: 3 });
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: textTexture('NEWS · TOBACCO', '#e8a33d', { size: 64 }), transparent: true, toneMapped: false }));
    sign.position.set(o.x, 2.8, o.z + 1.61); p.dyn(sign);
    p.commit(0);
    void r;
  },

  car(ctx, o) {
    const p = new P(ctx, o), { L, rot } = p.along;
    const paint = new THREE.MeshPhysicalMaterial({ color: o.color || 0x2a3a4a, roughness: 0.32, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 });
    const s = L / 4.4;
    p.rb(4.3 * s, 0.62, 1.82, 0.14, paint, 0, 0.62, 0);
    p.rb(2.3 * s, 0.55, 1.62, 0.18, paint, -0.25 * s, 1.15, 0);
    const glass = MAT.glass();
    p.rb(2.15 * s, 0.46, 1.66, 0.12, glass, -0.25 * s, 1.15, 0);
    p.rb(4.36 * s, 0.14, 1.86, 0.05, MAT.darkMetal(), 0, 0.36, 0);
    for (const x of [-1.35 * s, 1.35 * s]) for (const z of [-0.85, 0.85]) {
      p.cyl(0.34, 0.34, 0.24, MAT.rubber(), x, 0.34, z, Math.PI / 2, 0, 0, 20);
      p.cyl(0.2, 0.2, 0.25, MAT.chrome(), x, 0.34, z, Math.PI / 2, 0, 0, 12);
    }
    p.commit(rot);
    const lights = new THREE.Group();
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.38), MAT.emissive(0xdfe8ff, ctx.night ? 1.5 : 0.2));
    for (const z of [-0.62, 0.62]) { const h = head.clone(); h.position.set(2.16 * s, 0.75, z); lights.add(h); const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.32), MAT.emissive(0xff3020, ctx.night ? 1.2 : 0.3)); t.position.set(-2.16 * s, 0.78, z); lights.add(t); }
    lights.position.set(o.x, 0, o.z); lights.rotation.y = rot; p.dyn(lights);
  },

  van(ctx, o) {
    const p = new P(ctx, o), { L, rot } = p.along;
    const body = MAT.paint(0xd6d3cb, 0.45);
    p.rb(L * 0.72, 2.2, 2.2, 0.08, body, -L * 0.14, 1.3, 0);
    p.rb(L * 0.27, 1.6, 2.15, 0.15, body, L * 0.36, 1.0, 0);
    p.rb(0.05, 0.7, 1.9, 0.03, MAT.glass(), L * 0.5 - 0.03, 1.45, 0, 0, 0, -0.3);
    p.box(L * 0.7, 0.4, 0.02, MAT.paint(0xe8a33d, 0.5), -L * 0.14, 1.3, 1.11);
    for (const x of [-L * 0.32, L * 0.32]) for (const z of [-0.95, 0.95]) p.cyl(0.38, 0.38, 0.26, MAT.rubber(), x, 0.38, z, Math.PI / 2);
    p.commit(rot);
  },

  barrier(ctx, o) {
    const p = new P(ctx, o), { L, rot } = p.along;
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0); shape.lineTo(0.32, 0); shape.lineTo(0.3, 0.08); shape.lineTo(0.13, 0.3); shape.lineTo(0.1, o.h); shape.lineTo(-0.1, o.h); shape.lineTo(-0.13, 0.3); shape.lineTo(-0.3, 0.08); shape.closePath();
    const n = Math.max(1, Math.round(L / 3));
    const seg = L / n;
    for (let i = 0; i < n; i++) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: seg - 0.04, bevelEnabled: false });
      geo.rotateY(Math.PI / 2); geo.translate(-L / 2 + i * seg + 0.02, 0, 0);
      scaleUV(geo, 0.5, 0.5);
      p.m(geo, MAT.concrete([0.6, 0.59, 0.56], 12));
      p.box(seg * 0.5, 0.12, 0.005, MAT.hazard(), -L / 2 + i * seg + seg / 2, o.h - 0.3, 0.115);
      p.box(seg * 0.5, 0.12, 0.005, MAT.hazard(), -L / 2 + i * seg + seg / 2, o.h - 0.3, -0.115);
    }
    p.commit(rot);
  },

  shelter(ctx, o) {
    const p = new P(ctx, o), { L, rot } = p.along;
    const frame = MAT.darkMetal();
    p.box(L, 0.08, 1.6, frame, 0, 2.3, 0.6);
    for (const x of [-L / 2, L / 2]) p.box(0.08, 2.3, 0.08, frame, x, 0, 0);
    p.box(L * 0.7, 0.06, 0.4, MAT.wood([0.3, 0.22, 0.15]), 0, 0.45, 0.35);
    p.commit(rot);
    const g = new THREE.Group();
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.1), MAT.glass()); gl.position.y = 1.15; g.add(gl);
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.7), MAT.emissive(0x9cc4ff, ctx.night ? 0.9 : 0.15)); ad.position.set(L / 2 - 0.6, 1.2, 0.03); g.add(ad);
    g.position.set(o.x, 0, o.z); g.rotation.y = rot; p.dyn(g);
  },

  dumpster(ctx, o) {
    const p = new P(ctx, o), { L, rot } = p.along;
    const paint = MAT.metal([0.16, 0.28, 0.22], 14, 0.6);
    p.box(L, o.h - 0.2, o.d < o.w ? o.d : o.w, paint, 0, 0.15, 0);
    p.m(boxGeo(L + 0.06, 0.06, 1.4), MAT.darkMetal(), 0, o.h, 0.0, 0.12);
    for (const x of [-L / 2 + 0.2, L / 2 - 0.2]) p.cyl(0.08, 0.08, 0.06, MAT.rubber(), x, 0.08, 0.5, Math.PI / 2);
    p.box(L + 0.1, 0.08, 0.08, MAT.darkMetal(), 0, 0.9, 0.66);
    p.commit(rot);
  },

  crate(ctx, o) {
    const n = o.stack || 1, s = o.w, hh = o.h / n;
    const p = new P(ctx, o);
    const wood = MAT.wood([0.52, 0.4, 0.26]), batten = MAT.wood([0.38, 0.28, 0.18]);
    for (let i = 0; i < n; i++) {
      const y = i * hh, rr = i * 0.18;
      const sub = new THREE.Group(); sub.rotation.y = rr; sub.position.y = y;
      const core = new THREE.Mesh(boxGeo(s - 0.04, hh - 0.04, s - 0.04), wood); core.position.y = hh / 2; sub.add(core);
      for (const [w, h, d, x, yy, z] of [
        [s, 0.08, 0.08, 0, 0.04, s / 2 - 0.04], [s, 0.08, 0.08, 0, hh - 0.04, s / 2 - 0.04], [s, 0.08, 0.08, 0, 0.04, -s / 2 + 0.04], [s, 0.08, 0.08, 0, hh - 0.04, -s / 2 + 0.04],
        [0.08, hh, 0.08, s / 2 - 0.04, hh / 2, s / 2 - 0.04], [0.08, hh, 0.08, -s / 2 + 0.04, hh / 2, s / 2 - 0.04], [0.08, hh, 0.08, s / 2 - 0.04, hh / 2, -s / 2 + 0.04], [0.08, hh, 0.08, -s / 2 + 0.04, hh / 2, -s / 2 + 0.04],
        [0.08, 0.08, s, s / 2 - 0.04, 0.04, 0], [0.08, 0.08, s, -s / 2 + 0.04, 0.04, 0], [0.08, 0.08, s, s / 2 - 0.04, hh - 0.04, 0], [0.08, 0.08, s, -s / 2 + 0.04, hh - 0.04, 0],
      ]) { const b = new THREE.Mesh(boxGeo(w, h, d), batten); b.position.set(x, yy, z); sub.add(b); }
      const diag = new THREE.Mesh(boxGeo(s * 1.25, 0.08, 0.03), batten); diag.position.set(0, hh / 2, s / 2 - 0.005); diag.rotation.z = Math.atan2(hh, s); sub.add(diag);
      sub.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
      p.g.add(sub);
    }
    p.commit((o.seed || 0) * 0.1);
  },

  crate_metal(ctx, o) {
    const p = new P(ctx, o);
    const m = MAT.metal([0.25, 0.3, 0.27], 22, 0.6);
    p.box(o.w, o.h, o.d, m, 0, 0, 0);
    for (let i = 0; i < 3; i++) p.box(o.w + 0.03, 0.06, o.d + 0.03, MAT.darkMetal(), 0, 0.15 + i * (o.h - 0.3) / 2, 0);
    p.box(0.4, 0.25, 0.005, MAT.hazard(), 0, o.h * 0.5, o.d / 2 + 0.016);
    p.commit(0);
  },

  planter(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    p.box(L, o.h, W, MAT.concrete([0.52, 0.5, 0.47], 15), 0, 0, 0);
    p.box(L - 0.16, 0.05, W - 0.16, MAT.paint(0x1f1a14, 1), 0, o.h - 0.04, 0);
    const bush = MAT.paint(0x1c2a1c, 0.9);
    for (let i = 0; i < 3; i++) p.m(new THREE.IcosahedronGeometry(0.42, 1), bush, -L / 3 + i * L / 3, o.h + 0.3, 0, i, i * 2, 0, 1, 0.8, 1);
    p.commit(rot);
  },

  lowwall(ctx, o) { const p = new P(ctx, o); p.box(o.w, o.h, o.d, MAT.concrete([0.5, 0.49, 0.47], 16), 0, 0, 0); p.commit(0); },
  cwall(ctx, o) {
    const p = new P(ctx, o);
    p.box(o.w, o.h, o.d, MAT.concrete([0.66, 0.6, 0.52], 17), 0, 0, 0);
    p.box(o.w + 0.06, 0.12, o.d + 0.06, MAT.concrete([0.55, 0.5, 0.44], 18), 0, o.h - 0.12, 0);
    p.commit(0);
  },
  iwall(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    p.box(L, o.h, W, MAT.metal([0.72, 0.74, 0.76], 23, 0.25), 0, 0, 0);
    for (let x = -L / 2 + 1; x < L / 2; x += 1.2) { p.box(0.08, o.h, W + 0.08, MAT.metal([0.55, 0.57, 0.6], 24, 0.3), x, 0, 0); }
    p.box(L, 0.25, W + 0.1, MAT.hazard(), 0, 0.0, 0);
    p.box(L + 0.1, 0.2, W + 0.6, MAT.snow(), 0, o.h, 0);
    p.commit(rot);
  },
  roof(ctx, o) {
    const p = new P(ctx, o);
    const mat = o.style === 'metal' ? MAT.metal([0.6, 0.62, 0.64], 25, 0.3) : MAT.concrete([0.6, 0.56, 0.5], 19);
    p.box(o.w, o.h, o.d, mat, 0, 0, 0);
    if (ctx.theme === 'arctic') p.box(o.w + 0.2, 0.25, o.d + 0.4, MAT.snow(), 0, o.h, 0);
    if (ctx.theme === 'desert') { p.box(1.2, 0.8, 1, MAT.metal([0.5, 0.5, 0.48], 26, 0.6), 3, o.h, 2); p.box(o.w, 0.25, 0.3, MAT.concrete([0.6, 0.55, 0.48], 20), 0, o.h, o.d / 2 - 0.15); }
    p.commit(0);
  },

  container(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    const c = new THREE.Color(o.color || 0x8a5a3a);
    const corr = MAT.corrugated([c.r, c.g, c.b], Math.round(c.r * 100));
    const g = boxGeo(L, o.h, W);
    // corrugation should run vertically: rotate UVs on side faces by scaling u
    p.m(g, corr, 0, o.h / 2, 0);
    const steel = MAT.darkMetal();
    for (const x of [-L / 2, L / 2]) for (const z of [-W / 2, W / 2]) p.box(0.18, o.h, 0.18, steel, x - Math.sign(x) * 0.09, 0, z - Math.sign(z) * 0.09);
    for (const y of [0, o.h - 0.15]) { p.box(L, 0.15, 0.12, steel, 0, y, W / 2 - 0.06); p.box(L, 0.15, 0.12, steel, 0, y, -W / 2 + 0.06); }
    for (const z of [-0.6, -0.2, 0.2, 0.6]) p.box(0.05, o.h - 0.3, 0.05, MAT.chrome(), L / 2 + 0.03, 0.15, z * W / 2.5);
    p.commit(rot);
  },

  hesco(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    const n = Math.round(L / 1.1), s = L / n;
    const fill = MAT.sandbag(), wire = MAT.paint(0x5a5246, 0.7);
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + s * (i + 0.5);
      p.rb(s - 0.06, o.h, W, 0.12, fill, x, o.h / 2, 0);
      for (const z of [-W / 2, W / 2]) for (let k = 0; k < 4; k++) p.box(0.025, o.h, 0.025, wire, x - s / 2 + 0.05 + k * (s - 0.1) / 3, 0, z);
      for (const y of [0.3, 0.8, 1.3]) { p.box(s - 0.04, 0.025, 0.025, wire, x, Math.min(y, o.h - 0.05), W / 2); p.box(s - 0.04, 0.025, 0.025, wire, x, Math.min(y, o.h - 0.05), -W / 2); }
    }
    p.commit(rot);
  },

  sandbags(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    const mat = MAT.sandbag();
    const bagL = 0.6, bagH = 0.2, rows = Math.max(1, Math.round(o.h / bagH)), cols = Math.max(1, Math.round(L / bagL));
    const geo = new RoundedBoxGeometry(bagL * 0.98, bagH, Math.min(W, 0.45), 2, 0.08);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - (r % 2); c++) {
      const x = -L / 2 + bagL / 2 + c * bagL + (r % 2) * bagL / 2;
      for (let d = 0; d < Math.max(1, Math.round(W / 0.45)); d++) {
        p.m(geo, mat, x, bagH / 2 + r * bagH * 0.95, -W / 2 + 0.225 + d * 0.45, 0, (Math.sin(r * 7 + c * 3) * 0.06), Math.sin(r + c) * 0.03, 1, 0.9 + Math.sin(c * 5 + r) * 0.1, 1);
      }
    }
    p.commit(rot);
  },

  truck(ctx, o) {
    const p = new P(ctx, o), { L, rot } = p.along;
    const paint = MAT.metal([0.42, 0.38, 0.28], 27, 0.5);
    p.rb(L * 0.25, 1.9, 2.3, 0.1, paint, L * 0.36, 1.45, 0);
    p.rb(0.05, 0.7, 1.9, 0.03, MAT.glass(), L * 0.49, 1.85, 0, 0, 0, -0.15);
    p.box(L * 0.7, 0.3, 2.4, paint, -L * 0.14, 1.0, 0);
    p.rb(L * 0.68, 1.5, 2.36, 0.25, MAT.sandbag(), -L * 0.14, 2.05, 0);
    p.box(L, 0.3, 1.0, MAT.darkMetal(), 0, 0.5, 0);
    for (const x of [-L * 0.33, -L * 0.12, L * 0.36]) for (const z of [-1.0, 1.0]) p.cyl(0.5, 0.5, 0.36, MAT.rubber(), x, 0.5, z, Math.PI / 2);
    p.commit(rot);
  },

  rock(ctx, o) {
    const p = new P(ctx, o);
    const r = rand(o.seed || 3);
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = 1 + Math.sin(x * 3.1 + (o.seed || 1)) * 0.12 + Math.sin(y * 5.3 + z * 2.1) * 0.08 + Math.sin(z * 7.7 + x * 4.1) * 0.05;
      pos.setXYZ(i, x * n, Math.max(y * n, -0.3), z * n);
    }
    geo.computeVertexNormals();
    scaleUV(geo, 3, 3);
    const tint = ctx.theme === 'desert' ? [0.62, 0.5, 0.38] : [0.5, 0.5, 0.52];
    p.m(geo, MAT.rock(tint, o.seed || 9), 0, o.h * 0.42, 0, 0, r() * 6, 0, o.w * 0.58, o.h * 0.62, o.d * 0.58);
    p.m(new THREE.IcosahedronGeometry(1, 2), MAT.rock(tint, o.seed || 9), o.w * 0.4, o.h * 0.2, o.d * 0.3, 0, r() * 6, 0, o.w * 0.25, o.h * 0.3, o.d * 0.25);
    p.commit(0);
  },

  ice(ctx, o) {
    const p = new P(ctx, o);
    const r = rand(o.seed || 4);
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.OctahedronGeometry(1, 0);
      const s = 0.5 + r() * 0.5;
      p.m(geo, MAT.ice(), (r() - 0.5) * o.w * 0.5, o.h * 0.4 * s, (r() - 0.5) * o.d * 0.5, r(), r() * 6, r() * 0.5, o.w * 0.4 * s, o.h * 0.65 * s, o.d * 0.4 * s);
    }
    p.m(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow(), 0, 0, 0, 0, 0, 0, o.w * 0.6, o.h * 0.35, o.d * 0.6);
    p.commit(0);
  },

  barrels(ctx, o) {
    const p = new P(ctx, o);
    const cols = [[0.25, 0.32, 0.4], [0.5, 0.22, 0.12], [0.3, 0.3, 0.26]];
    const spots = [[-0.4, -0.4], [0.4, -0.35], [-0.35, 0.42], [0.42, 0.4]];
    spots.forEach(([x, z], i) => {
      const m = MAT.metal(cols[i % 3], 40 + i, 0.8);
      p.cyl(0.3, 0.3, 0.9, m, x, 0.45, z);
      for (const y of [0.25, 0.65]) p.cyl(0.31, 0.31, 0.04, MAT.darkMetal(), x, y, z);
    });
    p.commit(0);
  },

  generator(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    p.box(L, o.h * 0.8, W, MAT.metal([0.4, 0.42, 0.3], 41, 0.5), 0, 0.15, 0);
    p.box(L + 0.1, 0.15, W + 0.1, MAT.darkMetal(), 0, 0, 0);
    for (let i = 0; i < 8; i++) p.box(0.04, o.h * 0.5, 0.02, MAT.darkMetal(), -L / 3 + i * 0.1, 0.4, W / 2 + 0.01);
    p.cyl(0.06, 0.06, 0.6, MAT.darkMetal(), L / 3, o.h + 0.1, 0);
    p.commit(rot);
  },

  post(ctx, o) { const p = new P(ctx, o); p.box(o.w, o.h, o.d, ctx.theme === 'desert' ? MAT.wood([0.4, 0.3, 0.2]) : MAT.darkMetal(), 0, 0, 0); p.commit(0); },

  walkway(ctx, o) {
    const p = new P(ctx, o);
    const tower = o.style === 'tower';
    const deckMat = tower ? MAT.wood([0.45, 0.34, 0.22]) : MAT.tread();
    if (tower) p.box(o.w, 0.2, o.d, deckMat, 0, -0.2, 0);
    else {
      const grate = TEX.grate();
      const gm = new THREE.MeshStandardMaterial({ color: 0x4a4c50, metalness: 0.85, roughness: 0.45, alphaMap: grate.alphaMap, alphaTest: 0.5, side: THREE.DoubleSide });
      gm.alphaMap.repeat.set(o.w / 2, o.d / 2);
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.d), gm);
      deck.rotation.x = -Math.PI / 2; deck.position.set(o.x, o.y - 0.02, o.z); deck.castShadow = true; deck.receiveShadow = true;
      p.dyn(deck);
      p.box(o.w, 0.18, 0.12, MAT.darkMetal(), 0, -0.2, o.d / 2 - 0.06);
      p.box(o.w, 0.18, 0.12, MAT.darkMetal(), 0, -0.2, -o.d / 2 + 0.06);
      for (let x = -o.w / 2; x <= o.w / 2; x += 2) p.box(0.1, 0.16, o.d, MAT.darkMetal(), x, -0.2, 0);
    }
    const railMat = tower ? MAT.wood([0.38, 0.28, 0.18]) : MAT.paint(0xc08a2e, 0.5);
    for (const side of o.rails) {
      const alongX = side === '+z' || side === '-z';
      const len = alongX ? o.w : o.d;
      const s = side[0] === '+' ? 1 : -1;
      const ox = alongX ? 0 : s * (o.w / 2 - 0.04), oz = alongX ? s * (o.d / 2 - 0.04) : 0;
      for (const hy of [0.5, 1.0]) p.box(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, railMat, ox, hy, oz);
      for (let i = 0; i <= Math.round(len / 1.5); i++) {
        const t = -len / 2 + i * (len / Math.round(len / 1.5));
        p.box(0.05, 1.05, 0.05, railMat, alongX ? t : ox, 0, alongX ? oz : t);
      }
    }
    p.commit(0, o.x, o.y, o.z);
  },

  stairs(ctx, o) {
    const p = new P(ctx, o);
    const steps = o.steps, rise = o.top / steps, depth = o.run / steps;
    const wood = o.style === 'wood';
    const tread = wood ? MAT.wood([0.45, 0.34, 0.22]) : MAT.tread();
    const frame = wood ? MAT.wood([0.36, 0.27, 0.17]) : MAT.darkMetal();
    const sx = o.dir === '+x' ? 1 : o.dir === '-x' ? -1 : 0, sz = o.dir === '+z' ? 1 : o.dir === '-z' ? -1 : 0;
    const rot = sx ? (sx > 0 ? 0 : Math.PI) : (sz > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (let i = 0; i < steps; i++) p.box(depth + 0.02, 0.06, o.width, tread, (i + 0.5) * depth, (i + 1) * rise - 0.06, 0);
    const len = Math.hypot(o.run, o.top), ang = Math.atan2(o.top, o.run);
    for (const z of [-o.width / 2, o.width / 2]) {
      p.m(boxGeo(len, 0.25, 0.06), frame, o.run / 2, o.top / 2, z, 0, 0, ang);
      p.m(boxGeo(len, 0.05, 0.05), wood ? frame : MAT.paint(0xc08a2e, 0.5), o.run / 2, o.top / 2 + 1.0, z, 0, 0, ang);
      for (let k = 1; k < 4; k++) p.box(0.05, 1.0, 0.05, frame, (o.run * k) / 4, (o.top * k) / 4, z);
    }
    p.commit(rot, o.x, 0, o.z);
  },

  towerroof(ctx, o) {
    const p = new P(ctx, o);
    for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) p.box(0.14, 2.5, 0.14, MAT.wood([0.4, 0.3, 0.2]), x, 0, z);
    p.m(boxGeo(4.6, 0.08, 4.6), MAT.corrugated([0.5, 0.48, 0.42], 51), 0, 2.55, 0, 0.08);
    p.commit(0, o.x, o.y, o.z);
  },

  net(ctx, o) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    for (let i = 0; i < 400; i++) { x.fillStyle = ['#5c5440', '#6e6448', '#4a4434'][i % 3]; x.beginPath(); x.arc(Math.random() * 128, Math.random() * 128, 3 + Math.random() * 6, 0, 7); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(o.w, o.d, 8, 8);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -Math.sin((pos.getX(i) / o.w + 0.5) * Math.PI) * Math.sin((pos.getY(i) / o.d + 0.5) * Math.PI) * 0.4);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, alphaMap: t, transparent: false, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 }));
    m.rotation.x = -Math.PI / 2; m.position.set(o.x, o.y, o.z); m.castShadow = true;
    ctx.group.add(m);
  },

  mast(ctx, o) {
    const p = new P(ctx, o);
    const h = o.tall || 6;
    p.cyl(0.06, 0.08, h, MAT.darkMetal(), 0, h / 2, 0);
    for (let y = 1; y < h; y += 1.5) p.box(0.6, 0.03, 0.03, MAT.darkMetal(), 0, y, 0);
    p.commit(0, o.x, o.y, o.z);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), MAT.emissive(0xff5a2a, 6));
    beacon.position.set(o.x, o.y + h + 0.05, o.z); beacon.userData.dynamic = true; ctx.group.add(beacon);
    ctx.anim.push((dt, t) => { beacon.visible = (t * 0.9) % 1 < 0.15; });
  },

  floodlight(ctx, o) {
    const p = new P(ctx, o);
    p.cyl(0.08, 0.1, 6, MAT.darkMetal(), 0, 3, 0);
    p.box(1.4, 0.1, 0.1, MAT.darkMetal(), 0, 6, 0);
    for (const x of [-0.5, 0.5]) p.box(0.4, 0.3, 0.2, MAT.darkMetal(), x, 6.1, 0.15);
    p.commit(o.yaw || 0, o.x, 0, o.z);
  },

  module(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    const shell = MAT.metal([0.78, 0.8, 0.82], 60 + (o.seed || 0), 0.2);
    const rib = MAT.metal([0.5, 0.53, 0.56], 61, 0.3);
    p.rb(L, o.h - 0.4, W, 0.2, shell, 0, (o.h - 0.4) / 2 + 0.4, 0);
    for (let x = -L / 2 + 0.6; x < L / 2; x += 1.4) p.rb(0.12, o.h - 0.3, W + 0.1, 0.04, rib, x, (o.h - 0.3) / 2 + 0.35, 0);
    for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) p.box(0.25, 0.4, 0.25, MAT.darkMetal(), x, 0, z);
    p.box(L + 0.1, 0.3, W + 0.4, MAT.snow(), 0, o.h, 0);
    p.box(L * 0.95, 0.12, 0.02, MAT.paint(0xe8a33d, 0.5), 0, 1.4, W / 2 + 0.03);
    p.box(1.0, 2.0, 0.06, MAT.metal([0.35, 0.38, 0.42], 62, 0.4), L / 2 - 1.2, 0.45, -W / 2 - 0.02);
    p.commit(rot);
    const g = new THREE.Group();
    for (let i = 0; i < Math.floor(L / 2); i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), MAT.emissive(0xbfe0ff, 1.2));
      w.position.set(-L / 2 + 1.2 + i * 2, 2.1, W / 2 + 0.07); g.add(w);
    }
    g.position.set(o.x, 0, o.z); g.rotation.y = rot; ctx.group.add(g);
  },

  tank(ctx, o) {
    const p = new P(ctx, o);
    const r = Math.min(o.w, o.d) / 2;
    const arctic = ctx.theme === 'arctic';
    const mat = arctic ? MAT.metal([0.7, 0.72, 0.74], 63, 0.3) : MAT.metal([0.42, 0.36, 0.3], 64, 0.85);
    p.cyl(r * 0.96, r * 0.96, o.h - 0.6, mat, 0, (o.h - 0.6) / 2 + 0.6, 0, 0, 0, 0, 32);
    p.m(new THREE.SphereGeometry(r * 0.96, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, o.h, 0, 0, 0, 0, 1, 0.3, 1);
    for (let y = 1.2; y < o.h; y += 1.6) p.cyl(r, r, 0.1, MAT.darkMetal(), 0, y, 0, 0, 0, 0, 32);
    p.cyl(r * 1.02, r * 1.02, 0.6, MAT.concrete([0.45, 0.45, 0.45], 65), 0, 0.3, 0, 0, 0, 0, 32);
    for (let y = 0.6; y < o.h; y += 0.35) p.box(0.5, 0.04, 0.04, MAT.darkMetal(), 0, y, r + 0.12);
    p.box(0.04, o.h - 0.6, 0.04, MAT.darkMetal(), -0.25, 0.6, r + 0.12);
    p.box(0.04, o.h - 0.6, 0.04, MAT.darkMetal(), 0.25, 0.6, r + 0.12);
    p.cyl(0.18, 0.18, 2, MAT.darkMetal(), r + 0.6, 1.2, 0, 0, 0, Math.PI / 2);
    if (arctic) p.m(new THREE.SphereGeometry(r * 0.98, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow(), 0, o.h + 0.05, 0, 0, 0, 0, 1, 0.32, 1);
    p.box(1.2, 0.6, 0.02, MAT.hazard(), 0, o.h * 0.5, -r - 0.02);
    p.commit(0);
  },

  pipes(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    const pm = ctx.theme === 'arctic' ? MAT.metal([0.62, 0.64, 0.66], 66, 0.4) : MAT.metal([0.45, 0.35, 0.25], 67, 0.8);
    for (const [z, y, r] of [[-W / 4, o.h - 0.25, 0.22], [W / 4, o.h - 0.32, 0.16], [0, 0.42, 0.12]]) p.cyl(r, r, L, pm, 0, y, z, 0, 0, Math.PI / 2);
    for (let x = -L / 2 + 0.5; x < L / 2; x += 2) { p.box(0.12, o.h - 0.4, W, MAT.darkMetal(), x, 0, 0); p.box(0.16, 0.06, W + 0.1, MAT.darkMetal(), x, o.h - 0.5, 0); }
    p.cyl(0.14, 0.14, 0.2, MAT.paint(0xe8a33d, 0.5), 0.6, o.h + 0.05, -W / 4);
    if (ctx.theme === 'arctic') p.box(L, 0.08, W * 0.8, MAT.snow(), 0, o.h + 0.05, 0);
    p.commit(rot);
  },

  lockers(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    for (let i = 0; i < 3; i++) {
      const x = -L / 2 + L / 6 + i * L / 3;
      p.box(L / 3 - 0.02, o.h, W, MAT.metal([0.32, 0.38, 0.44], 68 + i, 0.4), x, 0, 0);
      for (let k = 0; k < 3; k++) p.box(0.25, 0.02, 0.01, MAT.darkMetal(), x, o.h - 0.25 - k * 0.04, W / 2 + 0.005);
    }
    p.commit(rot);
  },

  column(ctx, o) {
    const p = new P(ctx, o);
    p.box(o.w, o.h, o.d, MAT.concrete([0.5, 0.49, 0.47], 69), 0, 0, 0);
    p.box(o.w + 0.2, 0.3, o.d + 0.2, MAT.darkMetal(), 0, 0, 0);
    p.box(o.w + 0.02, 1.2, o.d + 0.02, MAT.hazard(), 0, 0.3, 0);
    p.commit(0);
  },

  press(ctx, o) {
    const p = new P(ctx, o);
    const body = MAT.metal([0.38, 0.4, 0.33], 70, 0.7);
    p.box(o.w, 1.0, o.d, body, 0, 0, 0);
    for (const x of [-o.w / 2 + 0.3, o.w / 2 - 0.3]) for (const z of [-o.d / 2 + 0.3, o.d / 2 - 0.3]) p.cyl(0.16, 0.16, o.h - 1, MAT.chrome(), x, (o.h - 1) / 2 + 1, z);
    p.box(o.w + 0.2, 1.1, o.d + 0.2, body, 0, o.h - 1.1, 0);
    p.box(o.w * 0.7, 0.4, o.d * 0.7, MAT.darkMetal(), 0, 2.2, 0);
    p.box(o.w + 0.02, 0.25, o.d + 0.02, MAT.hazard(), 0, 0.75, 0);
    p.box(0.6, 0.5, 0.3, MAT.darkMetal(), o.w / 2 + 0.2, 1.1, 0);
    p.commit(0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), MAT.emissive(0xe8a33d, 4).clone()); lamp.position.set(o.x + o.w / 2 + 0.2, 1.75, o.z); lamp.userData.dynamic = true; ctx.group.add(lamp);
    ctx.anim.push((dt, t) => { lamp.material.emissiveIntensity = 2 + Math.sin(t * 4) * 2; });
  },

  conveyor(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    p.box(L, 0.12, W, MAT.rubber(), 0, o.h - 0.12, 0);
    p.box(L, 0.25, 0.08, MAT.metal([0.5, 0.4, 0.15], 71, 0.7), 0, o.h - 0.3, W / 2);
    p.box(L, 0.25, 0.08, MAT.metal([0.5, 0.4, 0.15], 71, 0.7), 0, o.h - 0.3, -W / 2);
    for (let x = -L / 2 + 0.4; x < L / 2; x += 1.5) for (const z of [-W / 2 + 0.1, W / 2 - 0.1]) p.box(0.1, o.h - 0.3, 0.1, MAT.darkMetal(), x, 0, z);
    for (let i = 0; i < 4; i++) p.box(0.6, 0.45, 0.5, MAT.wood([0.55, 0.45, 0.3]), -L / 3 + i * 1.7, o.h, (i % 2 - 0.5) * 0.3);
    p.commit(rot);
  },

  pallets(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    for (let i = 0; i < 3; i++) p.box(L, 0.14, W, MAT.wood([0.55, 0.45, 0.32]), 0, i * 0.15, 0);
    p.box(L - 0.2, o.h - 0.45, W - 0.2, new THREE.MeshPhysicalMaterial({ color: 0x8c8a84, roughness: 0.3, transmission: 0, clearcoat: 1, envMapIntensity: 1.2 }), 0, 0.45, 0);
    p.commit(rot);
  },

  machine(ctx, o) {
    const p = new P(ctx, o), { L, W, rot } = p.along;
    const body = MAT.metal([0.3, 0.36, 0.42], 72, 0.6);
    p.box(L, o.h, W, body, 0, 0, 0);
    p.box(L * 0.4, 0.8, W + 0.04, MAT.darkMetal(), -L * 0.2, o.h * 0.4, 0);
    p.cyl(0.25, 0.25, 1.2, MAT.chrome(), L * 0.3, o.h + 0.2, 0, 0, 0, Math.PI / 2);
    p.box(L + 0.02, 0.2, W + 0.02, MAT.hazard(), 0, 0, 0);
    p.commit(rot);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), MAT.emissive(0x5aa9e6, 1.5));
    const g = new THREE.Group(); panel.position.set(L * 0.25, o.h * 0.65, W / 2 + 0.01); g.add(panel); g.position.set(o.x, 0, o.z); g.rotation.y = rot; ctx.group.add(g);
  },

  // ----- lights & signage -----
  lamp(ctx, o) {
    const p = new P(ctx, o);
    const s = o.facing === '+z' ? 1 : -1;
    p.cyl(0.07, 0.1, 6, MAT.darkMetal(), 0, 3, 0);
    p.box(0.08, 0.08, 1.6, MAT.darkMetal(), 0, 6, s * 0.75);
    p.box(0.4, 0.14, 0.7, MAT.darkMetal(), 0, 5.88, s * 1.4);
    p.commit(0, o.x, 0, o.z);
    const color = ctx.night ? 0xffb35a : 0xfff1d8;
    const flickers = ctx.night && Math.abs(o.x) === 24 && o.facing === '+z';
    const lensMat = MAT.emissive(color, ctx.night ? 8 : 0.5);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.6), flickers ? lensMat.clone() : lensMat);
    lens.rotation.x = Math.PI / 2; lens.position.set(o.x, 5.8, o.z + s * 1.4); ctx.group.add(lens);
    lens.userData.dynamic = flickers;
    if (ctx.night) {
      const pool = createLightPool(color, 5, 0.55); pool.position.set(o.x, 0.025, o.z + s * 1.6); ctx.group.add(pool);
      const cone = createLightCone(color, 5.8, 2.6, 0.1); cone.position.set(o.x, 5.8, o.z + s * 1.4); ctx.group.add(cone);
      ctx.light({ type: 'spot', color, intensity: 40, distance: 16, angle: 0.9, pos: [o.x, 5.75, o.z + s * 1.4], target: [o.x, 0, o.z + s * 2.2], priority: 2 });
      if (flickers) ctx.anim.push((dt, t) => { const f = Math.sin(t * 37) > 0.94 || Math.sin(t * 1.3) > 0.985 ? 0.2 : 1; lens.material.emissiveIntensity = 8 * f; });
    }
  },

  neon(ctx, o) {
    const tex = textTexture(o.text, `#${o.color.toString(16).padStart(6, '0')}`, { size: 110, glow: 30 });
    const h = 0.9, w = h * tex.userData.aspect;
    const g = new THREE.Group();
    const back = new THREE.Mesh(boxGeo(w + 0.2, h + 0.2, 0.12), MAT.paint(0x111214, 0.6)); back.position.z = -0.08; back.castShadow = true;
    g.add(back);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false, depthWrite: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); front.position.z = 0.0; g.add(front);
    const ry = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 }[o.facing];
    g.position.set(o.x, o.y, o.z); g.rotation.y = ry;
    const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    g.position.addScaledVector(n, 0.12);
    ctx.group.add(g);
    const c = new THREE.Color(o.color);
    const pool = createLightPool(o.color, 3.4, 0.3); pool.position.set(o.x + n.x * 2, 0.026, o.z + n.z * 2); ctx.group.add(pool);
    ctx.light({ type: 'point', color: o.color, intensity: 5, distance: 10, pos: [o.x + n.x * 0.8, o.y, o.z + n.z * 0.8], priority: 1 });
    if (o.text.length % 3 === 0) g.userData.dynamic = true;
    if (o.text.length % 3 === 0) ctx.anim.push((dt, t) => { const on = Math.sin(t * 23 + o.x) > -0.92 || Math.sin(t * 0.7) < 0.9; mat.color.setRGB(on ? 1.6 : 0.3, on ? 1.6 : 0.3, on ? 1.6 : 0.3); });
    void c;
  },

  striplight(ctx, o) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.12), o.x === 3 ? MAT.emissive(0xdfefff, 4).clone() : MAT.emissive(0xdfefff, 4));
    m.position.set(o.x, o.y, o.z); m.userData.dynamic = o.x === 3; ctx.group.add(m);
    const pool = createLightPool(0xcfe4ff, 3, 0.35); pool.position.set(o.x, 0.03, o.z); ctx.group.add(pool);
    ctx.light({ type: 'point', color: 0xcfe4ff, intensity: 4, distance: 7, pos: [o.x, o.y - 0.3, o.z], priority: 2 });
    if (o.x === 3) ctx.anim.push((dt, t) => { m.material.emissiveIntensity = Math.sin(t * 50) > 0.6 && Math.sin(t * 0.9) > 0.7 ? 0.5 : 4; });
  },

  coldlight(ctx, o) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.2), MAT.emissive(0x9fd0ff, 5));
    m.position.set(o.x, o.y, o.z); ctx.group.add(m);
    const pool = createLightPool(0x9fd0ff, 3.5, 0.35); pool.position.set(o.x, 0.03, o.z); ctx.group.add(pool);
    ctx.light({ type: 'point', color: 0x9fd0ff, intensity: 5, distance: 9, pos: [o.x, o.y, o.z], priority: 1 });
  },

  hanglamp(ctx, o) {
    const p = new P(ctx, o);
    p.cyl(0.015, 0.015, 4, MAT.darkMetal(), 0, 2, 0);
    p.m(new THREE.ConeGeometry(0.45, 0.35, 20, 1, true), MAT.paint(0x2f3a33, 0.5), 0, -0.1, 0);
    p.commit(0, o.x, o.y, o.z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), MAT.emissive(0xffd8a0, 6)); bulb.position.set(o.x, o.y - 0.22, o.z); ctx.group.add(bulb);
    const pool = createLightPool(0xffc888, 4, 0.3); pool.position.set(o.x, 0.03, o.z); ctx.group.add(pool);
    ctx.light({ type: 'point', color: 0xffc888, intensity: 6, distance: 12, pos: [o.x, o.y - 0.4, o.z], priority: 1 });
  },

  plantroof(ctx, o) {
    // Roof slabs with three skylight gaps; trusses below
    const p = new P(ctx, o);
    const gaps = [-14, 0, 14];
    const roofM = MAT.corrugated([0.35, 0.33, 0.3], 80);
    const segs = [];
    let last = -o.w / 2;
    for (const gx of gaps) { segs.push([last, gx - 2]); last = gx + 2; }
    segs.push([last, o.w / 2]);
    for (const [a, b] of segs) p.box(b - a, 0.2, o.d, roofM, (a + b) / 2, 0, 0);
    for (const gx of gaps) for (const z of [-o.d / 2 + 6, 0, o.d / 2 - 6]) p.box(4, 0.2, 3.5, roofM, gx, 0, z);
    for (let x = -o.w / 2 + 4; x < o.w / 2; x += 8) {
      p.box(0.3, 0.5, o.d, MAT.darkMetal(), x, -0.6, 0);
      for (let z = -o.d / 2; z < o.d / 2; z += 3) p.m(boxGeo(0.08, 0.08, 2.2), MAT.darkMetal(), x, -0.45, z, 0.7);
    }
    p.commit(0, o.x, o.y, o.z);
    ctx.skylights = gaps;
  },
};

/** Perimeter dressing per theme so the arena edge reads as a believable place. */
export function buildPerimeter(ctx, bounds) {
  const B = bounds, T = ctx.theme;
  const g = new P(ctx, { x: 0, z: 0 });
  if (T === 'desert') {
    const mat = MAT.rock([0.66, 0.53, 0.4], 81);
    const r = rand(7);
    const ring = (x, z, s) => {
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const k = 1 + (Math.sin(pos.getX(i) * 4 + x) + Math.sin(pos.getZ(i) * 3 + z)) * 0.1; pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k); }
      geo.computeVertexNormals(); scaleUV(geo, 4, 4);
      g.m(geo, mat, x, s * 0.3, z, 0, r() * 6, 0, s * 1.4, s, s * 1.2);
    };
    for (let x = B.minX - 4; x <= B.maxX + 4; x += 7) { ring(x, B.minZ - 4 - r() * 2, 4 + r() * 3); ring(x, B.maxZ + 4 + r() * 2, 4 + r() * 3); }
    for (let z = B.minZ; z <= B.maxZ; z += 7) { ring(B.minX - 4 - r() * 2, z, 4 + r() * 3); ring(B.maxX + 4 + r() * 2, z, 4 + r() * 3); }
    // distant dunes
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, d = 90 + r() * 40;
      g.m(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.sand(), Math.cos(a) * d, -1, Math.sin(a) * d, 0, a, 0, 30 + r() * 20, 6 + r() * 8, 18);
    }
  } else if (T === 'arctic') {
    const r = rand(9);
    for (let x = B.minX - 3; x <= B.maxX + 3; x += 5) for (const z of [B.minZ - 3, B.maxZ + 3]) g.m(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow(), x, -0.2, z + (r() - 0.5) * 2, 0, r() * 3, 0, 3 + r() * 2, 2.5 + r() * 2.5, 3);
    for (let z = B.minZ; z <= B.maxZ; z += 5) for (const x of [B.minX - 3, B.maxX + 3]) g.m(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.snow(), x + (r() - 0.5) * 2, -0.2, z, 0, r() * 3, 0, 3, 2.5 + r() * 2.5, 3 + r() * 2);
    // fence posts
    for (let x = B.minX; x <= B.maxX; x += 3) for (const z of [B.minZ - 0.6, B.maxZ + 0.6]) g.box(0.08, 2.2, 0.08, MAT.darkMetal(), x, 0, z);
    for (let z = B.minZ; z <= B.maxZ; z += 3) for (const x of [B.minX - 0.6, B.maxX + 0.6]) g.box(0.08, 2.2, 0.08, MAT.darkMetal(), x, 0, z);
    // mountains
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r(), d = 140 + r() * 60;
      const h = 40 + r() * 50;
      g.m(new THREE.ConeGeometry(30 + r() * 30, h, 6 + Math.floor(r() * 4)), MAT.rock([0.55, 0.58, 0.62], 82), Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d, 0, r() * 3, 0);
      g.m(new THREE.ConeGeometry(14 + r() * 8, h * 0.4, 7), MAT.snow(), Math.cos(a) * d, h * 0.82, Math.sin(a) * d);
    }
  } else if (T === 'industrial') {
    const wall = MAT.brick(41, [0.34, 0.2, 0.15]);
    const H = 12;
    g.box(B.maxX - B.minX + 2, H, 0.6, wall, 0, 0, B.minZ - 0.3);
    g.box(B.maxX - B.minX + 2, H, 0.6, wall, 0, 0, B.maxZ + 0.3);
    g.box(0.6, H, B.maxZ - B.minZ + 2, wall, B.minX - 0.3, 0, 0);
    g.box(0.6, H, B.maxZ - B.minZ + 2, wall, B.maxX + 0.3, 0, 0);
    g.box(B.maxX - B.minX, 1.2, 0.7, MAT.concrete([0.45, 0.44, 0.42], 83), 0, 0, B.minZ - 0.2);
    g.box(B.maxX - B.minX, 1.2, 0.7, MAT.concrete([0.45, 0.44, 0.42], 83), 0, 0, B.maxZ + 0.2);
    // high windows (bright)
    const win = MAT.emissive(0xfff0d8, 2.2);
    for (let x = B.minX + 4; x < B.maxX - 2; x += 6) for (const z of [B.minZ + 0.01, B.maxZ - 0.01]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), win); w.position.set(x, 8.5, z); w.rotation.y = z < 0 ? 0 : Math.PI; ctx.group.add(w);
      for (let k = 0; k < 3; k++) g.box(0.08, 2.2, 0.1, MAT.darkMetal(), x - 1.1 + k * 1.1, 7.4, z);
    }
    for (const x of [B.minX + 0.01, B.maxX - 0.01]) {
      const door = new THREE.Mesh(boxGeo(0.1, 6, 8), MAT.corrugated([0.3, 0.35, 0.4], 84)); door.position.set(x, 3, 0); door.castShadow = true; g.g.add(door);
    }
  }
  g.commit(0, 0, 0, 0);
}
