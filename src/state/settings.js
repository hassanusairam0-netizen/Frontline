import { Emitter } from '../engine/emitter.js';
import { load, save } from './storage.js';

const KEY = 'frontline.settings.v1';
const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const DEFAULTS = {
  quality: isMobile ? 'medium' : 'high',
  fov: 78,
  sensitivity: 1.0,
  adsSensitivity: 0.8,
  invertY: false,
  master: 0.8,
  sfx: 0.9,
  music: 0.45,
  ambience: 0.7,
  showFps: false,
  motionBlurUi: true,
  crosshair: 'amber',
  playerName: '',
  serverUrl: '',
};

export const QUALITY = {
  low: { label: 'LOW', pixelRatio: 0.75, shadows: 0, shadowSize: 1024, bloom: false, msaa: 0, dof: false, particles: 0.4 },
  medium: { label: 'MEDIUM', pixelRatio: 1, shadows: 1, shadowSize: 1024, bloom: true, msaa: 2, dof: false, particles: 0.7 },
  high: { label: 'HIGH', pixelRatio: 1.5, shadows: 1, shadowSize: 2048, bloom: true, msaa: 4, dof: true, particles: 1 },
  ultra: { label: 'ULTRA', pixelRatio: 2, shadows: 1, shadowSize: 4096, bloom: true, msaa: 4, dof: true, particles: 1.3 },
};

class Settings extends Emitter {
  constructor() {
    super();
    this.values = { ...DEFAULTS, ...load(KEY, {}) };
  }
  get(k) { return this.values[k]; }
  set(k, v) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    save(KEY, this.values);
    this.emit('change', k, v);
    this.emit(`change:${k}`, v);
  }
  quality() { return QUALITY[this.values.quality] || QUALITY.high; }
  reset() { this.values = { ...DEFAULTS, playerName: this.values.playerName }; save(KEY, this.values); this.emit('change', '*'); }
}

export const settings = new Settings();
