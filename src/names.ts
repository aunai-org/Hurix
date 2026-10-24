// What a storm is called on the page: the warning centre's name and word for it, or "Unnamed system" when no centre has
// a warning out for it (the IR fallback). Never a guessed name.

export const stormTitle = (s: { name?: string; kind?: string }) => (s.name ? `${s.kind ?? "Tropical cyclone"} ${s.name}` : "Unnamed system");

// EUMETSAT's licence asks for its credit wherever Meteosat imagery shows.
export const satCredit = (sat: string) => (sat.startsWith("Meteosat") ? " · © EUMETSAT" : "");

// The daylight picture of a Meteosat-9 storm west of about 60° E is Meteosat-12's true colour.
export const visSatellite = (s: { satellite: string; visSatellite?: string }) => s.visSatellite ?? s.satellite;

export const NATURAL_HINT = "Natural colour from Meteosat-9: a false-colour mix, land green and ice clouds cyan";

export function stormSub(s: { agencyId?: string; windKt?: number | null; agency?: string }) {
  if (!s.agency) return "from satellite only";
  return [s.agencyId, s.windKt != null ? `${s.windKt} kt` : null, s.agency].filter(Boolean).join(" · ");
}
