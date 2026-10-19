import * as THREE from 'three';
import { MapWorld } from '../world/MapWorld.js';

// Slow cinematic orbit around a fully built map — the real environment that loads into matches.

const ORBITS = {
  neon: { r: 33, h: 29, target: [0, 0, 0], speed: 0.05 },
  desert: { r: 38, h: 16, target: [0, 2, 0], speed: 0.04 },
  arctic: { r: 30, h: 12, target: [0, 2, 0], speed: 0.05 },
  industrial: { r: 22, h: 8.5, target: [0, 2.5, 0], speed: 0.05 },
};

export class MapStage {
  constructor(engine, mapId) {
    this.engine = engine;
    this.map = new MapWorld(engine, mapId);
    this.scene = this.map.scene;
    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 700);
    this.o = ORBITS[this.map.id];
    this.angle = 0.6;
    this.drag = 0;
    this.intro = 0;
    this.post = { ...this.map.post(), vignette: 0.55 };
  }
  dragBy(dx) { this.drag += dx * 0.004; }
  update(dt, t) {
    this.intro = Math.min(1, this.intro + dt * 0.4);
    const e = 1 - Math.pow(1 - this.intro, 3);
    this.angle += dt * this.o.speed + this.drag * 0.1;
    this.drag *= Math.exp(-dt * 4);
    const r = this.o.r * (1.25 - 0.25 * e), h = this.o.h * (1.3 - 0.3 * e);
    this.camera.position.set(Math.cos(this.angle) * r, h, Math.sin(this.angle) * r);
    this.camera.lookAt(...this.o.target);
    this.map.update(dt, t, this.camera);
  }
  dispose() { this.map.dispose(); }
}

/** Top-down tactical plan of a map drawn from its real collision layout. */
export function drawMapPlan(layout, w = 480, h = 270, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  const x = c.getContext('2d');
  x.scale(2, 2);
  const B = layout.bounds;
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#16181c'); g.addColorStop(1, '#0d0e11');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const pad = 14;
  const sx = (w - pad * 2) / (B.maxX - B.minX), sz = (h - pad * 2) / (B.maxZ - B.minZ);
  const s = Math.min(sx, sz);
  const ox = (w - (B.maxX - B.minX) * s) / 2, oz = (h - (B.maxZ - B.minZ) * s) / 2;
  const X = (v) => ox + (v - B.minX) * s, Z = (v) => oz + (v - B.minZ) * s;
  // grid
  x.strokeStyle = 'rgba(255,255,255,0.04)'; x.lineWidth = 1;
  for (let gx = Math.ceil(B.minX / 4) * 4; gx <= B.maxX; gx += 4) { x.beginPath(); x.moveTo(X(gx), Z(B.minZ)); x.lineTo(X(gx), Z(B.maxZ)); x.stroke(); }
  for (let gz = Math.ceil(B.minZ / 4) * 4; gz <= B.maxZ; gz += 4) { x.beginPath(); x.moveTo(X(B.minX), Z(gz)); x.lineTo(X(B.maxX), Z(gz)); x.stroke(); }
  x.strokeStyle = 'rgba(255,255,255,0.18)'; x.strokeRect(X(B.minX), Z(B.minZ), (B.maxX - B.minX) * s, (B.maxZ - B.minZ) * s);
  // solids, shaded by height
  const sorted = layout.colliders.filter((b) => !['perimeter', 'cliff', 'snowbank', 'plantwall', 'rail'].includes(b.kind)).sort((a, b) => a.max[1] - b.max[1]);
  for (const b of sorted) {
    const hgt = b.max[1];
    const k = Math.min(1, hgt / 8);
    const elevated = b.min[1] > 2;
    x.fillStyle = elevated ? 'rgba(90,169,230,0.22)' : `rgba(${Math.round(60 + k * 120)},${Math.round(62 + k * 112)},${Math.round(68 + k * 100)},${0.55 + k * 0.35})`;
    x.fillRect(X(b.min[0]), Z(b.min[2]), (b.max[0] - b.min[0]) * s, (b.max[2] - b.min[2]) * s);
  }
  // spawns
  const dot = (p, col, label) => {
    x.fillStyle = col; x.save(); x.translate(X(p.x), Z(p.z)); x.rotate(Math.PI / 4); x.fillRect(-3.5, -3.5, 7, 7); x.restore();
    if (label) { x.font = '600 9px "Barlow Condensed", sans-serif'; x.fillText(label, X(p.x) + 7, Z(p.z) + 3); }
  };
  layout.spawns.A.forEach((p, i) => dot(p, '#e8a33d', i === 0 ? 'A' : ''));
  layout.spawns.B.forEach((p, i) => dot(p, '#5aa9e6', i === 0 ? 'B' : ''));
  if (opts.label) { x.fillStyle = 'rgba(255,255,255,0.4)'; x.font = '600 10px "JetBrains Mono", monospace'; x.fillText(opts.label, 10, h - 10); }
  return c;
}
