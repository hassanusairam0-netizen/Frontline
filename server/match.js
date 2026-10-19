import { getLayout } from '../src/shared/maps/index.js';
import { createWorld, blocked, raycastWorld, rayPlayer, barrierBox, PLAYER } from '../src/shared/collision.js';
import { WEAPONS, damageFor, fireInterval } from '../src/shared/weapons.js';
import { OPERATORS, MAX_HEALTH } from '../src/shared/operators.js';
import { MATCH } from '../src/shared/rules.js';

// Server-authoritative 1v1 match. Clients send movement (validated), fire
// requests (re-traced here with lag compensation), reloads, switches and
// ability requests. The server owns health, ammo, cooldowns, rounds and score.

const TICK = 1 / 30;
// Test hook (never set in production): fixed facing spawns with clear line of sight.
const TEST_SPAWNS = process.env.FRONTLINE_TEST_SPAWNS === '1';
const SNAP_EVERY = 2; // 15 Hz snapshots
const MAX_REWIND = 0.25;

class PlayerState {
  constructor(slot, conn, loadout, name) {
    this.slot = slot; // 0 | 1
    this.conn = conn;
    this.id = conn.id;
    this.name = name;
    this.loadout = loadout;
    this.op = OPERATORS[loadout.operator];
    this.weaponIds = [loadout.primary, loadout.secondary];
    this.connected = true;
    this.loaded = false;
    this.resetLife({ x: 0, z: 0, yaw: 0 });
    this.abilityCd = 0;
    this.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, damage: 0, roundsWon: 0, flawless: 0 };
    this.history = [];
  }
  resetLife(sp) {
    this.x = sp.x; this.y = 0; this.z = sp.z; this.yaw = sp.yaw; this.pitch = 0; this.crouch = false; this.sprint = false; this.ads = false;
    this.vx = 0; this.vz = 0;
    this.hp = MAX_HEALTH; this.alive = true;
    this.cur = 0; this.switchUntil = 0;
    this.ammo = this.weaponIds.map((id) => ({ mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, reloadUntil: 0, nextFire: 0 }));
    this.boostUntil = 0; this.healLeft = 0;
    this.damageThisRound = 0;
    this.lastMove = null;
    this.history = [];
  }
  get eyeY() { return this.y + (this.crouch ? PLAYER.crouchEye : PLAYER.eye); }
  send(type, data) { if (this.connected) this.conn.send(type, data); }
}

export class Match {
  constructor(room, players, mapId, roundsToWin = MATCH.roundsToWin) {
    this.room = room;
    this.mapId = mapId;
    this.layout = getLayout(mapId);
    this.world = createWorld(this.layout.colliders, this.layout.bounds);
    this.roundsToWin = roundsToWin;
    this.p = players.map((pl, i) => new PlayerState(i, pl.conn, pl.loadout, pl.name));
    this.phase = 'loading';
    this.phaseT = 20; // load timeout
    this.round = 0;
    this.score = [0, 0];
    this.barriers = [];
    this.barrierSeq = 1;
    this.tick = 0;
    this.startedAt = Date.now();
    this.ended = false;
    this.timer = setInterval(() => this.step(), TICK * 1000);
  }

  get now() { return Date.now() / 1000; }
  other(ps) { return this.p[1 - ps.slot]; }
  byConn(conn) { return this.p.find((x) => x.conn === conn || x.id === conn.id); }

  startPayload(ps) {
    const o = this.other(ps);
    return {
      map: this.mapId, roundsToWin: this.roundsToWin, matchId: this.room.code,
      you: { id: ps.id, slot: ps.slot },
      opponent: { id: o.id, name: o.name, loadout: o.loadout },
      resume: this.phase !== 'loading' ? { round: this.round, score: this.score, phase: this.phase } : null,
    };
  }

  // ---------- messages ----------
  onMessage(conn, msg) {
    const ps = this.byConn(conn);
    if (!ps || this.ended) return;
    switch (msg.type) {
      case 'loaded': ps.loaded = true; if (this.phase === 'loading' && this.p.every((x) => x.loaded)) this.startRound(); else if (this.phase !== 'loading') this.sendRound(ps); break;
      case 'input': this.onInput(ps, msg); break;
      case 'fire': this.onFire(ps, msg); break;
      case 'reload': this.onReload(ps, msg); break;
      case 'switch': this.onSwitch(ps, msg); break;
      case 'ability': this.onAbility(ps); break;
      case 'forfeit': this.end(this.other(ps), true); break;
    }
  }

  onInput(ps, m) {
    if (!ps.alive) return;
    const now = this.now;
    const x = +m.x, y = +m.y, z = +m.z;
    if (![x, y, z].every(Number.isFinite)) return;
    ps.yaw = +m.yaw || 0; ps.pitch = Math.max(-1.6, Math.min(1.6, +m.pitch || 0));
    ps.crouch = !!m.c; ps.sprint = !!m.sp; ps.ads = !!m.ads;
    if (this.phase === 'pre' || this.phase === 'loading') {
      // frozen at spawn: accept look direction, snap back only if the client drifted
      if (Math.hypot(x - ps.x, z - ps.z) > 0.6) ps.send('correct', { x: ps.x, y: ps.y, z: ps.z });
      ps.lastMove = now;
      return;
    }
    // movement validation: speed budget + no clipping into solids
    const dt = ps.lastMove ? Math.min(0.5, now - ps.lastMove) : TICK;
    const boost = now < ps.boostUntil ? 1.32 : 1;
    const maxSpeed = PLAYER.sprint * 1.08 * boost * ps.op.speed;
    const dist = Math.hypot(x - ps.x, z - ps.z);
    const budget = maxSpeed * dt * 1.35 + 0.35;
    const h = ps.crouch ? PLAYER.crouchHeight : PLAYER.height;
    const inside = blocked(this.world, x, y + 0.08, z, h - 0.1, PLAYER.radius - 0.12);
    if (dist > budget || inside || y < -0.5 || y > 8) {
      ps.send('correct', { x: ps.x, y: ps.y, z: ps.z });
      ps.lastMove = now;
      return;
    }
    ps.vx = (x - ps.x) / Math.max(dt, 0.01); ps.vz = (z - ps.z) / Math.max(dt, 0.01);
    ps.x = x; ps.y = y; ps.z = z; ps.lastMove = now;
  }

  onFire(ps, m) {
    if (this.phase !== 'live' || !ps.alive) return;
    const now = this.now;
    const wid = ps.weaponIds[ps.cur];
    const w = WEAPONS[wid];
    const a = ps.ammo[ps.cur];
    if (m.w !== wid || now < ps.switchUntil) return ps.send('reject', { reason: 'weapon', ammo: this.ammoOf(ps) });
    if (a.reloadUntil > now) {
      if (w.perShell && a.mag > 0) a.reloadUntil = 0; else return ps.send('reject', { reason: 'reloading', ammo: this.ammoOf(ps) });
    }
    if (a.mag <= 0) return ps.send('reject', { reason: 'empty', ammo: this.ammoOf(ps) });
    const interval = fireInterval(w) + (w.bolt ? 0.75 : w.pump ? 0.55 : 0);
    if (now < a.nextFire - 0.06) return ps.send('reject', { reason: 'rate', ammo: this.ammoOf(ps) });
    a.nextFire = Math.max(now, a.nextFire) + interval * 0.92;
    a.mag--;
    ps.stats.shots++;
    const o = Array.isArray(m.o) ? m.o.map(Number) : [ps.x, ps.eyeY, ps.z];
    if (!o.every(Number.isFinite) || Math.hypot(o[0] - ps.x, o[1] - ps.eyeY, o[2] - ps.z) > 1.4) { o[0] = ps.x; o[1] = ps.eyeY; o[2] = ps.z; }
    const dirs = (Array.isArray(m.d) ? m.d : []).slice(0, w.pellets).map((d) => { const v = d.map(Number); const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; });
    if (!dirs.length) return;
    const target = this.other(ps);
    // lag compensation: rewind target to where the shooter saw it
    const rewind = Math.min(MAX_REWIND, (ps.conn.rtt || 80) / 2000 + 0.1);
    const tpos = this.historyAt(target, now - rewind);
    const ends = [];
    let anyHit = false, totalDmg = 0, part = null;
    for (const d of dirs) {
      const wh = raycastWorld(this.world, o, d, 220);
      const maxT = wh ? wh.t : 220;
      const ph = target.alive ? rayPlayer(o, d, tpos, maxT) : null;
      const t = ph ? ph.t : maxT;
      ends.push([+(o[0] + d[0] * t).toFixed(2), +(o[1] + d[1] * t).toFixed(2), +(o[2] + d[2] * t).toFixed(2), ph ? 1 : 0]);
      if (ph) { anyHit = true; const dmg = damageFor(w, t, ph.part); totalDmg += dmg; if (!part || ph.part === 'head') part = ph.part; }
      else if (wh?.box?.kind === 'barrier') this.damageBarrier(wh.box, damageFor(w, wh.t, 'body'));
    }
    target.send('shot', { o, e: ends, w: wid });
    if (anyHit) { ps.stats.hits++; this.applyDamage(target, totalDmg, ps, part, wid); }
  }

  ammoOf(ps) { return ps.ammo.map((a) => [a.mag, a.reserve]); }

  onReload(ps, m) {
    if (!ps.alive) return;
    const slot = m.slot === 1 ? 1 : 0;
    if (slot !== ps.cur) return;
    const a = ps.ammo[slot], w = WEAPONS[ps.weaponIds[slot]];
    if (a.reloadUntil > this.now || a.mag >= w.mag || a.reserve <= 0) return;
    if (w.perShell) { a.reloadUntil = this.now + w.reload; a.perShell = true; }
    else { a.reloadUntil = this.now + (a.mag === 0 ? w.reloadEmpty : w.reload) * 0.95; a.perShell = false; a.pendingFill = true; }
  }

  onSwitch(ps, m) {
    const slot = m.slot === 1 ? 1 : 0;
    if (slot === ps.cur) return;
    ps.ammo[ps.cur].reloadUntil = 0; ps.ammo[ps.cur].pendingFill = false;
    ps.cur = slot; ps.switchUntil = this.now + 0.2;
  }

  onAbility(ps) {
    if (!ps.alive || this.phase !== 'live' || ps.abilityCd > 0) return;
    const A = ps.op.ability;
    ps.abilityCd = A.cooldown;
    const o = this.other(ps);
    const ev = { by: ps.id, id: A.id };
    if (A.id === 'overdrive') ps.boostUntil = this.now + A.duration;
    else if (A.id === 'stim') { ps.healLeft = A.heal; }
    else if (A.id === 'barrier') {
      const box = barrierBox(ps.x, ps.y, ps.z, ps.yaw);
      box.id = this.barrierSeq++;
      this.world.dynamic.push(box);
      this.barriers.push({ box, hp: A.hp, until: this.now + A.duration });
      ev.box = box;
    } else if (A.id === 'recon') {
      ev.revealed = o.alive && Math.hypot(o.x - ps.x, o.z - ps.z) <= A.radius;
    }
    for (const pl of this.p) pl.send('ability', ev);
  }

  damageBarrier(box, dmg) {
    const b = this.barriers.find((x) => x.box === box);
    if (!b) return;
    b.hp -= dmg;
    if (b.hp <= 0) this.removeBarrier(b);
  }
  removeBarrier(b) {
    const i = this.barriers.indexOf(b); if (i >= 0) this.barriers.splice(i, 1);
    const k = this.world.dynamic.indexOf(b.box); if (k >= 0) this.world.dynamic.splice(k, 1);
    for (const pl of this.p) pl.send('barrierGone', { id: b.box.id });
  }

  applyDamage(target, dmg, by, part, wid) {
    if (!target.alive) return;
    target.hp -= dmg;
    target.damageThisRound += dmg;
    by.stats.damage += dmg;
    const hp = Math.max(0, Math.round(target.hp));
    for (const pl of this.p) pl.send('hit', { target: target.id, by: by.id, dmg, part, hp: pl === target ? hp : undefined, w: wid });
    if (target.hp <= 0) {
      target.alive = false; target.hp = 0;
      by.stats.kills++; target.stats.deaths++;
      if (part === 'head') by.stats.headshots++;
      for (const pl of this.p) pl.send('kill', { killer: by.id, victim: target.id, w: wid, head: part === 'head' });
      this.endRound(by, part === 'head' ? 'Headshot elimination' : 'Elimination');
    }
  }

  historyAt(ps, t) {
    const h = ps.history;
    if (!h.length) return { x: ps.x, y: ps.y, z: ps.z, crouch: ps.crouch };
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= t) {
        const a = h[i], b = h[i + 1];
        if (!b) return a;
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: k < 0.5 ? a.crouch : b.crouch };
      }
    }
    return h[0];
  }

  // ---------- rounds ----------
  startRound() {
    this.round++;
    const flip = this.round % 2 === 0;
    const L = this.layout.spawns;
    const ri = Math.floor(Math.random() * 3);
    let spawns = [L[flip ? 'B' : 'A'][ri % L.A.length], L[flip ? 'A' : 'B'][(ri + 1) % L.B.length]];
    if (TEST_SPAWNS) spawns = [{ x: -20, z: 0, yaw: -Math.PI / 2 }, { x: -8, z: 0, yaw: Math.PI / 2 }];
    this.p.forEach((pl, i) => { pl.resetLife(spawns[i]); if (this.round > 1) pl.abilityCd *= 0.5; else pl.abilityCd = 0; });
    for (const b of [...this.barriers]) this.removeBarrier(b);
    this.phase = 'pre'; this.phaseT = MATCH.preRound - 1;
    this.roundTime = MATCH.roundTime;
    this.p.forEach((pl, i) => this.sendRound(pl, { me: spawns[i], opp: spawns[1 - i] }));
  }

  sendRound(pl, spawns = null, winner = null, reason = '') {
    const sc = [this.score[pl.slot], this.score[1 - pl.slot]];
    pl.send('round', { phase: this.phase, round: this.round, score: sc, spawns, t: this.phaseT, winner, reason, roundTime: this.roundTime });
  }

  endRound(winner, reason) {
    if (this.phase !== 'live') return;
    this.phase = 'end'; this.phaseT = MATCH.roundEnd;
    if (winner) { this.score[winner.slot]++; winner.stats.roundsWon++; if (winner.damageThisRound === 0) winner.stats.flawless++; }
    for (const pl of this.p) this.sendRound(pl, null, winner ? (winner === pl ? 'me' : 'opp') : 'draw', reason);
    if (this.score.some((s) => s >= this.roundsToWin)) { this.phase = 'over'; this.phaseT = 3; }
  }

  step() {
    if (this.ended) return;
    const now = this.now;
    this.tick++;
    if (this.phase === 'loading') { this.phaseT -= TICK; if (this.phaseT <= 0) { if (this.p.every((x) => x.loaded)) this.startRound(); else this.end(this.p.find((x) => x.loaded) || null, true); } return; }
    if (this.phase === 'pre') { this.phaseT -= TICK; if (this.phaseT <= 0) { this.phase = 'live'; for (const pl of this.p) this.sendRound(pl); } }
    else if (this.phase === 'live') {
      this.roundTime -= TICK;
      if (this.roundTime <= 0) { const [a, b] = this.p; this.endRound(a.hp > b.hp ? a : b.hp > a.hp ? b : null, 'Time expired'); }
    } else if (this.phase === 'end') { this.phaseT -= TICK; if (this.phaseT <= 0) this.startRound(); }
    else if (this.phase === 'over') { this.phaseT -= TICK; if (this.phaseT <= 0) { const w = this.score[0] > this.score[1] ? this.p[0] : this.p[1]; this.end(w, false); return; } }

    for (const pl of this.p) {
      pl.abilityCd = Math.max(0, pl.abilityCd - TICK);
      if (pl.healLeft > 0 && pl.alive) { const amt = Math.min(pl.healLeft, 20 * TICK); pl.healLeft -= amt; pl.hp = Math.min(MAX_HEALTH, pl.hp + amt); }
      for (const a of pl.ammo) {
        if (a.reloadUntil && now >= a.reloadUntil) {
          const w = WEAPONS[pl.weaponIds[pl.ammo.indexOf(a)]];
          if (a.perShell) { if (a.reserve > 0 && a.mag < w.mag) { a.mag++; a.reserve--; } a.reloadUntil = a.mag < w.mag && a.reserve > 0 ? now + w.reload : 0; }
          else if (a.pendingFill) { const take = Math.min(w.mag - a.mag, a.reserve); a.mag += take; a.reserve -= take; a.reloadUntil = 0; a.pendingFill = false; }
        }
      }
      pl.history.push({ t: now, x: pl.x, y: pl.y, z: pl.z, crouch: pl.crouch });
      while (pl.history.length && pl.history[0].t < now - 1) pl.history.shift();
    }
    for (const b of [...this.barriers]) if (now >= b.until) this.removeBarrier(b);

    if (this.tick % SNAP_EVERY === 0) {
      for (const pl of this.p) {
        const o = this.other(pl);
        pl.send('snap', {
          ph: this.phase, tl: +this.roundTime.toFixed(2), rd: this.round,
          me: { hp: Math.round(pl.hp), alive: pl.alive, cd: +pl.abilityCd.toFixed(1), ammo: this.ammoOf(pl), cur: pl.cur },
          op: { x: +o.x.toFixed(3), y: +o.y.toFixed(3), z: +o.z.toFixed(3), yaw: +o.yaw.toFixed(3), pitch: +o.pitch.toFixed(3), c: o.crouch ? 1 : 0, sp: o.sprint ? 1 : 0, ads: o.ads ? 1 : 0, cur: o.cur, alive: o.alive, vx: +o.vx.toFixed(2), vz: +o.vz.toFixed(2) },
        });
      }
    }
  }

  // ---------- connection lifecycle ----------
  disconnected(conn) {
    const ps = this.byConn(conn);
    if (!ps || this.ended) return;
    ps.connected = false;
    this.other(ps).send('oppLeft', { grace: 15 });
    clearTimeout(ps.graceTimer);
    ps.graceTimer = setTimeout(() => { if (!ps.connected) this.end(this.other(ps), true); }, 15000);
  }
  reconnected(ps, conn) {
    ps.conn = conn; ps.connected = true; clearTimeout(ps.graceTimer);
    ps.send('start', this.startPayload(ps));
    this.other(ps).send('oppBack', {});
  }

  end(winner, forfeit) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    const duration = Math.round((Date.now() - this.startedAt) / 1000);
    for (const pl of this.p) {
      const won = winner === pl;
      const o = this.other(pl);
      const stats = { won, roundsWon: this.score[pl.slot], roundsLost: this.score[o.slot], kills: pl.stats.kills, deaths: pl.stats.deaths, headshots: pl.stats.headshots, shots: pl.stats.shots, hits: pl.stats.hits, flawless: pl.stats.flawless };
      const prof = pl.conn.profile;
      // A player who forfeits by leaving still gets completion credit only if they stayed connected.
      const rewards = prof && (pl.connected || !forfeit) ? this.room.grant(prof, stats) : null;
      pl.send('end', { ...stats, forfeit, duration, rewards, profile: prof ? this.room.publicProfile(prof) : null });
    }
    this.room.matchEnded(this);
  }

  dispose() { clearInterval(this.timer); this.p.forEach((x) => clearTimeout(x.graceTimer)); }
}
