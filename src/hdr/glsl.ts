// Shaders. Every IR texture stores code = (320 K − BT) / 140 K in its red channel.

/** Shared helpers: brightness temperature, cloud opacity, cloud-top height, and the enhanced IR palette. */
export const GLSL_IR = /* glsl */ `
  float btOf(float code) { return 320.0 - code * 140.0; }
  float cloudOf(float bt) { return pow(smoothstep(290.0, 228.0, bt), 0.8); }
  float topKm(float bt) { return clamp((300.0 - bt) / 6.3, 0.0, 17.5) * smoothstep(286.0, 262.0, bt); }
  vec3 enhance(float bt) {
    float c = bt - 273.15;
    vec3 col = vec3(1.0);
    col = mix(col, vec3(0.55, 0.85, 1.0), smoothstep(-38.0, -45.0, c));
    col = mix(col, vec3(0.20, 0.42, 1.0), smoothstep(-48.0, -56.0, c));
    col = mix(col, vec3(0.25, 1.0, 0.45), smoothstep(-58.0, -63.0, c));
    col = mix(col, vec3(1.0, 0.86, 0.15), smoothstep(-65.0, -69.0, c));
    col = mix(col, vec3(1.0, 0.28, 0.12), smoothstep(-71.0, -75.0, c));
    col = mix(col, vec3(1.0, 0.45, 1.0), smoothstep(-77.0, -82.0, c));
    return col;
  }
  float glowOf(float bt) { return smoothstep(-70.0, -82.0, bt - 273.15); }
`;

/** Height field of the storm frame, cross-fading two loop frames, lightly smoothed so single pixels don't spike. */
const GLSL_FRAME = /* glsl */ `
  float codeAt(vec2 uv){ return mix(texture2D(frameA, uv).r, texture2D(frameB, uv).r, frameMix); }
  float hAt(vec2 uv){ vec2 o = vec2(2.0 / 768.0, 0.0);
    return (topKm(btOf(codeAt(uv))) * 2.0 + topKm(btOf(codeAt(uv + o))) + topKm(btOf(codeAt(uv - o))) + topKm(btOf(codeAt(uv + o.yx))) + topKm(btOf(codeAt(uv - o.yx)))) / 6.0; }
`;

export const SKY = {
  vertex: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragment: /* glsl */ `uniform sampler2D map; varying vec2 vUv; void main(){ vec3 c = texture2D(map, vUv).rgb; gl_FragColor = vec4(pow(c, vec3(1.35)) * 1.6, 1.0); }`,
};

const SPHERE_VERTEX = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

/** Blue Marble day side, city lights at night, ocean glint, terrain bump, and shadows cast by the IR clouds. */
export const EARTH = {
  vertex: SPHERE_VERTEX,
  fragment: /* glsl */ `
    uniform sampler2D day, night, water, topo, ir; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    ${GLSL_IR}
    void main(){
      vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(sunDir);
      vec2 px = vec2(1.0/2048.0, 1.0/1024.0);
      float hC = texture2D(topo, vUv).r, hE = texture2D(topo, vUv + vec2(px.x,0.)).r, hN = texture2D(topo, vUv + vec2(0.,px.y)).r;
      vec3 t = normalize(cross(vec3(0.,1.,0.), N)), b = normalize(cross(N, t));
      vec3 Nb = normalize(N - 1.6 * ((hE - hC) * t + (hN - hC) * b));
      float ndl = dot(Nb, L), ndlS = dot(N, L);
      float dayF = smoothstep(-0.12, 0.22, ndlS);
      // cloud shadow: sample the IR clouds shifted away from the sun
      vec3 Lt = L - N * dot(L, N);
      vec2 sh = vec2(dot(Lt, t), dot(Lt, b)) * vec2(0.0045, 0.009);
      float shadow = cloudOf(btOf(texture2D(ir, vUv + sh).r)) * 0.72;
      vec3 albedo = texture2D(day, vUv).rgb;
      float w = texture2D(water, vUv).r;
      albedo = mix(albedo, albedo * vec3(0.55, 0.75, 1.05), w * 0.5);
      vec3 sunCol = vec3(1.0, 0.96, 0.9) * 2.3;
      vec3 col = albedo * sunCol * max(ndl, 0.0) * (1.0 - shadow);
      // sunset tint near the terminator
      col *= mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.35, ndlS));
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 220.0) * 14.0 + pow(max(dot(N, H), 0.0), 18.0) * 0.18;
      col += w * spec * 0.16 * vec3(1.0, 0.9, 0.75) * smoothstep(0.0, 0.1, ndlS) * (1.0 - shadow);
      // city lights on the night side, dimmed under cloud
      vec3 lights = pow(texture2D(night, vUv).rgb, vec3(1.6)) * vec3(1.0, 0.78, 0.5) * 7.0;
      float cl = cloudOf(btOf(texture2D(ir, vUv).r));
      col += lights * (1.0 - dayF) * (1.0 - cl * 0.85);
      col += albedo * vec3(0.012, 0.018, 0.03);
      // aerial perspective toward the limb
      float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col = mix(col, vec3(0.22, 0.5, 1.0) * 0.9 * max(dayF, 0.04), fres * 0.4);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** The stitched global IR as a cloud shell. Live satellite coverage is coloured; the archival gap stays grey. */
export const CLOUDS = {
  vertex: SPHERE_VERTEX,
  fragment: /* glsl */ `
    uniform sampler2D ir, live; uniform vec3 sunDir, eye, east, north; uniform float palette, patchOn, patchAng;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    ${GLSL_IR}
    void main(){
      vec3 N = normalize(vN), V = normalize(cameraPosition - vP), L = normalize(sunDir);
      float bt = btOf(texture2D(ir, vUv).r);
      float a = cloudOf(bt);
      float isLive = texture2D(live, vUv).r;
      // hide where the 3D patch takes over
      vec3 d = N - eye; float s = dot(d, east) / patchAng, tt = dot(d, north) / patchAng;
      float inPatch = (1.0 - smoothstep(0.40, 0.47, max(abs(s), abs(tt)))) * step(0.0, dot(N, eye));
      a *= 1.0 - inPatch * patchOn;
      float ndl = dot(N, L);
      float lit = smoothstep(-0.25, 0.6, ndl);
      vec3 base = palette > 0.5 ? mix(vec3(0.92), enhance(bt), isLive) : vec3(0.92);
      vec3 sunCol = vec3(1.0, 0.95, 0.88) * 1.9 * mix(vec3(1.0, 0.5, 0.25), vec3(1.0), smoothstep(0.0, 0.4, ndl));
      vec3 col = base * (sunCol * lit + vec3(0.10, 0.13, 0.18));
      // IR sees through the night: keep a cool moonlit read of the cloud tops
      col += base * vec3(0.30, 0.36, 0.48) * (1.0 - lit) * a;
      if (palette > 0.5) col += enhance(bt) * smoothstep(-40.0, -70.0, bt - 273.15) * 1.4 * isLive + enhance(bt) * glowOf(bt) * 3.0 * isLive;
      float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
      col = mix(col, vec3(0.6, 0.8, 1.0) * lit, fres * 0.25);
      gl_FragColor = vec4(col, a * mix(0.55, 0.97, isLive));
    }`,
};

export const ATMOSPHERE = {
  vertex: /* glsl */ `varying vec3 vNv; varying vec3 vNw; void main(){ vNv = normalize(normalMatrix * normal); vNw = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragment: /* glsl */ `
    uniform vec3 sunDir; varying vec3 vNv; varying vec3 vNw;
    void main(){
      float k = pow(clamp(0.78 + dot(vNv, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 5.0);
      float sd = dot(-vNw, normalize(sunDir));
      float day = smoothstep(-0.35, 0.45, sd);
      float term = exp(-pow(sd * 3.0, 2.0));
      vec3 col = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.42, 0.15), term * 0.45) * k * (0.08 + 2.4 * day + 0.5 * term);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Mode 1: the real 2 km frame on a dense grid, each vertex lifted to its cloud-top height, with self-shadowing. */
export const CLOUD_TOPS = {
  vertex: /* glsl */ `
    uniform sampler2D frameA, frameB; uniform float frameMix, exag, patchAng; uniform vec3 eye, east, north;
    varying vec2 vUv; varying vec3 vUp; varying vec3 vP;
    ${GLSL_IR}
    ${GLSL_FRAME}
    void main(){
      vUv = uv;
      float h = hAt(uv);
      vec2 st = uv - 0.5;
      vec3 dir = normalize(eye + (st.x * east + st.y * north) * patchAng);
      vUp = dir;
      vec3 p = dir * (1.0 + 0.0008 + h / 6371.0 * exag);
      vec4 w = modelMatrix * vec4(p, 1.0); vP = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragment: /* glsl */ `
    uniform sampler2D frameA, frameB; uniform float frameMix, exag, palette, patchAng; uniform vec3 sunDir, east, north;
    varying vec2 vUv; varying vec3 vUp; varying vec3 vP;
    ${GLSL_IR}
    ${GLSL_FRAME}
    void main(){
      float bt = btOf(codeAt(vUv));
      float a = cloudOf(bt);
      a *= 1.0 - smoothstep(0.40, 0.47, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
      if (a < 0.01) discard;
      float du = 2.5 / 768.0;
      float k = exag / (2.0 * du * 2048.0);
      float hx = (hAt(vUv + vec2(du, 0.)) - hAt(vUv - vec2(du, 0.))) * k;
      float hy = (hAt(vUv + vec2(0., du)) - hAt(vUv - vec2(0., du))) * k;
      vec3 N = normalize(vUp - hx * east - hy * north);
      vec3 L = normalize(sunDir), V = normalize(cameraPosition - vP);
      // self-shadowing: march the height field toward the sun
      vec3 Lt = L - vUp * dot(L, vUp);
      vec2 dirUv = vec2(dot(Lt, east), dot(Lt, north));
      float rise = max(dot(L, vUp), 0.02);
      float h0 = hAt(vUv), shadow = 0.0;
      float tanE = rise / max(length(Lt), 1e-3);
      for (int i = 1; i <= 24; i++) {
        float d = float(i) * float(i) * 0.00035;
        vec2 q = vUv + normalize(dirUv + 1e-5) * d;
        float diff = hAt(q) - (h0 + d * 2048.0 * tanE / exag);
        shadow = max(shadow, smoothstep(0.0, 1.2, diff));
      }
      float ndl = max(dot(N, L), 0.0);
      float wrap = max((dot(N, L) + 0.35) / 1.35, 0.0);
      vec3 base = palette > 0.5 ? enhance(bt) : vec3(1.0);
      vec3 sunCol = vec3(1.0, 0.95, 0.88) * 2.4;
      vec3 sky = vec3(0.22, 0.36, 0.62) * (0.35 + 0.65 * max(dot(N, vUp), 0.0));
      vec3 col = base * (sunCol * mix(ndl, wrap, 0.35) * (1.0 - shadow * 0.85) + sky);
      // silver lining on edges facing away
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(-V, L), 0.0);
      col += vec3(1.0, 0.9, 0.8) * rim * 3.0;
      if (palette > 0.5) col += enhance(bt) * glowOf(bt) * 2.6;
      gl_FragColor = vec4(col, a);
    }`,
};

/**
 * Mode 2: a volumetric cloud ray-marched from the same frame. Density sits between a cloud base and the IR cloud top,
 * measured against the true sphere, with noise sheared around the eye. The cutaway shows the Holland wind profile.
 */
export function volumeShader(rmwKm: number) {
  return {
    vertex: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragment: /* glsl */ `
    uniform sampler2D frameA, frameB; uniform float frameMix, exag, palette, time, cutaway; uniform vec3 sunDir;
    uniform vec3 eye, east, north; uniform float patchAng;
    uniform mat4 modelMatrix; varying vec3 vW;
    ${GLSL_IR}
    float codeAt(vec2 uv){ return mix(texture2D(frameA, uv).r, texture2D(frameB, uv).r, frameMix); }
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
    // world point -> (km east, km north, km above the sea), using the true sphere
    vec3 kmOf(vec3 w){ float rr = length(w); vec3 dir = w / rr; vec3 dd = dir - eye;
      return vec3(dot(dd, east) / patchAng * 2048.0, dot(dd, north) / patchAng * 2048.0, (rr - 1.0) * 6371.0 / exag); }
    float density(vec3 km, out float bt){
      vec2 uv = km.xy / 2048.0 + 0.5;
      if (any(lessThan(uv, vec2(0.02))) || any(greaterThan(uv, vec2(0.98)))) { bt = 300.0; return 0.0; }
      bt = btOf(codeAt(uv));
      float r = length(km.xy), z = km.z;
      float top = topKm(bt);
      float base = mix(0.8, 5.0, smoothstep(160.0, 600.0, r)) * smoothstep(225.0, 250.0, bt);
      float d = smoothstep(top, top - 1.6, z) * smoothstep(base * 0.4, base * 0.4 + 0.8, z) * cloudOf(bt);
      d *= 1.0 - smoothstep(0.40, 0.48, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
      if (d <= 0.0) return 0.0;
      // cloud texture, sheared around the eye like the real winds
      float ang = atan(km.y, km.x) + time * 1.2 / max(r, 30.0);
      vec3 q = vec3(cos(ang) * r, sin(ang) * r, z * 12.0) * 0.045;
      d *= smoothstep(0.25, 0.75, fbm(q) + 0.25 * d);
      if (cutaway > 0.5 && km.x > 0.0 && km.y < 0.0) d = 0.0;
      return d;
    }
    vec3 heat(float t){ return clamp(vec3(1.5*t, 1.5*t - 0.4, 0.2*(1.0-t)), 0.0, 1.0); }
    void main(){
      mat4 inv = inverse(modelMatrix);
      vec3 ro = (inv * vec4(cameraPosition, 1.0)).xyz;
      vec3 rd = normalize((inv * vec4(vW, 1.0)).xyz - ro);
      vec3 bmin = vec3(-1.0, -1.0, -0.45), bmax = vec3(1.0, 1.0, 1.0);
      vec3 t0 = (bmin - ro) / rd, t1 = (bmax - ro) / rd;
      vec3 tmin = min(t0, t1), tmax = max(t0, t1);
      float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0)), tf = min(min(tmax.x, tmax.y), tmax.z);
      if (tf <= tn) discard;
      vec3 Lw = normalize(sunDir);
      const int STEPS = 72;
      float dt = (tf - tn) / float(STEPS);
      float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 acc = vec3(0.0); float trans = 1.0;
      vec3 sunCol = vec3(1.0, 0.95, 0.88) * 1.9, skyCol = vec3(0.22, 0.38, 0.7) * 0.35;
      for (int i = 0; i < STEPS; i++) {
        float t = tn + (float(i) + jitter) * dt;
        vec3 w = (modelMatrix * vec4(ro + rd * t, 1.0)).xyz;
        vec3 km = kmOf(w);
        float bt; float d = density(km, bt);
        if (d > 0.01) {
          float od = 0.0;
          for (int j = 1; j <= 4; j++) { float bt2; od += density(kmOf(w + Lw * float(j * j) * 0.0022), bt2); }
          float lightT = exp(-od * 2.6);
          float powder = 1.0 - exp(-d * 4.0);
          vec3 base = palette > 0.5 ? mix(vec3(0.95), enhance(bt), smoothstep(11.0, 14.5, km.z)) : vec3(0.95);
          vec3 L = base * (sunCol * lightT * mix(0.6, 1.0, powder) + skyCol);
          if (palette > 0.5) L += enhance(bt) * glowOf(bt) * 1.4;
          if (cutaway > 0.5) {
            float r = length(km.xy), x = pow(${rmwKm.toFixed(1)} / max(r, 1.0), 1.6);
            float v = sqrt(x * exp(1.0 - x)) * smoothstep(0.0, 4.0, km.z) * (1.0 - smoothstep(10.0, 16.0, km.z));
            float nearCut = 1.0 - smoothstep(0.0, 18.0, min(abs(km.x), abs(km.y)));
            L += heat(v) * nearCut * 4.0 * v;
          }
          float segKm = length((modelMatrix * vec4(rd * dt, 0.0)).xyz) * 6371.0;
          float a = 1.0 - exp(-d * 0.09 * segKm);
          acc += trans * a * L;
          trans *= 1.0 - a;
          if (trans < 0.02) break;
        }
      }
      if (trans > 0.995) discard;
      gl_FragColor = vec4(acc, 1.0 - trans);
    }`,
  };
}

/** Wind tracers from a Holland profile: low-level inflow spiralling in, upper outflow spiralling out. */
export function windShader(rmwKm: number, vmaxKt: number) {
  return {
    vertex: /* glsl */ `
    attribute vec4 seed; uniform float time, exag; varying float vSpeed; varying float vFade;
    void main(){
      float r0 = seed.x, a0 = seed.y, z = seed.z, outflow = seed.w;
      float x = pow(${rmwKm.toFixed(1)} / r0, 1.6);
      float v = sqrt(x * exp(1.0 - x));                  // 0..1 of Vmax
      float life = fract(time * 0.02 + a0 * 0.159);
      float r = outflow > 0.5 ? r0 * (0.6 + life * 0.9) : r0 * (1.2 - life * 0.55);
      float omega = v * ${vmaxKt.toFixed(1)} * 1.852 / r * 0.9;  // rad per (scaled) hour
      float a = a0 + (outflow > 0.5 ? -1.0 : 1.0) * omega * time * 0.35;
      float zz = (z * exag - r * r / 12742.0) / 6371.0;    // follow the curve of the Earth
      vec3 p = vec3(cos(a) * r / 6371.0, sin(a) * r / 6371.0, zz);
      vSpeed = outflow > 0.5 ? 0.25 : v; vFade = sin(life * 3.14159);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (1.0 + 1.8 * v) * (1.6 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
    fragment: /* glsl */ `
    varying float vSpeed; varying float vFade;
    void main(){
      vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard;
      vec3 col = mix(vec3(0.35, 0.7, 1.0), vec3(1.0, 0.85, 0.3), smoothstep(0.35, 0.7, vSpeed));
      col = mix(col, vec3(1.0, 0.25, 0.15), smoothstep(0.8, 1.0, vSpeed));
      gl_FragColor = vec4(col * (0.4 + 2.6 * vSpeed) * vFade * (1.0 - d * 4.0) * 0.6, 1.0);
    }`,
  };
}
