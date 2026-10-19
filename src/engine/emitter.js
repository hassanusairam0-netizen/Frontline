export class Emitter {
  constructor() { this._l = new Map(); }
  on(ev, fn) { if (!this._l.has(ev)) this._l.set(ev, new Set()); this._l.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._l.get(ev)?.delete(fn); }
  emit(ev, ...a) { this._l.get(ev)?.forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); }
}
