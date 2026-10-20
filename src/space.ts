import * as THREE from "three";

/**
 * Background atmosphere: a faint Milky Way, two star layers, rare shooting stars,
 * a few drifting asteroids, and satellites circling the globe's rim.
 * Everything is procedural (no image assets) and costs a few buffer writes per frame.
 */

const SKY_RADIUS = 60;
const STREAK_BRIGHTNESS = 0.5;

export type SpaceOptions = {
  /** Shooting stars on screen at once. Default 2; 0 turns them off. */
  meteors?: number;
  /** Drifting asteroids, one at a time each. Default 3; 0 turns them off. */
  asteroids?: number;
  /** Satellites circling the globe. Default 6; 0 turns them off. */
  satellites?: number;
  /** The dim Milky Way band and its stars. Default true. */
  milkyWay?: boolean;
};

const DEFAULT_SPACE: Required<SpaceOptions> = { meteors: 2, asteroids: 3, satellites: 6, milkyWay: true };

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** Box–Muller: a soft, centred spread for the galactic band. */
function gauss() {
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-6)) * Math.cos(2 * Math.PI * Math.random());
}

/** The galactic band: a great circle tilted against the sky, brightest near its core. */
const TILT = 1.05;
const bandLat = (u: number) => Math.atan(Math.tan(TILT) * Math.sin(2 * Math.PI * u));
const core = (u: number) => Math.exp(-Math.pow((u - 0.28) / 0.12, 2));

/**
 * An equirectangular canvas with a tilted Milky Way band, kept dim on purpose.
 * The glow and dust are drawn on a small canvas and blurred, so they read as haze rather than blobs;
 * the band's stars are a separate point layer (bandStars) so they stay crisp at any size.
 */
function milkyWay(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;

  const haze = document.createElement("canvas");
  haze.width = 512;
  haze.height = 256;
  const hg = haze.getContext("2d");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!hg || !g) throw new Error("canvas");
  const soft = (x: number, y: number, r: number, rgb: string, alpha: number) => {
    const grad = hg.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    hg.fillStyle = grad;
    hg.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const hy = (lat: number) => (0.5 - lat / Math.PI) * haze.height;
  hg.fillStyle = "#000";
  hg.fillRect(0, 0, haze.width, haze.height);
  hg.globalCompositeOperation = "lighter";
  for (let i = 0; i < 700; i++) {
    const u = Math.random();
    const c = core(u);
    const lat = bandLat(u) + gauss() * (0.08 + c * 0.06);
    const warm = Math.random() < 0.35 + c * 0.3;
    soft(u * haze.width, hy(lat), rand(6, 18), warm ? "255,226,196" : "186,204,255", 0.03 + c * 0.04);
  }
  hg.globalCompositeOperation = "source-over";
  for (let i = 0; i < 160; i++) {
    const u = Math.random();
    soft(u * haze.width, hy(bandLat(u) + gauss() * 0.02), rand(3, 8), "0,0,0", 0.22);
  }

  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  g.filter = "blur(6px)";
  // Drawn wrapped on both sides, so the blur does not leave a seam where the sky texture meets itself.
  for (const dx of [-w, 0, w]) g.drawImage(haze, dx, 0, w, h);
  g.filter = "none";
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Faint stars crowded along the band, placed exactly where the haze texture draws it. */
function bandStars(count: number, radius: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const lat = bandLat(u) + gauss() * (0.08 + core(u) * 0.05);
    // Same parameterisation as THREE.SphereGeometry, so points line up with the texture.
    const phi = u * Math.PI * 2;
    const theta = Math.PI / 2 - lat;
    const r = radius * rand(0.95, 1);
    pos.set([-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xe4e9ff,
      size: 1,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}

function starLayer(count: number, radius: number, size: number, color: number, opacity: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(radius * rand(0.92, 1));
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: false,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = -2;
  return points;
}

type Meteor = { o: THREE.Vector3; d: THREE.Vector3; t: number; dur: number; wait: number };
type Rock = { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; t: number; life: number; wait: number };

/** A lumpy low-poly rock: an icosahedron with its corners pushed in and out. */
function rockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    const s = seen.get(k) ?? rand(0.7, 1.25);
    seen.set(k, s);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.8, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Space {
  private meteors: Meteor[] = [];
  private meteorGeo = new THREE.BufferGeometry();
  private rocks: Rock[] = [];
  private sats: { mesh: THREE.Mesh; angle: number; speed: number; radius: number }[] = [];
  private limb = new THREE.Vector3();
  private spin = new THREE.Vector3();
  private view = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private globeRadius: number,
    private still: boolean,
    options: SpaceOptions = {},
  ) {
    const o = { ...DEFAULT_SPACE, ...options };
    if (o.milkyWay) {
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
        new THREE.MeshBasicMaterial({ map: milkyWay(), side: THREE.BackSide, depthWrite: false, color: 0x9aa0b0 }),
      );
      sky.renderOrder = -3;
      scene.add(sky);
      scene.add(bandStars(3200, SKY_RADIUS * 0.95));
    }
    scene.add(starLayer(1400, SKY_RADIUS * 0.9, 1.1, 0xd8deff, 0.75));
    scene.add(starLayer(260, SKY_RADIUS * 0.85, 2, 0xffffff, 0.95));

    this.meteorGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(o.meteors * 6), 3));
    this.meteorGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(o.meteors * 6), 3));
    const streaks = new THREE.LineSegments(
      this.meteorGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    streaks.frustumCulled = false;
    scene.add(streaks);
    for (let i = 0; i < o.meteors; i++) {
      this.meteors.push({ o: new THREE.Vector3(), d: new THREE.Vector3(), t: 0, dur: 0.4, wait: rand(1.5, 4) });
    }

    const rockMat = new THREE.MeshLambertMaterial({ color: 0x6b645c, flatShading: true });
    for (let i = 0; i < o.asteroids; i++) {
      const mesh = new THREE.Mesh(rockGeometry(), rockMat);
      mesh.visible = false;
      scene.add(mesh);
      this.rocks.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, life: 1, wait: rand(4, 16) });
    }

    const satMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const satGeo = new THREE.SphereGeometry(0.009, 6, 6);
    for (let i = 0; i < o.satellites; i++) {
      const mesh = new THREE.Mesh(satGeo, satMat);
      scene.add(mesh);
      this.sats.push({
        mesh,
        angle: Math.random() * Math.PI * 2,
        speed: (i % 2 ? 1 : -1) * rand(0.045, 0.075),
        radius: globeRadius * rand(1.1, 1.26),
      });
    }
  }

  update(dt: number) {
    this.satellites(dt);
    if (this.still) return;
    this.shootingStars(dt);
    this.asteroids(dt);
  }

  /** Satellites ride a ring that always faces the camera, so they circle the globe instead of crossing it. */
  private satellites(dt: number) {
    this.view.copy(this.camera.position).normalize();
    this.limb.crossVectors(new THREE.Vector3(0, 1, 0), this.view);
    if (this.limb.lengthSq() < 1e-4) this.limb.set(1, 0, 0);
    this.limb.normalize();
    this.spin.crossVectors(this.view, this.limb).normalize();
    for (const s of this.sats) {
      if (!this.still) s.angle += dt * s.speed;
      s.mesh.position
        .copy(this.limb)
        .multiplyScalar(Math.cos(s.angle) * s.radius)
        .addScaledVector(this.spin, Math.sin(s.angle) * s.radius);
    }
  }

  /**
   * Start a streak somewhere on screen, clear of the globe, far out among the stars,
   * moving across the view rather than toward it. Random sky directions would be off-screen nine times in ten.
   */
  private aim(m: Meteor) {
    const cam = this.camera.position;
    for (let tries = 0; tries < 8; tries++) {
      const ray = new THREE.Vector3(rand(-0.85, 0.85), rand(-0.8, 0.8), 0.5).unproject(this.camera).sub(cam).normalize();
      // Skip rays that pass behind the globe.
      const along = -cam.dot(ray);
      const miss = cam.clone().addScaledVector(ray, along).length();
      if (along > 0 && miss < this.globeRadius * 1.25) continue;
      m.o.copy(cam).addScaledVector(ray, SKY_RADIUS * rand(0.72, 0.8));
      m.d.randomDirection().cross(ray).normalize().multiplyScalar(rand(9, 13));
      return;
    }
    m.o.set(0, 0, 0);
    m.d.set(0, 0, 0);
  }

  private shootingStars(dt: number) {
    const pos = this.meteorGeo.getAttribute("position") as THREE.BufferAttribute;
    const col = this.meteorGeo.getAttribute("color") as THREE.BufferAttribute;
    let dirty = false;
    this.meteors.forEach((m, i) => {
      if (m.wait > 0) {
        m.wait -= dt;
        if (m.wait > 0) return;
        this.aim(m);
        m.t = 0;
        m.dur = rand(0.9, 1.4);
      }
      dirty = true;
      m.t += dt;
      const u = m.t / m.dur;
      if (u >= 1) {
        m.wait = rand(4, 10);
        pos.setXYZ(i * 2, 0, 0, 0);
        pos.setXYZ(i * 2 + 1, 0, 0, 0);
        return;
      }
      const tail = Math.max(0, u - 0.28);
      const fade = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1;
      pos.setXYZ(i * 2, m.o.x + m.d.x * tail, m.o.y + m.d.y * tail, m.o.z + m.d.z * tail);
      pos.setXYZ(i * 2 + 1, m.o.x + m.d.x * u, m.o.y + m.d.y * u, m.o.z + m.d.z * u);
      col.setXYZ(i * 2, 0, 0, 0);
      // Light, not bright: about half of full white, fading to nothing along the tail.
      const glow = fade * STREAK_BRIGHTNESS;
      col.setXYZ(i * 2 + 1, glow, glow * 0.97, glow * 0.9);
    });
    if (dirty) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  }

  /** Now and then a rock drifts slowly across the far background, tumbling, then fades out. */
  private asteroids(dt: number) {
    for (const r of this.rocks) {
      if (r.wait > 0) {
        r.wait -= dt;
        if (r.wait > 0) continue;
        const start = new THREE.Vector3().randomDirection().multiplyScalar(rand(14, 22));
        // Keep them behind the globe's depth so they read as far away, never in front of the UI subject.
        if (start.dot(this.camera.position) > 0) start.negate();
        r.mesh.position.copy(start);
        r.vel.randomDirection().cross(start).normalize().multiplyScalar(rand(0.35, 0.7));
        r.spin.set(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6));
        r.mesh.scale.setScalar(rand(0.06, 0.16));
        r.t = 0;
        r.life = rand(14, 22);
        r.mesh.visible = true;
      }
      r.t += dt;
      r.mesh.position.addScaledVector(r.vel, dt);
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      r.mesh.rotation.z += r.spin.z * dt;
      if (r.t >= r.life) {
        r.mesh.visible = false;
        r.wait = rand(10, 30);
      }
    }
  }
}

/** How far the glow reaches past the globe, as a multiple of its radius. */
const GLOW_SCALE = 1.6;

/**
 * A soft rim around the globe: strongest at the Earth's edge, fading smoothly to nothing at its own
 * outer edge, so there is no visible line where the glow ends.
 */
export function rimGlow(radius: number): THREE.Mesh {
  // Seen from the camera, the globe's edge sits where the glow sphere's surface faces us by this much.
  const inner = Math.sqrt(1 - 1 / (GLOW_SCALE * GLOW_SCALE));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(0xeef0f4) },
      strength: { value: 0.4 },
      inner: { value: inner },
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float strength;
      uniform float inner;
      varying vec3 vNormal;
      void main() {
        // 0 at the glow's outer edge, 1 at the Earth's edge; eased so the fade has no visible step.
        float t = clamp(-vNormal.z / inner, 0.0, 1.0);
        float glow = pow(t, 2.4) * strength;
        gl_FragColor = vec4(color * glow, glow);
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius * GLOW_SCALE, 48, 32), material);
}
