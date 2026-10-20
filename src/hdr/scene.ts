// The HDR globe: Earth, the live IR cloud shell, atmosphere, the eye track, and the two 3D views of the storm.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ATMOSPHERE, CLOUDS, CLOUD_TOPS, EARTH, SKY, volumeShader, windShader } from "./glsl";
import { dvorak, frameDate, subsolar, type Meta } from "../meta";

export type Mode = 0 | 1 | 2;
const PATCH_KM = 2048, R_KM = 6371, D2R = Math.PI / 180;

/** lat/lon to a point on the globe. Matches SphereGeometry's UV layout: u = (lon + 180) / 360. */
export function ll2v(lat: number, lon: number, r = 1) {
  const phi = (lon + 180) * D2R, c = Math.cos(lat * D2R);
  return new THREE.Vector3(-Math.cos(phi) * c * r, Math.sin(lat * D2R) * r, Math.sin(phi) * c * r);
}

export interface Globe {
  camera: THREE.PerspectiveCamera;
  eye: THREE.Vector3;
  setMode(m: Mode): void;
  setPalette(enhanced: boolean): void;
  setRealSun(on: boolean): void;
  setHeight(exag: number): void;
  setCutaway(on: boolean): void;
  /** Loop position in frames, or null for the latest full-quality frame. */
  setLoop(t: number | null): void;
  /** Called every frame after rendering, with the current mode. */
  onFrame(fn: (mode: Mode, dt: number) => void): void;
}

export function createGlobe(canvas: HTMLCanvasElement, meta: Meta, base: string, onProgress: (f: number) => void, onLoad: () => void): Globe {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FRAME = frameDate(meta);
  const sun = subsolar(FRAME);
  const SUN_REAL = ll2v(sun.lat, sun.lon).normalize();
  const RMW_KM = Math.max(15, (meta.eyeDiameterKm ?? 30) * 0.65);
  const LOOP_N = meta.loopFrames;

  let mode: Mode = 0, realSun = false;

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.7;
  controls.minDistance = 1.15; controls.maxDistance = 8; controls.enablePan = false;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 2.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- textures ----------
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, n, t) => onProgress(n / t);
  manager.onLoad = onLoad;
  const loader = new THREE.TextureLoader(manager);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (path: string, srgb: boolean) => {
    const t = loader.load(base + path);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };
  const T = {
    day: tex("textures/earth-blue-marble.jpg", true),
    night: tex("textures/earth-night.jpg", true),
    water: tex("textures/earth-water.png", false),
    topo: tex("textures/earth-topology.png", false),
    sky: tex("textures/night-sky.png", true),
    ir: tex("data/ir_global.jpg", false),
    live: tex("data/ir_live_mask.png", false),
    storm: tex("data/storm_ir.png", false),
  };
  T.storm.wrapS = T.storm.wrapT = THREE.ClampToEdgeWrapping;
  const LOOP = Array.from({ length: LOOP_N }, (_, i) => {
    const t = tex(`data/loop/f${String(i).padStart(2, "0")}.jpg`, false);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });

  // ---------- uniforms shared by every material ----------
  const eye = ll2v(meta.eye.lat, meta.eye.lon).normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), eye).normalize();
  const north = new THREE.Vector3().crossVectors(eye, east).normalize();
  const uni = {
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    palette: { value: 1 },
    time: { value: 0 },
    patchOn: { value: 0 },
    eye: { value: eye },
    east: { value: east },
    north: { value: north },
    patchAng: { value: PATCH_KM / R_KM },
    frameA: { value: LOOP[LOOP_N - 1] ?? T.storm },
    frameB: { value: T.storm },
    frameMix: { value: 1 },
    exag: { value: 14 },
    cutaway: { value: 0 },
  };

  // ---------- stars, Earth, clouds, atmosphere ----------
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(90, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { map: { value: T.sky } }, vertexShader: SKY.vertex, fragmentShader: SKY.fragment,
  })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.ShaderMaterial({
    uniforms: { ...uni, day: { value: T.day }, night: { value: T.night }, water: { value: T.water }, topo: { value: T.topo }, ir: { value: T.ir } },
    vertexShader: EARTH.vertex, fragmentShader: EARTH.fragment,
  })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.0045, 256, 128), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...uni, ir: { value: T.ir }, live: { value: T.live } },
    vertexShader: CLOUDS.vertex, fragmentShader: CLOUDS.fragment,
  })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 128, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { sunDir: uni.sunDir }, vertexShader: ATMOSPHERE.vertex, fragmentShader: ATMOSPHERE.fragment,
  })));

  // ---------- track: eye fixes as dots, cloud-mass fixes as rings ----------
  const amber = (k: number) => new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(k);
  const trackGroup = new THREE.Group();
  scene.add(trackGroup);
  {
    const TR = meta.track;
    // light smoothing of cloud-mass fixes only; eye fixes stay as observed
    const pts = TR.map((p, i) => {
      if (p[3]) return [p[1], p[2]];
      const a = TR[Math.max(i - 1, 0)], b = TR[Math.min(i + 1, TR.length - 1)];
      return [(a[1] + p[1] * 2 + b[1]) / 4, (a[2] + p[2] * 2 + b[2]) / 4];
    });
    const curve = new THREE.CatmullRomCurve3(pts.map(([la, lo]) => ll2v(la, lo, 1.012)));
    trackGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.0028, 10), new THREE.MeshBasicMaterial({ color: amber(3.2) })));
    const dotGeo = new THREE.SphereGeometry(0.0042, 16, 12), ringGeo = new THREE.TorusGeometry(0.0042, 0.0011, 8, 24);
    const glow = new THREE.MeshBasicMaterial({ color: amber(4) });
    for (const p of TR) {
      const m = new THREE.Mesh(p[3] ? dotGeo : ringGeo, glow);
      m.position.copy(ll2v(p[1], p[2], 1.012));
      m.lookAt(m.position.clone().multiplyScalar(2));
      trackGroup.add(m);
    }
  }
  const pulseMat = new THREE.MeshBasicMaterial({ color: amber(5), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.01, 0.0125, 64), pulseMat);
  pulse.position.copy(ll2v(meta.eye.lat, meta.eye.lon, 1.013));
  pulse.lookAt(pulse.position.clone().multiplyScalar(2));
  scene.add(pulse);

  // ---------- mode 1: 3D cloud tops ----------
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 640, 640), new THREE.ShaderMaterial({
    transparent: true, uniforms: uni, vertexShader: CLOUD_TOPS.vertex, fragmentShader: CLOUD_TOPS.fragment,
  }));
  patch.frustumCulled = false; patch.visible = false;
  scene.add(patch);

  // ---------- mode 2: volumetric storm + wind tracers, in a frame tangent at the eye ----------
  const stormFrame = new THREE.Group();
  stormFrame.matrix.makeBasis(east, north, eye).setPosition(eye.clone());
  stormFrame.matrixAutoUpdate = false;
  stormFrame.updateMatrixWorld(true);
  scene.add(stormFrame);
  const HALF = PATCH_KM / 2 / R_KM;
  const vol = volumeShader(RMW_KM);
  const volBox = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1.45).translate(0, 0, 0.275), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
    uniforms: uni, vertexShader: vol.vertex, fragmentShader: vol.fragment,
  }));
  volBox.visible = false; volBox.frustumCulled = false; volBox.renderOrder = 10;
  stormFrame.add(volBox);

  const N_P = 7000;
  const pGeo = new THREE.BufferGeometry();
  {
    const seed = new Float32Array(N_P * 4);
    for (let i = 0; i < N_P; i++) {
      const out = Math.random() < 0.18;
      seed[i * 4] = out ? 180 + Math.random() * 520 : 22 + Math.pow(Math.random(), 0.8) * 700; // radius km
      seed[i * 4 + 1] = Math.random() * Math.PI * 2; // angle
      seed[i * 4 + 2] = out ? 14 + Math.random() * 2 : 0.3 + Math.random() * 2.5; // height km
      seed[i * 4 + 3] = out ? 1 : 0;
    }
    pGeo.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
    pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N_P * 3), 3));
  }
  const wind = windShader(RMW_KM, dvorak(meta.eyeK, meta.ringK).kt);
  const particles = new THREE.Points(pGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: uni, vertexShader: wind.vertex, fragmentShader: wind.fragment,
  }));
  particles.visible = false; particles.frustumCulled = false; particles.renderOrder = 9;
  stormFrame.add(particles);

  const setBox = () => {
    volBox.scale.set(HALF, HALF, (18 * uni.exag.value) / R_KM);
    volBox.updateMatrixWorld(true);
  };
  setBox();

  // ---------- camera moves ----------
    let fly: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; start: number; ms: number } | null = null;
  const flyTo = (pos: THREE.Vector3, target: THREE.Vector3, ms = 1800) => {
    fly = { p0: camera.position.clone(), p1: pos, t0: controls.target.clone(), t1: target, start: performance.now(), ms: reduceMotion ? 1 : ms };
  };
  const viewFor = (m: Mode) => {
    if (m === 0) {
      // keep the whole disc in view on narrow portrait screens
      const h = Math.atan(Math.tan(16 * D2R) * Math.min(innerWidth / innerHeight, 1));
      return { pos: ll2v(meta.eye.lat + 4, meta.eye.lon + 4, Math.min(7.5, Math.max(4.3, 0.9 / Math.sin(h)))), target: new THREE.Vector3() };
    }
    const back = eye.clone().multiplyScalar(0.62).addScaledVector(north, -0.34).addScaledVector(east, 0.1);
    return { pos: eye.clone().add(back), target: eye.clone() };
  };

  // the volume ray-march is the costly pass, so the 3D storm renders at a lower pixel ratio on high-density screens
  const pixelRatio = (m: Mode) => Math.min(devicePixelRatio, m === 2 ? 1.25 : 2);
  function resize() {
    renderer.setPixelRatio(pixelRatio(mode)); composer.setPixelRatio(pixelRatio(mode));
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();
  const v0 = viewFor(0);
  camera.position.copy(ll2v(meta.eye.lat - 5, meta.eye.lon + 22, 5.2));
  flyTo(v0.pos, v0.target, 2600);

  const listeners: ((m: Mode, dt: number) => void)[] = [];
  const timer = new THREE.Timer();
  const right = new THREE.Vector3(), upv = new THREE.Vector3(), fwd = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    uni.time.value += reduceMotion ? 0 : dt;
    if (fly) {
      const k = Math.min((performance.now() - fly.start) / fly.ms, 1), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const dist = fly.p0.length() * (1 - e) + fly.p1.length() * e;
      camera.position.copy(fly.p0).lerp(fly.p1, e);
      if (mode === 0) camera.position.setLength(dist);
      controls.target.copy(fly.t0).lerp(fly.t1, e);
      if (k >= 1) fly = null;
    }
    controls.update();
    // studio light: a key light from upper left, slightly behind the viewer; real sun: the subsolar point at frame time
    if (!realSun) {
      camera.matrixWorld.extractBasis(right, upv, fwd);
      uni.sunDir.value.copy(right).multiplyScalar(-0.55).addScaledVector(upv, 0.45).addScaledVector(fwd, 0.55).normalize();
      if (mode > 0) uni.sunDir.value.lerp(eye.clone().addScaledVector(right, -0.7).addScaledVector(upv, 0.4).normalize(), 0.6).normalize();
    } else uni.sunDir.value.copy(SUN_REAL);
    const s = 1 + 0.35 * Math.sin(uni.time.value * 2.4);
    pulse.scale.setScalar(s); pulseMat.opacity = 0.9 - (s - 1) * 1.6;
    for (const fn of listeners) fn(mode, dt);
    composer.render();
  }
  requestAnimationFrame(frame);

  return {
    camera,
    eye,
    setMode(m) {
      mode = m;
      resize();
      uni.patchOn.value = m > 0 ? 1 : 0;
      patch.visible = m === 1; volBox.visible = m === 2; particles.visible = m === 2;
      trackGroup.visible = m === 0; pulse.visible = m === 0;
      controls.minDistance = m === 0 ? 1.15 : 0.05;
      const v = viewFor(m);
      flyTo(v.pos, v.target);
    },
    setPalette(on) { uni.palette.value = on ? 1 : 0; },
    setRealSun(on) { realSun = on; },
    setHeight(exag) { uni.exag.value = exag; setBox(); },
    setCutaway(on) { uni.cutaway.value = on ? 1 : 0; },
    setLoop(t) {
      if (t === null || LOOP_N < 2) { uni.frameA.value = LOOP[LOOP_N - 1] ?? T.storm; uni.frameB.value = T.storm; uni.frameMix.value = 1; return; }
      const i = Math.floor(t);
      uni.frameA.value = LOOP[i]; uni.frameB.value = LOOP[(i + 1) % LOOP_N]; uni.frameMix.value = t - i;
    },
    onFrame(fn) { listeners.push(fn); },
  };
}
