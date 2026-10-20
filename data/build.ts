import type { Dataset } from "../src/data";
import { sampleDataset } from "./sample";

/**
 * Builds the dataset the site ships. `vite build` calls this once and writes the result to dist/data.json;
 * the dev server calls it on every request to /data.json.
 *
 * Replace the body with your own loader: fetch an API, read a CSV or JSON file, query a database.
 * Return a Dataset (see src/data.ts). If it throws, the build fails and your last good deploy stays live.
 *
 *   export async function buildDataset(): Promise<Dataset> {
 *     const res = await fetch("https://example.com/api/places.json");
 *     if (!res.ok) throw new Error(`upstream failed: ${res.status}`);
 *     return toDataset(await res.json());
 *   }
 */
export async function buildDataset(): Promise<Dataset> {
  return sampleDataset(new Date());
}
