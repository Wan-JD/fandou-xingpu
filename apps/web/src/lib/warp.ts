// Star-warp page transition: the clicked star swells until its light fills the screen,
// the route changes behind the glare, then the glare dissolves into the new page.
import type { Tone } from "./people";

const toneRgb: Record<Tone, string> = { gold: "231 201 130", aqua: "142 217 208", fog: "145 177 210" };
let active = false;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function warpTo(origin: DOMRect | null, tone: Tone, go: () => void | Promise<void>) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (active || reduced || !origin || typeof document.body.animate !== "function") {
    await go();
    return;
  }
  active = true;
  const x = origin.left + origin.width / 2;
  const y = origin.top + origin.height / 2;
  const start = Math.max(8, Math.min(origin.width, origin.height) / 2);
  const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) * 1.08;

  const layer = document.createElement("div");
  layer.className = "warp-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.style.setProperty("--warp-x", `${x}px`);
  layer.style.setProperty("--warp-y", `${y}px`);
  layer.style.setProperty("--warp-tone", toneRgb[tone]);
  layer.innerHTML = '<div class="warp-bloom"></div><div class="warp-streaks"></div><div class="warp-flare"></div>';
  document.body.appendChild(layer);
  const bloom = layer.querySelector<HTMLElement>(".warp-bloom")!;
  const streaks = layer.querySelector<HTMLElement>(".warp-streaks")!;
  const flare = layer.querySelector<HTMLElement>(".warp-flare")!;
  const circle = (radius: number) => `circle(${radius.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px)`;

  try {
    const grow = bloom.animate([
      { clipPath: circle(start), filter: "brightness(1)" },
      { clipPath: circle(start * 2.4), filter: "brightness(1.8)", offset: 0.28 },
      { clipPath: circle(end), filter: "brightness(1.15)" },
    ], { duration: 820, easing: "cubic-bezier(.7, 0, .25, 1)", fill: "forwards" });
    streaks.animate([
      { opacity: 0, transform: "scale(.2) rotate(0deg)" },
      { opacity: 0.75, transform: "scale(1) rotate(8deg)", offset: 0.5 },
      { opacity: 0, transform: "scale(2.6) rotate(14deg)" },
    ], { duration: 820, easing: "cubic-bezier(.5, 0, .3, 1)", fill: "forwards" });
    flare.animate([
      { opacity: 0, transform: "translate(-50%, -50%) scale(.3)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1.4)", offset: 0.4 },
      { opacity: 0, transform: "translate(-50%, -50%) scale(4)" },
    ], { duration: 820, easing: "ease-out", fill: "forwards" });
    await grow.finished;
    await go();
    window.scrollTo({ top: 0 });
    await frame();
    await frame();
    await layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 560, easing: "ease-out", fill: "forwards" }).finished;
  } finally {
    layer.remove();
    active = false;
  }
}
