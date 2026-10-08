// Canvas starfield: layered twinkling stars, meteors, drifting stardust and interactive sparkles.
type Rgb = readonly [number, number, number];

const STAR_PALETTE: readonly { color: Rgb; weight: number }[] = [
  { color: [248, 251, 245], weight: 0.64 },
  { color: [142, 217, 208], weight: 0.14 },
  { color: [231, 201, 130], weight: 0.12 },
  { color: [145, 177, 210], weight: 0.1 },
];

export type SparkTone = "white" | "aqua" | "gold" | "fog";
const TONE_INDEX: Record<SparkTone, number> = { white: 0, aqua: 1, gold: 2, fog: 3 };

interface Star { x: number; y: number; size: number; alpha: number; twinkle: number; phase: number; depth: number; tone: number; flare: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; tone: number; alpha: number }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; length: number }
interface Dust { x: number; y: number; vx: number; vy: number; size: number; phase: number; tone: number; alpha: number }

export interface Starfield {
  burst(x: number, y: number, tone?: SparkTone, count?: number): void;
  destroy(): void;
}

const SPRITE_SIZE = 64;
const MAX_PARTICLES = 420;
let active: Starfield | null = null;

/** Emits sparkles at viewport coordinates on the mounted starfield, if any. */
export function sparkle(x: number, y: number, tone: SparkTone = "gold", count = 18) {
  active?.burst(x, y, tone, count);
}

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pickTone = () => {
  let roll = Math.random();
  for (let index = 0; index < STAR_PALETTE.length; index += 1) {
    roll -= STAR_PALETTE[index].weight;
    if (roll <= 0) return index;
  }
  return 0;
};
const wrap = (value: number, size: number) => ((value % size) + size) % size;

function makeSprite([r, g, b]: Rgb, flare: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SPRITE_SIZE;
  const context = canvas.getContext("2d")!;
  const mid = SPRITE_SIZE / 2;
  const glow = context.createRadialGradient(mid, mid, 0, mid, mid, mid);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.07, `rgba(${r},${g},${b},0.95)`);
  glow.addColorStop(0.2, `rgba(${r},${g},${b},0.32)`);
  glow.addColorStop(0.48, `rgba(${r},${g},${b},0.07)`);
  glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
  context.fillStyle = glow;
  context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  if (flare) {
    // Diffraction spikes for the brightest stars.
    const horizontal = context.createLinearGradient(0, mid, SPRITE_SIZE, mid);
    const vertical = context.createLinearGradient(mid, 0, mid, SPRITE_SIZE);
    for (const gradient of [horizontal, vertical]) {
      gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
      gradient.addColorStop(0.5, "rgba(255,255,255,0.9)");
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    }
    context.fillStyle = horizontal;
    context.fillRect(0, mid - 0.6, SPRITE_SIZE, 1.2);
    context.fillStyle = vertical;
    context.fillRect(mid - 0.6, 0, 1.2, SPRITE_SIZE);
  }
  return canvas;
}

export function mountStarfield(canvas: HTMLCanvasElement): Starfield {
  const context = canvas.getContext("2d")!;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const sprites = STAR_PALETTE.map(({ color }) => makeSprite(color, false));
  const flareSprites = STAR_PALETTE.map(({ color }) => makeSprite(color, true));

  let width = 0;
  let height = 0;
  let stars: Star[] = [];
  let dust: Dust[] = [];
  const particles: Particle[] = [];
  const meteors: Meteor[] = [];
  const pointer = { x: 0, y: 0, easedX: 0, easedY: 0, lastTrail: 0, trailX: 0, trailY: 0 };
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let nextMeteor = random(1.5, 4);
  let resizeTimer = 0;

  function seed() {
    const count = Math.min(1400, Math.round((width * height) / 1100));
    stars = Array.from({ length: count }, () => {
      const depth = Math.pow(Math.random(), 1.6) * 0.85 + 0.15;
      const bright = Math.random() < 0.03;
      // A share of faint stars gathers along a diagonal band to suggest the Milky Way.
      const inBand = !bright && Math.random() < 0.4;
      let x = Math.random() * width;
      let y = Math.random() * height;
      if (inBand) {
        const along = Math.random();
        const spread = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        x = along * width + spread * height * 0.05;
        y = height * (0.92 - 0.84 * along) + spread * height * 0.11;
      }
      return {
        x,
        y,
        size: bright ? random(1.4, 2.3) : random(0.35, 1.2) * (0.6 + depth * 0.6) * (inBand ? 0.75 : 1),
        alpha: bright ? random(0.75, 1) : random(0.25, 0.85) * (inBand ? 0.8 : 1),
        twinkle: random(0.6, 2.6),
        phase: Math.random() * Math.PI * 2,
        depth,
        tone: pickTone(),
        flare: bright,
      };
    });
    const dustCount = Math.round(Math.min(42, width / 34));
    dust = Array.from({ length: dustCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: random(-3, 3),
      vy: random(-10, -3),
      size: random(10, 26),
      phase: Math.random() * Math.PI * 2,
      tone: Math.random() < 0.55 ? 1 : 2,
      alpha: random(0.05, 0.16),
    }));
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    seed();
    if (reducedMotion) draw(0);
  }

  function spawnMeteor() {
    const angle = random(2.62, 2.85); // heading down-left
    const speed = random(780, 1150);
    meteors.push({
      x: random(width * 0.25, width * 1.05),
      y: random(-height * 0.05, height * 0.35),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: random(0.7, 1.15),
      length: random(110, 230),
    });
  }

  function drawSprite(sprite: HTMLCanvasElement, x: number, y: number, size: number, alpha: number) {
    if (alpha <= 0.003) return;
    context.globalAlpha = Math.min(alpha, 1);
    context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  function draw(delta: number) {
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    const scroll = window.scrollY;
    const parallaxX = pointer.easedX * 18;
    const parallaxY = pointer.easedY * 12;

    for (const star of stars) {
      const x = wrap(star.x - parallaxX * star.depth, width);
      const y = wrap(star.y - scroll * star.depth * 0.06 - parallaxY * star.depth, height);
      const shimmer = reducedMotion ? 0.85 : 0.62 + 0.38 * Math.sin(elapsed * star.twinkle + star.phase);
      const sprite = star.flare ? flareSprites[star.tone] : sprites[star.tone];
      drawSprite(sprite, x, y, star.size * (star.flare ? 16 : 9), star.alpha * shimmer);
    }

    if (!reducedMotion) {
      for (const mote of dust) {
        mote.x = wrap(mote.x + (mote.vx + Math.sin(elapsed * 0.3 + mote.phase) * 4) * delta, width);
        mote.y = wrap(mote.y + mote.vy * delta, height);
        drawSprite(sprites[mote.tone], mote.x, mote.y, mote.size, mote.alpha * (0.6 + 0.4 * Math.sin(elapsed + mote.phase)));
      }

      for (let index = meteors.length - 1; index >= 0; index -= 1) {
        const meteor = meteors[index];
        meteor.life += delta;
        meteor.x += meteor.vx * delta;
        meteor.y += meteor.vy * delta;
        const progress = meteor.life / meteor.maxLife;
        if (progress >= 1) {
          meteors.splice(index, 1);
          continue;
        }
        const fade = Math.sin(progress * Math.PI);
        const speed = Math.hypot(meteor.vx, meteor.vy);
        const tailX = meteor.x - (meteor.vx / speed) * meteor.length;
        const tailY = meteor.y - (meteor.vy / speed) * meteor.length;
        const trail = context.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        trail.addColorStop(0, `rgba(255,250,232,${0.9 * fade})`);
        trail.addColorStop(0.25, `rgba(231,201,130,${0.4 * fade})`);
        trail.addColorStop(1, "rgba(142,217,208,0)");
        context.globalAlpha = 1;
        context.strokeStyle = trail;
        context.lineWidth = 1.6;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(meteor.x, meteor.y);
        context.lineTo(tailX, tailY);
        context.stroke();
        drawSprite(flareSprites[0], meteor.x, meteor.y, 26, fade);
      }

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.life += delta;
        if (particle.life >= particle.maxLife) {
          particles.splice(index, 1);
          continue;
        }
        const drag = Math.pow(0.12, delta);
        particle.vx *= drag;
        particle.vy = particle.vy * drag + 14 * delta;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        const remaining = 1 - particle.life / particle.maxLife;
        drawSprite(sprites[particle.tone], particle.x, particle.y, particle.size * (0.4 + remaining * 0.6), particle.alpha * remaining);
      }
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  function tick(time: number) {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;
    elapsed += delta;
    pointer.easedX += (pointer.x - pointer.easedX) * Math.min(1, delta * 2.5);
    pointer.easedY += (pointer.y - pointer.easedY) * Math.min(1, delta * 2.5);
    nextMeteor -= delta;
    if (nextMeteor <= 0) {
      spawnMeteor();
      nextMeteor = random(3.5, 8.5);
    }
    draw(delta);
    frame = requestAnimationFrame(tick);
  }

  function emit(x: number, y: number, tone: number, count: number, speed: [number, number], life: [number, number], size: [number, number], alpha: number) {
    for (let index = 0; index < count && particles.length < MAX_PARTICLES; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = random(speed[0], speed[1]);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 0,
        maxLife: random(life[0], life[1]),
        size: random(size[0], size[1]),
        tone: Math.random() < 0.7 ? tone : 0,
        alpha,
      });
    }
  }

  function onPointerMove(event: PointerEvent) {
    pointer.x = event.clientX / Math.max(width, 1) - 0.5;
    pointer.y = event.clientY / Math.max(height, 1) - 0.5;
    if (reducedMotion || !finePointer || event.pointerType !== "mouse") return;
    const now = performance.now();
    const moved = Math.hypot(event.clientX - pointer.trailX, event.clientY - pointer.trailY);
    if (now - pointer.lastTrail < 28 || moved < 8) return;
    pointer.lastTrail = now;
    pointer.trailX = event.clientX;
    pointer.trailY = event.clientY;
    emit(event.clientX, event.clientY, Math.random() < 0.5 ? 1 : 2, 1, [4, 22], [0.45, 0.8], [5, 10], 0.55);
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 120);
  }

  function onVisibility() {
    if (reducedMotion) return;
    cancelAnimationFrame(frame);
    if (!document.hidden) {
      lastTime = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  resize();
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  if (!reducedMotion) frame = requestAnimationFrame(tick);

  const field: Starfield = {
    burst(x, y, tone = "gold", count = 18) {
      if (reducedMotion) return;
      emit(x, y, TONE_INDEX[tone], count, [40, 190], [0.6, 1.25], [7, 16], 0.95);
    },
    destroy() {
      cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      if (active === field) active = null;
    },
  };
  active = field;
  return field;
}
