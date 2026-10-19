import { h } from '../dom.js';
import { MenuStage } from '../../stages/MenuStage.js';

export class CreditsScreen {
  constructor(app) { this.app = app; this.music = 'menu'; }
  async prepareStage() { await this.app.useStage('menu', () => new MenuStage(this.app.engine)); }
  render() {
    const sec = (role, who) => [h('div.role', role), h('div.who', who)];
    return h('section.screen.scroll-y', { style: { background: 'radial-gradient(ellipse at center, rgba(8,9,11,.75), rgba(8,9,11,.95))', justifyContent: 'center' } },
      h('div.credits-roll.reveal',
        h('div.eyebrow', 'Credits'),
        h('div.h-display', 'FRONTLINE'),
        h('div.menu-sub', { style: { marginTop: '14px' } }, 'One arena. Two fighters. No second chances.'),
        h('div', { style: { margin: '46px 0 10px' } }, h('div.creator-mark', 'Made by ', h('span', 'Usairam Hassan'))),
        ...sec('Concept, design & direction', 'Usairam Hassan'),
        ...sec('Game design & development', 'Usairam Hassan'),
        ...sec('Rendering', 'Three.js · procedural PBR materials · custom post-processing'),
        ...sec('Audio', 'Real-time synthesised weapons, foley, ambience and score (Web Audio)'),
        ...sec('Networking', 'Node.js · WebSocket · server-authoritative simulation'),
        ...sec('Motion', 'GSAP ScrollTrigger'),
        ...sec('Typography', 'Barlow Condensed · Inter · JetBrains Mono'),
        h('p.small.muted', { style: { marginTop: '40px' } }, 'All operators, weapons, places and events are fictional.'),
        h('button.btn', { style: { marginTop: '18px' }, onclick: () => this.app.go('menu') }, 'Back to menu')));
  }
}
