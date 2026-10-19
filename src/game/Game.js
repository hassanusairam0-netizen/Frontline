import * as THREE from 'three';
import { MapWorld } from '../world/MapWorld.js';
import { Character } from '../models/character.js';
import { createMuzzleFlash } from '../models/fx.js';
import { Viewmodel } from './Viewmodel.js';
import { Effects } from './Effects.js';
import { Fighter } from './Fighter.js';
import { Bot } from './Bot.js';
import { NavGrid } from './nav.js';
import { Input } from '../engine/input.js';
import { Hud } from '../ui/hud.js';
import { audio } from '../engine/audio.js';
import { settings } from '../state/settings.js';
import { profile } from '../state/profile.js';
import { PLAYER, moveBody, blocked, raycastWorld, rayPlayer, dirFromAngles, spreadDir } from '../shared/collision.js';
import { damageFor, WEAPONS } from '../shared/weapons.js';
import { OPERATORS, operatorPalette } from '../shared/operators.js';
import { MATCH } from '../shared/rules.js';
import { activateAbility, tickAbility, makeBarrierVisual, makeRevealMarker } from './abilities.js';
import { OnlineSession } from './OnlineSession.js';
import { PauseMenu } from '../ui/pause.js';

// The match: owns the map, fighters, bot or network session, HUD and the
// round state machine. Implements the engine "stage" contract.

const BOT_NAMES = ['KESTREL', 'ONYX', 'SPECTER', 'HALCYON', 'RAVEN', 'WARDEN', 'CIPHER', 'TALON'];
const DEG = Math.PI / 180;

export class Game {
  constructor(engine, config, cb) {
    this.engine = engine;
    this.config = config;
    this.cb = cb;
    this.online = config.mode === 'online';
    this.roundsToWin = config.roundsToWin || MATCH.roundsToWin;
    this.phase = 'loading';
    this.phaseT = 0;
    this.round = 0;
    this.score = { me: 0, opp: 0 };
    this.time = 0;
    this.matchTime = 0;
    this.fxList = [];
    this.barriers = [];
    this.reveals = [];
    this.paused = false;
    this.disposed = false;
    this.camPunch = { p: 0, y: 0, vp: 0 };
    this.recoilDebt = 0;
    this.footDist = 0;
    this.deathCam = 0;
    this.switching = 0;
    this.pendingSwitch = -1;
  }

  async load(progress = () => {}) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    progress(0.05); await tick();
    this.map = new MapWorld(this.engine, this.config.map);
    this.scene = this.map.scene;
    this.world = this.map.world;
    this.layout = this.map.layout;
    progress(0.55); await tick();
    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), innerWidth / innerHeight, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.post = this.map.post();
    this.fx = new Effects(this.scene, this.map.id);

    const lo = this.config.loadout;
    const myName = (profile.data.name || 'YOU').toUpperCase();
    this.me = new Fighter({ id: 'me', name: myName, side: 'A', loadout: lo, isLocal: true });
    const oppInfo = this.online ? this.config.opponent : this.makeBotLoadout();
    this.opp = new Fighter({ id: oppInfo.id || 'bot', name: oppInfo.name, side: 'B', loadout: oppInfo.loadout, isBot: !this.online });
    this.fighters = [this.me, this.opp];

    // viewmodel
    const pal = operatorPalette(lo.operator, lo.outfit);
    this.vm = new Viewmodel(this.scene.environment, this.map.theme.sun.color, pal);
    this.viewmodel = { scene: this.vm.scene, camera: this.vm.camera };
    this.vm.setWeapon(lo.primary, lo.skins[lo.primary]);
    progress(0.7); await tick();

    // opponent model
    const ol = this.opp.loadout;
    this.opp.character = new Character({ operator: ol.operator, outfit: ol.outfit || 'standard', weapon: ol.primary, skin: ol.skins?.[ol.primary] || 'factory' });
    this.scene.add(this.opp.character.root);
    this.oppFlash = createMuzzleFlash();
    this.opp.character.weapon.anchors.muzzle.add(this.oppFlash);
    this.oppSlotShown = 0;
    // local muzzle light in the world (always present; intensity animates)
    this.myLight = new THREE.PointLight(0xffb560, 0, 9, 2);
    this.scene.add(this.myLight);
    progress(0.8); await tick();

    if (!this.online) {
      this.nav = new NavGrid(this.layout);
      this.bot = new Bot(this.opp, this, this.config.difficulty);
    } else {
      this.session = new OnlineSession(this, this.config);
    }
    progress(0.9); await tick();

    this.input = new Input(this.engine.canvas);
    this.input.onLockChange = (locked) => this.onLock(locked);
    this.hud = new Hud({ youName: myName, oppName: this.opp.name, oppOperator: this.opp.op.name, oppRole: this.opp.op.role, roundsToWin: this.roundsToWin, operator: this.me.op.name, mode: this.config.mode });
    this.hud.setAbility(this.me.op.ability.id);
    this.pauseMenu = new PauseMenu(this);
    this._onKey = (e) => { if (e.code === 'Escape' && this.input.isTouch) this.togglePause(); };
    addEventListener('keydown', this._onKey);
    // Warm up shaders so the first frame of combat doesn't hitch.
    this.engine.renderer.compile(this.scene, this.camera);
    this.engine.renderer.compile(this.vm.scene, this.vm.camera);
    progress(1);
  }

  makeBotLoadout() {
    const ops = Object.keys(OPERATORS).filter((o) => o !== this.config.loadout.operator);
    const op = ops[Math.floor(Math.random() * ops.length)];
    const prim = ['vk7', 'hornet', 'ridgeline', 'breacher', 'vk7'];
    const primary = this.config.difficulty === 'easy' ? 'vk7' : prim[Math.floor(Math.random() * prim.length)];
    return { id: 'bot', name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], loadout: { operator: op, outfit: 'standard', primary, secondary: 'vesper', skins: {} } };
  }

  start() {
    audio.setAmbience(this.map.theme.ambience);
    audio.setMusic('combat');
    this.input.showTouch(true);
    if (this.online) { this.session.ready(); this.phase = 'waiting'; this.hud.message('Waiting for opponent', 'Synchronising match'); }
    else this.startRound();
    this.input.requestLock();
    this.hud.showClickToPlay(!this.input.locked && !this.input.isTouch);
  }

  opponentOf(f) { return f === this.me ? this.opp : this.me; }

  // ---------------- rounds ----------------
  startRound(spawns = null) {
    this.round++;
    const flip = this.round % 2 === 0;
    const L = this.layout.spawns;
    const pick = (arr, i) => arr[i % arr.length];
    const ri = Math.floor(Math.random() * 3);
    const sMe = spawns?.me || pick(flip ? L.B : L.A, ri);
    const sOpp = spawns?.opp || pick(flip ? L.A : L.B, (ri + 1) % 3);
    this.me.spawnAt(sMe, this.round > 1);
    this.opp.spawnAt(sOpp, this.round > 1);
    this.opp.character.revive();
    this.setOppWeaponVisual(0);
    this.vm.setWeapon(this.me.weapon.id, this.me.loadout.skins[this.me.weapon.id]);
    this.vm.visible = true;
    this.clearBarriers();
    this.clearReveals();
    this.bot?.reset();
    this.deathCam = 0;
    this.recoilDebt = 0;
    this.phase = 'pre';
    this.phaseT = MATCH.preRound - 1;
    this.roundTime = MATCH.roundTime;
    this.hud.message(`Round ${this.round}`, this.round === 1 ? 'Eliminate the opponent' : `${this.score.me} — ${this.score.opp}`, Math.ceil(this.phaseT));
    this.hud.objective('Eliminate the opponent');
    audio.beep(false);
    this.lastBeep = Math.ceil(this.phaseT);
  }

  goLive() {
    this.phase = 'live';
    this.hud.message('');
    audio.beep(true);
  }

  endRound(winner, reason = '') {
    if (this.phase !== 'live') return;
    this.phase = 'end';
    this.phaseT = MATCH.roundEnd;
    let title = 'Draw', cls = '';
    if (winner === this.me) { this.score.me++; title = 'Round won'; cls = 'win'; if (this.me.damageTakenRound === 0) this.me.stats.flawless++; }
    else if (winner === this.opp) { this.score.opp++; title = 'Round lost'; cls = 'loss'; }
    const over = this.score.me >= this.roundsToWin || this.score.opp >= this.roundsToWin;
    this.hud.message(over ? (this.score.me > this.score.opp ? 'Victory' : 'Defeat') : title, reason || `${this.score.me} — ${this.score.opp}`, null, cls);
    audio.stinger(winner === this.me);
    if (over) { this.phase = 'over'; this.phaseT = 3.2; }
  }

  finishMatch(serverEnd = null) {
    if (this.finished) return;
    this.finished = true;
    this.input.exitLock();
    this.input.enabled = false;
    const s = this.me.stats;
    const won = serverEnd ? serverEnd.won : this.score.me > this.score.opp;
    const result = {
      mode: this.online ? 'online' : this.config.difficulty,
      map: this.map.id, won, roundsWon: serverEnd?.roundsWon ?? this.score.me, roundsLost: serverEnd?.roundsLost ?? this.score.opp,
      kills: s.kills, deaths: s.deaths, shots: s.shots, hits: s.hits, headshots: s.headshotKills, headshotKills: s.headshotKills,
      abilities: s.abilities, sidearmKills: s.sidearmKills, flawless: s.flawless, damage: Math.round(s.damage),
      duration: Math.round(this.matchTime), oppName: this.opp.name, oppOperator: this.opp.op.name, operator: this.me.op.name,
      forfeit: serverEnd?.forfeit || false,
    };
    audio.setMusic(null);
    this.hud.setVisible(false);
    this.input.showTouch(false);
    this.cb.onEnd?.({ ...result, server: serverEnd });
  }

  // ---------------- stage contract ----------------
  update(dt, t) {
    if (this.disposed) return;
    this.time = t;
    const frozen = this.paused && !this.online;
    if (!frozen) this.simulate(dt);
    this.updateCamera(dt);
    this.updateVisuals(frozen ? 0 : dt, t);
    this.updateHud();
    this.input.endFrame();
  }

  simulate(dt) {
    if (this.phase !== 'over' && this.phase !== 'waiting') this.matchTime += dt;
    // phases (local authority only)
    if (!this.online) {
      if (this.phase === 'pre') {
        this.phaseT -= dt;
        const c = Math.ceil(this.phaseT);
        if (c !== this.lastBeep && c > 0) { this.lastBeep = c; this.hud.countdown(c); audio.beep(false); }
        if (this.phaseT <= 0) this.goLive();
      } else if (this.phase === 'live') {
        this.roundTime -= dt;
        if (this.roundTime <= 0) {
          const a = this.me.hp, b = this.opp.hp;
          this.endRound(a > b ? this.me : b > a ? this.opp : null, 'Time expired');
        }
      } else if (this.phase === 'end') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.startRound();
      } else if (this.phase === 'over') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.finishMatch();
      }
    } else this.session.update(dt);

    const canAct = this.phase === 'live';
    this.updatePlayer(dt, canAct, this.phase === 'pre');
    if (!this.online) this.updateBot(dt, canAct);
    for (const f of this.fighters) tickAbility(f, dt, this.online);
    this.updateBarriers(dt);
  }

  // ---------------- local player ----------------
  updatePlayer(dt, canAct, frozenMove) {
    const me = this.me, I = this.input, w = me.weapon;
    // look
    if (me.alive) {
      const look = I.look();
      const adsT = this.vm.state.adsT;
      const baseFov = settings.get('fov');
      const fovK = adsT > 0 ? 1 - adsT + adsT * settings.get('adsSensitivity') * (this.currentFov / baseFov) : 1;
      const sens = 0.0021 * settings.get('sensitivity') * fovK;
      me.yaw -= look.dx * sens;
      me.pitch -= look.dy * sens * (settings.get('invertY') ? -1 : 1);
      me.pitch = Math.max(-1.52, Math.min(1.52, me.pitch));
      this.lookDX = look.dx; this.lookDY = look.dy;
    }
    if (!me.alive) { me.vx *= 0.9; me.vz *= 0.9; moveBody(this.world, me, dt, me.height); return; }

    // weapon timers
    for (const ws of me.weapons) {
      const ev = ws.update(dt);
      if (ws === w && ev === 'shell') { audio.mech('shell'); this.vm.reload(ws.def, ws.def.reload); }
      if (ws === w && ev === 'done' && ws.def.perShell) audio.mech('pump');
    }

    // crouch
    const wantCrouch = I.down('KeyC') || I.down('ControlLeft') || I.touchHeld('crouch') || (I.touch?.toggles.has('crouch'));
    if (wantCrouch) me.crouch = true;
    else if (me.crouch && !blocked(this.world, me.x, me.y, me.z, PLAYER.height)) me.crouch = false;
    me.crouchT += ((me.crouch ? 1 : 0) - me.crouchT) * (1 - Math.exp(-dt * 12));

    // movement
    const { f, s } = frozenMove ? { f: 0, s: 0 } : I.axes();
    const ads = I.ads && !w.reloading;
    me.aiming = ads;
    const sprint = (I.down('ShiftLeft') || I.down('ShiftRight')) && f > 0 && !ads && !me.crouch && !(I.fire && w.mag > 0);
    if (sprint && w.reloading && !w.def.perShell) { /* allow sprint-reload */ }
    me.sprinting = sprint && me.onGround;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw), rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    let wx = fx * f + rx * s, wz = fz * f + rz * s;
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    let speed = me.crouch ? PLAYER.crouchSpeed : sprint ? PLAYER.sprint : PLAYER.walk;
    speed *= me.speedMult * (ads ? PLAYER.adsSpeed : 1);
    const accel = me.onGround ? 12 : 2.5;
    const k = 1 - Math.exp(-dt * accel);
    me.vx += (wx * speed - me.vx) * k;
    me.vz += (wz * speed - me.vz) * k;
    if ((I.hit('Space') || I.touchTap('jump')) && me.onGround && !me.crouch && !frozenMove) { me.vy = PLAYER.jump; me.onGround = false; }
    const wasAir = !me.onGround, vyBefore = me.vy;
    moveBody(this.world, me, dt, me.height);
    if (wasAir && me.onGround && vyBefore < -4) { audio.land(); this.vm.land(-vyBefore); this.camPunch.vp -= 0.35; }

    // footsteps
    const hs = Math.hypot(me.vx, me.vz);
    if (me.onGround && hs > 1.2 && !me.crouch) {
      this.footDist += hs * dt;
      const stride = sprint ? 2.5 : 2.0;
      if (this.footDist > stride) { this.footDist = 0; audio.footstep(this.map.surfaceAt(me.x, me.y, me.z), null, sprint ? 1 : 0.6); }
    }
    if (me.sprinting && this.bot && Math.random() < dt * 2) this.bot.heard([me.x, me.y, me.z], 0.45);

    if (!canAct) return;
    // weapon switching
    const wantSlot = I.hit('Digit1') ? 0 : I.hit('Digit2') ? 1 : (I.mouse.wheel || I.touchTap('swap')) ? 1 - me.slot : -1;
    if (wantSlot >= 0 && wantSlot !== me.slot && this.switching <= 0) this.beginSwitch(wantSlot);
    if (this.switching > 0) {
      this.switching -= dt;
      if (this.switching <= 0.18 && this.pendingSwitch >= 0) {
        me.weapon.cancelReload();
        me.slot = this.pendingSwitch; this.pendingSwitch = -1;
        this.vm.setWeapon(me.weapon.id, me.loadout.skins[me.weapon.id]);
        this.vm.state.switchT = 0; this.vm.state.lowered = 1;
        audio.mech('draw');
        this.session?.sendSwitch(me.slot);
      }
      return;
    }
    // reload
    if ((I.hit('KeyR') || I.touchTap('reload')) && me.weapon.startReload()) this.onReloadStart(me);
    // ability
    if ((I.hit('KeyQ') || I.hit('KeyE') || I.touchTap('ability')) && me.ability.cd <= 0) {
      if (this.online) this.session.sendAbility();
      else activateAbility(this, me);
    }
    if (I.hit('KeyT')) this.vm.inspect();
    // fire
    const cw = me.weapon;
    const trigger = cw.def.auto ? I.fire : I.firePressed;
    if (trigger && !me.sprinting) {
      if (cw.reloading && cw.def.perShell && cw.mag > 0) { cw.cancelReload(); this.vm.reloadCancel(); }
      if (cw.canFire) this.fire(me);
      else if (cw.mag === 0 && I.firePressed && !cw.reloading) {
        audio.dryFire();
        if (cw.startReload()) this.onReloadStart(me);
      }
    }
    if (!I.fire) cw.shotsInBurst = 0;
    // recoil recovery
    if (!I.fire && this.recoilDebt > 0) {
      const rec = Math.min(this.recoilDebt, cw.def.recoil.recover * DEG * dt);
      me.pitch -= rec; this.recoilDebt -= rec;
    }
  }

  beginSwitch(slot) {
    this.switching = 0.42;
    this.pendingSwitch = slot;
    this.vm.switchOut();
  }

  onReloadStart(f) {
    const w = f.weapon, d = w.def;
    if (f.isLocal) {
      this.vm.reload(d, w.reloadDur);
      this.session?.sendReload(f.slot);
      if (d.perShell) { audio.mech('shell'); return; }
      const dur = w.reloadDur;
      const seq = d.revolver ? [[0.12, 'cylinder'], [0.78, 'magIn']] : [[0.18, 'magOut'], [0.66, 'magIn'], [0.86, d.slide ? 'boltFwd' : 'boltBack']];
      for (const [p, k] of seq) setTimeout(() => { if (w.reloading && f.weapon === w) audio.mech(k); }, p * dur * 1000);
    } else {
      f.character?.reload(w.reloadDur);
      audio.mech('magOut', [f.x, f.y + 1, f.z]);
    }
  }

  spreadFor(f) {
    const w = f.weapon, d = w.def;
    let s = f.aiming ? d.spread.ads : d.spread.hip;
    const spd = Math.hypot(f.vx, f.vz);
    s += d.spread.move * Math.min(1, spd / PLAYER.walk) * (f.aiming ? 0.45 : 1);
    if (!f.onGround) s += d.spread.air;
    if (f.crouch) s *= 0.75;
    if (d.pellets === 1) s += w.bloom * d.spread.hip * (f.aiming ? 0.25 : 0.6);
    return s;
  }

  /** Fire the fighter's current weapon (local authority or online prediction). */
  fire(f) {
    const w = f.weapon, d = w.def;
    const spread = this.spreadFor(f);
    w.fire();
    f.stats.shots++;
    const origin = [f.x, f.eyeY, f.z];
    const base = dirFromAngles(f.yaw, f.pitch);
    const dirs = [];
    for (let i = 0; i < d.pellets; i++) dirs.push(spreadDir(base, spread));
    const muzzle = f.isLocal ? this.localMuzzle() : this.oppMuzzle();
    const target = this.opponentOf(f);
    let anyHit = false, totalDmg = 0, headHit = false;
    const results = [];
    for (const dir of dirs) {
      const wh = raycastWorld(this.world, origin, dir, 220);
      const maxT = wh ? wh.t : 220;
      const ph = !this.online && target.alive ? rayPlayer(origin, dir, target.hitState, maxT) : null;
      // online: hits are predicted visually only; the server decides damage
      const predicted = this.online && target.alive ? rayPlayer(origin, dir, target.hitState, maxT) : null;
      const hit = ph || predicted;
      const t = hit ? hit.t : maxT;
      const end = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      results.push({ dir, end, hit, wh });
      if (Math.random() < (d.pellets > 1 ? 0.35 : 0.5) || f !== this.me) this.fx.tracer(muzzle, end, f === this.me ? [1, 0.72, 0.4] : [0.55, 0.75, 1]);
      if (hit) {
        anyHit = true;
        this.fx.impact(end, [-dir[0], -dir[1], -dir[2]], 'flesh');
        if (ph) { const dmg = damageFor(d, t, ph.part); totalDmg += dmg; if (ph.part === 'head') headHit = true; this.damage(target, dmg, f, ph.part, w.id, false); }
      } else if (wh) {
        if (wh.box?.kind === 'barrier' && !this.online) this.damageBarrier(wh.box, damageFor(d, wh.t, 'body'), end);
        else if (wh.box?.kind === 'barrier') audio.barrierHit(end);
        else { const surf = this.map.impactSurface(wh.box); this.fx.impact(end, wh.normal, surf); if (Math.random() < 0.5) audio.impact(surf, end); }
      }
    }
    if (anyHit && !this.online) f.stats.hits++;
    void totalDmg; void headHit;
    // sound / visuals
    if (f.isLocal) {
      audio.shot(d.sound);
      this.vm.fire(d);
      this.myLight.intensity = 14;
      const rec = d.recoil.v * DEG * (f.aiming ? 0.72 : 1) * (f.crouch ? 0.85 : 1) * (0.85 + Math.random() * 0.3) * (1 + Math.min(1, w.shotsInBurst / 10) * 0.25);
      f.pitch = Math.min(1.52, f.pitch + rec);
      this.recoilDebt += rec * 0.65;
      f.yaw += (Math.random() - 0.5) * 2 * d.recoil.h * DEG;
      this.camPunch.vp += d.recoil.kick * 4;
      if (this.bot) this.bot.heard([f.x, f.y, f.z], 1);
      if (d.pump || d.bolt) {
        setTimeout(() => { this.vm.cycle(d); audio.mech(d.pump ? 'pump' : 'boltBack'); }, d.pump ? 250 : 320);
        if (d.bolt) setTimeout(() => audio.mech('boltFwd'), 700);
      }
      this.session?.sendFire(f, origin, results.map((r) => r.dir));
      if (w.mag === 0 && w.reserve > 0) setTimeout(() => { if (w.mag === 0 && f.weapon === w && w.startReload()) this.onReloadStart(f); }, 280);
    } else {
      audio.shot(d.sound, { pos: [f.x, f.eyeY, f.z] });
      f.character?.fire();
      this.oppFlash.userData.fire(d.pellets > 1 ? 1.4 : 1);
      if (!d.pump && !d.bolt && !d.revolver && Math.random() < 0.5) audio.casing([f.x, f.y + 0.5, f.z]);
    }
    return results;
  }

  localMuzzle() {
    const c = this.camera;
    const ads = this.vm.state.adsT;
    const off = new THREE.Vector3(0.12 * (1 - ads), -0.09 * (1 - ads) - 0.03, -0.7).applyQuaternion(c.quaternion);
    return [c.position.x + off.x, c.position.y + off.y, c.position.z + off.z];
  }
  oppMuzzle() {
    const p = this.opp.character.muzzleWorld(new THREE.Vector3());
    return [p.x, p.y, p.z];
  }

  /** Apply damage (authoritative locally, or mirrored from server online). */
  damage(target, dmg, attacker, part, weaponId, fromServer = false, hpOverride = null) {
    if (!target.alive) return;
    target.hp = hpOverride != null ? hpOverride : target.hp - dmg;
    target.damageTakenRound += dmg;
    attacker.stats.damage += dmg;
    if (target === this.me) {
      // attacker direction in the player's local frame → clockwise screen angle from "ahead"
      const dx = attacker.x - target.x, dz = attacker.z - target.z;
      const fwd = -Math.sin(target.yaw) * dx - Math.cos(target.yaw) * dz;
      const right = Math.cos(target.yaw) * dx - Math.sin(target.yaw) * dz;
      this.hud.damageFrom(Math.atan2(right, fwd));
      audio.hurt();
      this.damagePulse = Math.min(1, (this.damagePulse || 0) + dmg / 50);
      this.camPunch.vp += 0.5; this.camPunch.y += (Math.random() - 0.5) * 0.02;
    } else {
      target.character?.flinch(Math.random() < 0.5 ? -1 : 1);
      this.hud.hitmarker(part === 'head' ? 'head' : '');
      audio.hitmarker(part === 'head');
      this.bot?.damaged([attacker.x, attacker.y, attacker.z]);
    }
    if (target.hp <= 0 && !fromServer) this.kill(target, attacker, weaponId, part === 'head');
  }

  kill(victim, killer, weaponId, head) {
    if (!victim.alive) return;
    victim.alive = false; victim.hp = 0;
    victim.character?.die();
    killer.stats.kills++;
    if (head) killer.stats.headshotKills++;
    if (WEAPONS[weaponId]?.slot === 'secondary') killer.stats.sidearmKills++;
    victim.stats.deaths++;
    this.hud.kill(killer.name, victim.name, WEAPONS[weaponId]?.name || '', head, killer === this.me);
    if (killer === this.me) { audio.kill(); this.hud.hitmarker('kill'); }
    if (victim === this.me) { this.vm.visible = false; this.deathCam = 0.0001; this.killerPos = [killer.x, killer.eyeY, killer.z]; }
    if (!this.online) this.endRound(killer, head ? 'Headshot elimination' : 'Elimination');
  }

  // ---------------- bot ----------------
  updateBot(dt, canAct) {
    const b = this.opp, bot = this.bot;
    for (const ws of b.weapons) { const ev = ws.update(dt); if (ws === b.weapon && ev === 'shell') audio.mech('shell', [b.x, b.y + 1, b.z]); }
    if (!b.alive) { b.vx *= 0.9; b.vz *= 0.9; moveBody(this.world, b, dt, b.height); return; }
    const I = canAct ? bot.think(dt, this.me) : { mx: 0, mz: 0 };
    if (canAct) {
      if (I.switchTo >= 0 && I.switchTo !== b.slot) { b.weapon.cancelReload(); b.slot = I.switchTo; this.setOppWeaponVisual(b.slot); }
      if (I.reload && b.weapon.startReload()) this.onReloadStart(b);
      if (I.ability) activateAbility(this, b);
      b.aiming = !!I.ads && !I.sprint;
      if (I.fire && b.weapon.canFire && !I.sprint) this.fire(b);
    }
    b.crouch = !!I.crouch;
    b.crouchT += ((b.crouch ? 1 : 0) - b.crouchT) * (1 - Math.exp(-dt * 10));
    b.sprinting = !!I.sprint;
    let speed = b.crouch ? PLAYER.crouchSpeed : I.sprint ? PLAYER.sprint : PLAYER.walk;
    speed *= b.speedMult * (b.aiming ? PLAYER.adsSpeed : 1);
    const k = 1 - Math.exp(-dt * (b.onGround ? 10 : 2));
    b.vx += ((I.mx || 0) * speed - b.vx) * k;
    b.vz += ((I.mz || 0) * speed - b.vz) * k;
    if (I.jump && b.onGround) { b.vy = PLAYER.jump; b.onGround = false; }
    moveBody(this.world, b, dt, b.height);
    const hs = Math.hypot(b.vx, b.vz);
    if (b.onGround && hs > 1.5 && !b.crouch) {
      b.footDist = (b.footDist || 0) + hs * dt;
      if (b.footDist > (b.sprinting ? 2.5 : 2)) { b.footDist = 0; audio.footstep(this.map.surfaceAt(b.x, b.y, b.z), [b.x, b.y, b.z], b.sprinting ? 1.4 : 0.9); }
    }
  }

  setOppWeaponVisual(slot) {
    if (this.oppSlotShown === slot && this.opp.character.weapon.id === this.opp.weapons[slot].id) return;
    this.oppSlotShown = slot;
    const id = this.opp.weapons[slot].id;
    this.opp.character.weapon.anchors.muzzle.remove(this.oppFlash);
    this.opp.character.setWeapon(id, this.opp.loadout.skins?.[id] || 'factory');
    this.opp.character.weapon.anchors.muzzle.add(this.oppFlash);
  }

  // ---------------- abilities / barriers / reveals ----------------
  addFx(obj, follow = null, pos = null) {
    if (pos) obj.position.set(pos[0], pos[1] + (obj.position.y || 0), pos[2]);
    obj.userData.follow = follow;
    this.scene.add(obj);
    this.fxList.push(obj);
  }

  addBarrier(box, owner, hp, duration) {
    const mesh = makeBarrierVisual(box);
    this.scene.add(mesh);
    this.world.dynamic.push(box);
    const b = { box, mesh, hp, max: hp, t: duration, owner, id: box.id };
    this.barriers.push(b);
    return b;
  }
  damageBarrier(box, dmg, at) {
    const b = this.barriers.find((x) => x.box === box);
    if (!b) return;
    b.hp -= dmg;
    b.mesh.userData.hit = 1;
    audio.barrierHit(at);
    this.fx.spark(at, [0, 1, 0], 6, [1, 0.7, 0.3], 2, 0.04, 0.25);
    if (b.hp <= 0) b.t = 0;
  }
  removeBarrierById(id) { const b = this.barriers.find((x) => x.id === id); if (b) b.t = 0; }
  updateBarriers(dt) {
    for (let i = this.barriers.length - 1; i >= 0; i--) {
      const b = this.barriers[i];
      b.t -= dt;
      b.mesh.userData.update(dt, this.time);
      b.mesh.userData.mat.uniforms.uHp.value = b.hp / b.max;
      if (b.t <= 0) {
        this.scene.remove(b.mesh);
        const k = this.world.dynamic.indexOf(b.box); if (k >= 0) this.world.dynamic.splice(k, 1);
        this.fx.spark([(b.box.min[0] + b.box.max[0]) / 2, 1, (b.box.min[2] + b.box.max[2]) / 2], [0, 1, 0], 20, [1, 0.7, 0.3], 3, 0.05, 0.4);
        this.barriers.splice(i, 1);
      }
    }
  }
  clearBarriers() { for (const b of this.barriers) { this.scene.remove(b.mesh); } this.barriers = []; this.world.dynamic.length = 0; }

  showReveal(target, duration) {
    const m = makeRevealMarker();
    this.scene.add(m);
    this.reveals.push({ m, target, t: duration });
    this.hud.objective('Recon pulse — enemy revealed');
  }
  clearReveals() { for (const r of this.reveals) this.scene.remove(r.m); this.reveals = []; }

  // ---------------- camera & visuals ----------------
  updateCamera(dt) {
    const me = this.me, cam = this.camera;
    const P = this.camPunch;
    P.vp += (-P.p * 200 - P.vp * 20) * dt; P.p += P.vp * dt;
    P.y *= Math.exp(-dt * 8);
    let roll = 0, eyeY = me.eyeY;
    if (this.deathCam > 0) {
      this.deathCam = Math.min(1, this.deathCam + dt * 1.4);
      const e = 1 - Math.pow(1 - this.deathCam, 3);
      eyeY = me.y + 0.35 + (me.eyeY - me.y - 0.35) * (1 - e);
      roll = e * 0.5;
    }
    cam.position.set(me.x, eyeY, me.z);
    if (this.deathCam > 0 && this.killerPos) {
      const dx = this.killerPos[0] - me.x, dz = this.killerPos[2] - me.z;
      const targetYaw = Math.atan2(-dx, -dz);
      let d = targetYaw - me.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      me.yaw += d * Math.min(1, dt * 2); me.pitch *= 0.95;
    }
    cam.rotation.set(me.pitch + P.p, me.yaw + P.y, roll);
    // FOV blend with ADS
    const base = settings.get('fov');
    const w = me.weapon.def;
    const adsT = this.vm.state.adsT;
    const adsFov = base * (w.ads.fov / 78);
    const od = me.speedBoost > 0 ? 6 : 0;
    const sprintF = me.sprinting ? 4 : 0;
    const target = base + (adsFov - base) * adsT + od + sprintF * (1 - adsT);
    this.currentFov = (this.currentFov || base) + (target - (this.currentFov || base)) * (1 - Math.exp(-dt * 14));
    if (Math.abs(cam.fov - this.currentFov) > 0.01) { cam.fov = this.currentFov; cam.updateProjectionMatrix(); }
    const fwd = dirFromAngles(me.yaw, me.pitch);
    audio.setListener([cam.position.x, cam.position.y, cam.position.z], fwd);
  }

  updateVisuals(dt, t) {
    const me = this.me, opp = this.opp, I = this.input;
    // viewmodel
    const scoped = !!me.weapon.def.scope && this.vm.state.adsT > 0.92 && me.alive;
    this.vm.visible = me.alive && !scoped;
    this.vm.update({
      dt, t, lookDX: this.lookDX || 0, lookDY: this.lookDY || 0, speed: Math.hypot(me.vx, me.vz), onGround: me.onGround,
      sprint: me.sprinting, ads: me.aiming && me.alive && this.switching <= 0, crouch: me.crouch, adsTime: me.weapon.def.ads.time,
    });
    this.scoped = scoped;
    this.myLight.position.copy(this.camera.position).add(new THREE.Vector3(0, 0, -1.2).applyQuaternion(this.camera.quaternion));
    this.myLight.intensity *= Math.exp(-dt * 40);

    // opponent character
    const c = opp.character;
    c.root.position.set(opp.x, opp.y, opp.z);
    c.root.rotation.y = opp.yaw + Math.PI;
    const sp = Math.hypot(opp.vx, opp.vz);
    const fx = -Math.sin(opp.yaw), fz = -Math.cos(opp.yaw);
    const fwd = sp > 0.1 ? (opp.vx * fx + opp.vz * fz) / sp : 1;
    const side = sp > 0.1 ? (opp.vx * Math.cos(opp.yaw) - opp.vz * Math.sin(opp.yaw)) / sp : 0;
    c.update(dt, { speed: sp, fwd, side, crouch: opp.crouchT, pitch: opp.pitch, sprint: opp.sprinting ? 1 : 0, aim: opp.sprinting ? 0 : 1, idle: 0 });
    this.oppFlash.userData.update(dt);
    if (!this.online) this.setOppWeaponVisual(opp.slot);

    // follow fx
    for (let i = this.fxList.length - 1; i >= 0; i--) {
      const o = this.fxList[i];
      if (o.userData.follow) o.position.set(o.userData.follow.x, o.userData.follow.y + 0.1, o.userData.follow.z);
      o.userData.update?.(dt, t);
      if (o.userData.done) { this.scene.remove(o); o.geometry?.dispose(); this.fxList.splice(i, 1); }
    }
    for (let i = this.reveals.length - 1; i >= 0; i--) {
      const r = this.reveals[i];
      r.t -= dt;
      r.m.position.set(r.target.x, r.target.y + (r.target.crouch ? 1.6 : 2.15), r.target.z);
      r.m.userData.update(dt, t);
      r.m.userData.body.position.y = r.target.crouch ? -0.95 : -1.2;
      if (r.t <= 0 || !r.target.alive) { this.scene.remove(r.m); this.reveals.splice(i, 1); if (!this.reveals.length) this.hud.objective('Eliminate the opponent'); }
    }
    this.fx.update(dt);
    this.map.update(dt, t, this.camera);
    // damage vignette
    this.damagePulse = Math.max(0, (this.damagePulse || 0) - dt * 1.5);
    const lowHp = me.alive ? Math.max(0, (35 - me.hp) / 35) * (0.6 + Math.sin(t * 4) * 0.15) : 0.8;
    this.engine.setDamage(Math.min(1, this.damagePulse + lowHp));
    if (me.alive && me.hp < 30 && Math.floor(t * 1.2) !== this._hb) { this._hb = Math.floor(t * 1.2); audio.heartbeat(); }
    void I;
  }

  updateHud() {
    const me = this.me, w = me.weapon;
    this.hud.update({
      hp: me.hp, mag: w.mag, reserve: w.reserve, magSize: w.def.mag, weaponName: w.def.name, slot: me.slot,
      abilityCd: me.ability.cd, abilityMax: me.op.ability.cooldown, abilityActive: me.ability.active,
      timer: this.phase === 'live' ? this.roundTime : this.phase === 'pre' ? MATCH.roundTime : this.roundTime ?? MATCH.roundTime,
      round: Math.max(1, this.round), you: this.score.me, opp: this.score.opp, oppAlive: this.opp.alive,
      spread: this.spreadFor(me), ads: me.aiming, scoped: this.scoped, scopeKind: w.def.scope, sprinting: me.sprinting,
      reloading: w.reloading, overdrive: me.speedBoost > 0, healing: me.healLeft > 0, fps: this.engine.fps, fov: this.camera.fov,
      ping: this.online ? this.session.ping : null, revealedMe: me.revealed > 0, oppRevealed: this.opp.revealed > 0,
    });
  }

  // ---------------- pause / lock ----------------
  onLock(locked) {
    if (this.finished || this.disposed) return;
    this.hud.showClickToPlay(!locked && !this.input.isTouch && !this.pauseMenu.open);
    if (!locked && !this.input.isTouch) this.pauseMenu.show();
    else if (locked) this.pauseMenu.hide();
  }
  togglePause() { if (this.pauseMenu.open) this.resume(); else this.pauseMenu.show(); }
  setPaused(v) { this.paused = v; if (v) audio.duckMusic(true); else audio.duckMusic(false); }
  resume() { this.pauseMenu.hide(); this.input.requestLock(); }
  quit() {
    if (this.online) this.session.forfeit();
    this.finished = true;
    this.cb.onQuit?.();
  }

  onResize() { this.vm?.onResize(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    removeEventListener('keydown', this._onKey);
    this.session?.dispose();
    this.input?.dispose();
    this.hud?.dispose();
    this.pauseMenu?.dispose();
    this.engine.setDamage(0);
    if (this.opp?.character) { this.scene.remove(this.opp.character.root); this.opp.character.dispose(); }
    this.fx?.dispose();
    this.vm?.dispose();
    this.map?.dispose();
    audio.setAmbience(null);
  }
}
