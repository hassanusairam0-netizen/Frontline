// Map construction kit. Maps describe themselves as a list of typed objects; this
// kit derives axis-aligned colliders from them. The client turns the same objects
// into detailed meshes, and the server loads only the colliders.

export function createKit(bounds) {
  const objects = [];
  const colliders = [];
  const spawns = { A: [], B: [] };

  const box = (x, y, z, w, h, d, kind, extra = {}) => {
    const c = { min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], kind, ...extra };
    colliders.push(c);
    return c;
  };

  const k = {
    bounds, objects, colliders, spawns,

    /** Solid object resting at y (default 0). w along X, d along Z. */
    add(kind, x, z, w, d, h, opts = {}) {
      const y = opts.y ?? 0;
      const o = { kind, x, y, z, w, d, h, ...opts };
      objects.push(o);
      if (opts.solid !== false) box(x, y, z, w, h, d, kind, opts.noRay ? { noRay: true } : {});
      return o;
    },

    /** Point-symmetric pair: (x,z) and (-x,-z). Keeps 1v1 layouts fair. */
    sym(kind, x, z, w, d, h, opts = {}) {
      k.add(kind, x, z, w, d, h, opts);
      if (x !== 0 || z !== 0) k.add(kind, -x, -z, w, d, h, { ...opts, mirrored: true, seed: (opts.seed ?? 0) + 7 });
    },

    /** Visual-only decoration. */
    deco(kind, x, y, z, opts = {}) {
      objects.push({ kind, x, y, z, solid: false, ...opts });
    },

    /**
     * Solid staircase. Rises from (x0,z0) toward dir ('+x','-x','+z','-z') over `run` metres
     * to `top` height; `width` is across the run direction.
     */
    stairs(x0, z0, dir, run, width, top, opts = {}) {
      const steps = Math.ceil(top / 0.3);
      const rise = top / steps, depth = run / steps;
      const sx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0;
      const sz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
      for (let i = 0; i < steps; i++) {
        const a = i * depth, b = run; // each step spans to the top end: solid underneath
        const len = b - a, mid = (a + b) / 2;
        const cx = x0 + sx * mid, cz = z0 + sz * mid;
        const w = sx ? len : width, d = sz ? len : width;
        box(cx, 0, cz, w, (i + 1) * rise, d, 'stairs');
      }
      objects.push({ kind: 'stairs', x: x0, z: z0, dir, run, width, top, steps, solid: false, ...opts });
    },

    /** Elevated grated walkway with railing on the given open sides. */
    walkway(x, z, w, d, y, rails = [], opts = {}) {
      objects.push({ kind: 'walkway', x, y, z, w, d, rails, solid: false, ...opts });
      box(x, y - 0.2, z, w, 0.2, d, 'walkway');
      for (const side of rails) {
        if (side === '+z') box(x, y, z + d / 2 - 0.04, w, 1.05, 0.08, 'rail', { noRay: true });
        if (side === '-z') box(x, y, z - d / 2 + 0.04, w, 1.05, 0.08, 'rail', { noRay: true });
        if (side === '+x') box(x + w / 2 - 0.04, y, z, 0.08, 1.05, d, 'rail', { noRay: true });
        if (side === '-x') box(x - w / 2 + 0.04, y, z, 0.08, 1.05, d, 'rail', { noRay: true });
      }
    },

    spawn(side, x, z, yaw) { spawns[side].push({ x, z, yaw }); },
    symSpawn(x, z, yaw) { spawns.A.push({ x, z, yaw }); spawns.B.push({ x: -x, z: -z, yaw: yaw + Math.PI }); },

    /** Boundary walls just outside the playable bounds (bullets stop on them). */
    perimeter(height = 8, kind = 'perimeter') {
      const B = bounds, t = 1;
      box((B.minX + B.maxX) / 2, 0, B.minZ - t / 2, B.maxX - B.minX + 2, height, t, kind);
      box((B.minX + B.maxX) / 2, 0, B.maxZ + t / 2, B.maxX - B.minX + 2, height, t, kind);
      box(B.minX - t / 2, 0, (B.minZ + B.maxZ) / 2, t, height, B.maxZ - B.minZ + 2, kind);
      box(B.maxX + t / 2, 0, (B.minZ + B.maxZ) / 2, t, height, B.maxZ - B.minZ + 2, kind);
    },
  };
  return k;
}
