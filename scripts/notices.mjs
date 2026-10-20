// Regenerates public/third-party-notices.txt from the licence files of the libraries the site bundles.
// Run it after adding or upgrading a dependency that ships in the page:  npm run notices
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const app = JSON.parse(readFileSync("package.json", "utf8"));
const rule = "=".repeat(72);

// [package, what it is used for]. Add a line here when you bundle another library.
const bundled = [
  ["three", "3D globe and sky rendering"],
  ["d3-geo", "map projection for the globe texture"],
  ["d3-array", "used by d3-geo"],
  ["topojson-client", "decoding the country outlines"],
  ["world-atlas", "country outlines, derived from Natural Earth (public domain)"],
  ["@fontsource/ibm-plex-mono", "IBM Plex Mono font files"],
];

function licence(name) {
  const dir = `node_modules/${name}`;
  const file = readdirSync(dir).find((entry) => /^licen[cs]e/i.test(entry));
  if (!file) throw new Error(`no licence file found for ${name}`);
  const meta = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  return { version: meta.version, license: meta.license, text: readFileSync(`${dir}/${file}`, "utf8").replace(/\r\n/g, "\n").trim() };
}

const parts = [
  `Third-party notices for ${app.name}

${app.name} (${app.license}) bundles or redistributes the works below.
Each is used under its own licence, reproduced here as that licence requires.
If you replace the sample data with data from a source that has its own licence, add its notice here too.
`,
];
for (const [name, use] of bundled) {
  const l = licence(name);
  parts.push(`${rule}\n${name} ${l.version}\nLicense: ${l.license} · Used for: ${use}\n${rule}\n\n${l.text}\n`);
}
parts.push(
  `${rule}\nNatural Earth\nSource: https://www.naturalearthdata.com · License: public domain\n${rule}\n\nMap data from Natural Earth. Free vector and raster map data @ naturalearthdata.com.\nNatural Earth is in the public domain; this credit is given as a courtesy.\n`,
);
writeFileSync("public/third-party-notices.txt", parts.join("\n"));
console.log(`public/third-party-notices.txt: ${bundled.length} libraries + Natural Earth`);
