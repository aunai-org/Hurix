// The HDR globe: Earth, the live IR cloud shell, atmosphere, every storm's track, and the two 3D views of the selected storm.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { ATMOSPHERE, CLOUDS, CLOUD_TOPS, EARTH, IMAGERY, SKY, VOLUME, VOLUME_BLEND } from "./glsl";
import { dvorak, frameDate, isoMs, subsolar, type Meta, type Storm } from "../meta";

export type Mode = 0 | 1 | 2;
/** 0 = Visible, 1 = Infra, 2 = Blue. */
export type Style = 0 | 1 | 2;
const PATCH_KM = 2048, R_KM = 6371, D2R = Math.PI / 180;

/** lat/lon to a point on the globe. Matches SphereGeometry's UV layout: u = (lon + 180) / 360. */
export function ll2v(lat: number, lon: number, r = 1) {
  const phi = (lon + 180) * D2R, c = Math.cos(lat * D2R);
  return new THREE.Vector3(-Math.cos(phi) * c * r, Math.sin(lat * D2R) * r, Math.sin(phi) * c * r);
}

export interface Globe {
  camera: THREE.PerspectiveCamera;
  /** The selected storm's eye, as a unit vector. */
  eye: THREE.Vector3;
  selectStorm(i: number): void;
  /** Turns the whole globe to a place (a storm listed without imagery). */
  lookAt(lat: number, lon: number): void;
  setMode(m: Mode): void;
  setStyle(s: Style): void;
  setRealSun(on: boolean): void;
  setHeight(exag: number): void;
  setTrack(on: boolean): void;
  /** Loads the loop frames at these indices (and the true-colour frames in their time span) before they play. */
  prepareLoop(frames: number[]): Promise<void>;
  /** Loop position along the prepared frames (fractional), or null for the latest full-quality frame. */
  setLoop(t: number | null): void;
  /** Called every frame after rendering, with the current mode. */
  onFrame(fn: (mode: Mode, dt: number) => void): void;
}

export function createGlobe(canvas: HTMLCanvasElement, meta: Meta, base: string, onProgress: (f: number) => void, onLoad: () => void): Globe {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FRAME = frameDate(meta);
  const sun = subsolar(FRAME);
  const SUN_REAL = ll2v(sun.lat, sun.lon).normalize();
  const storms = meta.storms;
  let cur = 0;

  let mode: Mode = 0, realSun = false, style: Style = 0, playing = false;

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.005, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.7;
  controls.minDistance = 1.15; controls.maxDistance = 8; controls.enablePan = false;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // the 3D storm is ray-marched into its own buffer, then lightly filtered (a 3x3 tent) and laid over the scene: the
  // per-pixel dither that hides the march's banding averages out instead of showing as grain, and detail stays sharp
  const volScene = new THREE.Scene();
  const volRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const volBlend = new ShaderPass(VOLUME_BLEND);
  volBlend.uniforms.tVol.value = volRT.texture;
  volBlend.enabled = false;
  composer.addPass(volBlend);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.5, 3.2);
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
  };
  // each storm's close-up, loaded the first time it is selected; its loop frames load when a loop is first played
  type StormTex = { still: THREE.Texture; vis: THREE.Texture | null; loop: Promise<THREE.Texture>[]; visLoop: Promise<THREE.Texture>[] };
  const stormTex = new Map<string, StormTex>();
  const clamp = <X extends THREE.Texture>(x: X) => { x.wrapS = x.wrapT = THREE.ClampToEdgeWrapping; return x; };
  const texFor = (s: Storm) => {
    let t = stormTex.get(s.id);
    if (!t) {
      t = {
        still: clamp(tex(`${s.dir}storm_ir.png`, false)),
        vis: s.visible ? clamp(tex(`${s.dir}storm_vis.jpg`, true)) : null,
        loop: [], visLoop: [],
      };
      stormTex.set(s.id, t);
    }
    return t;
  };
  // infrared frames are greyscale: keep one channel on the GPU (a quarter of the memory), so a 24-hour loop fits on phones
  const redTexture = async (url: string) => {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const rgba = g.getImageData(0, 0, img.width, img.height).data, w = img.width, h = img.height;
    const red = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) red[(h - 1 - y) * w + x] = rgba[(y * w + x) * 4];  // flip, like image textures
    const t = new THREE.DataTexture(red, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    t.anisotropy = maxAniso; t.needsUpdate = true;
    return clamp(t);
  };
  const colourTexture = (url: string) => new Promise<THREE.Texture>((ok, fail) => new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; ok(clamp(t));
  }, undefined, fail));
  const pad = (i: number) => String(i).padStart(2, "0");
  const loopFrame = (s: Storm, i: number) => (texFor(s).loop[i] ??= redTexture(`${base}${s.dir}loop/f${pad(i)}.jpg`));
  const visFrame = (s: Storm, i: number) => (texFor(s).visLoop[i] ??= colourTexture(`${base}${s.dir}loop/v${pad(i)}.jpg`));
  // the whole globe's hourly infrared frames, oldest first; the frame itself is the full-size ir_global.jpg
  const globeMs = [...(meta.globeTimes ?? []).map(isoMs), FRAME.getTime()];
  const globeTex: Promise<THREE.Texture>[] = [];
  const globeFrame = (i: number) => i === globeMs.length - 1 ? Promise.resolve(T.ir) : (globeTex[i] ??= redTexture(`${base}data/globe/g${pad(i)}.jpg`));
  // the prepared loop: infrared frames with their times, and the true-colour frames covering the same span (if any)
  let loopIR: THREE.Texture[] = [], loopMs: number[] = [], loopVis: THREE.Texture[] = [], loopVisMs: number[] = [];
  let loopGlobe: THREE.Texture[] = [], loopGlobeMs: number[] = [];
  const rmwOf = (s: Storm) => Math.max(15, (s.eyeDiameterKm ?? 30) * 0.65);

  // ---------- uniforms shared by every material ----------
  const eye = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3();
  const first = texFor(storms[0]);
  const uni = {
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    style: { value: 0 },
    vis: { value: first.vis ?? first.still },
    visB: { value: first.vis ?? first.still },
    visOn: { value: 0 },
    sunReal: { value: SUN_REAL },
    time: { value: 0 },
    patchOn: { value: 0 },
    eye: { value: eye },
    east: { value: east },
    north: { value: north },
    patchAng: { value: PATCH_KM / R_KM },
    frameA: { value: first.still },
    frameB: { value: first.still },
    frameMix: { value: 1 },
    visMix: { value: 0 },
    exag: { value: 14 },
    ir: { value: T.ir as THREE.Texture },
    irB: { value: T.ir as THREE.Texture },
    irMix: { value: 0 },
    realSun: { value: 0 },
    rmw: { value: 30 },
    vmax: { value: 100 },
  };

  // ---------- stars, Earth, clouds, atmosphere ----------
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(90, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { map: { value: T.sky } }, vertexShader: SKY.vertex, fragmentShader: SKY.fragment,
  })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.ShaderMaterial({
    uniforms: { ...uni, day: { value: T.day }, night: { value: T.night }, water: { value: T.water }, topo: { value: T.topo } },
    vertexShader: EARTH.vertex, fragmentShader: EARTH.fragment,
  })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.0045, 256, 128), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...uni, live: { value: T.live } },
    vertexShader: CLOUDS.vertex, fragmentShader: CLOUDS.fragment,
  })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 128, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { sunDir: uni.sunDir }, vertexShader: ATMOSPHERE.vertex, fragmentShader: ATMOSPHERE.fragment,
  })));

  // ---------- track: eye fixes as dots, cloud-mass fixes as rings ----------
  const amber = (k: number) => new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(k);
  const trackGroup = new THREE.Group();
  let showTrack = false;
  scene.add(trackGroup);
  const dotGeo = new THREE.SphereGeometry(0.0042, 16, 12), ringGeo = new THREE.TorusGeometry(0.0042, 0.0011, 8, 24);
  const glow = new THREE.MeshBasicMaterial({ color: amber(4) }), tubeMat = new THREE.MeshBasicMaterial({ color: amber(3.2) });
  const pulseMat = new THREE.MeshBasicMaterial({ color: amber(5), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const pulseGeo = new THREE.RingGeometry(0.01, 0.0125, 64);
  const pulses: THREE.Mesh[] = [];
  for (const st of storms) {
    const TR = st.track;
    // light smoothing of cloud-mass fixes only; eye fixes stay as observed
    const pts = TR.map((p, i) => {
      if (p[3]) return [p[1], p[2]];
      const a = TR[Math.max(i - 1, 0)], b = TR[Math.min(i + 1, TR.length - 1)];
      return [(a[1] + p[1] * 2 + b[1]) / 4, (a[2] + p[2] * 2 + b[2]) / 4];
    });
    if (pts.length > 1) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([la, lo]) => ll2v(la, lo, 1.012)));
      trackGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.0028, 10), tubeMat));
    }
    for (const p of TR) {
      const m = new THREE.Mesh(p[3] ? dotGeo : ringGeo, glow);
      m.position.copy(ll2v(p[1], p[2], 1.012));
      m.lookAt(m.position.clone().multiplyScalar(2));
      trackGroup.add(m);
    }
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.position.copy(ll2v(st.eye.lat, st.eye.lon, 1.013));
    pulse.lookAt(pulse.position.clone().multiplyScalar(2));
    trackGroup.add(pulse); pulses.push(pulse);
  }

  // ---------- mode 0: the selected storm's sharp close-up, draped over the globe ----------
  const imagery = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 192, 192), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: uni, vertexShader: IMAGERY.vertex, fragmentShader: IMAGERY.fragment,
  }));
  imagery.frustumCulled = false; imagery.renderOrder = 1;
  scene.add(imagery);

  // ---------- mode 1: 3D cloud tops ----------
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 640, 640), new THREE.ShaderMaterial({
    transparent: true, uniforms: uni, vertexShader: CLOUD_TOPS.vertex, fragmentShader: CLOUD_TOPS.fragment,
  }));
  patch.frustumCulled = false; patch.visible = false;
  scene.add(patch);

  // ---------- mode 2: volumetric storm, in a frame tangent at the eye ----------
  const stormFrame = new THREE.Group();
  stormFrame.matrixAutoUpdate = false;
  volScene.add(stormFrame);
  const HALF = PATCH_KM / 2 / R_KM;
  const volBox = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1.45).translate(0, 0, 0.275), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
    uniforms: uni, vertexShader: VOLUME.vertex, fragmentShader: VOLUME.fragment,
  }));
  volBox.visible = false; volBox.frustumCulled = false; volBox.renderOrder = 10;
  stormFrame.add(volBox);


  const setBox = () => {
    volBox.scale.set(HALF, HALF, (18 * uni.exag.value) / R_KM);
    volBox.updateMatrixWorld(true);
  };
  setBox();

  // how far a pan can slide the view from the eye: most of the 2048 km close-up
  const panOff = new THREE.Vector3(), PAN_MAX = 0.7 * HALF;

  // OrbitControls orbits around camera.up, fixed when it was built; in the 3D views "up" is the storm's own vertical
  const Y = new THREE.Vector3(0, 1, 0);
  const orbitAxis = (up: THREE.Vector3) => {
    camera.up.copy(up);
    const c = controls as unknown as { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
    c._quat.setFromUnitVectors(up, Y); c._quatInverse.copy(c._quat).invert();
  };

  // point everything storm-specific at storm i
  const useStorm = (i: number) => {
    cur = i; panOff.set(0, 0, 0);
    const st = storms[i];
    eye.copy(ll2v(st.eye.lat, st.eye.lon)).normalize();
    east.crossVectors(new THREE.Vector3(0, 1, 0), eye).normalize();
    north.crossVectors(eye, east).normalize();
    stormFrame.matrix.makeBasis(east, north, eye).setPosition(eye);
    stormFrame.updateMatrixWorld(true);
    uni.rmw.value = rmwOf(st);
    uni.vmax.value = dvorak(st.eyeK, st.ringK).kt;
    const t = texFor(st);
    uni.frameA.value = uni.frameB.value = t.still; uni.frameMix.value = 1;
    loopIR = []; loopVis = [];
    uni.vis.value = uni.visB.value = t.vis ?? t.still;
    syncVis();
    if (mode > 0) orbitAxis(eye);
  };
  // the loop plays in true colour when the pipeline cut one; otherwise it plays in infrared
  function syncVis() { const t = texFor(storms[cur]); uni.visOn.value = style === 0 && (playing ? loopVis.length > 1 : !!t.vis) ? 1 : 0; }
  useStorm(0);

  // ---------- camera moves ----------
    let fly: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; start: number; ms: number } | null = null;
  const flyTo = (pos: THREE.Vector3, target: THREE.Vector3, ms = 1800) => {
    fly = { p0: camera.position.clone(), p1: pos, t0: controls.target.clone(), t1: target, start: performance.now(), ms: reduceMotion ? 1 : ms };
  };
  const viewFor = (m: Mode) => {
    if (m === 0) {
      // keep the whole disc in view on narrow portrait screens
      const h = Math.atan(Math.tan(16 * D2R) * Math.min(innerWidth / innerHeight, 1));
      const st = storms[cur];
      return { pos: ll2v(st.eye.lat + 4, st.eye.lon + 4, Math.min(7.5, Math.max(4.3, 0.9 / Math.sin(h)))), target: new THREE.Vector3() };
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
    const pr = renderer.getPixelRatio();
    volRT.setSize(Math.max(1, Math.round(w * pr)), Math.max(1, Math.round(h * pr)));
    volBlend.uniforms.texel.value.set(1 / volRT.width, 1 / volRT.height);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();
  const v0 = viewFor(0);
  camera.position.copy(ll2v(storms[0].eye.lat - 5, storms[0].eye.lon + 22, 5.2));
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
    // zoomed in, a drag orbits the storm; scroll out and the pivot slides to the Earth's centre so the globe spins.
    // Close in, the camera can't drop below the storm's horizon (or into the globe).
    // Close in, a right-drag (or two fingers) slides across the storm, kept to the storm's own patch.
    if (mode > 0) {
      const out = THREE.MathUtils.smoothstep(camera.position.length(), 1.5, 2.4);
      controls.enablePan = out < 0.5;
      if (!fly) controls.target.copy(eye).addScaledVector(panOff, 1 - out).multiplyScalar(1 - out);
      controls.maxPolarAngle = THREE.MathUtils.lerp(1.32, Math.PI, out);
      const before = controls.target.clone();
      controls.update();
      if (!fly && out < 1) {
        // what the pan added this frame, kept in the storm's ground plane and within its patch
        panOff.addScaledVector(controls.target.clone().sub(before), 1 / (1 - out));
        panOff.addScaledVector(eye, -panOff.dot(eye));
        if (panOff.length() > PAN_MAX) panOff.setLength(PAN_MAX);
        // move the camera with the corrected target, so a clamped pan stops instead of tilting the view
        const fixed = eye.clone().addScaledVector(panOff, 1 - out).multiplyScalar(1 - out);
        camera.position.add(fixed.sub(controls.target)); controls.target.add(fixed);
      }
    } else controls.update();
    if (camera.position.length() < 1.012) camera.position.setLength(1.012);
    // studio light: a key light from upper left, slightly behind the viewer; real sun: the subsolar point at frame time
    if (!realSun) {
      camera.matrixWorld.extractBasis(right, upv, fwd);
      uni.sunDir.value.copy(right).multiplyScalar(-0.55).addScaledVector(upv, 0.45).addScaledVector(fwd, 0.55).normalize();
      if (mode > 0) uni.sunDir.value.lerp(eye.clone().addScaledVector(right, -0.7).addScaledVector(upv, 0.4).normalize(), 0.6).normalize();
    } else uni.sunDir.value.copy(SUN_REAL);
    uni.realSun.value = realSun ? 1 : 0;
    const s = 1 + 0.35 * Math.sin(uni.time.value * 2.4);
    pulses.forEach((p, i) => p.scale.setScalar(i === cur ? s : 0.8)); pulseMat.opacity = 0.9 - (s - 1) * 1.6;
    for (const fn of listeners) fn(mode, dt);
    volBlend.enabled = mode === 2;
    if (mode === 2) {
      const clear = renderer.getClearColor(new THREE.Color()), clearA = renderer.getClearAlpha();
      renderer.setRenderTarget(volRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(volScene, camera);
      renderer.setRenderTarget(null); renderer.setClearColor(clear, clearA);
    }
    composer.render();
  }
  requestAnimationFrame(frame);

  return {
    camera,
    eye,
    selectStorm(i) {
      if (i === cur) return;
      useStorm(i);
      const v = viewFor(mode);
      flyTo(v.pos, v.target);
    },
    lookAt(lat, lon) {
      const v = viewFor(0);
      flyTo(ll2v(lat + 4, lon + 4, v.pos.length()), new THREE.Vector3());
    },
    setMode(m) {
      mode = m; panOff.set(0, 0, 0); controls.enablePan = false;
      resize();
      uni.patchOn.value = 1;
      imagery.visible = m === 0; patch.visible = m === 1; volBox.visible = m === 2;
      trackGroup.visible = m === 0 && showTrack;
      controls.minDistance = m === 0 ? 1.07 : 0.05;
      orbitAxis(m === 0 ? Y : eye);
      if (m === 0) controls.maxPolarAngle = Math.PI;
      const v = viewFor(m);
      flyTo(v.pos, v.target);
    },
    setStyle(s) { style = s; uni.style.value = s; syncVis(); },
    setRealSun(on) {
      realSun = on;
      if (on && mode === 0) {
        // turn toward the nearest terminator so the night side is in view
        const t = eye.clone().addScaledVector(SUN_REAL, -eye.dot(SUN_REAL)).normalize();
        flyTo(eye.clone().addScaledVector(t, 1.4).normalize().multiplyScalar(camera.position.length()), new THREE.Vector3());
      }
    },
    setHeight(exag) { uni.exag.value = exag; setBox(); },
    setTrack(on) { showTrack = on; trackGroup.visible = mode === 0 && on; },
    async prepareLoop(frames) {
      const st = storms[cur], ms = frames.map((i) => isoMs(st.loopTimes[i]));
      const ir = await Promise.all(frames.map((i) => loopFrame(st, i)));
      // true colour plays only if its 30-minute frames cover the whole span without a gap (no night in between)
      const vt = (st.visTimes ?? []).map(isoMs), span = vt.map((t, i) => [t, i] as const).filter(([t]) => t >= ms[0] - 60e3);
      const covered = span.length > 1 && span[0][0] <= ms[0] + 60e3 && span[span.length - 1][0] >= ms[ms.length - 1] - 60e3
        && span.every(([t], k) => k === 0 || t - span[k - 1][0] <= 31 * 60e3);
      const vis = covered ? await Promise.all(span.map(([, i]) => visFrame(st, i))).catch(() => []) : [];
      // the whole globe moves too: its hourly frames from the last one at or before the loop's start
      let g0 = globeMs.length - 1; while (g0 > 0 && globeMs[g0] > ms[0]) g0--;
      const gi = globeMs.map((_, i) => i).slice(g0);
      const globe = gi.length > 1 ? await Promise.all(gi.map(globeFrame)).catch(() => []) : [];
      if (st !== storms[cur]) return;
      loopIR = ir; loopMs = ms; loopVis = vis; loopVisMs = vis.length ? span.map(([t]) => t) : [];
      loopGlobe = globe; loopGlobeMs = globe.length ? gi.map((i) => globeMs[i]) : [];
      syncVis();
    },
    setLoop(t) {
      const { still, vis } = texFor(storms[cur]), n = loopIR.length;
      if (playing !== (t !== null)) { playing = t !== null; syncVis(); }
      if (t === null || n < 2) {
        uni.frameA.value = uni.frameB.value = still; uni.frameMix.value = 1;
        uni.vis.value = uni.visB.value = vis ?? still;
        uni.ir.value = uni.irB.value = T.ir; uni.irMix.value = 0;
        return;
      }
      const i = Math.floor(t) % n, j = (i + 1) % n, f = t - Math.floor(t);
      uni.frameA.value = loopIR[i]; uni.frameB.value = loopIR[j]; uni.frameMix.value = j === 0 ? 0 : f;
      const now = loopMs[i] + (j === 0 ? 0 : (loopMs[j] - loopMs[i]) * f);
      // frames further apart than the infrared ones (true colour every 30 minutes, the globe every hour): blend the pair either side
      const pair = (times: number[]) => {
        let k = 0; while (k < times.length - 2 && times[k + 1] <= now) k++;
        return [k, THREE.MathUtils.clamp((now - times[k]) / (times[k + 1] - times[k]), 0, 1)] as const;
      };
      if (loopVis.length > 1) {
        const [k, m] = pair(loopVisMs);
        uni.vis.value = loopVis[k]; uni.visB.value = loopVis[k + 1]; uni.visMix.value = m;
      }
      if (loopGlobe.length > 1) {
        const [k, m] = pair(loopGlobeMs);
        uni.ir.value = loopGlobe[k]; uni.irB.value = loopGlobe[k + 1]; uni.irMix.value = m;
      }
    },
    onFrame(fn) { listeners.push(fn); },
  };
}
