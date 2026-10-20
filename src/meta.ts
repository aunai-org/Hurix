// Everything about the frame comes from data/meta.json, written by pipeline/export.py.

/** One storm, as measured from its own 2 km close-up. */
export interface Storm {
  id: string;
  /** The satellite its close-up and track come from. */
  satellite: string;
  loopFrames: number;
  /** Time of each loop frame (older pipelines left this out; the frames were then 10 minutes apart). */
  loopTimes?: string[];
  eye: { lat: number; lon: number };
  /** Warmest pixel in the eye and coldest top in the ring around it, in kelvin. */
  eyeK: number;
  ringK: number;
  eyeDiameterKm: number | null;
  cdoRadiusKm: number;
  motion: { kt: number; bearing: number; hours: number };
  /** [time, lat, lon, eye visible (1) or centre from cloud mass (0)], oldest first. */
  track: [string, number, number, number][];
  /** Folder of its close-up and loop, relative to the site root. */
  dir: string;
}

export interface Meta {
  /** Frame time, "YYYY-MM-DDTHH:MMZ". */
  frame: string;
  /** Strongest first. */
  storms: Storm[];
}

export async function loadMeta(base: string): Promise<Meta> {
  const res = await fetch(`${base}data/meta.json`);
  if (!res.ok) throw new Error(`data/meta.json: HTTP ${res.status}`);
  const raw = await res.json();
  // the first pipeline wrote one storm at the top level, with its files directly in data/
  if (!raw.storms) return { frame: raw.frame, storms: [{ ...raw, id: "s1", satellite: "Himawari-9", dir: "data/" }] };
  return { frame: raw.frame, storms: (raw.storms as Omit<Storm, "dir">[]).map((s) => ({ ...s, dir: `data/storms/${s.id}/` })) };
}

export const frameDate = (meta: Meta) => new Date(meta.frame.replace("Z", ":00Z"));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
export const dayStr = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
export const degC = (k: number) => `${k - 273.15 >= 0 ? "+" : "−"}${Math.abs(k - 273.15).toFixed(1)} °C`;

/** Cloud-top height implied by a brightness temperature (≈ 6.3 K per km), the same rule the shaders use. */
export const topKm = (bt: number) => Math.min(17.5, Math.max(0, (300 - bt) / 6.3));

const KT: Record<string, number> = { "4.0": 65, "4.5": 77, "5.0": 90, "5.5": 102, "6.0": 115, "6.5": 127, "7.0": 140, "7.5": 155 };
/** A rough Dvorak-style read of the eye scene: the coldest ring around the eye, nudged up for a very warm eye. Not official. */
export function dvorak(eyeK: number, ringK: number): { t: number; kt: number } {
  const ring = ringK - 273.15, eye = eyeK - 273.15;
  let t = ring <= -76 ? 6.5 : ring <= -70 ? 6.0 : ring <= -64 ? 5.5 : ring <= -58 ? 5.0 : ring <= -42 ? 4.5 : 4.0;
  if (eye >= 9) t += 0.5;
  return { t, kt: KT[t.toFixed(1)] };
}

/** Real subsolar point at a time (low-precision solar ephemeris, good to a fraction of a degree). */
export function subsolar(date: Date): { lat: number; lon: number } {
  const D2R = Math.PI / 180;
  const d = date.getTime() / 864e5 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, e = (23.439 - 3.6e-7 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / D2R, dec = Math.asin(Math.sin(e) * Math.sin(L)) / D2R;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const lon = ((((ra - gmst * 15) + 540) % 360) + 360) % 360 - 180;
  return { lat: dec, lon };
}
