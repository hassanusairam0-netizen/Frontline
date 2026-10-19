// Two real browser clients play an online match through the Node server:
// quick-match pairing, lobby, map vote, ready-up, countdown, server-authoritative
// hits, round resolution and disconnect/forfeit handling.
// Requires: `FRONTLINE_TEST_SPAWNS=1 npm run server`, `npm run dev`, Playwright + Chromium.
// Usage: node tests/online-e2e.mjs   (env PW = path to playwright index.mjs, CHROME = executable)
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.URL || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS || null;
const { chromium } = await import(PW);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`[${name}] ${e.message}`));
  await page.addInitScript((name) => { localStorage.setItem('frontline.settings.v1', JSON.stringify({ quality: 'low' })); localStorage.setItem('frontline.profile.v1', JSON.stringify({ name })); }, name);
  await page.goto(`${URL}#play`);
  return page;
};
const A = await mk('ALPHA'), B = await mk('BRAVO');
await A.waitForSelector('[data-act="quick"]', { timeout: 90000 }); await B.waitForSelector('[data-act="quick"]', { timeout: 90000 });
await A.waitForTimeout(1500);
await A.click('[data-act="quick"]');
await A.waitForTimeout(2500);
console.log('A after queue:', (await A.textContent('.screen h2'))?.trim());
await B.click('[data-act="quick"]');
await A.waitForSelector('[data-act="ready"]', { timeout: 30000 }); await B.waitForSelector('[data-act="ready"]', { timeout: 30000 });
await A.waitForTimeout(1200);
const lobbyText = await A.evaluate(() => [...document.querySelectorAll('.lobby-player')].map((e) => e.innerText.split('\n').slice(0, 2).join(' ')).join(' | '));
console.log('lobby:', lobbyText);
if (!/BRAVO/.test(lobbyText)) fail('opponent not shown in lobby');
await A.click('[data-map="neon"]'); await B.click('[data-map="neon"]');
await A.waitForTimeout(600);
await A.click('[data-act="ready"]'); await B.click('[data-act="ready"]');
await A.waitForTimeout(2200);
console.log('countdown:', await A.evaluate(() => document.querySelector('.countdown-big')?.textContent));
if (SHOTS) await A.screenshot({ path: `${SHOTS}/lobby_A.png` });
const live = (p) => p.waitForFunction(() => window.__frontline.game?.phase === 'live', null, { timeout: 240000, polling: 500 });
await Promise.all([live(A), live(B)]);
console.log('both clients live');
const state = (p) => p.evaluate(() => { const g = window.__frontline.game; return { me: [+g.me.x.toFixed(1), +g.me.z.toFixed(1), g.me.hp, g.me.alive], opp: [+g.opp.x.toFixed(1), +g.opp.z.toFixed(1), g.opp.alive], score: g.score, phase: g.phase }; });
console.log('A', JSON.stringify(await state(A)), '| B', JSON.stringify(await state(B)));
await A.evaluate(() => { window.__frontline.game.input.locked = true; });
await A.mouse.move(240, 135);
await A.mouse.down();
for (let i = 0; i < 60; i++) {
  await A.waitForTimeout(250);
  const done = await A.evaluate(() => { const g = window.__frontline.game; const me = g.me, o = g.opp; const dx = o.x - me.x, dz = o.z - me.z; me.yaw = Math.atan2(-dx, -dz); me.pitch = Math.atan2(o.y + 1.15 - me.eyeY, Math.hypot(dx, dz)); g.recoilDebt = 0; return !o.alive || g.phase !== 'live'; });
  if (done) break;
}
await A.mouse.up();
await A.waitForTimeout(2000);
const sa = await state(A), sb = await state(B);
console.log('after firing  A', JSON.stringify(sa), '| B', JSON.stringify(sb));
if (sa.score.me < 1) fail('server did not award the round to the shooter');
if (sb.score.opp < 1) fail('victim client did not receive the round result');
if (SHOTS) { await A.screenshot({ path: `${SHOTS}/online_A.png` }); await B.screenshot({ path: `${SHOTS}/online_B.png` }); }
console.log('closing client B to test disconnect handling (15 s grace)…');
await B.context().close();
await A.waitForSelector('.results', { timeout: 60000 });
await A.waitForTimeout(3000);
const title = await A.textContent('.result-title');
console.log('A results:', title, (await A.textContent('.result-score')).trim(), 'credits', await A.evaluate(() => window.__frontline.profile.credits), 'linked', await A.evaluate(() => window.__frontline.profile.data.linked));
if (!/Victory/i.test(title)) fail('remaining player was not awarded the forfeit win');
if (SHOTS) await A.screenshot({ path: `${SHOTS}/online_results.png` });
const errs = [...A.errors, ...B.errors];
if (errs.length) console.log(errs.slice(0, 10).join('\n'));
await browser.close();
console.log(process.exitCode ? 'ONLINE E2E FAILED' : 'ONLINE E2E OK');
