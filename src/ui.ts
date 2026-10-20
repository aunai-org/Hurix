// The card, the storm picker, the legend, the control bar and the place labels. Everything shown is measured from the
// frame in meta.json.
import * as THREE from "three";
import { dayStr, degC, dvorak, frameDate, hhmm, subsolar, topKm, type Meta, type Storm } from "./meta";
import { ll2v, type Globe, type Mode, type Style } from "./hdr/scene";

const CITIES: [string, number, number][] = [
  ["Manila", 14.6, 121.0], ["Guam", 13.44, 144.79], ["Tokyo", 35.68, 139.69], ["Taipei", 25.03, 121.56],
  ["Naha", 26.21, 127.68], ["Palau", 7.5, 134.6], ["Hong Kong", 22.3, 114.17], ["Honolulu", 21.31, -157.86],
  ["Miami", 25.76, -80.19], ["Havana", 23.11, -82.37], ["Acapulco", 16.85, -99.82], ["Mumbai", 19.08, 72.88],
  ["Darwin", -12.46, 130.84], ["Nouméa", -22.27, 166.44], ["Port Louis", -20.16, 57.5],
];
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const html = (id: string, s: string) => { $(id).innerHTML = s; };
const compass = (deg: number) => POINTS[Math.round(deg / 22.5) % 16];

/** The basin and the word its warning centre uses at this strength (an unofficial estimate, so only a guide). */
function naming(st: Storm) {
  const { lat, lon } = st.eye;
  const kt = st.eyeDiameterKm ? dvorak(st.eyeK, st.ringK).kt : null;
  const strong = (word: string) => (kt === null ? "Tropical cyclone" : kt >= 64 ? word : "Tropical storm");
  if (lat < 0) return { basin: lon > 135 || lon < -120 ? "South Pacific" : "South Indian Ocean", title: kt === null ? "Tropical cyclone" : "Severe tropical cyclone" };
  if (lon >= 100) return { basin: "West Pacific", title: kt !== null && kt >= 130 ? "Super typhoon" : strong("Typhoon") };
  if (lon >= 40) return { basin: "North Indian Ocean", title: strong("Cyclone") };
  if (lon < -140) return { basin: "Central Pacific", title: strong("Hurricane") };
  if (lon >= -82 || (lon > -100 && lat > 17)) return { basin: "Atlantic", title: strong("Hurricane") };
  return { basin: "East Pacific", title: strong("Hurricane") };
}

function fillCard(meta: Meta, st: Storm) {
  const frame = frameDate(meta);
  const ns = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? p : n}`;
  const nm = naming(st), dv = st.eyeDiameterKm ? dvorak(st.eyeK, st.ringK) : null;
  $("card-eyebrow").textContent = `${nm.basin} · from satellite only`;
  $("card-title").textContent = nm.title;
  html("fix", `${ns(st.eye.lat, "N", "S")} ${ns(st.eye.lon, "E", "W")}<br><small>from IR, ${hhmm(frame)} ${dayStr(frame)}</small>`);
  html("motion", `${compass(st.motion.bearing)} at ≈ ${Math.round(st.motion.kt)} kt<br><small>from ${st.motion.hours} h of fixes</small>`);
  $("eyed").textContent = st.eyeDiameterKm ? `${st.eyeDiameterKm} km wide · ${degC(st.eyeK)}` : "Not clear in this frame";
  $("tops").textContent = `${degC(st.ringK)} · ≈ ${topKm(st.ringK).toFixed(0)} km`;
  $("cdo").textContent = `≈ ${st.cdoRadiusKm} km radius below −63 °C`;
  const tr = st.track, span = tr.length > 1 ? Math.round((Date.parse(tr[tr.length - 1][0]) - Date.parse(tr[0][0])) / 36e5) : 0;
  $("trackinfo").textContent = `${span} h of fixes from ${st.satellite}, every 3 h`;
  $("peek").textContent = `${dv ? `≈ ${dv.kt} kt (unofficial)` : "no clear eye"} · ${compass(st.motion.bearing)} at ${Math.round(st.motion.kt)} kt`;
  html("vmax", dv ? `≈ ${dv.kt} kt (T${dv.t.toFixed(1)})<br><small>rough Dvorak-style IR estimate, not official</small>`
    : "No estimate<br><small>the IR method used here needs a clear eye</small>");
}

export function bindControls(globe: Globe, meta: Meta) {
  const frame = frameDate(meta);
  const storms = meta.storms;
  let st = storms[0], sel = 0;
  const hints = () => [
    `Infrared at 10.4 µm from three geostationary satellites, stitched at ${hhmm(frame)} ${dayStr(frame)}. Colder tops are higher.`,
    `The real 2 km ${st.satellite} frame, lifted by the height its temperature implies (≈ 6.3 K per km). Drag to orbit the storm; scroll out to spin the globe.`,
    "Volumetric cloud built from the same frame. Tracers show the modelled wind: inflow near the sea, outflow aloft. Turn on Cutaway for wind speed.",
  ];
  const press = (attr: string, v: string) =>
    document.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === v)));

  let mode: Mode = 0;
  const setMode = (m: Mode) => {
    mode = m;
    press("mode", String(m));
    globe.setMode(m);
    $("exagwrap").hidden = m === 0;
    $("cutwrap").hidden = m !== 2;
    $("modehint").textContent = hints()[m];
  };
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(Number(b.dataset.mode) as Mode)));
  // imagery style, with a legend to match
  const RAMPS: Record<Style, { ramp: string; ticks: string[]; hint: () => string }> = {
    0: { ramp: "linear-gradient(90deg, #3a3f46, #e9ecef)", ticks: ["warm, low", "cold, high"],
      hint: () => st.visible ? `True colour from ${st.satellite}'s visible channels (1 km) around the storm. Elsewhere, and at night, infrared in grey.`
        : "No daylight picture of this storm in this frame, so it shows infrared in grey." },
    1: { ramp: "linear-gradient(90deg, #2a2a2a 0%, #d9d9d9 30%, #1a44f2 38%, #08a6d9 48%, #1bb320 58%, #f2cc0d 67%, #f25a05 76%, #b30d05 85%, #4d0202 100%)",
      ticks: ["+20", "−33", "−43", "−53", "−63", "−73 °C"], hint: () => "Infrared coloured by cloud-top temperature. Red and deep red are the tallest, strongest thunderstorms." },
    2: { ramp: "linear-gradient(90deg, #08184f, #e6edf8 45%, #6b7078)", ticks: ["sea", "low cloud", "cold core"],
      hint: () => "Infrared clouds over a blue sea. The tall, cold core shows soft grey; thinner and lower cloud is bright." },
  };
  let style: Style = storms.some((s) => s.visible) ? 0 : 1;
  const setStyle = (s: Style) => {
    style = s; globe.setStyle(s); press("style", String(s));
    const r = RAMPS[s];
    $("ramp").style.background = r.ramp;
    html("ticks", r.ticks.map((t) => `<span>${t}</span>`).join(""));
    $("legend-title").textContent = s === 0 ? "Visible imagery" : s === 1 ? "Cloud-top temperature" : "Infrared over blue sea";
    $("stylehint").textContent = r.hint();
  };
  document.querySelectorAll<HTMLElement>("[data-style]").forEach((b) => b.addEventListener("click", () => setStyle(Number(b.dataset.style) as Style)));
  // local solar time at the storm, so it's clear why the real sun can look like the studio light
  const sunHint = () => {
    const h = (((12 + (st.eye.lon - subsolar(frame).lon) / 15) % 24) + 24) % 24;
    const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
    return `Real sun: lit as at ${hhmm(frame)}. It's about ${pad(h)}:${pad((h % 1) * 60)} local solar time at the storm, ${
      h >= 6 && h < 18 ? "so the storm is in daylight" : "so the storm is in darkness (infrared still sees it)"}.`;
  };
  let realSun = false;
  document.querySelectorAll<HTMLElement>("[data-light]").forEach((b) => b.addEventListener("click", () => {
    realSun = b.dataset.light === "1";
    globe.setRealSun(realSun); press("light", b.dataset.light!);
    $("sunhint").hidden = !realSun; $("sunhint").textContent = sunHint();
  }));
  const exag = $<HTMLInputElement>("exag");
  exag.addEventListener("input", () => { globe.setHeight(Number(exag.value)); $("exagv").textContent = exag.value; });
  const track = $("track");
  track.addEventListener("click", () => { const on = track.getAttribute("aria-pressed") !== "true"; globe.setTrack(on); track.setAttribute("aria-pressed", String(on)); });
  const cut = $("cut");
  cut.addEventListener("click", () => { const on = cut.getAttribute("aria-pressed") !== "true"; globe.setCutaway(on); cut.setAttribute("aria-pressed", String(on)); });

  // 3-hour loop at 10-minute steps; paused shows the latest frame at full resolution
  let playing = false, loopT = st.loopFrames - 1;
  const playBtn = $("play"), playIcon = document.getElementById("playicon")!, timeEl = $("time");
  const setPlaying = (on: boolean) => {
    playing = on;
    playIcon.setAttribute("d", playing ? "M6 4.5h4v15H6zM14 4.5h4v15h-4z" : "M7 4.5v15l12-7.5z");
    playBtn.setAttribute("aria-label", playing ? "Pause the loop" : "Play the 3-hour loop");
    if (!playing) loopT = st.loopFrames - 1;
  };
  playBtn.addEventListener("click", () => setPlaying(!playing));

  // place labels on the globe view; storm labels are buttons that select the storm
  const root = $("labels");
  type Label = { el: HTMLElement; p: THREE.Vector3; dx: number; dy: number };
  const labels: Label[] = CITIES.map(([n, la, lo]) => ({
    el: root.appendChild(Object.assign(document.createElement("div"), { className: "label", textContent: n })), p: ll2v(la, lo, 1.004), dx: 8, dy: -6,
  }));
  const stormLabels = storms.map((s, i) => {
    const el = Object.assign(document.createElement("button"), { type: "button", className: "label storm", textContent: storms.length > 1 ? `${i + 1} · ${naming(s).title}` : `EYE · ${hhmm(frame)}` });
    el.addEventListener("click", () => select(i));
    root.appendChild(el);
    const l = { el, p: ll2v(s.eye.lat, s.eye.lon, 1.02), dx: 34, dy: -34 };
    labels.push(l);
    return el;
  });

  // the picker: one button per storm, shown when there is more than one
  const pick = $("stormpick");
  pick.hidden = storms.length < 2;
  storms.forEach((s, i) => {
    const dv = s.eyeDiameterKm ? dvorak(s.eyeK, s.ringK) : null;
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: `${i + 1} · ${dv ? `≈${dv.kt} kt` : "no eye"}` });
    b.dataset.storm = String(i);
    b.title = `${naming(s).title}, ${naming(s).basin}`;
    b.addEventListener("click", () => select(i));
    pick.appendChild(b);
  });

  function select(i: number) {
    sel = i; st = storms[i];
    press("storm", String(i));
    stormLabels.forEach((el, j) => el.classList.toggle("on", j === i));
    fillCard(meta, st);
    globe.selectStorm(i);
    setPlaying(false);
    $("play").hidden = st.loopFrames < 2;
    $("modehint").textContent = hints()[mode];
    $("sunhint").textContent = sunHint();
    $("stylehint").textContent = RAMPS[style].hint();
  }

  const canvas = $("gl"), tmp = new THREE.Vector3(), toCam = new THREE.Vector3();
  let shown = "";
  globe.onFrame((m, dt) => {
    const n = st.loopFrames;
    if (playing) loopT = (loopT + dt * 3.0) % n;
    globe.setLoop(playing ? loopT : null);
    const idx = Math.min(Math.round(loopT), n - 1);
    const key = `${sel}:${idx}:${playing}`;
    if (key !== shown) {
      shown = key;
      const iso = st.loopTimes?.[idx];
      const t = iso ? new Date(iso.replace("Z", ":00Z")) : new Date(frame.getTime() - (n - 1 - idx) * 600000);
      timeEl.innerHTML = `<b>${hhmm(t)}</b> · ${dayStr(t)}${playing ? " · loop" : ""}`;
    }
    const w = canvas.clientWidth, h = canvas.clientHeight, cam = globe.camera;
    for (const l of labels) {
      const facing = toCam.copy(cam.position).sub(l.p).normalize().dot(tmp.copy(l.p).normalize());
      tmp.copy(l.p).project(cam);
      const show = m === 0 && facing > 0.15 && tmp.z < 1;
      l.el.style.display = show ? "block" : "none";
      if (show) l.el.style.transform = `translate(${((tmp.x + 1) / 2) * w + l.dx}px, ${((1 - tmp.y) / 2) * h + l.dy}px)`;
    }
  });

  // the card and the legend fold to their title on any screen; on phones the card starts folded so the globe stays visible
  const foldable = (panel: string, button: string, what: string, folded: boolean) => {
    const el = document.querySelector<HTMLElement>(panel)!, toggle = $(button);
    const fold = (f: boolean) => {
      el.dataset.collapsed = String(f);
      toggle.setAttribute("aria-expanded", String(!f));
      toggle.setAttribute("aria-label", `${f ? "Show" : "Hide"} ${what}`);
    };
    fold(folded);
    toggle.addEventListener("click", () => fold(el.dataset.collapsed !== "true"));
  };
  foldable(".card", "cardtoggle", "storm details", matchMedia("(max-width: 900px)").matches);
  foldable(".legend", "legendtoggle", "legend", false);

  fillCard(meta, st);
  press("storm", "0");
  stormLabels[0]?.classList.add("on");
  $("play").hidden = st.loopFrames < 2;
  setMode(0);
  setStyle(style);
}
