import { lineOfSight, dirFromAngles, raycastWorld } from '../shared/collision.js';

// Tactical bot brain. It only knows what it can see (FOV + wall-respecting
// line of sight), hear (gunfire, footsteps while sprinting) or feel (damage).
// Difficulty changes perception and decision quality, never damage numbers.

export const DIFFICULTY = {
  easy: { reaction: 0.8, aimErr: 5.5, turn: 2.6, fov: 100, burst: [2, 4], pause: [0.6, 1.1], strafe: 0.25, coverHp: 25, ability: 0.35, hearing: 22, head: 0.04, ramp: 1.8, vision: 45, flank: false, crouchFight: 0.1, firstShot: 0.45, preferAds: 0.2 },
  normal: { reaction: 0.45, aimErr: 3.0, turn: 4.6, fov: 115, burst: [3, 7], pause: [0.3, 0.6], strafe: 0.6, coverHp: 45, ability: 0.75, hearing: 38, head: 0.14, ramp: 1.1, vision: 60, flank: false, crouchFight: 0.3, firstShot: 0.25, preferAds: 0.6 },
  hard: { reaction: 0.24, aimErr: 1.6, turn: 8, fov: 130, burst: [5, 11], pause: [0.14, 0.32], strafe: 0.9, coverHp: 55, ability: 1, hearing: 55, head: 0.3, ramp: 0.65, vision: 80, flank: true, crouchFight: 0.45, firstShot: 0.12, preferAds: 0.9 },
};

const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class Bot {
  constructor(fighter, game, difficulty = 'normal') {
    this.f = fighter;
    this.game = game;
    this.diffName = difficulty;
    this.D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.reset();
  }

  reset() {
    this.state = 'patrol';
    this.path = null; this.pathT = 0; this.goal = null;
    this.seeT = 0; this.lostT = 99; this.visible = false; this.reacted = false; this.reactT = 0;
    this.lastKnown = null; this.knowT = 99;
    this.trackT = 0;
    this.err = [0, 0]; this.errTarget = [0, 0]; this.errT = 0;
    this.burstLeft = 0; this.pauseT = 0.5;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0;
    this.coverT = 0; this.coverSpot = null; this.peekT = 0;
    this.stuckT = 0; this.lastPos = [this.f.x, this.f.z];
    this.flinch = 0; this.thinkT = 0;
    this.intent = { mx: 0, mz: 0, sprint: false, crouch: false, jump: false, fire: false, reload: false, ability: false, ads: false, switchTo: -1 };
    this.searchLook = 0;
  }

  // ---- perception events ----
  heard(pos, loudness = 1) {
    const d = Math.hypot(pos[0] - this.f.x, pos[2] - this.f.z);
    if (d > this.D.hearing * loudness) return;
    const err = d * 0.12;
    this.lastKnown = [pos[0] + rnd(-err, err), pos[2] + rnd(-err, err)];
    this.knowT = 0;
    if (this.state === 'patrol') this.setState('search');
  }
  damaged(fromPos) {
    this.flinch = 1;
    this.lastKnown = [fromPos[0], fromPos[2]]; this.knowT = 0;
    if (!this.visible) { this.reactT = Math.max(this.reactT, this.D.reaction * 0.6); this.setState('search'); }
    // snap attention toward the attacker
    const dx = fromPos[0] - this.f.x, dz = fromPos[2] - this.f.z;
    this.attnYaw = Math.atan2(-dx, -dz);
  }

  setState(s) { if (this.state !== s) { this.state = s; this.path = null; this.stateT = 0; } }

  canSee(target) {
    const f = this.f;
    if (!target.alive) return false;
    const eye = [f.x, f.eyeY, f.z];
    const dx = target.x - f.x, dz = target.z - f.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.D.vision) return false;
    // field of view (wider when already alert)
    const yawTo = Math.atan2(-dx, -dz);
    const fov = (this.state === 'engage' || this.knowT < 3 ? this.D.fov + 40 : this.D.fov) * Math.PI / 360;
    if (Math.abs(angDiff(f.yaw, yawTo)) > fov && dist > 3) return false;
    const pts = [[target.x, target.eyeY - 0.02, target.z], [target.x, target.y + (target.crouch ? 0.7 : 1.15), target.z]];
    for (const p of pts) if (lineOfSight(this.game.world, eye, p)) return true;
    return false;
  }

  pathTo(x, z) {
    this.path = this.game.nav.path(this.f.x, this.f.z, x, z);
    this.goal = [x, z];
    this.pathT = 0;
  }

  followPath(dt) {
    if (!this.path || this.path.length < 2) return false;
    const f = this.f;
    let wp = this.path[1];
    if (Math.hypot(wp[0] - f.x, wp[1] - f.z) < 0.7) { this.path.shift(); if (this.path.length < 2) return false; wp = this.path[1]; }
    const dx = wp[0] - f.x, dz = wp[1] - f.z, l = Math.hypot(dx, dz) || 1;
    this.intent.mx = dx / l; this.intent.mz = dz / l;
    return true;
  }

  /** Choose a cover spot hidden from the target, not too far, not toward the target. */
  findCover(target, maxDist = 14) {
    const f = this.f, W = this.game.world;
    const cands = this.game.nav.coverNear(f.x, f.z, maxDist);
    let best = null, bestScore = -1e9;
    for (const c of cands) {
      const dSelf = Math.hypot(c.x - f.x, c.z - f.z);
      const dT = Math.hypot(c.x - target.x, c.z - target.z);
      if (dT < 5) continue;
      const hiddenCrouched = !lineOfSight(W, [target.x, target.eyeY, target.z], [c.x, 0.9, c.z]);
      if (!hiddenCrouched) continue;
      const hiddenStanding = !lineOfSight(W, [target.x, target.eyeY, target.z], [c.x, 1.55, c.z]);
      const score = -dSelf * 1.2 + Math.min(dT, 20) * 0.4 + (hiddenStanding ? 4 : 0) + Math.random();
      if (score > bestScore) { bestScore = score; best = { ...c, standing: hiddenStanding }; }
    }
    return best;
  }

  think(dt, target) {
    const f = this.f, D = this.D, I = this.intent;
    I.mx = I.mz = 0; I.sprint = false; I.jump = false; I.fire = false; I.reload = false; I.ability = false; I.switchTo = -1;
    if (!f.alive) return I;
    this.stateT = (this.stateT || 0) + dt;
    this.flinch = Math.max(0, this.flinch - dt * 2.5);
    this.knowT += dt;

    // perception (throttled)
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.08;
      const vis = this.canSee(target);
      if (vis && !this.visible) { this.reactT = D.reaction * (this.knowT < 2 ? 0.6 : 1) * rnd(0.85, 1.25); this.trackT = 0; }
      this.visible = vis;
    }
    if (this.visible) {
      this.lastKnown = [target.x, target.z]; this.knowT = 0; this.lostT = 0;
      this.reactT -= dt;
      if (this.reactT <= 0 && this.state !== 'cover') this.setState('engage');
    } else this.lostT += dt;

    const w = f.weapon;
    const lowHp = f.hp <= D.coverHp;

    // weapon management
    if (w.mag === 0 && !w.reloading) {
      if (w.reserve > 0) I.reload = true;
      else if (f.slot === 0) I.switchTo = 1;
    }
    if (!this.visible && w.mag < w.def.mag * 0.5 && w.reserve > 0 && !w.reloading && this.lostT > 1.2) I.reload = true;
    if (f.slot === 1 && f.weapons[0].mag + f.weapons[0].reserve > 0 && !this.visible) I.switchTo = 0;

    // abilities
    this.useAbility(target, lowHp);

    let aimYaw = this.attnYaw ?? f.yaw, aimPitch = 0;
    switch (this.state) {
      case 'patrol': {
        if (!this.path || this.stateT > 6) {
          const tgt = this.lastKnown || this.game.nav.randomPoint();
          this.pathTo(tgt[0] + rnd(-6, 6), tgt[1] + rnd(-6, 6));
          this.stateT = 0;
        }
        if (!this.followPath(dt)) this.path = null;
        aimYaw = Math.atan2(-I.mx, -I.mz) || f.yaw;
        if (this.lastKnown && this.knowT < 8) this.setState('search');
        break;
      }
      case 'search': {
        if (!this.lastKnown) { this.setState('patrol'); break; }
        if (!this.path) {
          let [gx, gz] = this.lastKnown;
          if (D.flank && Math.random() < 0.6 && Math.hypot(gx - f.x, gz - f.z) > 12) {
            // approach from an offset angle instead of straight down the lane
            const dx = gx - f.x, dz = gz - f.z, l = Math.hypot(dx, dz);
            const s = Math.random() < 0.5 ? -1 : 1;
            gx += (-dz / l) * 9 * s; gz += (dx / l) * 9 * s;
          }
          this.pathTo(gx, gz);
        }
        const moving = this.followPath(dt);
        I.sprint = this.knowT > 1.5 && moving && Math.hypot(this.lastKnown[0] - f.x, this.lastKnown[1] - f.z) > 10;
        if (moving) aimYaw = Math.atan2(-I.mx, -I.mz);
        else {
          this.searchLook += dt;
          aimYaw = f.yaw + Math.sin(this.searchLook * 1.3) * 0.04;
          if (this.searchLook > 2.5) { this.searchLook = 0; this.lastKnown = null; this.setState('patrol'); }
        }
        if (this.lastKnown && this.knowT < 0.5) { const dx = this.lastKnown[0] - f.x, dz = this.lastKnown[1] - f.z; if (Math.hypot(dx, dz) < 25) aimYaw = Math.atan2(-dx, -dz); }
        break;
      }
      case 'engage': {
        if (!this.visible && this.lostT > 0.7) { this.setState('search'); break; }
        if ((lowHp || (w.reloading && Math.hypot(target.x - f.x, target.z - f.z) < 22)) && this.stateT > 0.6) {
          const c = this.findCover(target);
          if (c) { this.coverSpot = c; this.setState('cover'); this.pathTo(c.x, c.z); break; }
        }
        // strafe
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rnd(0.4, 1.2); this.crouchFight = Math.random() < D.crouchFight; }
        const dx = target.x - f.x, dz = target.z - f.z, dist = Math.hypot(dx, dz) || 1;
        if (Math.random() < D.strafe * dt * 60 / 60 || true) {
          const sx = -dz / dist * this.strafeDir, sz = dx / dist * this.strafeDir;
          const sk = D.strafe * (this.crouchFight ? 0 : 1);
          // close in with shotguns/SMGs, back off with precision rifles
          const ideal = w.def.category === 'SHOTGUN' ? 6 : w.def.category === 'SUBMACHINE GUN' ? 12 : w.def.category === 'PRECISION RIFLE' ? 28 : 18;
          const approach = dist > ideal + 4 ? 0.8 : dist < ideal - 6 ? -0.6 : 0;
          I.mx = sx * sk + (dx / dist) * approach; I.mz = sz * sk + (dz / dist) * approach;
          const l = Math.hypot(I.mx, I.mz); if (l > 1) { I.mx /= l; I.mz /= l; }
          if (I.mx || I.mz) {
            // don't strafe into walls
            const probe = raycastWorld(this.game.world, [f.x, 0.5, f.z], [I.mx / (l || 1), 0, I.mz / (l || 1)], 1.2);
            if (probe) { this.strafeDir *= -1; I.mx = -I.mx; I.mz = -I.mz; }
          }
        }
        I.crouch = !!this.crouchFight;
        this.aimAndFire(dt, target, I);
        aimYaw = this.aimYaw; aimPitch = this.aimPitch;
        break;
      }
      case 'cover': {
        const c = this.coverSpot;
        if (!c) { this.setState('engage'); break; }
        const atSpot = Math.hypot(c.x - f.x, c.z - f.z) < 0.8;
        if (!atSpot) {
          if (!this.path) this.pathTo(c.x, c.z);
          if (!this.followPath(dt)) this.path = null;
          I.sprint = true;
          aimYaw = Math.atan2(-I.mx, -I.mz);
          if (this.stateT > 5) this.setState('engage');
        } else {
          I.crouch = true;
          this.coverT += dt;
          if (w.needsReload && !w.reloading) I.reload = true;
          if (this.lastKnown) { const dx = this.lastKnown[0] - f.x, dz = this.lastKnown[1] - f.z; aimYaw = Math.atan2(-dx, -dz); }
          const rested = this.coverT > rnd(1.4, 2.6) && !w.reloading && (f.hp > D.coverHp * 0.8 || this.coverT > 5);
          if (this.visible && this.reactT <= 0) { this.aimAndFire(dt, target, I); aimYaw = this.aimYaw; aimPitch = this.aimPitch; }
          if (rested) { this.coverT = 0; this.coverSpot = null; this.setState(this.visible ? 'engage' : 'search'); }
        }
        break;
      }
    }

    // turning toward the aim with limited angular speed (flinch disturbs)
    const turn = D.turn * dt * (this.state === 'engage' ? 1 : 0.7);
    const dy = angDiff(f.yaw, aimYaw);
    f.yaw += Math.max(-turn, Math.min(turn, dy)) + (this.flinch ? (Math.random() - 0.5) * this.flinch * 0.05 : 0);
    f.pitch += Math.max(-turn, Math.min(turn, aimPitch - f.pitch)) * 0.8 + this.flinch * 0.01;

    // stuck handling
    if (I.mx || I.mz) {
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        const moved = Math.hypot(f.x - this.lastPos[0], f.z - this.lastPos[1]);
        if (moved < 0.3) { I.jump = true; this.path = null; }
        this.lastPos = [f.x, f.z]; this.stuckT = 0;
      }
    }
    return I;
  }

  aimAndFire(dt, target, I) {
    const f = this.f, D = this.D;
    this.trackT += dt;
    // error vector drifts and shrinks with continuous tracking
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = rnd(0.2, 0.45);
      const moving = Math.hypot(target.vx, target.vz) > 2;
      const mag = D.aimErr * (1 + 1.8 * Math.exp(-this.trackT / D.ramp)) * (moving ? 1.35 : 1) * (1 + this.flinch);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * mag * Math.PI / 180;
      this.errTarget = [Math.cos(a) * r, Math.sin(a) * r];
    }
    this.err[0] += (this.errTarget[0] - this.err[0]) * Math.min(1, dt * 6);
    this.err[1] += (this.errTarget[1] - this.err[1]) * Math.min(1, dt * 6);
    const aimHead = this.headPick ?? (this.headPick = Math.random() < D.head);
    if (this.trackT > 1.5 && Math.random() < dt) this.headPick = Math.random() < D.head;
    const ty = aimHead ? target.eyeY - 0.02 : target.y + (target.crouch ? 0.75 : 1.2);
    // slight lead on moving targets (better bots lead better)
    const lead = this.diffName === 'hard' ? 0.08 : this.diffName === 'normal' ? 0.04 : 0;
    const tx = target.x + target.vx * lead, tz = target.z + target.vz * lead;
    const dx = tx - f.x, dz = tz - f.z, dyv = ty - f.eyeY;
    const horiz = Math.hypot(dx, dz);
    this.aimYaw = Math.atan2(-dx, -dz) + this.err[0];
    this.aimPitch = Math.atan2(dyv, horiz) + this.err[1];
    const offYaw = Math.abs(angDiff(f.yaw, this.aimYaw)), offPitch = Math.abs(this.aimPitch - f.pitch);
    const onTarget = offYaw < 0.06 + D.aimErr * 0.01 && offPitch < 0.06;
    I.ads = Math.random() < D.preferAds || horiz > 20;

    // burst control
    const w = f.weapon;
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    if (!this.visible || this.reactT > -D.firstShot || !onTarget || w.reloading) return;
    if (this.burstLeft <= 0) this.burstLeft = w.def.auto ? Math.round(rnd(D.burst[0], D.burst[1])) : 1;
    I.fire = true;
    if (w.canFire) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.pauseT = w.def.auto ? rnd(D.pause[0], D.pause[1]) : rnd(0.12, 0.3) + (w.def.bolt ? 0.6 : 0) + (1 - (this.diffName === 'hard' ? 0.6 : 0.2)) * 0.25;
    }
  }

  useAbility(target, lowHp) {
    const f = this.f, D = this.D, I = this.intent;
    if (f.ability.cd > 0 || Math.random() > D.ability * 0.02) return; // evaluated stochastically
    const id = f.op.ability.id;
    const dist = Math.hypot(target.x - f.x, target.z - f.z);
    if (id === 'stim' && f.hp < 60 && (!this.visible || this.state === 'cover')) I.ability = true;
    else if (id === 'recon' && !this.visible && this.knowT > 4 && dist < 34) I.ability = true;
    else if (id === 'overdrive' && ((this.state === 'cover' && !this.coverSpot) || (this.state === 'search' && this.knowT < 4) || (lowHp && this.state === 'cover'))) I.ability = true;
    else if (id === 'barrier' && this.visible && this.state === 'engage' && f.hp < 80 && dist > 8) I.ability = true;
  }

  /** Recon reveal grants knowledge. */
  revealed(target) { this.lastKnown = [target.x, target.z]; this.knowT = 0; if (this.state === 'patrol') this.setState('search'); }

  get aimDir() { return dirFromAngles(this.f.yaw, this.f.pitch); }
}
