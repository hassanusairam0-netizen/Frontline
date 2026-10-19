import { h, confirm } from './dom.js';
import { settings } from '../state/settings.js';

// In-match menu. Practice matches pause; online matches keep running.

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.open = false;
    const slider = (key, min, max, step, label) => {
      const val = h('span.mono.small', String(settings.get(key)));
      const input = h('input', { type: 'range', min, max, step, value: settings.get(key), oninput: (e) => { settings.set(key, Number(e.target.value)); val.textContent = e.target.value; } });
      return h('div.field', h('label', h('span', label), ' ', val), input);
    };
    this.el = h('div.pause',
      h('div.pause-inner.panel.panel-pad',
        h('div.eyebrow', game.online ? 'Online match · still running' : 'Practice · paused'),
        h('h3.h-section', { style: { margin: '6px 0 14px' } }, 'Paused'),
        h('button.btn.btn--primary.btn--block', { onclick: () => game.resume(), dataset: { act: 'resume' } }, 'Resume'),
        h('div.divider'),
        slider('sensitivity', 0.2, 3, 0.05, 'Mouse sensitivity'),
        slider('fov', 60, 95, 1, 'Field of view'),
        slider('master', 0, 1, 0.05, 'Master volume'),
        h('div.divider'),
        h('button.btn.btn--block', {
          onclick: async () => {
            const ok = await confirm({ eyebrow: game.online ? 'Forfeit' : 'Leave practice', title: game.online ? 'Forfeit the match?' : 'Quit to menu?', body: game.online ? 'Leaving counts as a loss and your opponent is awarded the win.' : 'Progress from this match will not be recorded.', ok: 'Quit match' });
            if (ok) game.quit();
          },
          dataset: { act: 'quit' },
        }, game.online ? 'Forfeit & leave' : 'Quit to menu')));
  }
  show() {
    if (this.open || this.game.finished) return;
    this.open = true;
    document.body.appendChild(this.el);
    this.game.setPaused(true);
    this.game.hud.showClickToPlay(false);
  }
  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.remove();
    this.game.setPaused(false);
  }
  dispose() { this.el.remove(); }
}
