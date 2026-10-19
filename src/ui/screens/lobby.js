import { h, clear, toast } from '../dom.js';
import { net } from '../../game/net.js';
import { profile } from '../../state/profile.js';
import { settings } from '../../state/settings.js';
import { MenuStage } from '../../stages/MenuStage.js';
import { MAP_LIST, MAPS, getLayout } from '../../shared/maps/index.js';
import { OPERATORS, BANNERS } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';
import { drawMapPlan } from '../../stages/MapStage.js';
import { launchMatch } from '../../game/launch.js';
import { audio } from '../../engine/audio.js';

// Online flow: connect → matchmaking queue or private room → lobby (loadouts,
// map vote, ready-up, countdown) → match start handed to the launcher.

export class LobbyScreen {
  constructor(app, params) {
    this.app = app; this.params = params; this.music = 'menu'; this.ambience = 'menu';
    this.mode = params.mode || 'quick';
    this.room = params.room || null;
    this.offs = [];
    this.view = 'connecting';
  }
  async prepareStage() { await this.app.useStage('menu', () => new MenuStage(this.app.engine)); }

  render() {
    this.body = h('div.reveal', { style: { maxWidth: '1180px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' } });
    return h('section.screen.scroll-y', this.body);
  }

  mounted() {
    const on = (ev, fn) => this.offs.push(net.on(ev, fn));
    on('queued', () => { this.view = 'queue'; this.draw(); });
    on('room', (m) => { this.room = m; this.view = 'room'; this.draw(); if (m.state === 'countdown') audio.beep(m.countdown <= 1); });
    on('error', (m) => toast(m.msg, 'err'));
    on('start', (m) => this.onStart(m));
    on('disconnected', () => { this.view = 'error'; this.err = 'Lost connection to the game server.'; this.draw(); });
    this.connect();
  }

  async connect() {
    this.view = 'connecting'; this.draw();
    try {
      await net.connect();
      if (this.room) { this.view = 'room'; this.draw(); net.send('loadout', { loadout: profile.loadout() }); return; }
      if (this.mode === 'quick') { net.send('queue', {}); this.queueStart = performance.now(); this.view = 'queue'; }
      else this.view = 'roomPick';
      this.draw();
    } catch (e) {
      this.view = 'error'; this.err = e.message; this.draw();
    }
  }

  draw() {
    const b = clear(this.body);
    clearInterval(this.qTimer);
    const head = (eyebrow, title) => h('div', h('div.eyebrow', eyebrow), h('h2.h-section', title));
    if (this.view === 'connecting') {
      b.append(head('Online', 'Connecting'), h('div.panel.panel-pad', h('p', `Reaching the FRONTLINE game server at `, h('span.mono', net.url), ' …')));
    } else if (this.view === 'error') {
      b.append(head('Online · Unavailable', 'Server unreachable'),
        h('div.panel.panel-pad.col',
          h('div.notice.warn', h('strong', 'Online multiplayer needs the FRONTLINE game server running. '), `(${this.err})`),
          h('p', 'This prototype ships with a real Node.js WebSocket server (server/index.js) that runs matchmaking, private rooms, lobbies and server-authoritative matches, and stores online profiles. To play online:'),
          h('div.notice', h('div', 'Local: run ', h('code', 'npm run server'), ' alongside ', h('code', 'npm run dev'), ' — the dev server proxies ', h('code', '/ws'), ' to port 8787.'),
            h('div', 'Production: ', h('code', 'npm start'), ' builds the client and serves it from the same Node process. Deploy that process to any host with WebSocket support.'),
            h('div', 'Custom host: set a server URL below (e.g. ', h('code', 'wss://your-host/ws'), ').')),
          h('div.field', h('label', 'Server URL (blank = same origin)'), h('input.input', { value: settings.get('serverUrl'), placeholder: net.url, onchange: (e) => settings.set('serverUrl', e.target.value.trim()) })),
          h('div.row', h('button.btn.btn--primary', { onclick: () => this.connect() }, 'Retry'), h('button.btn', { onclick: () => this.app.go('play', { practice: true }) }, 'Play vs bots instead'), h('button.btn', { onclick: () => this.app.go('menu') }, 'Back'))));
    } else if (this.view === 'queue') {
      const t = h('span.mono', '0:00');
      this.qTimer = setInterval(() => { const s = Math.floor((performance.now() - (this.queueStart || performance.now())) / 1000); t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
      b.append(head('Quick match', 'Searching for an opponent'),
        h('div.panel.panel-pad.col', { style: { alignItems: 'flex-start' } },
          h('div.row', h('span.online-dot.on'), h('span', 'Connected · in queue · '), t),
          h('p', 'You will be paired with the next player who queues. Open a second browser window and press Quick Match there to test a full online match locally.'),
          h('button.btn', { onclick: () => { net.send('cancelQueue'); this.app.go('play'); } }, 'Cancel')));
    } else if (this.view === 'roomPick') {
      const code = h('input.input', { placeholder: 'ABCD', maxLength: 4, style: { textTransform: 'uppercase', width: '160px', letterSpacing: '.3em' } });
      b.append(head('Private room', 'Create or join'),
        h('div.mode-grid', { style: { gridTemplateColumns: '1fr 1fr' } },
          h('div.mode-card', { onclick: () => net.send('createRoom') }, h('h3', 'Create room'), h('p', 'Get a four-letter code to share with your opponent.'), h('div.go', h('button.btn.btn--primary', 'Create'))),
          h('div.mode-card', { style: { cursor: 'default' } }, h('h3', 'Join room'), h('p', 'Enter the code your opponent shared.'),
            h('div.go.row', code, h('button.btn', { onclick: () => { if (code.value.trim().length === 4) net.send('joinRoom', { code: code.value.trim().toUpperCase() }); else toast('Enter the four-letter room code', 'err'); } }, 'Join')))),
        h('button.btn', { style: { alignSelf: 'flex-start' }, onclick: () => this.app.go('play') }, 'Back'));
    } else if (this.view === 'room') this.drawRoom(b, head);
  }

  drawRoom(b, head) {
    const r = this.room;
    const me = r.players.find((p) => p.id === net.id);
    const them = r.players.find((p) => p.id !== net.id);
    if (!this.sentLoadout) { this.sentLoadout = true; net.send('loadout', { loadout: profile.loadout() }); }
    const card = (p, mine) => {
      if (!p) return h('div.panel.lobby-player', h('div.eyebrow.blue', 'Opponent'), h('div', { style: { fontFamily: 'var(--f-display)', fontSize: '28px', letterSpacing: '.1em', marginTop: '30px' } }, 'Waiting for player…'), r.kind === 'private' && h('p', 'Share the room code above.'));
      const op = OPERATORS[p.loadout.operator];
      const bn = BANNERS[p.banner] || BANNERS.standard;
      return h('div.panel.lobby-player', { class: p.ready ? 'ready' : '' },
        h('div.banner', { style: { background: `linear-gradient(90deg, ${bn.colors[0]}, ${bn.colors[1]})` } }),
        h('div', { class: mine ? 'eyebrow' : 'eyebrow blue' }, mine ? 'You' : 'Opponent'),
        h('div', { style: { fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '34px', letterSpacing: '.08em', textTransform: 'uppercase' } }, p.name),
        h('div.row', h('span.tag', { class: mine ? 'amber' : 'blue' }, `${op.name} · ${op.role}`)),
        h('div.small.muted', `${WEAPONS[p.loadout.primary].name} · ${WEAPONS[p.loadout.secondary].name}`),
        h('div', { style: { marginTop: 'auto' } }, p.ready ? h('span.tag.ok', 'Ready') : h('span.tag', 'Not ready')));
    };
    const ownedOps = Object.values(OPERATORS).filter((o) => profile.owns('operator', o.id));
    const ownedPrim = Object.values(WEAPONS).filter((w) => w.slot === 'primary' && profile.owns('weapon', w.id));
    const ownedSec = Object.values(WEAPONS).filter((w) => w.slot === 'secondary' && profile.owns('weapon', w.id));
    const lo = profile.loadout();
    const sel = (items, cur, slot) => h('div.seg', { style: { flexWrap: 'wrap' } }, items.map((it) => h('button', { class: it.id === cur ? 'on' : '', disabled: me?.ready, onclick: () => { profile.equip(slot, it.id); net.send('loadout', { loadout: profile.loadout() }); this.draw(); } }, it.name.split(' ')[0])));
    const votes = h('div.vote-grid', MAP_LIST.map((m) => {
      const plan = drawMapPlan(getLayout(m.id), 240, 120); plan.style.width = '100%'; plan.style.display = 'block';
      return h('button.vote', { class: me?.vote === m.id ? 'on' : '', onclick: () => net.send('vote', { map: m.id }), dataset: { map: m.id } },
        plan,
        h('div', { style: { fontFamily: 'var(--f-display)', fontWeight: 700, letterSpacing: '.08em', marginTop: '8px' } }, m.name),
        h('div.votes', r.players.filter((p) => p.vote === m.id).map((p) => h('i', { class: p.id === net.id ? '' : 'them' }))));
    }));
    b.append(
      h('div.row', head(r.kind === 'private' ? 'Private room' : 'Quick match · Lobby', r.state === 'countdown' ? 'Match starting' : 'Lobby'), h('span.grow'),
        r.kind === 'private' && h('div', { style: { textAlign: 'right' } }, h('div.small.muted', 'ROOM CODE'), h('div.room-code', r.code))),
      h('div', r.state === 'countdown' ? h('div.countdown-big', r.countdown) : null),
      h('div.lobby', card(me, true), h('div.vs', 'VS'), card(them, false)),
      h('div.panel.panel-pad.col', { style: { gap: '14px' } },
        h('div.eyebrow', 'Your loadout'),
        h('div.field', h('label', 'Operator'), sel(ownedOps, lo.operator, 'operator')),
        h('div.row', { style: { gap: '28px', flexWrap: 'wrap' } }, h('div.field', h('label', 'Primary'), sel(ownedPrim, lo.primary, 'primary')), h('div.field', h('label', 'Sidearm'), sel(ownedSec, lo.secondary, 'secondary')))),
      h('div.panel.panel-pad.col', h('div.eyebrow', 'Map vote · ties resolve randomly between the voted maps'), votes),
      h('div.row',
        h('button.btn', { onclick: () => { net.send('leaveRoom'); this.app.go('play'); } }, 'Leave'),
        h('span.grow'),
        h('span.small.muted', them ? (them.ready ? 'Opponent is ready' : 'Waiting for opponent to ready up') : 'Waiting for an opponent to join'),
        h(`button.btn.btn--lg${me?.ready ? '' : '.btn--primary'}`, { disabled: !them, onclick: () => net.send('ready', { ready: !me?.ready }), dataset: { act: 'ready' } }, me?.ready ? 'Cancel ready' : 'Ready')));
  }

  onStart(m) {
    const lo = profile.loadout();
    const mine = this.room?.players.find((p) => p.id === net.id)?.loadout || lo;
    launchMatch(this.app, {
      mode: 'online', map: m.map, roundsToWin: m.roundsToWin, youId: m.you.id,
      opponent: { id: m.opponent.id, name: m.opponent.name.toUpperCase(), loadout: m.opponent.loadout },
      loadout: { ...lo, operator: mine.operator, primary: mine.primary, secondary: mine.secondary },
      room: this.room, difficulty: 'online',
    });
  }

  unmount() { clearInterval(this.qTimer); this.offs.forEach((o) => o()); }
}
export { MAPS };
