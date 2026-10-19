// Navigation grid built from the map's collision layout: walkability, cover
// cells (next to solid geometry tall enough to hide behind), A* with smoothing.

const CELL = 0.75;
const CLEAR = 0.42;

export class NavGrid {
  constructor(layout) {
    const B = layout.bounds;
    this.B = B;
    this.w = Math.ceil((B.maxX - B.minX) / CELL);
    this.h = Math.ceil((B.maxZ - B.minZ) / CELL);
    this.walk = new Uint8Array(this.w * this.h);
    this.cover = new Float32Array(this.w * this.h); // cover height (0 = none)
    this.coverDir = new Array(this.w * this.h).fill(null);
    const boxes = layout.colliders.filter((b) => b.min[1] < 1.7 && b.max[1] > 0.5);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = B.minX + (i + 0.5) * CELL, z = B.minZ + (j + 0.5) * CELL;
      let ok = x - CLEAR > B.minX && x + CLEAR < B.maxX && z - CLEAR > B.minZ && z + CLEAR < B.maxZ;
      if (ok) for (const b of boxes) {
        if (b.max[0] > x - CLEAR && b.min[0] < x + CLEAR && b.max[2] > z - CLEAR && b.min[2] < z + CLEAR) { ok = false; break; }
      }
      this.walk[j * this.w + i] = ok ? 1 : 0;
    }
    // cover: walkable cell with a tall solid within 1.1 m
    const tall = layout.colliders.filter((b) => b.max[1] >= 1.0 && b.min[1] < 0.6 && !b.noRay);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i;
      if (!this.walk[k]) continue;
      const x = B.minX + (i + 0.5) * CELL, z = B.minZ + (j + 0.5) * CELL;
      for (const b of tall) {
        const dx = Math.max(b.min[0] - x, 0, x - b.max[0]), dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
        if (Math.hypot(dx, dz) < 1.1) {
          if (b.max[1] > this.cover[k]) {
            this.cover[k] = Math.min(3, b.max[1]);
            const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
            const l = Math.hypot(cx - x, cz - z) || 1;
            this.coverDir[k] = [(cx - x) / l, (cz - z) / l];
          }
        }
      }
    }
  }

  cellOf(x, z) { return [Math.floor((x - this.B.minX) / CELL), Math.floor((z - this.B.minZ) / CELL)]; }
  center(i, j) { return [this.B.minX + (i + 0.5) * CELL, this.B.minZ + (j + 0.5) * CELL]; }
  ok(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[j * this.w + i] === 1; }

  nearestWalkable(x, z) {
    let [i, j] = this.cellOf(x, z);
    if (this.ok(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (this.ok(i + di, j + dj)) return [i + di, j + dj];
    }
    return [i, j];
  }

  /** A* path from world (ax,az) to (bx,bz). Returns smoothed list of [x,z] or null. */
  path(ax, az, bx, bz) {
    const [si, sj] = this.nearestWalkable(ax, az), [ti, tj] = this.nearestWalkable(bx, bz);
    const W = this.w, N = W * this.h;
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const start = sj * W + si, goal = tj * W + ti;
    const heap = [];
    const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const hfn = (k) => { const i = k % W, j = (k / W) | 0; const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[start] = 0; push(start, hfn(start));
    let iter = 0;
    while (heap.length && iter++ < 20000) {
      const [, k] = pop();
      if (k === goal) break;
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % W, j = (k / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!this.ok(ni, nj)) continue;
        if (di && dj && (!this.ok(i + di, j) || !this.ok(i, j + dj))) continue;
        const nk = nj * W + ni;
        const cost = g[k] + (di && dj ? 1.414 : 1) + (this.cover[nk] ? -0.05 : 0);
        if (cost < g[nk]) { g[nk] = cost; came[nk] = k; push(nk, cost + hfn(nk)); }
      }
    }
    if (came[goal] === -1 && goal !== start) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) { cells.push(k); if (k === start) break; }
    cells.reverse();
    const pts = cells.map((k) => this.center(k % W, (k / W) | 0));
    pts[pts.length - 1] = [bx, bz];
    return this.smooth([[ax, az], ...pts.slice(1)]);
  }

  /** Walkable straight segment test (samples the grid). */
  clearLine(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const [i, j] = this.cellOf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!this.ok(i, j)) return false;
    }
    return true;
  }

  smooth(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clearLine(pts[i], pts[j])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }

  randomPoint(rng = Math.random) {
    for (let t = 0; t < 200; t++) {
      const i = Math.floor(rng() * this.w), j = Math.floor(rng() * this.h);
      if (this.ok(i, j)) return this.center(i, j);
    }
    return [0, 0];
  }

  /** Cover cells within radius of (x,z), as [{x,z,h,dir}] */
  coverNear(x, z, radius) {
    const out = [];
    const [ci, cj] = this.cellOf(x, z);
    const r = Math.ceil(radius / CELL);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (!this.ok(i, j)) continue;
      const k = j * this.w + i;
      if (!this.cover[k]) continue;
      const [px, pz] = this.center(i, j);
      if (Math.hypot(px - x, pz - z) <= radius) out.push({ x: px, z: pz, h: this.cover[k], dir: this.coverDir[k] });
    }
    return out;
  }
}
