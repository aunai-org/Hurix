import type { Dataset, HubRow, ItemRow, LinkRow, NodeRow } from "../src/data";

/**
 * Sample data: fictional film studios (hubs), their releases (items), and the festivals that screened them (nodes).
 * Names are made up; the places are real cities, used only as map positions.
 * Dates are relative to the build date, so the demo always has fresh releases to pulse and list.
 * It is deterministic: the same day always builds the same dataset.
 */

const hubs: HubRow[] = [
  { id: "northlight", name: "Northlight Studio", place: "Oslo, Norway", lat: 59.91, lng: 10.75 },
  { id: "kestrel", name: "Kestrel Pictures", place: "Los Angeles, USA", lat: 34.05, lng: -118.24 },
  { id: "bluebird", name: "Bluebird Films", place: "Los Angeles, USA", lat: 34.1, lng: -118.3 },
  { id: "copperline", name: "Copperline", place: "Los Angeles, USA", lat: 34.02, lng: -118.4 },
  { id: "marlowe", name: "Marlowe & Vane", place: "London, UK", lat: 51.51, lng: -0.13 },
  { id: "ironbridge", name: "Ironbridge Media", place: "London, UK", lat: 51.52, lng: -0.1 },
  { id: "sakura", name: "Sakura Reel", place: "Tokyo, Japan", lat: 35.68, lng: 139.76 },
  { id: "duna", name: "Duna Studio", place: "Budapest, Hungary", lat: 47.5, lng: 19.04 },
  { id: "pasofino", name: "Paso Fino Cine", place: "Mexico City, Mexico", lat: 19.43, lng: -99.13 },
  { id: "aurora", name: "Aurora Works", place: "Reykjavik, Iceland", lat: 64.15, lng: -21.94 },
  { id: "baobab", name: "Baobab Films", place: "Lagos, Nigeria", lat: 6.52, lng: 3.38 },
  { id: "monsoon", name: "Monsoon Arts", place: "Mumbai, India", lat: 19.08, lng: 72.88 },
  { id: "outback", name: "Outback Pictures", place: "Sydney, Australia", lat: -33.87, lng: 151.21 },
  { id: "tango", name: "Tango Frame", place: "Buenos Aires, Argentina", lat: -34.6, lng: -58.38 },
  // A hub with no coordinates: it is listed and searchable but has no pin, and its card says "No pin".
  { id: "nomad", name: "Nomad Collective", facts: [["Base", "Remote"]] },
];

const nodes: NodeRow[] = [
  { id: "harbor", name: "Harbor Lights Festival", place: "Lisbon, Portugal", lat: 38.72, lng: -9.14 },
  { id: "northern", name: "Northern Frames", place: "Tromsø, Norway", lat: 69.65, lng: 18.96 },
  { id: "riviera", name: "Riviera Nights", place: "Nice, France", lat: 43.7, lng: 7.27 },
  { id: "lagoon", name: "Lagoon Screens", place: "Venice, Italy", lat: 45.44, lng: 12.33 },
  { id: "lakeside", name: "Lakeside Premieres", place: "Toronto, Canada", lat: 43.65, lng: -79.38 },
  { id: "highdesert", name: "High Desert Cinema", place: "Park City, USA", lat: 40.65, lng: -111.5 },
  { id: "pacific", name: "Pacific Rim Reels", place: "Busan, South Korea", lat: 35.18, lng: 129.08 },
  { id: "canal", name: "Canal Cuts", place: "Amsterdam, Netherlands", lat: 52.37, lng: 4.9 },
  { id: "southern", name: "Southern Cross Screenings", place: "Melbourne, Australia", lat: -37.81, lng: 144.96 },
  { id: "highland", name: "Highland Shorts", place: "Edinburgh, UK", lat: 55.95, lng: -3.19 },
  { id: "jacaranda", name: "Jacaranda Cinema Week", place: "Johannesburg, South Africa", lat: -26.2, lng: 28.05 },
  { id: "monsoonlens", name: "Monsoon Lens", place: "Kolkata, India", lat: 22.57, lng: 88.36 },
  { id: "andes", name: "Andes Frames", place: "Bogotá, Colombia", lat: 4.71, lng: -74.07 },
  { id: "bosphorus", name: "Bosphorus Nights", place: "Istanbul, Türkiye", lat: 41.01, lng: 28.98 },
  { id: "empire", name: "Empire State Screenings", place: "New York, USA", lat: 40.71, lng: -74.01 },
  { id: "kyoto", name: "Sakura Circuit", place: "Kyoto, Japan", lat: 35.01, lng: 135.77 },
].map((row, i) => ({ ...row, facts: [["Season", ["Spring", "Summer", "Autumn", "Winter"][i % 4]]] }) as NodeRow);

const ADJECTIVES = ["Quiet", "Golden", "Last", "Paper", "Midnight", "Silent", "Broken", "Northern", "Electric", "Hollow", "Restless", "Winter"];
const NOUNS = ["Harbor", "Orchard", "Signal", "Garden", "Line", "Season", "Letters", "Engine", "Mirror", "Tide", "Archive", "Bridge"];
const GENRES = ["Drama", "Documentary", "Thriller", "Comedy", "Animation", "Sci-fi", "Romance"];
const RATINGS = ["G", "PG", "PG-13", "R"];

/** Small seeded generator (mulberry32), so the sample is stable from run to run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Days back from today: a few releases in the last week, a few more in the last fortnight, the rest older. */
const DAYS_AGO = [0, 1, 3, 6, 10, 18, 27, 41, 60, 88, 125, 175, 240, 330, 450, 600];

function isoDay(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

export function sampleDataset(now = new Date()): Dataset {
  const rand = seeded(20260929);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const items: ItemRow[] = [];
  const links: LinkRow[] = [];
  let n = 0;
  hubs.forEach((hub, h) => {
    const count = hub.id === "nomad" ? 2 : 3 + (h % 4);
    for (let i = 0; i < count; i++, n++) {
      const id = `${hub.id}-${i + 1}`;
      items.push({
        id,
        hub: hub.id,
        name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
        date: isoDay(now, DAYS_AGO[(n * 5 + h) % DAYS_AGO.length]),
        facts: [
          ["Genre", pick(GENRES)],
          ["Runtime", `${85 + Math.floor(rand() * 60)} min`],
          ["Rating", pick(RATINGS)],
          ["Festival cut", rand() > 0.5 ? "Yes" : "No"],
        ],
      });
      // Each release "screened at" two to four festivals. Picked at random: the arcs are a demo, not real screenings.
      const chosen = new Set<string>();
      const target = 2 + Math.floor(rand() * 3);
      while (chosen.size < target) chosen.add(pick(nodes).id);
      for (const node of chosen) links.push({ item: id, node });
    }
  });
  return { updatedAt: now.toISOString(), hubs, items, nodes, links };
}
