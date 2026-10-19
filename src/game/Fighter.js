import { WEAPONS, fireInterval } from '../shared/weapons.js';
import { OPERATORS, MAX_HEALTH } from '../shared/operators.js';
import { PLAYER } from '../shared/collision.js';

// Gameplay state for one combatant (local player, bot, or remote opponent).

export class WeaponState {
  constructor(id) {
    this.def = WEAPONS[id];
    this.id = id;
    this.mag = this.def.mag;
    this.reserve = this.def.reserve;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.cooldown = 0;     // time until next shot allowed
    this.cycle = 0;        // bolt/pump cycle time remaining
    this.bloom = 0;        // accumulated spread from sustained fire
    this.shotsInBurst = 0;
  }
  refill() { this.mag = this.def.mag; this.reserve = this.def.reserve; this.reloading = false; this.cooldown = 0; this.cycle = 0; this.bloom = 0; }
  get canFire() { return !this.reloading && this.cooldown <= 0 && this.cycle <= 0 && this.mag > 0; }
  get needsReload() { return this.mag < this.def.mag && this.reserve > 0; }

  fire() {
    this.mag--;
    this.cooldown = fireInterval(this.def);
    if (this.def.bolt || this.def.pump) this.cycle = this.def.bolt ? 0.75 : 0.55;
    this.bloom = Math.min(1, this.bloom + (this.def.auto ? 0.12 : 0.35));
    this.shotsInBurst++;
  }

  startReload() {
    if (this.reloading || !this.needsReload) return false;
    this.reloading = true;
    this.reloadT = 0;
    const d = this.def;
    this.reloadDur = d.perShell ? d.reload : (this.mag === 0 ? d.reloadEmpty : d.reload);
    return true;
  }
  cancelReload() { this.reloading = false; }

  /** Advance timers. Returns 'done' | 'shell' | null. */
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.cycle = Math.max(0, this.cycle - dt);
    this.bloom = Math.max(0, this.bloom - dt * (this.def.auto ? 1.6 : 2.2));
    if (!this.reloading) return null;
    this.reloadT += dt;
    if (this.reloadT >= this.reloadDur) {
      if (this.def.perShell) {
        this.mag++; this.reserve--;
        if (this.mag < this.def.mag && this.reserve > 0) { this.reloadT = 0; return 'shell'; }
        this.reloading = false; return 'done';
      }
      const need = this.def.mag - this.mag;
      const take = Math.min(need, this.reserve);
      this.mag += take; this.reserve -= take;
      this.reloading = false;
      return 'done';
    }
    return null;
  }
}

export class Fighter {
  constructor({ id, name, side, loadout, isBot = false, isLocal = false }) {
    this.id = id;
    this.name = name;
    this.side = side;
    this.isBot = isBot;
    this.isLocal = isLocal;
    this.loadout = loadout;
    this.op = OPERATORS[loadout.operator] || OPERATORS.volt;
    this.weapons = [new WeaponState(loadout.primary), new WeaponState(loadout.secondary)];
    this.slot = 0;
    this.switchT = 0;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.crouch = false;
    this.crouchT = 0;
    this.onGround = true;
    this.sprinting = false;
    this.aiming = false;
    this.hp = MAX_HEALTH;
    this.alive = true;
    this.ability = { cd: 0, active: 0, uses: 0 };
    this.speedBoost = 0;
    this.healLeft = 0;
    this.revealed = 0;
    this.lastHitBy = null;
    this.damageTakenRound = 0;
    this.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, headshotKills: 0, damage: 0, abilities: 0, sidearmKills: 0, flawless: 0 };
    this.character = null;
  }

  get weapon() { return this.weapons[this.slot]; }
  get height() { return this.crouch ? PLAYER.crouchHeight : PLAYER.height; }
  get eyeY() { return this.y + PLAYER.eye + (PLAYER.crouchEye - PLAYER.eye) * this.crouchT; }
  get speedMult() { return this.op.speed * (this.speedBoost > 0 ? 1.32 : 1) * this.weapon.def.move; }

  spawnAt(sp, partialCooldown = true) {
    this.x = sp.x; this.y = 0; this.z = sp.z; this.vx = this.vy = this.vz = 0;
    this.yaw = sp.yaw; this.pitch = 0;
    this.hp = MAX_HEALTH; this.alive = true;
    this.crouch = false; this.crouchT = 0;
    this.weapons.forEach((w) => w.refill());
    this.slot = 0; this.switchT = 0;
    this.speedBoost = 0; this.healLeft = 0; this.revealed = 0;
    this.damageTakenRound = 0;
    // abilities carry over half their remaining cooldown between rounds
    if (partialCooldown) this.ability.cd = Math.max(0, this.ability.cd * 0.5); else this.ability.cd = 0;
    this.ability.active = 0;
    this.onGround = true;
  }

  /** Player-shaped state used by hit tests. */
  get hitState() { return { x: this.x, y: this.y, z: this.z, crouch: this.crouch }; }
}
