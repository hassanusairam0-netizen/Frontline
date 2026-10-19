import './styles/main.css';
import './styles/hud.css';
import './styles/site.css';
import { Engine } from './engine/Engine.js';
import { setAnisotropy, setTextureSize } from './engine/textures.js';
import { settings } from './state/settings.js';
import { audio } from './engine/audio.js';
import { profile } from './state/profile.js';
import { App } from './ui/app.js';
import { installUiSounds, toast } from './ui/dom.js';
import { loadingOverlay } from './game/launch.js';
import { MenuScreen } from './ui/screens/menu.js';
import { PlayScreen } from './ui/screens/play.js';
import { OperatorsScreen } from './ui/screens/operators.js';
import { ArmoryScreen } from './ui/screens/armory.js';
import { MapsScreen } from './ui/screens/maps.js';
import { StoreScreen } from './ui/screens/store.js';
import { SettingsScreen } from './ui/screens/settings.js';
import { CreditsScreen } from './ui/screens/credits.js';
import { LobbyScreen } from './ui/screens/lobby.js';
import { ResultsScreen } from './ui/screens/results.js';
import { endActiveGame } from './game/launch.js';

// Boot: WebGL engine → cinematic site (scroll story) or, for #play deep links,
// straight into the game menu. Heavy game code (match, bots) is lazy-loaded.

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

async function boot() {
  if (!webglOk()) {
    document.body.innerHTML = '<div style="padding:40px;font-family:Inter,sans-serif;color:#ddd;background:#0a0b0d;min-height:100vh"><h1 style="font-family:Barlow Condensed;letter-spacing:.2em">FRONTLINE</h1><p>This game needs WebGL. Please enable hardware acceleration or use a current desktop browser.</p><p style="color:#888">Made by Usairam Hassan</p></div>';
    return;
  }
  const canvas = document.getElementById('gl');
  const engine = new Engine(canvas);
  window.__frontline = { engine, profile, settings };
  setAnisotropy(Math.min(8, engine.renderer.capabilities.getMaxAnisotropy()));
  setTextureSize(settings.get('quality') === 'low' ? 256 : 512);
  installUiSounds();
  const unlockAudio = () => audio.unlock();
  addEventListener('pointerdown', unlockAudio, { capture: true });
  addEventListener('keydown', unlockAudio, { capture: true });

  const screens = { menu: MenuScreen, play: PlayScreen, operators: OperatorsScreen, armory: ArmoryScreen, maps: MapsScreen, store: StoreScreen, settings: SettingsScreen, credits: CreditsScreen, lobby: LobbyScreen, results: ResultsScreen };
  const app = new App(engine, screens);
  window.__frontline.app = app;
  engine.onError = (e) => { toast(`Rendering error: ${e.message}`, 'err'); app.go('menu'); };

  // any screen that replaces the match stage ends the match cleanly
  const go = app.go.bind(app);
  app.go = (name, params) => { const fromResults = name !== 'results' && app.currentName === 'results'; return go(name, params).then(() => { if (fromResults) endActiveGame(); }); };

  const enterApp = async (menuStage, target = 'menu') => {
    document.body.classList.add('in-app');
    document.getElementById('app').classList.remove('hidden');
    if (menuStage) { app.stages.menu = menuStage; app.stageKey = 'menu'; engine.setStage(menuStage, false); }
    if (!profile.data.name) profile.setName(`OPERATOR-${Math.floor(Math.random() * 900 + 100)}`);
    const route = target === 'bots' ? ['play', { practice: true }] : target === 'quick' ? ['lobby', { mode: 'quick' }] : [target, {}];
    await app.go(...route);
    app.fadeIn();
  };

  const hash = location.hash.replace('#', '');
  if (hash.startsWith('play')) {
    const L = loadingOverlay('FRONTLINE', 'Deploying');
    L.progress(0.3);
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('site')?.remove();
    const sub = hash.split('/')[1];
    await enterApp(null, sub && screens[sub] && !['results', 'lobby'].includes(sub) ? sub : 'menu');
    L.progress(1); L.done();
  } else {
    const L = loadingOverlay('FRONTLINE', 'Made by Usairam Hassan');
    L.progress(0.25);
    await new Promise((r) => setTimeout(r, 50));
    const { startSite } = await import('./site/landing.js');
    L.progress(0.6);
    await new Promise((r) => setTimeout(r, 20));
    startSite(engine, (menuStage, target) => enterApp(menuStage, target));
    L.progress(1);
    setTimeout(() => L.done(), 250);
  }
}

boot();

// Practice mode must work offline once loaded: warm the lazily-split match code
// in the background so starting a bot match never needs the network.
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
idle(() => { import('./game/Game.js').catch(() => {}); import('./ui/screens/results.js').catch(() => {}); }, { timeout: 8000 });
