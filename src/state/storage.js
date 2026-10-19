// localStorage can throw (private mode, blocked storage); never let that break the game.
export function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
