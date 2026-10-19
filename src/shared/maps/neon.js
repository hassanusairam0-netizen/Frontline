import { createKit } from './kit.js';

export const meta = {
  id: 'neon', index: '01', name: 'NEON DISTRICT',
  tagline: 'Rain-soaked streets. Three lanes. Nowhere dry to hide.',
  desc: 'A dense downtown block at 2 AM. A wide main street splits two service lanes, linked by narrow alleys. Wet asphalt mirrors every sign, and every sign gives you away.',
  strategy: 'Hold the kiosk for main-street control, or flank through the north and south lanes. Alleys reward patience.',
  difficulty: 3, size: 'MEDIUM', tags: ['NIGHT', 'RAIN', 'THREE LANES'], time: '02:14 · HEAVY RAIN',
};

export function layout() {
  const k = createKit({ minX: -32, maxX: 32, minZ: -22, maxZ: 22 });
  const P = Math.PI;

  // City blocks (point-symmetric)
  k.sym('building', -9.75, -11, 12.5, 8, 12, { style: 'brick', facades: ['+z', '-z'], seed: 1 });
  k.sym('building', 9.75, -11, 12.5, 8, 15, { style: 'concrete', facades: ['+z', '-z'], seed: 2 });

  // Skyline outside the bounds (visual only — perimeter colliders contain players)
  for (let i = 0; i < 6; i++) {
    const x = -30 + i * 12;
    const h = 14 + ((i * 37) % 11);
    k.add('building', x, -27, 11.6, 10, h, { solid: false, style: i % 2 ? 'concrete' : 'brick', facades: ['+z'], seed: 10 + i });
    k.add('building', -x, 27, 11.6, 10, h + 3, { solid: false, style: i % 2 ? 'brick' : 'concrete', facades: ['-z'], seed: 20 + i });
  }
  for (let i = 0; i < 4; i++) {
    const z = -18 + i * 12;
    k.add('building', -37, z, 10, 11.6, 16 + i * 2, { solid: false, style: 'concrete', facades: ['+x'], seed: 30 + i });
    k.add('building', 37, -z, 10, 11.6, 18 + i, { solid: false, style: 'brick', facades: ['-x'], seed: 40 + i });
  }
  k.perimeter(10);

  // Main street cover
  k.add('kiosk', 0, 0, 2.4, 2.4, 2.7);
  k.sym('car', -8, -3.6, 4.4, 1.9, 1.45, { color: 0x24384c });
  k.sym('barrier', -3.5, 4.2, 3, 0.65, 1.05);
  k.sym('shelter', 13, -6.2, 3.6, 0.35, 2.3);

  // Lanes
  k.sym('dumpster', -10, -19.6, 2.1, 1.3, 1.45);
  k.sym('crate', -1.8, -18, 1.3, 1.3, 1.3);
  k.sym('crate', 2.2, -20.5, 1.3, 1.3, 2.6, { stack: 2 });
  k.sym('van', 12, -18.6, 5, 2.3, 2.5);

  // Spawn plazas
  k.sym('crate', -22, -6, 1.4, 1.4, 1.4);
  k.sym('crate', -21, 5.5, 1.4, 1.4, 2.8, { stack: 2 });
  k.sym('barrier', -25, 0, 0.65, 3, 1.05);
  k.sym('planter', -19.5, -12.5, 2.6, 1.1, 0.9);
  k.sym('planter', -19.5, 12.5, 2.6, 1.1, 0.9);
  k.sym('car', -24, 14, 1.9, 4.4, 1.45, { color: 0x3a3a3c });
  k.sym('lowwall', -28, -15, 4, 0.4, 1.2);

  // Street lamps and neon (visual)
  for (const x of [-24, -12, 0, 12, 24]) {
    k.deco('lamp', x, 0, -6.6, { facing: '+z' });
    k.deco('lamp', -x, 0, 6.6, { facing: '-z' });
  }
  const signs = [
    ['OPEN 24H', -13, 5.2, -6.95, '+z', 0xe8a33d], ['HOTEL ORIEL', -6, 7.5, -6.95, '+z', 0x5aa9e6],
    ['RAMEN', 7, 4.6, -6.95, '+z', 0xff6a3d], ['VAULT', 13.5, 6.4, -6.95, '+z', 0x5aa9e6],
    ['PHARMACY', 13, 4.8, 6.95, '-z', 0x4fc3b0], ['LUCKY 8', 6, 6.6, 6.95, '-z', 0xe8a33d],
    ['NOODLE BAR', -7, 4.4, 6.95, '-z', 0xff6a3d], ['ARCADE', -13.5, 7.2, 6.95, '-z', 0x8fb8ff],
    ['PARKING', -3.6, 3.8, -13, '+x', 0xe8a33d], ['CLINIC', 3.6, 3.8, 13, '-x', 0x5aa9e6],
    ['KARAOKE', -20, 9, -21.95, '+z', 0xff4f7a], ['BAR', 20, 9, 21.95, '-z', 0xe8a33d],
  ];
  for (const [text, x, y, z, facing, color] of signs) k.deco('neon', x, y, z, { text, facing, color });

  k.symSpawn(-29, -3, -P / 2);
  k.symSpawn(-29, 4, -P / 2);
  k.symSpawn(-27, 11, -P / 2);
  return k;
}
