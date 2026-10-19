import { createKit } from './kit.js';

export const meta = {
  id: 'desert', index: '02', name: 'DESERT OUTPOST',
  tagline: 'Hard light, long sightlines, two watchtowers.',
  desc: 'A forward operating base baking under a late-afternoon sun. A concrete command bunker anchors the center, ringed by HESCO walls, containers and two elevated watchtowers.',
  strategy: 'Precision rifles own the towers. Close the distance through the bunker or the container lanes to deny the angle.',
  difficulty: 2, size: 'LARGE', tags: ['DAY', 'OPEN', 'VERTICAL'], time: '16:40 · CLEAR',
};

export function layout() {
  const k = createKit({ minX: -34, maxX: 34, minZ: -28, maxZ: 28 });
  const P = Math.PI;
  k.perimeter(8, 'cliff');

  // Command bunker with four doorways
  k.sym('cwall', -4, -5, 6, 0.5, 3.2);
  k.sym('cwall', 4, -5, 6, 0.5, 3.2);
  k.sym('cwall', -7, -3.25, 0.5, 3.5, 3.2);
  k.sym('cwall', -7, 3.25, 0.5, 3.5, 3.2);
  k.add('roof', 0, 0, 14.6, 10.6, 0.35, { y: 3.2, style: 'concrete' });
  k.sym('crate', -3, -2.6, 1.2, 1.2, 1.2);
  k.sym('crate_metal', 4.6, -3.4, 1.4, 1.2, 1.0);

  // Containers
  k.sym('container', -18, -8, 2.5, 6.1, 2.6, { color: 0x8a5a3a });
  k.sym('container', 14, -13, 6.1, 2.5, 2.6, { color: 0x4d5a4a });
  k.sym('container', 23, -2, 2.5, 6.1, 2.6, { color: 0x6b6f72 });
  k.sym('container', 23, -2, 2.5, 6.1, 2.6, { y: 2.6, color: 0x8a5a3a });

  // HESCO and sandbag lines
  k.sym('hesco', -8, -15, 6, 1.1, 1.6);
  k.sym('hesco', 0, -19.5, 4, 1.1, 1.6);
  k.sym('hesco', -27, -10, 1.1, 6, 1.8);
  k.sym('hesco', 30, -6, 1.1, 4, 1.8);
  k.sym('sandbags', -12, 1, 1.0, 3.6, 1.1);
  k.sym('sandbags', 10, -20.5, 3.5, 1.0, 1.1);
  k.sym('sandbags', -3, -23.2, 3.2, 1.0, 1.0);

  // Vehicles, rocks, clutter
  k.sym('truck', -6, 13, 6.5, 2.4, 2.7);
  k.sym('rock', -28.5, -1, 4, 3.2, 2.4, { seed: 3 });
  k.sym('rock', 27, -21, 5, 4, 3, { seed: 5 });
  k.sym('rock', -30, 20, 4, 5, 3.4, { seed: 9 });
  k.sym('barrels', 9, -6.6, 1.6, 1.6, 1.2);
  k.sym('generator', -10.5, -3, 2.2, 1.3, 1.5);

  // Watchtowers (elevated, reached by stairs)
  const tower = (tx, tz, s) => {
    k.walkway(tx, tz, 4, 4, 3.6, ['+z', '-z', s > 0 ? '-x' : '+x'], { style: 'tower' });
    for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) k.add('post', tx + ox, tz + oz, 0.25, 0.25, 3.4);
    k.stairs(tx + s * 7.2, tz + s * 1.3, s > 0 ? '-x' : '+x', 5.2, 1.3, 3.6, { style: 'wood' });
    k.deco('towerroof', tx, 3.6, tz, {});
    k.add('sandbags', tx, tz + s * -1.75, 3.6, 0.5, 0.9, { y: 3.6, solid: true });
  };
  tower(-21, 14, 1);
  tower(21, -14, -1);

  // Camo nets, lights, antenna (visual)
  k.deco('net', 0, 3.8, -9, { w: 6, d: 4 });
  k.deco('net', 0, 3.8, 9, { w: 6, d: 4 });
  k.deco('mast', -2, 3.55, 2, {});
  k.deco('floodlight', -16, 0, -16, { yaw: 0.7 });
  k.deco('floodlight', 16, 0, 16, { yaw: 0.7 + P });

  k.symSpawn(-5, -25.5, P);
  k.symSpawn(5, -25, P);
  k.symSpawn(14, -24, P);
  return k;
}
