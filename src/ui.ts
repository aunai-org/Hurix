// The card, the legend, the control bar and the place labels. Everything shown is measured from the frame in meta.json.
import * as THREE from "three";
import { dayStr, degC, dvorak, frameDate, hhmm, topKm, type Meta } from "./meta";
import { ll2v, type Globe, type Mode } from "./hdr/scene";

const CITIES: [string, number, number][] = [
  ["Manila", 14.6, 121.0], ["Guam", 13.44, 144.79], ["Tokyo", 35.68, 139.69], ["Taipei", 25.03, 121.56],
  ["Naha", 26.21, 127.68], ["Palau", 7.5, 134.6], ["Hong Kong", 22.3, 114.17],
];
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const html = (id: string, s: string) => { $(id).innerHTML = s; };

export function fillCard(meta: Meta) {
  const frame = frameDate(meta);
  const ns = (v: number, p: string, n: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? p : n}`;
  const dv = dvorak(meta.eyeK, meta.ringK);
  // JTWC's wording for the West Pacific, the basin Himawari-9 watches
  $("card-title").textContent = `${dv.kt >= 130 ? "Super typhoon" : dv.kt >= 64 ? "Typhoon" : "Tropical storm"} in the West Pacific`;
  html("fix", `${ns(meta.eye.lat, "N", "S")} ${ns(meta.eye.lon, "E", "W")}<br><small>from IR, ${hhmm(frame)} ${dayStr(frame)}</small>`);
  html("motion", `${POINTS[Math.round(meta.motion.bearing / 22.5) % 16]} at ≈ ${Math.round(meta.motion.kt)} kt<br><small>from ${meta.motion.hours} h of eye fixes</small>`);
  $("eyed").textContent = meta.eyeDiameterKm ? `${meta.eyeDiameterKm} km wide · ${degC(meta.eyeK)}` : "Not clear in this frame";
  $("tops").textContent = `${degC(meta.ringK)} · ≈ ${topKm(meta.ringK).toFixed(0)} km`;
  $("cdo").textContent = `≈ ${meta.cdoRadiusKm} km radius below −63 °C`;
  const tr = meta.track, span = tr.length > 1 ? Math.round((Date.parse(tr[tr.length - 1][0]) - Date.parse(tr[0][0])) / 36e5) : 0;
  $("trackinfo").textContent = `${span} h of fixes from Himawari-9, every 3 h`;
  html("vmax", `≈ ${dv.kt} kt (T${dv.t.toFixed(1)})<br><small>rough Dvorak-style IR estimate, not official</small>`);
}

export function bindControls(globe: Globe, meta: Meta) {
  const frame = frameDate(meta);
  const loopN = meta.loopFrames;
  const hints = [
    `Infrared at 10.4 µm from three geostationary satellites, stitched at ${hhmm(frame)} ${dayStr(frame)}. Colder tops are higher.`,
    "The real 2 km Himawari frame, lifted by the height its temperature implies (≈ 6.3 K per km). Drag to orbit, scroll to zoom.",
    "Volumetric cloud built from the same frame. Tracers show the modelled wind: inflow near the sea, outflow aloft. Turn on Cutaway for wind speed.",
  ];
  const press = (attr: string, v: string) =>
    document.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === v)));

  const setMode = (m: Mode) => {
    press("mode", String(m));
    globe.setMode(m);
    $("exagwrap").hidden = m === 0;
    $("cutwrap").hidden = m !== 2;
    $("modehint").textContent = hints[m];
  };
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(Number(b.dataset.mode) as Mode)));
  document.querySelectorAll<HTMLElement>("[data-pal]").forEach((b) => b.addEventListener("click", () => { globe.setPalette(b.dataset.pal === "1"); press("pal", b.dataset.pal!); }));
  document.querySelectorAll<HTMLElement>("[data-light]").forEach((b) => b.addEventListener("click", () => { globe.setRealSun(b.dataset.light === "1"); press("light", b.dataset.light!); }));
  const exag = $<HTMLInputElement>("exag");
  exag.addEventListener("input", () => { globe.setHeight(Number(exag.value)); $("exagv").textContent = exag.value; });
  const cut = $("cut");
  cut.addEventListener("click", () => { const on = cut.getAttribute("aria-pressed") !== "true"; globe.setCutaway(on); cut.setAttribute("aria-pressed", String(on)); });

  // 3-hour loop at 10-minute steps; paused shows the latest frame at full resolution
  let playing = false, loopT = loopN - 1;
  const playBtn = $("play"), playIcon = document.getElementById("playicon")!, timeEl = $("time");
  $("play").hidden = loopN < 2;
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playIcon.setAttribute("d", playing ? "M6 4.5h4v15H6zM14 4.5h4v15h-4z" : "M7 4.5v15l12-7.5z");
    playBtn.setAttribute("aria-label", playing ? "Pause the loop" : "Play the 3-hour loop");
    if (!playing) loopT = loopN - 1;
  });

  // place labels, shown on the globe view only
  const root = $("labels");
  const labels = CITIES.map(([n, la, lo]) => ({ text: n, cls: "label", p: ll2v(la, lo, 1.004), dx: 8, dy: -6 }));
  labels.push({ text: `EYE · ${hhmm(frame)}`, cls: "label storm", p: ll2v(meta.eye.lat, meta.eye.lon, 1.02), dx: 34, dy: -34 });
  const els = labels.map((l) => root.appendChild(Object.assign(document.createElement("div"), { className: l.cls, textContent: l.text })));
  const canvas = $("gl"), tmp = new THREE.Vector3(), toCam = new THREE.Vector3();

  let shownIdx = -1, shownPlaying = !playing;
  globe.onFrame((mode, dt) => {
    if (playing) loopT = (loopT + dt * 3.0) % loopN;
    globe.setLoop(playing ? loopT : null);
    const shown = Math.min(Math.round(loopT), loopN - 1);
    if (shown !== shownIdx || playing !== shownPlaying) {
      shownIdx = shown; shownPlaying = playing;
      const iso = meta.loopTimes?.[shown];
      const t = iso ? new Date(iso.replace("Z", ":00Z")) : new Date(frame.getTime() - (loopN - 1 - shown) * 600000);
      timeEl.innerHTML = `<b>${hhmm(t)}</b> · ${dayStr(t)}${playing ? " · loop" : ""}`;
    }
    const w = canvas.clientWidth, h = canvas.clientHeight, cam = globe.camera;
    labels.forEach((l, i) => {
      const facing = toCam.copy(cam.position).sub(l.p).normalize().dot(tmp.copy(l.p).normalize());
      tmp.copy(l.p).project(cam);
      const show = mode === 0 && facing > 0.15 && tmp.z < 1;
      els[i].style.display = show ? "block" : "none";
      if (show) els[i].style.transform = `translate(${((tmp.x + 1) / 2) * w + l.dx}px, ${((1 - tmp.y) / 2) * h + l.dy}px)`;
    });
  });

  setMode(0);
}
