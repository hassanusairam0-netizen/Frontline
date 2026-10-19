import { h, clear, toast, confirm } from '../dom.js';
import { settings, QUALITY } from '../../state/settings.js';
import { profile } from '../../state/profile.js';
import { net } from '../../game/net.js';
import { MenuStage } from '../../stages/MenuStage.js';

const TABS = [['graphics', 'Graphics'], ['controls', 'Controls'], ['audio', 'Audio'], ['account', 'Profile'], ['about', 'About']];

export class SettingsScreen {
  constructor(app, params) { this.app = app; this.tab = params.tab || 'graphics'; this.music = 'menu'; this.ambience = 'menu'; }
  async prepareStage() { await this.app.useStage('menu', () => new MenuStage(this.app.engine)); }

  render() {
    this.nav = h('div.col', { style: { gap: '4px' } });
    this.body = h('div');
    const el = h('section.screen.scroll-y', { style: { background: 'linear-gradient(90deg, rgba(8,9,11,.94), rgba(8,9,11,.7))' } },
      h('div', { style: { maxWidth: '1000px', width: '100%', margin: '0 auto' } },
        h('div', { style: { marginBottom: '22px' } }, h('div.eyebrow', 'Settings'), h('h2.h-section', 'Configure')),
        h('div.settings-grid', this.nav, this.body)));
    this.draw();
    return el;
  }

  row(label, desc, control) { return h('div.setting', h('div', h('div.lbl', label), desc && h('div.desc', desc)), h('div', control)); }
  slider(key, min, max, step, fmtFn = (v) => v) {
    const val = h('span.mono.small', { style: { minWidth: '48px', textAlign: 'right' } }, fmtFn(settings.get(key)));
    return h('div.row', h('input', { type: 'range', min, max, step, value: settings.get(key), oninput: (e) => { settings.set(key, Number(e.target.value)); val.textContent = fmtFn(Number(e.target.value)); }, dataset: { setting: key } }), val);
  }
  toggle(key) { const b = h('button.toggle', { class: settings.get(key) ? 'on' : '', onclick: () => { settings.set(key, !settings.get(key)); b.classList.toggle('on', settings.get(key)); }, dataset: { setting: key } }); return b; }
  seg(key, opts) { const s = h('div.seg', opts.map(([v, l]) => h('button', { class: settings.get(key) === v ? 'on' : '', onclick: () => { settings.set(key, v); this.draw(); }, dataset: { setting: `${key}:${v}` } }, l))); return s; }

  draw() {
    clear(this.nav).append(...TABS.map(([id, l]) => h('button.list-item', { class: this.tab === id ? 'active' : '', onclick: () => { this.tab = id; this.draw(); }, dataset: { tab: id } }, h('span.name', { style: { fontSize: '16px' } }, l), h('span'))));
    const b = clear(this.body);
    const pct = (v) => `${Math.round(v * 100)}%`;
    if (this.tab === 'graphics') {
      b.append(
        this.row('Quality preset', 'Resolution scale, shadow resolution, bloom, anti-aliasing and depth of field.', this.seg('quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]))),
        this.row('Field of view', 'Vertical field of view in degrees.', this.slider('fov', 60, 95, 1, (v) => `${v}°`)),
        this.row('Show FPS', 'Frame counter in the match HUD.', this.toggle('showFps')),
        this.row('Crosshair colour', null, this.seg('crosshair', [['white', 'White'], ['amber', 'Amber'], ['blue', 'Blue'], ['green', 'Green']])));
    } else if (this.tab === 'controls') {
      b.append(
        this.row('Mouse sensitivity', null, this.slider('sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))),
        this.row('Aim sensitivity', 'Multiplier while aiming down sights (scaled by zoom).', this.slider('adsSensitivity', 0.3, 1.5, 0.05, (v) => v.toFixed(2))),
        this.row('Invert vertical look', null, this.toggle('invertY')),
        h('div', { style: { marginTop: '22px' } }, h('div.cat-head', 'Key bindings'),
          h('div.keys', [['Move', 'W A S D'], ['Sprint', 'Shift'], ['Crouch', 'C / Ctrl'], ['Jump', 'Space'], ['Fire', 'Left mouse'], ['Aim down sights', 'Right mouse'], ['Reload', 'R'], ['Primary / Sidearm', '1 / 2 / Wheel'], ['Ability', 'Q / E'], ['Inspect weapon', 'T'], ['Menu / pause', 'Esc']].map(([a, k]) => h('div', h('span', a), h('span.kbd', k))))),
        h('p.small.muted', 'Touch devices get an on-screen stick, look-drag and action buttons automatically.'));
    } else if (this.tab === 'audio') {
      b.append(
        this.row('Master volume', null, this.slider('master', 0, 1, 0.05, pct)),
        this.row('Effects', 'Weapons, footsteps, impacts, abilities and UI.', this.slider('sfx', 0, 1, 0.05, pct)),
        this.row('Music', 'Adaptive score in menus and matches.', this.slider('music', 0, 1, 0.05, pct)),
        this.row('Ambience', 'Rain, wind, machinery and city beds.', this.slider('ambience', 0, 1, 0.05, pct)));
    } else if (this.tab === 'account') {
      const name = h('input.input', { value: profile.data.name, maxLength: 16, placeholder: 'OPERATOR', dataset: { setting: 'name' } });
      b.append(
        this.row('Callsign', 'Shown in lobbies, the kill feed and results.', h('div.row', name, h('button.btn.btn--sm', { onclick: () => { profile.setName(name.value.trim().toUpperCase()); if (net.connected) net.request('rename', { name: profile.data.name }).catch(() => {}); toast('Callsign saved'); } }, 'Save'))),
        this.row('Profile storage', profile.data.linked ? 'Linked to the online server. Credits and unlocks are held and validated server-side.' : 'Local profile stored in this browser. It links to the server automatically the first time you play online.',
          h('div.row', h('span.tag', { class: profile.data.linked ? 'ok' : '' }, profile.data.linked ? 'Online' : 'Local'), profile.data.linked && h('button.btn.btn--sm', { onclick: async () => { if (await confirm({ title: 'Unlink online profile?', body: 'This browser will go back to a local profile with your current balance and unlocks. The server copy is kept.', ok: 'Unlink' })) { profile.unlink(); this.draw(); } } }, 'Unlink'))),
        this.row('Server URL', 'Blank uses the same origin as this page (/ws).', h('input.input', { value: settings.get('serverUrl'), placeholder: net.url, onchange: (e) => settings.set('serverUrl', e.target.value.trim()) })),
        this.row('Reset progression', 'Wipes local credits, unlocks and stats. Cannot be undone.', h('button.btn.btn--sm', { onclick: async () => { if (await confirm({ eyebrow: 'Danger', title: 'Reset all progress?', body: 'Your local credits, unlocks, stats and challenge progress will be erased.', ok: 'Reset' })) { profile.reset(); toast('Progress reset'); this.draw(); } }, dataset: { act: 'reset' } }, 'Reset')),
        this.row('Restore defaults', 'Resets graphics, controls and audio settings.', h('button.btn.btn--sm', { onclick: () => { settings.reset(); this.draw(); toast('Settings restored'); } }, 'Restore')));
    } else {
      b.append(
        h('div.panel.panel-pad.col', { style: { gap: '14px' } },
          h('div.creator-mark', 'Made by ', h('span', 'Usairam Hassan')),
          h('p', 'FRONTLINE is a browser-based tactical 1v1 shooter prototype: procedural 3D operators, weapons and environments rendered with Three.js, synthesised audio, a tactical AI opponent, and a Node.js server-authoritative multiplayer service.'),
          h('div.row', { style: { flexWrap: 'wrap' } }, h('button.btn', { onclick: () => this.app.go('credits') }, 'View credits'), h('button.btn', { onclick: () => { location.hash = ''; location.reload(); } }, 'View the cinematic site'))));
    }
  }
}
