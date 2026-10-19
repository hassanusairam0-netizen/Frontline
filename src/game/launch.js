import { h } from '../ui/dom.js';
import { MAPS } from '../shared/maps/index.js';
import { audio } from '../engine/audio.js';

// Match launcher: loading screen, lazy-loads the game module, swaps stages,
// and routes the end-of-match result to the results screen.

const TIPS = [
  'Headshots multiply damage. Precision rifles reward patience; SMGs reward aggression.',
  'Bots hear gunfire. Firing reveals your position for a few seconds.',
  'Crouching tightens your spread and shrinks your silhouette behind low cover.',
  'Sprinting lowers your weapon — you cannot fire until it settles.',
  'Abilities recharge between rounds only partially. Use them, but use them well.',
  'Bulwark barriers block bullets from both sides. Flank them.',
  'Phantom\'s pulse reveals through walls but warns the target with a sonar ping.',
];

export function loadingOverlay(title, sub) {
  const bar = h('i', { style: { width: '0%' } });
  const tip = h('div.tip', TIPS[Math.floor(Math.random() * TIPS.length)]);
  const el = h('div.loading',
    h('div.loading-inner',
      h('div.eyebrow', sub),
      h('div.h-display', title),
      h('div.bar', bar),
      tip));
  document.body.appendChild(el);
  return {
    el,
    progress(p) { bar.style.width = `${Math.round(p * 100)}%`; },
    done() { el.classList.add('out'); setTimeout(() => el.remove(), 700); },
  };
}

let activeGame = null;
export const getActiveGame = () => activeGame;

export async function launchMatch(app, config) {
  audio.unlock();
  const meta = MAPS[config.map] || MAPS.neon;
  const L = loadingOverlay(meta.name, config.mode === 'online' ? 'Online match · Deploying' : `Practice · ${config.difficulty.toUpperCase()} bot`);
  L.progress(0.05);
  await new Promise((r) => setTimeout(r, 60));
  if (app.current) { app.current.unmount?.(); app.current.el?.remove(); app.current = null; }
  app.showTopbar(false);
  if (activeGame) { activeGame.dispose(); activeGame = null; }
  app.releaseMenuStage();
  audio.setMusic(null);
  const { Game } = await import('./Game.js');
  L.progress(0.2);
  const game = new Game(app.engine, config, {
    onEnd: async (result) => {
      const { ResultsScreen } = await import('../ui/screens/results.js');
      app.screens.results = ResultsScreen;
      app.go('results', { result, config, game });
    },
    onQuit: () => { app.go('menu'); },
  });
  try {
    await game.load((p) => L.progress(0.2 + p * 0.75));
  } catch (e) {
    console.error(e);
    L.done();
    app.go('menu');
    return null;
  }
  activeGame = game;
  if (window.__frontline) window.__frontline.game = game;
  // Stage swap: dispose previous non-menu stage
  const old = app.engine.stage;
  app.engine.setStage(game, false);
  if (old && old !== game && old !== app.stages.menu) old.dispose?.();
  app.stageKey = 'game';
  app.currentName = 'game';
  L.progress(1);
  setTimeout(() => L.done(), 200);
  game.start();
  return game;
}

/** Called by screens that replace the game stage, so the game is cleaned up. */
export function endActiveGame() {
  if (activeGame) { activeGame.dispose(); activeGame = null; }
}
