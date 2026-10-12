<script setup lang="ts">
import { computed } from "vue";
import type { ZodiacKey, ZodiacMeta } from "@fandou-xingpu/shared";

type Point = readonly [number, number];
type Shape = { points: readonly Point[]; edges: readonly (readonly [number, number])[] };

const props = defineProps<{ zodiac: ZodiacMeta; ownerName: string }>();

const shapes: Record<ZodiacKey, Shape> = {
  aries: { points: [[27, 67], [39, 49], [53, 43], [67, 50], [78, 69]], edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  taurus: { points: [[25, 31], [38, 45], [50, 57], [64, 47], [78, 32], [58, 68], [72, 76]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6]] },
  gemini: { points: [[30, 26], [42, 42], [38, 65], [29, 79], [67, 24], [58, 43], [62, 65], [72, 79]], edges: [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [1, 5], [2, 6]] },
  cancer: { points: [[22, 49], [38, 42], [50, 56], [64, 45], [78, 34], [66, 70]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]] },
  leo: { points: [[20, 59], [34, 50], [48, 57], [60, 45], [73, 52], [81, 37], [68, 72]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [3, 6]] },
  virgo: { points: [[20, 31], [34, 47], [48, 42], [56, 58], [70, 51], [82, 67], [59, 78]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [3, 6]] },
  libra: { points: [[20, 48], [35, 43], [50, 53], [65, 43], [80, 48], [50, 70]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]] },
  scorpio: { points: [[16, 33], [28, 43], [40, 38], [51, 53], [63, 49], [72, 64], [84, 57], [79, 76]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] },
  sagittarius: { points: [[20, 76], [35, 61], [49, 52], [63, 40], [80, 25], [67, 26], [80, 25], [79, 40], [44, 72]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 7], [2, 8]] },
  capricorn: { points: [[18, 39], [32, 49], [44, 43], [57, 57], [70, 50], [82, 65], [70, 76], [55, 68]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 3]] },
  aquarius: { points: [[18, 36], [32, 47], [47, 37], [61, 48], [78, 35], [22, 63], [38, 72], [53, 62], [68, 71], [82, 60]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [8, 9]] },
  pisces: { points: [[19, 34], [31, 45], [43, 55], [51, 67], [59, 55], [71, 44], [82, 32], [51, 28]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 7]] },
};

const shape = computed(() => shapes[props.zodiac.key]);
/** Tight viewBox around the figure so every sign fills the cover's visible band and sits centred. */
const viewBox = computed(() => {
  const xs = shape.value.points.map(([x]) => x);
  const ys = shape.value.points.map(([, y]) => y);
  const pad = 7;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return `${minX} ${minY} ${Math.max(...xs) - minX + pad} ${Math.max(...ys) - minY + pad}`;
});
const usedPoints = computed(() => new Set(shape.value.edges.flat()));
</script>

<template>
  <div class="zodiac-figure">
    <div class="zodiac-sign" :title="zodiac.dateRange">
      <span aria-hidden="true">{{ zodiac.symbol }}</span>
      <span><strong>{{ zodiac.name }}</strong><small>{{ zodiac.dateRange }} · {{ ownerName }} 的本命星图</small></span>
    </div>
    <div class="zodiac-stage">
      <span class="zodiac-glow" aria-hidden="true"></span>
      <svg class="zodiac-map" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="`${ownerName}的星座是${zodiac.name}`">
        <line
          v-for="([from, to], index) in shape.edges"
          :key="`edge-${index}`"
          :x1="shape.points[from][0]"
          :y1="shape.points[from][1]"
          :x2="shape.points[to][0]"
          :y2="shape.points[to][1]"
          pathLength="1"
          :style="{ animationDelay: `${index * 90}ms` }"
        />
        <g v-for="([x, y], index) in shape.points" v-show="usedPoints.has(index)" :key="`star-${index}`" class="zodiac-node" :style="{ animationDelay: `${index * -310}ms` }">
          <circle class="zodiac-halo" :cx="x" :cy="y" :r="index % 3 === 0 ? 3.4 : 2.6" />
          <circle class="zodiac-star" :cx="x" :cy="y" :r="index % 3 === 0 ? 1.15 : 0.8" />
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
/* The visible band of the cover sits between the sign chip and the identity card that overlaps its bottom. */
.zodiac-figure { position: absolute; inset: 0; z-index: 1; --zodiac-top: 58px; --zodiac-bottom: 96px; }
.zodiac-stage { position: absolute; top: var(--zodiac-top); bottom: var(--zodiac-bottom); left: 50%; width: min(78%, 760px); translate: -50% 0; }
.zodiac-glow { position: absolute; top: 50%; left: 50%; width: 62%; height: 120%; translate: -50% -50%; border-radius: 50%; background: radial-gradient(closest-side, rgb(var(--cover-b) / .16), rgb(var(--cover-b) / .05) 60%, transparent); filter: blur(6px); pointer-events: none; }
.zodiac-map { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 10px rgb(var(--cover-b) / .28)); }
.zodiac-map line { stroke: rgb(var(--cover-b) / .7); stroke-width: .5; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: zodiac-line 1.6s var(--ease-out) forwards; }
.zodiac-node { transform-box: fill-box; transform-origin: center; animation: zodiac-pulse 3.6s ease-in-out infinite; }
.zodiac-halo { fill: rgb(var(--cover-b) / .2); }
.zodiac-star { fill: #fffaf0; filter: drop-shadow(0 0 1.2px rgb(var(--cover-b))) drop-shadow(0 0 3px rgb(var(--cover-b) / .7)); }
.zodiac-sign { position: absolute; top: 18px; left: 20px; z-index: 2; display: flex; align-items: center; gap: 10px; color: rgba(238, 244, 241, .88); }
.zodiac-sign > span:first-child { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid rgb(var(--cover-b) / .48); border-radius: 50%; background: rgba(4, 9, 22, .48); color: var(--gold); font-size: 20px; box-shadow: 0 0 22px rgb(var(--cover-b) / .16); }
.zodiac-sign > span:last-child { display: grid; gap: 2px; }
.zodiac-sign strong { font-family: var(--serif); font-size: 15px; font-weight: 400; letter-spacing: .16em; }
.zodiac-sign small { color: rgba(238, 244, 241, .5); font-size: 10px; letter-spacing: .1em; }
@keyframes zodiac-line { to { stroke-dashoffset: 0; } }
@keyframes zodiac-pulse { 0%, 100% { opacity: .78; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.12); } }
@media (max-width: 760px) {
  .zodiac-figure { --zodiac-top: 62px; --zodiac-bottom: 132px; }
  .zodiac-stage { width: 88%; }
  .zodiac-map line { stroke-width: .65; }
  .zodiac-sign { top: 14px; left: 14px; }
}
@media (prefers-reduced-motion: reduce) { .zodiac-map line, .zodiac-node { animation: none; stroke-dashoffset: 0; } }
</style>
