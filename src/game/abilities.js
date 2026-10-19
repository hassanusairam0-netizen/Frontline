import * as THREE from 'three';
import { barrierBox } from '../shared/collision.js';
import { createBarrierMesh, createPulseRing, createAura, createRingBurst, createRevealMarker } from '../models/fx.js';
import { audio } from '../engine/audio.js';

// Operator abilities. In practice mode these resolve locally; online, the server
// validates cooldowns/effects and the client calls the same visual functions.

export function canUseAbility(f) { return f.alive && f.ability.cd <= 0; }

/** Apply ability effects for fighter f. Returns false if not allowed. */
export function activateAbility(game, f, opts = {}) {
  if (!opts.force && !canUseAbility(f)) return false;
  const A = f.op.ability;
  f.ability.cd = A.cooldown;
  f.ability.active = A.duration;
  f.stats.abilities++;
  const pos = [f.x, f.y + 1, f.z];
  audio.ability(A.id, f.isLocal ? null : pos);
  if (f.character) f.character.ability();
  switch (A.id) {
    case 'overdrive':
      f.speedBoost = A.duration;
      if (!f.isLocal) game.addFx(createAura(0xe8a33d, 70, A.duration), f);
      game.addFx(createRingBurst(0xe8a33d, 2.2), null, [f.x, f.y, f.z]);
      break;
    case 'stim':
      f.healLeft = opts.serverHeal ?? A.heal;
      if (!f.isLocal) game.addFx(createAura(0x4fc3b0, 60, A.duration + 0.4), f);
      game.addFx(createRingBurst(0x4fc3b0, 1.6), null, [f.x, f.y, f.z]);
      break;
    case 'recon': {
      const ring = createPulseRing(0x5aa9e6, A.radius);
      game.addFx(ring, null, [f.x, f.y, f.z]);
      const target = game.opponentOf(f);
      const inRange = opts.revealed ?? (target && target.alive && Math.hypot(target.x - f.x, target.z - f.z) <= A.radius);
      if (inRange && target) {
        target.revealed = A.duration;
        if (f.isLocal) game.showReveal(target, A.duration);
        if (f.isBot) game.bot?.revealed(target);
        if (target.isLocal) game.hud?.objective('Enemy recon pulse — your position is revealed');
      }
      break;
    }
    case 'barrier': {
      const box = opts.box || barrierBox(f.x, f.y, f.z, f.yaw);
      game.addBarrier(box, f, A.hp, A.duration);
      break;
    }
  }
  return true;
}

/** Per-frame ability timers (heal ticks, boosts). */
export function tickAbility(f, dt, authoritativeHp = false) {
  f.ability.cd = Math.max(0, f.ability.cd - dt);
  f.ability.active = Math.max(0, f.ability.active - dt);
  f.speedBoost = Math.max(0, f.speedBoost - dt);
  f.revealed = Math.max(0, f.revealed - dt);
  if (f.healLeft > 0 && f.alive) {
    const amt = Math.min(f.healLeft, 20 * dt);
    f.healLeft -= amt;
    if (!authoritativeHp) f.hp = Math.min(100, f.hp + amt);
  }
}

export function makeBarrierVisual(box) {
  const mesh = createBarrierMesh(2.6, 1.9);
  mesh.position.set((box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2);
  mesh.rotation.y = box.alongX ? 0 : Math.PI / 2;
  return mesh;
}

export function makeRevealMarker() { return createRevealMarker(0x5aa9e6); }
export { THREE };
