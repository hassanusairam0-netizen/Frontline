import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { settings } from '../state/settings.js';

// Final grade: vignette, film grain, a whisper of chromatic fringing and a
// split-tone (warm highlights / cool shadows) that ties every scene to the palette.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.04 },
    uAberration: { value: 0.0012 },
    uWarm: { value: new THREE.Color(1.03, 1.0, 0.95) },
    uCool: { value: new THREE.Color(0.95, 0.99, 1.05) },
    uDamage: { value: 0 },
    uFade: { value: 0 },
    uSat: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uAberration, uDamage, uFade, uSat;
    uniform vec3 uWarm, uCool; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = length(c);
      vec2 off = c * uAberration * (1.0 + d * 2.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, uSat);
      col *= mix(uCool, uWarm, smoothstep(0.15, 0.75, l));
      float vig = smoothstep(0.85, 0.2, d * (1.0 + uVignette));
      col *= mix(1.0 - uVignette, 1.0, vig);
      col = mix(col, col * vec3(1.0, 0.55, 0.4) + vec3(0.06,0.0,0.0), uDamage * smoothstep(0.25, 0.75, d));
      col += (hash(vUv * vec2(1920.0,1080.0) + fract(uTime) * 100.0) - 0.5) * uGrain;
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false; // totals per frame across all composer passes
    this.pmrem = new THREE.PMREMGenerator(r);
    this.clock = new THREE.Clock();
    this.stage = null;
    this.time = 0;
    this.fps = 60;
    this.frameHooks = new Set();
    this._dummyScene = new THREE.Scene();
    this._dummyCam = new THREE.PerspectiveCamera();
    this.buildComposer();
    this.resize();
    addEventListener('resize', () => this.resize());
    settings.on('change:quality', () => { this.buildComposer(); this.resize(); this.applyStagePost(); this.stage?.onQuality?.(); });
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  get quality() { return settings.quality(); }

  buildComposer() {
    const q = this.quality;
    this.composer?.dispose?.();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this._dummyScene, this._dummyCam);
    this.composer.addPass(this.renderPass);
    this.vmPass = new RenderPass(this._dummyScene, this._dummyCam);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.vmPass.enabled = false;
    this.composer.addPass(this.vmPass);
    this.bokeh = new BokehPass(this._dummyScene, this._dummyCam, { focus: 8, aperture: 0.0016, maxblur: 0.006 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.55, 0.82);
    this.bloom.enabled = q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.renderer.shadowMap.enabled = !!q.shadows;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    if (this.stage?.camera) { this.stage.camera.aspect = w / h; this.stage.camera.updateProjectionMatrix(); }
    if (this.stage?.viewmodel) { this.stage.viewmodel.camera.aspect = w / h; this.stage.viewmodel.camera.updateProjectionMatrix(); }
    this.stage?.onResize?.(w, h);
  }

  applyStagePost() {
    const s = this.stage; if (!s) return;
    const p = s.post || {};
    const q = this.quality;
    this.renderPass.scene = s.scene; this.renderPass.camera = s.camera;
    this.vmPass.enabled = !!s.viewmodel;
    if (s.viewmodel) { this.vmPass.scene = s.viewmodel.scene; this.vmPass.camera = s.viewmodel.camera; }
    this.bokeh.enabled = !!(p.dof && q.dof);
    this.bokeh.scene = s.scene; this.bokeh.camera = s.camera;
    if (p.dof) {
      this.bokeh.uniforms.focus.value = p.dof.focus;
      this.bokeh.uniforms.aperture.value = p.dof.aperture;
      this.bokeh.uniforms.maxblur.value = p.dof.maxblur ?? 0.006;
    }
    this.bloom.enabled = q.bloom && p.bloom !== 0;
    this.bloom.strength = p.bloom ?? 0.45;
    this.bloom.threshold = p.bloomThreshold ?? 0.82;
    this.bloom.radius = p.bloomRadius ?? 0.55;
    const u = this.grade.uniforms;
    u.uVignette.value = p.vignette ?? 0.35;
    u.uGrain.value = p.grain ?? 0.035;
    u.uSat.value = p.saturation ?? 1;
    this.renderer.toneMappingExposure = p.exposure ?? 1;
  }

  setStage(stage, disposeOld = true) {
    const old = this.stage;
    this.stage = stage;
    if (stage?.camera) { stage.camera.aspect = innerWidth / innerHeight; stage.camera.updateProjectionMatrix(); }
    if (stage?.viewmodel) { stage.viewmodel.camera.aspect = innerWidth / innerHeight; stage.viewmodel.camera.updateProjectionMatrix(); }
    this.applyStagePost();
    if (disposeOld && old && old !== stage) old.dispose?.();
  }

  /** Environment map from a scene (used for reflections that match the actual set). */
  envFromScene(scene, sigma = 0.04) {
    return this.pmrem.fromScene(scene, sigma).texture;
  }

  setDamage(v) { this.grade.uniforms.uDamage.value = v; }

  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    if (document.hidden) return;
    const s = this.stage;
    if (!s) { this.renderer.clear(); return; }
    try {
      this.renderer.info.reset();
      s.update?.(dt, this.time);
      this.frameHooks.forEach((fn) => fn(dt, this.time));
      if (s.post?.dof && this.bokeh.enabled && s.post.dof.dynamic) this.bokeh.uniforms.focus.value = s.post.dof.focus;
      this.grade.uniforms.uTime.value = this.time;
      if (s.render) s.render(this); else this.composer.render(dt);
    } catch (e) {
      console.error('frame error', e);
      this.stage = null;
      this.onError?.(e);
    }
  }
}
