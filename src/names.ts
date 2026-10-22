// What a storm is called on the page: the warning centre's name and word for it, or "Unnamed system" when no centre has
// a warning out for it (the IR fallback). Never a guessed name.

export const stormTitle = (s: { name?: string; kind?: string }) => (s.name ? `${s.kind ?? "Tropical cyclone"} ${s.name}` : "Unnamed system");

export function stormSub(s: { agencyId?: string; windKt?: number | null; agency?: string }) {
  if (!s.agency) return "from satellite only";
  return [s.agencyId, s.windKt != null ? `${s.windKt} kt` : null, s.agency].filter(Boolean).join(" · ");
}
