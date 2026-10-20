// Captures README media from the production build: desktop and phone screenshots, and an animated GIF of arcs drawing out.
//   npm run build && npm run media
// Needs Chrome, Edge or Chromium (set CHROME_PATH if it isn't found) and, for the GIF, ffmpeg on your PATH.
// It drives the app through its own buttons, so it works with whatever data you build; edit the scenes below to suit.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const OUT = "docs/media";
const FRAMES = "node_modules/.cache/media-frames";
const FPS = 15;
const PORT = 9333;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!chromePath) throw new Error("Chrome not found. Set CHROME_PATH to a Chrome, Edge or Chromium executable.");
if (!existsSync("dist/index.html")) throw new Error("dist/ is missing. Run `npm run build` first.");

// A tiny static server for dist/, so nothing else has to be running.
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join("dist", path === "/" || path === "\\" ? "index.html" : path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join("dist", "index.html");
  res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = resolve("node_modules/.cache/media-profile");
rmSync(profile, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const chrome = spawn(
  chromePath,
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--mute-audio", "--no-first-run",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", "about:blank"],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  } catch {}
}
if (!target) throw new Error("Chrome did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let seq = 0;
const pending = new Map();
const waiters = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method && waiters.has(msg.method)) {
    waiters.get(msg.method)(msg.params);
    waiters.delete(msg.method);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (event) => new Promise((resolve) => waiters.set(event, resolve));
const run = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

async function viewport(width, height, mobile = false, scale = 1) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 5 });
}
async function load() {
  await send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    if (await run(`document.querySelector('#app')?.dataset.state === 'ready'`)) break;
  }
  await sleep(2500);
}
async function png(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name), Buffer.from(data, "base64"));
  console.log("saved", join(OUT, name));
}
// The newest item in the Latest list, then (optionally) the link that frames its nodes.
const openNewest = (frameNodes) => run(`(async () => {
  document.querySelector('.latest').open = true;
  await new Promise(r => setTimeout(r, 150));
  document.querySelector('#latest button')?.click();
  await new Promise(r => setTimeout(r, 900));
  ${frameNodes ? "document.querySelector('.fact-link')?.click();" : ""}
})()`);

await send("Page.enable");
await send("Runtime.enable");

// Desktop: an item with its arcs, framed.
await viewport(1280, 800);
await load();
await openNewest(true);
await sleep(2500);
await png("desktop.png");

// Phone: the same, as a bottom sheet.
await viewport(390, 844, true, 2);
await load();
await openNewest(false);
await sleep(2500);
await png("phone.png");

// GIF: the arcs drawing out. Steps Chrome's virtual clock one frame at a time, so the result is smooth on any machine.
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) {
  await viewport(1100, 700);
  await load();
  await run(`document.querySelector('.latest').open = true`);
  await sleep(300);
  const dir = join(FRAMES, "arcs");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Virtual time starts at the real clock, so dates ("2 days ago") stay true while frames step evenly.
  await send("Emulation.setVirtualTimePolicy", { policy: "pause", initialVirtualTime: Date.now() / 1000 });
  const count = 45;
  for (let i = 0; i < count; i++) {
    if (i === 3) await run(`document.querySelector('#latest button')?.click()`);
    const done = once("Emulation.virtualTimeBudgetExpired");
    await send("Emulation.setVirtualTimePolicy", { policy: "pauseIfNetworkFetchesPending", budget: 1000 / FPS });
    await done;
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(dir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
  }
  const filter =
    "tpad=stop_mode=clone:stop_duration=1.2,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"), "-vf", filter, "-loop", "0", join(OUT, "arcs.gif")], { stdio: "inherit" });
  console.log("saved", join(OUT, "arcs.gif"));
} else {
  console.log("ffmpeg not found: skipped the GIF. Install ffmpeg and run again to create docs/media/arcs.gif.");
}

ws.close();
chrome.kill();
server.close();
process.exit(0);
