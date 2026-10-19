import { createKit } from './kit.js';

export const meta = {
  id: 'industrial', index: '04', name: 'ABANDONED INDUSTRIAL ZONE',
  tagline: 'Steel catwalks above, machinery below, light cutting through the dust.',
  desc: 'A decommissioned processing plant. Raised catwalks line both walls above a floor of tanks, presses and dead conveyor lines, lit by shafts of sunlight through a broken roof.',
  strategy: 'The catwalks give height but expose you to the floor. Fight around the tanks and press, and punish anyone who lingers upstairs.',
  difficulty: 3, size: 'MEDIUM', tags: ['INTERIOR', 'CATWALKS', 'GOD RAYS'], time: '09:20 · DUST',
};

export function layout() {
  const k = createKit({ minX: -32, maxX: 32, minZ: -24, maxZ: 24 });
  const P = Math.PI;
  k.perimeter(13, 'plantwall');

  // Catwalks with stairs (one per side)
  k.walkway(0, -22.25, 40, 3.5, 3.6, ['+z', '+x']);
  k.stairs(-27, -23.1, '+x', 7, 1.6, 3.6);
  k.walkway(0, 22.25, 40, 3.5, 3.6, ['-z', '-x']);
  k.stairs(27, 23.1, '-x', 7, 1.6, 3.6);
  for (const x of [-16, -8, 0, 8, 16]) {
    k.add('post', x, -20.7, 0.3, 0.3, 3.4);
    k.add('post', -x, 20.7, 0.3, 0.3, 3.4);
  }

  // Columns, tanks, press, conveyors
  k.sym('column', -16, -10, 0.7, 0.7, 12);
  k.sym('column', 0, -10, 0.7, 0.7, 12);
  k.sym('column', 16, -10, 0.7, 0.7, 12);
  k.sym('tank', -9, -9, 5, 5, 7.5);
  k.add('press', 0, 0, 4, 3, 4.6);
  k.sym('conveyor', -14, 6, 9, 1.3, 1.05);
  k.sym('container', -22, -10, 6.1, 2.5, 2.6, { color: 0x3d4d5c });
  k.sym('crate', -24, 2, 1.4, 1.4, 1.4);
  k.sym('crate', -22.6, 3.4, 1.2, 1.2, 2.4, { stack: 2 });
  k.sym('pallets', 6, -16.5, 2.4, 1.6, 1.3);
  k.sym('barrels', -5, 13, 1.6, 1.6, 1.2);
  k.sym('machine', 18, -17.8, 4, 3, 2.6);
  k.sym('crate_metal', 26, -12, 1.5, 1.5, 1.2);

  // Roof with skylight gaps (visual), hanging lamps, chains
  k.deco('plantroof', 0, 12, 0, { w: 64, d: 48 });
  for (const [x, z] of [[-12, 0], [12, 0], [0, -14], [0, 14], [-24, -14], [24, 14]]) k.deco('hanglamp', x, 8, z, {});

  k.symSpawn(-29, 0, -P / 2);
  k.symSpawn(-29, -7, -P / 2);
  k.symSpawn(-28, 8, -P / 2);
  return k;
}
