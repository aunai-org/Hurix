// The stylesheet is linked from index.html so it applies before the first paint.
import { loadMeta } from "./meta";
import { createGlobe } from "./hdr/scene";
import { bindControls, fillCard } from "./ui";

async function start() {
  const base = import.meta.env.BASE_URL;
  const loading = document.getElementById("loading")!;
  const prog = document.getElementById("prog") as HTMLProgressElement;
  try {
    const meta = await loadMeta(base);
    fillCard(meta);
    const globe = createGlobe(document.getElementById("gl") as HTMLCanvasElement, meta, base, (f) => (prog.value = f), () => {
      loading.style.opacity = "0";
      setTimeout(() => (loading.hidden = true), 900);
    });
    bindControls(globe, meta);
  } catch (err) {
    document.getElementById("loading-msg")!.textContent = `Couldn't load the satellite frame: ${(err as Error).message}`;
    prog.hidden = true;
    throw err;
  }
}

start();
