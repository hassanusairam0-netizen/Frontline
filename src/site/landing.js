import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LandingStage } from './LandingStage.js';
import { WEAPON_LIST, displayStats } from '../shared/weapons.js';
import { OPERATOR_LIST } from '../shared/operators.js';
import { MAP_LIST, getLayout } from '../shared/maps/index.js';
import { drawMapPlan } from '../stages/MapStage.js';
import { audio } from '../engine/audio.js';

gsap.registerPlugin(ScrollTrigger);
// Keep animations time-based even if a frame stalls (e.g. while a set is building).
gsap.ticker.lagSmoothing(0);

// Scroll storytelling: sticky (pinned) sections whose scroll progress drives the
// 3D sets, word-split headline reveals, and live showcase panels. Works with
// plain scrolling and anchor links; reduced-motion users get instant reveals.

export function startSite(engine, onEnter) {
  const stage = new LandingStage(engine);
  engine.setStage(stage, false);
  const S = stage.state;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => document.querySelector(s);

  // headline word split
  document.querySelectorAll('[data-split]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map((w) => `<span class="w"><span>${w}</span></span>`).join(' ');
  });
  if (!reduce) {
    document.querySelectorAll('.sec:not(#intro)').forEach((sec) => {
      const words = sec.querySelectorAll('[data-split] .w > span');
      const reveals = sec.querySelectorAll('[data-reveal]');
      const tl = gsap.timeline({ scrollTrigger: { trigger: sec, start: 'top 70%', toggleActions: 'play none none reverse' } });
      if (words.length) tl.from(words, { yPercent: 110, duration: 0.9, ease: 'power4.out', stagger: 0.06 }, 0);
      if (reveals.length) tl.from(reveals, { y: 24, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08 }, 0.15);
    });
    // hero plays once the loading veil lifts
    const hero = gsap.timeline({ paused: true });
    hero.from('#intro .site-title .w > span', { yPercent: 110, duration: 1.4, ease: 'power4.out', stagger: 0.08 })
      .from('#intro [data-reveal]', { y: 24, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.1 }, 0.35);
    setTimeout(() => hero.play(), 450);
  }

  // section progress → stage state
  const bind = (id, key, scale, section) => ScrollTrigger.create({
    trigger: id, start: 'top top', end: 'bottom bottom',
    onUpdate: (st) => { S[key] = st.progress * scale; },
    onToggle: (st) => { if (st.isActive) setSection(section); },
  });
  const setSection = (name) => {
    S.section = name;
    stage.prewarm(name);
    document.querySelectorAll('.site-links a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${name === 'play' ? 'play-section' : name}`));
  };
  ScrollTrigger.create({ trigger: '#intro', start: 'top top', end: 'bottom top', onUpdate: (st) => { S.neon = st.progress * 0.15; }, onToggle: (st) => st.isActive && setSection('intro') });
  ScrollTrigger.create({ trigger: '#arena', start: 'top bottom', end: 'bottom bottom', onUpdate: (st) => { S.neon = 0.15 + st.progress * 0.85; }, onToggle: (st) => st.isActive && setSection('arena') });
  bind('#armory', 'weapon', WEAPON_LIST.length - 0.001, 'armory');
  bind('#operators', 'op', OPERATOR_LIST.length - 0.001, 'operators');
  bind('#maps', 'map', MAP_LIST.length - 0.001, 'maps');
  ScrollTrigger.create({ trigger: '#play-section', start: 'top bottom', end: 'bottom bottom', onUpdate: (st) => { S.finale = st.progress; }, onToggle: (st) => st.isActive && setSection('play') });
  ScrollTrigger.create({ trigger: '#credits-section', start: 'top 60%', onToggle: (st) => { if (st.isActive) { S.finale = 1; setSection('credits'); } } });
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (st) => { $('.site-progress i').style.height = `${st.progress * 100}%`; } });

  // live showcase panels
  let lw = -1, lo = -1, lm = -1;
  const tick = () => {
    if (!document.body.contains($('#site'))) return;
    const wi = Math.min(WEAPON_LIST.length - 1, Math.floor(S.weapon));
    if (wi !== lw) {
      lw = wi; const w = WEAPON_LIST[wi], st = displayStats(w);
      $('#w-cat').textContent = w.category; $('#w-idx').textContent = `${String(wi + 1).padStart(2, '0')} / ${String(WEAPON_LIST.length).padStart(2, '0')}`;
      $('#w-name').textContent = w.name; $('#w-blurb').textContent = w.blurb;
      $('#w-stats').innerHTML = [['Damage', st.damage], ['Fire rate', st.fireRate], ['Accuracy', st.accuracy], ['Range', st.range], ['Mobility', st.mobility]].map(([k, v]) => `<div class="stat"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div><span class="v">${v}</span></div>`).join('');
      gsap.fromTo('#w-name', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });
    }
    const oi = Math.min(OPERATOR_LIST.length - 1, Math.floor(S.op));
    if (oi !== lo) {
      lo = oi; const o = OPERATOR_LIST[oi];
      $('#o-role').textContent = `${o.role}${o.price ? '' : ' · FREE'}`; $('#o-idx').textContent = `${String(oi + 1).padStart(2, '0')} / ${String(OPERATOR_LIST.length).padStart(2, '0')}`;
      $('#o-name').textContent = o.name; $('#o-bio').textContent = o.bio; $('#o-ab').textContent = `${o.ability.name} · ${o.ability.cooldown}s cooldown`; $('#o-abd').textContent = o.ability.desc;
      gsap.fromTo('#o-name', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });
    }
    const mi = Math.min(MAP_LIST.length - 1, Math.floor(S.map));
    if (mi !== lm) {
      lm = mi; const m = MAP_LIST[mi];
      $('#m-idx').textContent = `MAP ${m.index}`; $('#m-time').textContent = m.time; $('#m-name').textContent = m.name; $('#m-tag').textContent = m.tagline; $('#m-desc').textContent = m.desc;
      const plan = drawMapPlan(getLayout(m.id), 480, 200); const holder = $('#m-plan'); holder.innerHTML = ''; holder.appendChild(plan);
      gsap.fromTo('#m-name', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 });
    }
    requestAnimationFrame(tick);
  };
  tick();

  // first interaction unlocks audio for the site ambience
  const unlock = () => { audio.unlock(); audio.setAmbience('menu'); audio.setMusic('menu'); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);

  document.querySelectorAll('[data-enter]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); enter(b.dataset.enter); }));

  let entering = false;
  function enter(target) {
    if (entering) return;
    entering = true;
    audio.unlock();
    audio.whoosh();
    document.body.classList.add('site-entering');
    // pull back to the Neon set for the hand-off, then dissolve the site
    S.section = 'play'; S.finale = 1;
    const doHandoff = () => {
      gsap.to('#site', { opacity: 0, duration: 0.7, ease: 'power2.inOut', onComplete: () => {
        ScrollTrigger.getAll().forEach((t) => t.kill());
        const menu = stage.handoff();
        document.getElementById('site').remove();
        window.scrollTo(0, 0);
        onEnter(menu, target);
      } });
    };
    if (stage.active !== stage.menu) setTimeout(doHandoff, 700); else doHandoff();
  }
  return { stage, enter };
}
