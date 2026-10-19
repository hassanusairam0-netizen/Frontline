import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Character } from '../models/character.js';
import { buildWeapon } from '../models/weapon.js';

// Renders real 3D thumbnails (operators, weapons, finishes, outfits) with a
// small offscreen renderer, queued one per frame and cached as data URLs.

let R = null, scene, cam, pivot;
const cache = new Map();
const queue = [];
let busy = false;

function init() {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 256;
  R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setSize(384, 256, false);
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping;
  R.toneMappingExposure = 1.15;
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(R);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xffd6a8, 2.6); key.position.set(2, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x5aa9e6, 3); rim.position.set(-3, 2, -3); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x8090a0, 0x101010, 0.6));
  cam = new THREE.PerspectiveCamera(30, 384 / 256, 0.05, 50);
  pivot = new THREE.Group(); scene.add(pivot);
}

function renderItem(spec) {
  if (!R) init();
  while (pivot.children.length) pivot.remove(pivot.children[0]);
  let disposeFn = null;
  if (spec.type === 'operator') {
    const c = new Character({ operator: spec.id, outfit: spec.outfit || 'standard', weapon: spec.weapon || 'vk7', shadows: false });
    c.update(0.016, { idle: 0, aim: 0.3 });
    c.update(0.016, { idle: 0, aim: 0.3 });
    pivot.add(c.root);
    pivot.rotation.y = -0.45;
    if (spec.bust) { cam.position.set(0, 1.45, 1.9); cam.lookAt(0, 1.32, 0); }
    else { cam.position.set(0, 1.08, 3.05); cam.lookAt(0, 1.0, 0); }
    disposeFn = () => c.dispose();
  } else {
    const w = buildWeapon(spec.id, spec.skin || 'factory');
    const box = new THREE.Box3().setFromObject(w.root);
    const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    w.root.position.sub(ctr);
    const holder = new THREE.Group(); holder.add(w.root); holder.rotation.y = -Math.PI / 2 + 0.25; holder.rotation.z = 0.06;
    pivot.rotation.y = 0;
    pivot.add(holder);
    const d = 0.35 + size.z * 1.25;
    cam.position.set(0.0, 0.08, d); cam.lookAt(0, 0, 0);
  }
  R.render(scene, cam);
  const url = R.domElement.toDataURL('image/png');
  disposeFn?.();
  return url;
}

function pump() {
  if (busy) return;
  busy = true;
  const step = () => {
    const job = queue.shift();
    if (!job) { busy = false; return; }
    try {
      const url = cache.get(job.key) || renderItem(job.spec);
      cache.set(job.key, url);
      job.cbs.forEach((cb) => cb(url));
    } catch (e) { console.warn('thumb failed', e); }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Request a thumbnail; returns an <img> that fills in when rendered. */
export function thumb(spec) {
  const key = JSON.stringify(spec);
  const img = document.createElement('img');
  img.alt = '';
  img.style.opacity = '0'; img.style.transition = 'opacity .5s';
  const done = (url) => { img.src = url; img.style.opacity = '1'; };
  if (cache.has(key)) { done(cache.get(key)); return img; }
  const existing = queue.find((j) => j.key === key);
  if (existing) existing.cbs.push(done); else queue.push({ key, spec, cbs: [done] });
  pump();
  return img;
}
