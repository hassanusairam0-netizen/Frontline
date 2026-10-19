import { createKit } from './kit.js';

export const meta = {
  id: 'arctic', index: '03', name: 'ARCTIC FACILITY',
  tagline: 'A research station gone dark in a whiteout.',
  desc: 'A polar research complex half-buried in snow. A sealed service corridor cuts through the middle, flanked by prefab labs, frozen fuel tanks and pipelines.',
  strategy: 'The corridor is fast but predictable. Use the pipelines and lab modules to rotate unseen through the blowing snow.',
  difficulty: 4, size: 'MEDIUM', tags: ['BLIZZARD', 'CORRIDORS', 'LOW VISIBILITY'], time: '11:05 · WHITEOUT',
};

export function layout() {
  const k = createKit({ minX: -32, maxX: 32, minZ: -26, maxZ: 26 });
  const P = Math.PI;
  k.perimeter(8, 'snowbank');

  // Central service corridor (enclosed, roofed)
  k.sym('iwall', -8.5, -3.2, 7, 0.4, 3.4);
  k.sym('iwall', 4.5, -3.2, 15, 0.4, 3.4);
  k.add('roof', 0, 0, 24.4, 6.8, 0.3, { y: 3.4, style: 'metal' });
  k.sym('crate', -1, 1.6, 1.2, 1.2, 1.2);
  k.sym('crate_metal', 7, -1.9, 1.4, 1.4, 1.1);
  k.sym('lockers', -10.8, -2.55, 1.6, 0.8, 2.0);
  for (const x of [-9, -3, 3, 9]) k.deco('striplight', x, 3.35, 0, {});

  // Lab modules, tanks, pipelines
  k.sym('module', -15, -14, 7, 3.2, 3.2, { seed: 1 });
  k.sym('module', 1, -18, 7, 3.2, 3.2, { seed: 2 });
  k.sym('module', 15, -11, 3.2, 7, 3.2, { seed: 3 });
  k.sym('tank', 7, -13, 5, 5, 6);
  k.sym('pipes', -5, -9, 10, 0.9, 1.15);
  k.sym('pipes', 24, -19, 0.9, 8, 1.15);

  // Ice, drifts, crates
  k.sym('ice', -24, -9, 3.5, 2.8, 1.8, { seed: 4 });
  k.sym('ice', -22, 17, 3, 3, 1.4, { seed: 8 });
  k.sym('crate', -24, 4, 1.4, 1.4, 1.4);
  k.sym('crate_metal', -20, -3, 1.5, 1.5, 1.2);
  k.sym('barrier', -27, -18, 3, 0.65, 1.05);
  k.sym('crate', -9, 13, 1.3, 1.3, 2.6, { stack: 2 });

  k.deco('mast', 0, 3.7, -18, { tall: 9 });
  k.deco('mast', 0, 3.7, 18, { tall: 9 });
  for (const [x, z] of [[-15, -12.3], [15, 12.3], [13.3, -11], [-13.3, 11], [1, -16.3], [-1, 16.3]]) k.deco('coldlight', x, 2.6, z, {});

  k.symSpawn(-29, -2, -P / 2);
  k.symSpawn(-29, 6, -P / 2);
  k.symSpawn(-28, -12, -P / 2);
  return k;
}
