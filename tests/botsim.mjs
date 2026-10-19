// Headless bot-vs-bot simulation on every map: verifies navigation, line of
// sight, aiming, firing, reloading and round resolution without a browser.
// Usage: node tests/botsim.mjs [difficulty] [seconds]
import { getLayout, MAP_LIST } from '../src/shared/maps/index.js';
import { createWorld, moveBody, raycastWorld, rayPlayer, dirFromAngles, spreadDir, PLAYER } from '../src/shared/collision.js';
import { damageFor } from '../src/shared/weapons.js';
import { NavGrid } from '../src/game/nav.js';
import { Fighter } from '../src/game/Fighter.js';
import { Bot } from '../src/game/Bot.js';

const diff = process.argv[2] || 'normal';
const maxT = Number(process.argv[3] || 90);
let failures = 0;

function spreadFor(f) {
  const d = f.weapon.def; let s = f.aiming ? d.spread.ads : d.spread.hip;
  s += d.spread.move * Math.min(1, Math.hypot(f.vx, f.vz) / PLAYER.walk) * (f.aiming ? 0.45 : 1);
  if (f.crouch) s *= 0.75; return s;
}

for (const meta of MAP_LIST) {
  const layout = getLayout(meta.id);
  const world = createWorld(layout.colliders, layout.bounds);
  const nav = new NavGrid(layout);
  const results = [];
  for (let round = 0; round < 4; round++) {
    const mk = (id, side, op, w) => new Fighter({ id, name: id, side, isBot: true, loadout: { operator: op, primary: w, secondary: 'vesper' } });
    const a = mk('A', 'A', 'volt', round % 2 ? 'hornet' : 'vk7'), b = mk('B', 'B', 'phantom', round % 2 ? 'ridgeline' : 'vk7');
    a.spawnAt(layout.spawns.A[round % 3], false); b.spawnAt(layout.spawns.B[(round + 1) % 3], false);
    a.ability.cd = b.ability.cd = 1e9; // abilities need the renderer; covered in browser tests
    const game = { world, nav, opponentOf: (f) => (f === a ? b : a) };
    const bots = [new Bot(a, game, diff), new Bot(b, game, diff)];
    let t = 0, shots = 0, hits = 0, winner = null, travelled = 0;
    const dt = 1 / 30;
    while (t < maxT && !winner) {
      t += dt;
      for (const [i, f] of [a, b].entries()) {
        const bot = bots[i], tgt = i ? a : b;
        for (const w of f.weapons) w.update(dt);
        const I = bot.think(dt, tgt);
        if (I.switchTo >= 0) f.slot = I.switchTo;
        if (I.reload) f.weapon.startReload();
        f.aiming = !!I.ads && !I.sprint;
        if (I.fire && f.weapon.canFire && !I.sprint) {
          const spread = spreadFor(f); f.weapon.fire(); shots++;
          const o = [f.x, f.eyeY, f.z]; const base = dirFromAngles(f.yaw, f.pitch);
          for (let p = 0; p < f.weapon.def.pellets; p++) {
            const d = spreadDir(base, spread); const wh = raycastWorld(world, o, d, 220);
            const ph = rayPlayer(o, d, tgt.hitState, wh ? wh.t : 220);
            if (ph) { hits++; tgt.hp -= damageFor(f.weapon.def, ph.t, ph.part); bots[1 - i].damaged([f.x, f.y, f.z]); }
          }
          bots[1 - i].heard([f.x, f.y, f.z], 1);
          if (tgt.hp <= 0) { tgt.alive = false; winner = f.id; }
        }
        f.crouch = !!I.crouch;
        f.crouchT = f.crouch ? 1 : 0;
        const sp = (f.crouch ? PLAYER.crouchSpeed : I.sprint ? PLAYER.sprint : PLAYER.walk) * f.speedMult * (f.aiming ? PLAYER.adsSpeed : 1);
        f.vx += ((I.mx || 0) * sp - f.vx) * 0.3; f.vz += ((I.mz || 0) * sp - f.vz) * 0.3;
        if (I.jump && f.onGround) f.vy = PLAYER.jump;
        const ox = f.x, oz = f.z;
        moveBody(world, f, dt, f.height);
        travelled += Math.hypot(f.x - ox, f.z - oz);
      }
    }
    results.push({ round, winner: winner || 'timeout', t: +t.toFixed(1), shots, hits, travelled: Math.round(travelled), states: bots.map((x) => x.state).join('/') });
  }
  const decided = results.filter((r) => r.winner !== 'timeout').length;
  console.log(`${meta.id.padEnd(11)} decided ${decided}/4  ` + results.map((r) => `[${r.winner} ${r.t}s ${r.hits}/${r.shots} moved ${r.travelled}m]`).join(' '));
  if (decided < 2) failures++;
}
if (failures) { console.error(`FAIL: bots failed to resolve fights on ${failures} map(s)`); process.exit(1); }
console.log('OK');
