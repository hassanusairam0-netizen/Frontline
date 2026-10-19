// Browser test: store purchase flow (confirm → credits debit → ownership → persistence)
// and operator abilities in a live practice match (barrier blocks fire, recon reveals, stim heals).
// Requires `npm run dev`. Usage: node tests/abilities-store-e2e.mjs
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.URL || 'http://localhost:5173/';
const { chromium } = await import(PW);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
let ok = true; const check = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) ok = false; };
await page.addInitScript(() => { if (!localStorage.getItem('frontline.settings.v1')) localStorage.setItem('frontline.settings.v1', JSON.stringify({ quality: 'low' })); });
await page.goto(`${URL}#play/operators`);
await page.waitForSelector('[data-op="medic"]', { timeout: 90000 });
await page.evaluate(() => { const p = window.__frontline.profile; p.data.credits = 5000; p.persist(); });
// buy MEDIC through the real UI
await page.click('[data-op="medic"]');
await page.waitForSelector('[data-act="buy-op"]');
await page.click('[data-act="buy-op"]');
await page.waitForSelector('.modal .btn--primary');
await page.click('.modal .btn--primary');
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ c: window.__frontline.profile.credits, owned: window.__frontline.profile.owns('operator', 'medic'), eq: window.__frontline.profile.data.equipped.operator }));
check(after.c === 3800 && after.owned && after.eq === 'medic', `purchase MEDIC: credits 5000 → ${after.c}, owned=${after.owned}, equipped=${after.eq}`);
// insufficient funds is refused
await page.evaluate(() => { const p = window.__frontline.profile; p.data.credits = 100; p.persist(); });
const refused = await page.evaluate(async () => (await window.__frontline.profile.purchase('operator', 'bulwark')).reason);
check(/Need/.test(refused || ''), `purchase refused without credits: "${refused}"`);
// persistence across reload
await page.reload();
await page.waitForSelector('[data-op="medic"]', { timeout: 90000 });
check(await page.evaluate(() => window.__frontline.profile.owns('operator', 'medic')), 'ownership persists after reload');

async function match(op) {
  await page.evaluate((op) => { const p = window.__frontline.profile; if (!p.data.owned.operators.includes(op)) p.data.owned.operators.push(op); p.data.equipped.operator = op; p.persist(); window.__frontline.game = null; localStorage.setItem('frontline.practice.v1', JSON.stringify({ map: 'neon', difficulty: 'easy', roundsToWin: 3 })); }, op);
  await page.evaluate(() => window.__frontline.app.go('play', { practice: true }));
  await page.waitForSelector('[data-act="start-practice"]', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.click('[data-act="start-practice"]');
  await page.waitForFunction(() => window.__frontline.game?.phase === 'live', null, { timeout: 180000, polling: 400 });
  await page.evaluate(() => { const g = window.__frontline.game; g.bot.think = () => ({ mx: 0, mz: 0 }); const me = g.me, o = g.opp; o.x = me.x - Math.sin(me.yaw) * 10; o.z = me.z - Math.cos(me.yaw) * 10; });
}
// BULWARK barrier
await match('bulwark');
await page.keyboard.press('KeyQ'); await page.waitForTimeout(600);
const bar = await page.evaluate(async () => {
  const g = window.__frontline.game; const { raycastWorld, dirFromAngles } = await import('/src/shared/collision.js');
  const me = g.me; const hit = raycastWorld(g.world, [me.x, me.eyeY - 0.4, me.z], dirFromAngles(me.yaw, -0.05), 30);
  return { n: g.barriers.length, dyn: g.world.dynamic.length, kind: hit?.box?.kind, cd: me.ability.cd };
});
check(bar.n === 1 && bar.dyn === 1 && bar.kind === 'barrier', `Bulwark barrier deployed and blocks a forward trace (${JSON.stringify(bar)})`);
await page.keyboard.press('KeyQ'); await page.waitForTimeout(300);
check(await page.evaluate(() => window.__frontline.game.barriers.length) === 1, 'second Q during cooldown is ignored');
await page.evaluate(() => window.__frontline.game.quit());
await page.waitForTimeout(3000);
// PHANTOM recon
await match('phantom');
await page.keyboard.press('KeyQ'); await page.waitForTimeout(600);
const rec = await page.evaluate(() => ({ reveals: window.__frontline.game.reveals.length, revealed: window.__frontline.game.opp.revealed > 0 }));
check(rec.reveals === 1 && rec.revealed, `Phantom recon reveals the opponent (${JSON.stringify(rec)})`);
await page.evaluate(() => window.__frontline.game.quit());
await page.waitForTimeout(3000);
// MEDIC stim
await match('medic');
await page.evaluate(() => { window.__frontline.game.me.hp = 40; });
await page.keyboard.press('KeyQ');
await page.waitForFunction(() => { const me = window.__frontline.game.me; return me.ability.cd > 0 && me.healLeft <= 0; }, null, { timeout: 60000, polling: 300 });
const hp = await page.evaluate(() => window.__frontline.game.me.hp);
check(hp >= 79 && hp <= 100, `Medic stim heals 40 HP over 2 s (40 → ${Math.round(hp)})`);
check(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(ok ? 'ABILITIES/STORE E2E OK' : 'ABILITIES/STORE E2E FAILED');
process.exitCode = ok ? 0 : 1;
