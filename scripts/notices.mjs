// Regenerates public/third-party-notices.txt from the licence files of the libraries the site bundles.
// Run it after adding or upgrading a dependency that ships in the page:  npm run notices
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const app = JSON.parse(readFileSync("package.json", "utf8"));
const rule = "=".repeat(72);

// [package, what it is used for]. Add a line here when you bundle another library.
const bundled = [
  ["three", "3D globe, post-processing and storm rendering"],
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
`,
];
for (const [name, use] of bundled) {
  const l = licence(name);
  parts.push(`${rule}\n${name} ${l.version}\nLicense: ${l.license} · Used for: ${use}\n${rule}\n\n${l.text}\n`);
}
parts.push(
  `${rule}\nthree-globe 2.45.6 example textures (public/textures)\nLicense: MIT · Used for: Earth day, night, water, topography and star-field textures\n${rule}\n\n` +
    "The day texture is NASA Blue Marble and the night texture is NASA Black Marble (both public domain).\n\n" +
    readFileSync("public/textures/LICENSE-three-globe.txt", "utf8").trim() + "\n",
  `${rule}\nNOAA open data (public/data)\nSource: NOAA Open Data Dissemination on AWS (GOES-18, GOES-19, Himawari-9) · License: public domain\n${rule}\n\nSatellite imagery from NOAA's GOES-R series and from JMA's Himawari-9, redistributed by NOAA.\nThis credit is given as a courtesy.\n`,
);
writeFileSync("public/third-party-notices.txt", parts.join("\n"));
console.log(`public/third-party-notices.txt: ${bundled.length} libraries + textures + NOAA data`);
