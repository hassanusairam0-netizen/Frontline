import { net } from './net.js';
import { activateAbility } from './abilities.js';
import { audio } from '../engine/audio.js';
import { WEAPONS } from '../shared/weapons.js';

// Client side of an online match. Local movement is predicted and streamed to the
// server; the opponent is rendered ~100 ms in the past from interpolated
// snapshots; health, kills, ammo truth, rounds and score come from the server.

const INTERP_DELAY = 0.1;

export class OnlineSession {
  constructor(game, config) {
    this.game = game;
    this.config = config;
    this.snaps = [];
    this.sendT = 0;
    this.ping = net.rtt;
    this.offs = [];
    const on = (ev, fn) => this.offs.push(net.on(ev, fn));
    on('round', (m) => this.onRound(m));
    on('snap', (m) => this.onSnap(m));
    on('shot', (m) => this.onShot(m));
    on('hit', (m) => this.onHit(m));
    on('kill', (m) => this.onKill(m));
    on('ability', (m) => this.onAbility(m));
    on('barrierGone', (m) => game.removeBarrierById(m.id));
    on('correct', (m) => { const me = game.me; me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vz = me.vy = 0; });
    on('reject', (m) => this.onReject(m));
    on('end', (m) => this.onEnd(m));
    on('oppLeft', (m) => { game.hud.message('Opponent disconnected', `Waiting up to ${m.grace}s for them to return`); });
    on('oppBack', () => { game.hud.message('Opponent reconnected', ''); setTimeout(() => game.hud.message(''), 1500); });
    on('rtt', (r) => { this.ping = r; });
    on('disconnected', () => {
      game.hud.message('Connection lost', 'Returning to menu');
      setTimeout(() => { if (!game.finished) { game.finished = true; game.input.exitLock(); game.cb.onQuit?.(); } }, 2500);
    });
  }

  ready() { net.send('loaded', {}); }

  get oppId() { return this.config.opponent.id; }
  isMe(id) { return id === net.id || id === this.config.youId; }

  onRound(m) {
    const g = this.game;
    g.score.me = m.score[0]; g.score.opp = m.score[1];
    if (m.phase === 'pre') {
      // server-chosen spawns
      g.round = m.round - 1;
      g.startRound(m.spawns ? { me: m.spawns.me, opp: m.spawns.opp } : null);
      g.phaseT = m.t;
    } else if (m.phase === 'live') {
      g.roundTime = m.roundTime;
      g.goLive();
    } else if (m.phase === 'end' || m.phase === 'over') {
      const over = m.phase === 'over';
      g.phase = 'live';
      const winner = m.winner === 'me' ? g.me : m.winner === 'opp' ? g.opp : null;
      // mirror server score: endRound increments locally, so roll back first
      if (winner === g.me) g.score.me--; else if (winner === g.opp) g.score.opp--;
      g.endRound(winner, m.reason);
      if (!over) g.phase = 'end';
    }
  }

  onSnap(m) {
    const g = this.game;
    this.snaps.push({ t: performance.now() / 1000, ...m.op });
    while (this.snaps.length > 30) this.snaps.shift();
    if (g.phase === 'live' || g.phase === 'pre') g.roundTime = m.tl;
    const me = g.me;
    me.hp = m.me.hp;
    if (me.alive && !m.me.alive) me.alive = false;
    me.ability.cd = m.me.cd;
    // reconcile ammo when idle (avoid fighting local prediction mid-burst)
    const w = me.weapons[m.me.cur];
    if (w && !w.reloading && w.cooldown <= 0 && m.me.cur === me.slot) { const [mag, res] = m.me.ammo[m.me.cur]; if (Math.abs(w.mag - mag) > 1 || w.reserve !== res) { w.mag = mag; w.reserve = res; } }
    const opp = g.opp;
    opp.alive = m.op.alive;
    if (m.op.cur !== opp.slot) { opp.slot = m.op.cur; g.setOppWeaponVisual(opp.slot); }
  }

  onShot(m) {
    const g = this.game, opp = g.opp;
    const w = WEAPONS[m.w];
    const muzzle = g.oppMuzzle();
    for (const e of m.e) {
      g.fx.tracer(muzzle, e, [0.55, 0.75, 1]);
      if (!e[3]) g.fx.impact(e, [0, 1, 0], 'concrete');
    }
    audio.shot(w?.sound || 'rifle', { pos: [opp.x, opp.eyeY, opp.z] });
    opp.character?.fire();
    g.oppFlash.userData.fire(w?.pellets > 1 ? 1.4 : 1);
  }

  onHit(m) {
    const g = this.game;
    const target = this.isMe(m.target) ? g.me : g.opp;
    const by = target === g.me ? g.opp : g.me;
    if (by === g.me) g.me.stats.hits++;
    g.damage(target, m.dmg, by, m.part, m.w, true, target === g.me ? m.hp : Math.max(1, target.hp - m.dmg));
  }

  onKill(m) {
    const g = this.game;
    const victim = this.isMe(m.victim) ? g.me : g.opp;
    const killer = victim === g.me ? g.opp : g.me;
    victim.alive = true; // let kill() run its effects
    g.kill(victim, killer, m.w, m.head);
  }

  onAbility(m) {
    const g = this.game;
    const f = this.isMe(m.by) ? g.me : g.opp;
    activateAbility(g, f, { force: true, box: m.box, revealed: m.revealed });
    if (m.box) { const b = g.barriers[g.barriers.length - 1]; if (b) b.id = m.box.id; }
  }

  onReject(m) {
    const me = this.game.me;
    if (m.ammo) m.ammo.forEach(([mag, res], i) => { me.weapons[i].mag = mag; me.weapons[i].reserve = res; });
  }

  onEnd(m) {
    const g = this.game;
    g.finishMatch({ won: m.won, roundsWon: m.roundsWon, roundsLost: m.roundsLost, rewards: m.rewards, profile: m.profile, forfeit: m.forfeit, serverStats: m });
  }

  // ----- outgoing -----
  sendFire(f, origin, dirs) { net.send('fire', { w: f.weapon.id, o: origin.map((v) => +v.toFixed(3)), d: dirs.map((d) => d.map((v) => +v.toFixed(4))) }); }
  sendReload(slot) { net.send('reload', { slot }); }
  sendSwitch(slot) { net.send('switch', { slot }); }
  sendAbility() { net.send('ability', {}); }
  forfeit() { net.send('forfeit', {}); }

  update(dt) {
    const g = this.game, me = g.me;
    // phase timers for display only
    if (g.phase === 'pre') {
      g.phaseT -= dt;
      const c = Math.ceil(g.phaseT);
      if (c !== g.lastBeep && c > 0) { g.lastBeep = c; g.hud.countdown(c); audio.beep(false); }
    }
    // stream input at 30 Hz
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / 30;
      net.send('input', { x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), c: me.crouch ? 1 : 0, sp: me.sprinting ? 1 : 0, ads: me.aiming ? 1 : 0 });
    }
    // interpolate opponent
    const rt = performance.now() / 1000 - INTERP_DELAY;
    const S = this.snaps;
    if (S.length) {
      let a = S[0], b = S[S.length - 1];
      for (let i = 0; i < S.length - 1; i++) if (S[i].t <= rt && S[i + 1].t >= rt) { a = S[i]; b = S[i + 1]; break; }
      const k = b.t === a.t ? 1 : Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
      const o = g.opp;
      o.x = a.x + (b.x - a.x) * k; o.y = a.y + (b.y - a.y) * k; o.z = a.z + (b.z - a.z) * k;
      let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      o.yaw = a.yaw + dy * k; o.pitch = a.pitch + (b.pitch - a.pitch) * k;
      o.crouch = !!b.c; o.crouchT += ((o.crouch ? 1 : 0) - o.crouchT) * Math.min(1, dt * 10);
      o.sprinting = !!b.sp; o.aiming = !!b.ads; o.vx = b.vx; o.vz = b.vz;
    }
  }

  dispose() { this.offs.forEach((off) => off()); }
}
