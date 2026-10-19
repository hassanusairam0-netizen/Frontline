import * as neon from './neon.js';
import * as desert from './desert.js';
import * as arctic from './arctic.js';
import * as industrial from './industrial.js';

export const MAP_MODULES = { neon, desert, arctic, industrial };
export const MAP_LIST = [neon.meta, desert.meta, arctic.meta, industrial.meta];
export const MAPS = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));

const cache = {};
/** Returns the (cached) layout: objects, colliders, spawns, bounds. */
export function getLayout(id) {
  if (!cache[id]) cache[id] = (MAP_MODULES[id] || neon).layout();
  return cache[id];
}
