/**
 * Synthesized UI cues: terminal blips and a soft HUD chirp. No audio files are loaded.
 * Off by default; the choice is remembered in this browser under `<app id>:sound`.
 * Call initSound(id) once at start-up.
 */

let key = "app:sound";
let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let enabled = false;

/** Names the storage key and restores the saved on/off choice. */
export function initSound(appId: string) {
  key = `${appId}:sound`;
  enabled = read();
}

function read(): boolean {
  try {
    return localStorage.getItem(key) === "on";
  } catch {
    return false;
  }
}

export function soundOn(): boolean {
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Storage can be blocked; the toggle still works for this visit.
  }
  if (on) play((ac, t) => blips(ac, t, [660, 990, 1320], 0.06));
}

/** Runs a cue only when sound is on, resuming the context first if the browser paused it. */
function play(cue: (ac: AudioContext, t: number) => void) {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
  } catch {
    return;
  }
  const ac = ctx;
  if (ac.state === "suspended") void ac.resume().then(() => cue(ac, ac.currentTime));
  else cue(ac, ac.currentTime);
}

function tone(ac: AudioContext, t: number, freq: number, type: OscillatorType, dur: number, amp: number, bend = 1) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * bend), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(amp, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A terminal blip: short sine notes in a row. */
function blips(ac: AudioContext, t: number, notes: number[], amp = 0.08, gap = 0.07) {
  notes.forEach((hz, i) => tone(ac, t + i * gap, hz, "sine", 0.09, amp));
}

function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
  const n = Math.floor(ac.sampleRate * 0.14);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  noiseBuf = buf;
  return buf;
}

/**
 * A card opens: a quiet, low-passed hiss sweeps down under three rounded chirps,
 * so it reads as "panel opened" without a harsh edge.
 */
export function cueOpen() {
  play((ac, t) => {
    const src = ac.createBufferSource();
    src.buffer = noise(ac);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    lp.Q.value = 0.8;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.018, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(lp).connect(ng).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.14);
    tone(ac, t, 1320, "sine", 0.07, 0.035, 1.25);
    tone(ac, t + 0.045, 880, "triangle", 0.08, 0.025, 0.8);
    tone(ac, t + 0.095, 1760, "sine", 0.09, 0.02, 1.1);
  });
}

/** Choosing a node: a soft sonar ping with a fainter echo, like a signal found far away. */
export function cuePing() {
  play((ac, t) => {
    tone(ac, t, 1040, "sine", 0.28, 0.05, 0.94);
    tone(ac, t + 0.004, 1046, "sine", 0.28, 0.025, 0.94);
    tone(ac, t + 0.16, 1040, "sine", 0.22, 0.018, 0.94);
    tone(ac, t + 0.3, 1040, "sine", 0.18, 0.008, 0.94);
  });
}

/** Choosing an item: a rising two-note confirm. */
export function cueSelect() {
  play((ac, t) => blips(ac, t, [620, 980]));
}

/** A node pops in as its arc lands; each one a little higher, kept very quiet. */
export function cueLand(index: number) {
  play((ac, t) => tone(ac, t, 1100 * Math.pow(1.06, Math.min(index, 12)), "sine", 0.06, 0.025));
}

/** Opening a cluster badge: a low three-note pad tone. */
export function cueCluster() {
  play((ac, t) => blips(ac, t, [320, 480, 320], 0.07, 0.06));
}

/** Clearing the selection: a falling pair. */
export function cueClear() {
  play((ac, t) => blips(ac, t, [520, 300], 0.06, 0.06));
}

/** Panel toggles and filter switches: a single soft tick. */
export function cueTick() {
  play((ac, t) => tone(ac, t, 1500, "sine", 0.04, 0.03));
}
