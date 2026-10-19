// Deterministic axis-aligned collision used by the client controller, the bot AI
// and the authoritative server. Boxes: { min:[x,y,z], max:[x,y,z], kind }.

export const PLAYER = {
  radius: 0.38,
  height: 1.8,
  crouchHeight: 1.2,
  eye: 1.64,
  crouchEye: 1.06,
  step: 0.48,
  gravity: 22,
  jump: 7.2,
  walk: 5.1,
  sprint: 7.4,
  crouchSpeed: 2.6,
  adsSpeed: 0.62,
};

export function createWorld(boxes, bounds) {
  return { boxes: boxes.slice(), dynamic: [], bounds };
}

export function allBoxes(world) {
  return world.dynamic.length ? world.boxes.concat(world.dynamic) : world.boxes;
}

const EPS = 1e-4;

function overlaps(b, minX, minY, minZ, maxX, maxY, maxZ) {
  return b.max[0] > minX && b.min[0] < maxX && b.max[1] > minY && b.min[1] < maxY && b.max[2] > minZ && b.min[2] < maxZ;
}

/** True if a player-sized box at (x,y,z) intersects any solid. */
export function blocked(world, x, y, z, h, r = PLAYER.radius) {
  const boxes = allBoxes(world);
  for (let i = 0; i < boxes.length; i++) {
    if (overlaps(boxes[i], x - r, y + EPS, z - r, x + r, y + h, z + r)) return true;
  }
  const B = world.bounds;
  return x - r < B.minX || x + r > B.maxX || z - r < B.minZ || z + r > B.maxZ;
}

/**
 * Kinematic character move with step-up. Mutates `s` ({x,y,z,vx,vy,vz,onGround}).
 * Returns true when the body is resting on something.
 */
export function moveBody(world, s, dt, h, r = PLAYER.radius) {
  const boxes = allBoxes(world);
  const B = world.bounds;

  const axis = (ax) => {
    const v = ax === 0 ? s.vx : s.vz;
    if (v === 0) return;
    const prev = ax === 0 ? s.x : s.z;
    let next = prev + v * dt;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const minX = (ax === 0 ? next : s.x) - r, maxX = (ax === 0 ? next : s.x) + r;
      const minZ = (ax === 2 ? next : s.z) - r, maxZ = (ax === 2 ? next : s.z) + r;
      if (!overlaps(b, minX, s.y + EPS, minZ, maxX, s.y + h, maxZ)) continue;
      const rise = b.max[1] - s.y;
      if (rise > 0 && rise <= PLAYER.step && s.onGround) {
        const nx = ax === 0 ? next : s.x, nz = ax === 2 ? next : s.z;
        if (!blocked(world, nx, b.max[1], nz, h, r)) { s.y = b.max[1]; continue; }
      }
      if (v > 0) next = Math.min(next, b.min[ax] - r - EPS);
      else next = Math.max(next, b.max[ax] + r + EPS);
      if (ax === 0) s.vx = 0; else s.vz = 0;
    }
    const lo = ax === 0 ? B.minX : B.minZ, hi = ax === 0 ? B.maxX : B.maxZ;
    next = Math.max(lo + r, Math.min(hi - r, next));
    if (ax === 0) s.x = next; else s.z = next;
  };

  axis(0);
  axis(2);

  // Vertical
  s.vy -= PLAYER.gravity * dt;
  let ny = s.y + s.vy * dt;
  let ground = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!overlaps(b, s.x - r, Math.min(ny, s.y) + EPS, s.z - r, s.x + r, Math.max(ny, s.y) + h, s.z + r)) continue;
    if (s.vy <= 0 && b.max[1] <= s.y + EPS + 0.05) { ny = b.max[1]; s.vy = 0; ground = true; }
    else if (s.vy > 0 && b.min[1] >= s.y + h - 0.05) { ny = b.min[1] - h - EPS; s.vy = 0; }
  }
  if (ny <= 0) { ny = 0; s.vy = 0; ground = true; }
  // Snap down small steps while walking so stairs feel smooth.
  if (!ground && s.onGround && s.vy <= 0) {
    const probe = groundHeightAt(world, s.x, s.z, s.y + 0.05, r);
    if (s.y - probe <= PLAYER.step) { ny = probe; s.vy = 0; ground = true; }
  }
  s.y = ny;
  s.onGround = ground;
  return ground;
}

/** Highest walkable surface beneath (x, z) whose top is at or below `fromY`. */
export function groundHeightAt(world, x, z, fromY, r = 0.05) {
  let best = 0;
  const boxes = allBoxes(world);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.max[0] > x - r && b.min[0] < x + r && b.max[2] > z - r && b.min[2] < z + r) {
      if (b.max[1] <= fromY + EPS && b.max[1] > best) best = b.max[1];
    }
  }
  return best;
}

/** Slab ray test; returns entry distance or -1, and writes the hit axis into out.axis. */
export function rayBox(ox, oy, oz, dx, dy, dz, b, maxT, out) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return -1;
    } else {
      const inv = 1 / d[a];
      let t1 = (b.min[a] - o[a]) * inv, t2 = (b.max[a] - o[a]) * inv;
      let s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (out) { out.axis = axis; out.sign = sign; }
  return tmin;
}

const _hit = { axis: 0, sign: 0 };

/** Ray against all world solids. dir must be normalised. */
export function raycastWorld(world, o, d, maxDist = 200, ignore = null) {
  let best = maxDist, hitBox = null, axis = 1, sign = 1;
  const boxes = allBoxes(world);
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b === ignore || b.noRay) continue;
    const t = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], b, best, _hit);
    if (t >= 0 && t < best) { best = t; hitBox = b; axis = _hit.axis; sign = _hit.sign; }
  }
  // ground plane
  if (d[1] < -1e-6) {
    const tg = -o[1] / d[1];
    if (tg >= 0 && tg < best) { best = tg; hitBox = 'ground'; axis = 1; sign = 1; }
  }
  if (!hitBox) return null;
  const normal = [0, 0, 0];
  normal[axis < 0 ? 1 : axis] = axis < 0 ? 1 : sign;
  return { t: best, point: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], normal, box: hitBox };
}

/** Line-of-sight between two points (true if unobstructed). */
export function lineOfSight(world, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const hit = raycastWorld(world, a, [dx / len, dy / len, dz / len], len);
  return !hit || hit.t >= len - 0.05;
}

/** Hitboxes for a player standing at p ({x,y,z,crouch}). */
export function hitboxes(p) {
  const c = p.crouch ? 1 : 0;
  const top = c ? PLAYER.crouchHeight : PLAYER.height;
  const headY = p.y + top - 0.2;
  return {
    head: { c: [p.x, headY, p.z], r: 0.19 },
    body: { min: [p.x - 0.3, p.y + (c ? 0.45 : 0.8), p.z - 0.3], max: [p.x + 0.3, headY - 0.13, p.z + 0.3] },
    legs: { min: [p.x - 0.24, p.y, p.z - 0.24], max: [p.x + 0.24, p.y + (c ? 0.45 : 0.8), p.z + 0.24] },
  };
}

function raySphere(o, d, c, r, maxT) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : -1;
}

/** Ray vs player hitboxes. Returns {t, part} or null. */
export function rayPlayer(o, d, p, maxT) {
  const hb = hitboxes(p);
  let best = maxT, part = null;
  const th = raySphere(o, d, hb.head.c, hb.head.r, best);
  if (th >= 0 && th < best) { best = th; part = 'head'; }
  const tb = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], hb.body, best, null);
  if (tb >= 0 && tb < best) { best = tb; part = 'body'; }
  const tl = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], hb.legs, best, null);
  if (tl >= 0 && tl < best) { best = tl; part = 'legs'; }
  return part ? { t: best, part } : null;
}

/** Direction vector from yaw/pitch (yaw 0 looks toward -Z). */
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Random direction within a cone (degrees) around d, using provided rng. */
export function spreadDir(d, deg, rng = Math.random) {
  if (deg <= 0) return d.slice();
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * Math.tan((deg * Math.PI) / 180);
  // orthonormal basis
  const up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let ux = up[1] * d[2] - up[2] * d[1], uy = up[2] * d[0] - up[0] * d[2], uz = up[0] * d[1] - up[1] * d[0];
  const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
  const vx = d[1] * uz - d[2] * uy, vy = d[2] * ux - d[0] * uz, vz = d[0] * uy - d[1] * ux;
  const x = d[0] + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
  const y = d[1] + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
  const z = d[2] + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Barrier box for Bulwark's ability, placed in front of the player. */
export function barrierBox(x, y, z, yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const cx = x + fx * 1.6, cz = z + fz * 1.6;
  // snap to the dominant axis so the barrier stays axis-aligned for collision
  const alongX = Math.abs(fz) >= Math.abs(fx);
  const hw = alongX ? 1.3 : 0.12, hd = alongX ? 0.12 : 1.3;
  return { min: [cx - hw, y, cz - hd], max: [cx + hw, y + 1.9, cz + hd], kind: 'barrier', dynamic: true, alongX };
}
