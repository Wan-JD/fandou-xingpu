<script setup lang="ts">
// Zoomable lineage constellation: compact contour layout, pan / pinch / wheel zoom, minimap,
// branch folding and focus, level-of-detail labels and a quick preview card per star.
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import StarAvatar from "../StarAvatar.vue";
import {
  academicGrade, destinationClass, destinationEligible, destinationLabel, formatCohort, gradeLabel, groupRoleClass, groupRoleLabels,
  membershipLabel, relationLabel, toneFor, treeGroupRole, type Cohort, type Person, type Tone,
} from "../../lib/people";
import { ancestorsOf, clampScale, descendantsOf, fitView, layoutConstellation, zoomAt, type Viewport } from "../../lib/constellation";
import { sparkle } from "../../lib/starfield";

type Edge = { id: string; mentorId: string; studentId: string };
type Row = { cohort: Cohort; members: Person[] };
type Placed = { person: Person; x: number; y: number; row: number; core: number; badges: boolean; crest: boolean };
type Link = { id: string; mentorId: string; studentId: string; path: string; x1: number; y1: number; x2: number; y2: number; crossCohort: boolean };

const props = defineProps<{
  people: Person[];
  edges: Edge[];
  rows: Row[];
  expanded: Record<string, boolean>;
  rootId: string | null;
  query: string;
  matchingIds: Set<string>;
  myPersonId: string | null;
  generatedAt: string;
}>();
const emit = defineEmits<{ toggleRow: [id: string]; openProfile: [person: Person, origin: DOMRect | null, tone: Tone]; clearQuery: [] }>();

// Geometry in canvas units; zoom handles every screen size so these stay fixed.
const SLOT = 118;
const ROW_H = 214;
const ROW_COLLAPSED = 64;
const ORBIT_Y = 80;
const ORBIT_Y_COLLAPSED = 32;
const PAD_X = 190;
const PAD_TOP = 14;
const PAD_BOTTOM = 44;
const MIN_SCALE = 0.12;
/** Screen-space strip on the left reserved for the pinned cohort labels. */
const labelGutter = computed(() => viewportSize.value.width < 720 ? 104 : 196);
const MAX_SCALE = 1.8;
const READABLE_SCALE = 0.45;
/** Below this fit the whole map is too dense to be a useful first view. */
const OVERVIEW_SCALE = 0.28;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const stageRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const nodeRefs = new Map<string, HTMLElement>();
const view = ref<Viewport>({ x: 0, y: 0, scale: 0.6 });
const viewportSize = ref({ width: 0, height: 0 });
const folded = shallowRef(new Set<string>());
const focusRootId = ref<string | null>(null);
const selected = ref<Person | null>(null);
const hoveredId = ref<string | null>(null);
const popupPosition = ref({ left: 0, top: 0, arrow: 0, below: true });
const fullscreen = ref(false);
const interacting = ref(false);
const settled = ref(false);
const locateIndex = ref(-1);
let initialised = false;
let resizeObserver: ResizeObserver | null = null;
let animation = 0;

const byId = computed(() => new Map(props.people.map((person) => [person.id, person])));
const mentorOf = computed(() => new Map(props.people.map((person) => [person.id, person.mentorId])));
const rowIndex = computed(() => new Map(props.rows.map((row, index) => [row.cohort.id, index])));
const rowOf = (person: Person) => rowIndex.value.get(person.cohort?.id ?? "uncategorized") ?? props.rows.length;
const baseLayout = computed(() => layoutConstellation(props.people.map((person) => ({ id: person.id, mentorId: person.mentorId, row: rowOf(person), order: person.name })), { rootId: props.rootId }));
const searching = computed(() => Boolean(props.query.trim()));

/** Ids hidden by folds or by the focused branch. Search matches and their ancestors stay visible. */
const hidden = computed(() => {
  const result = descendantsOf(folded.value, baseLayout.value.children);
  if (searching.value) {
    props.matchingIds.forEach((id) => ancestorsOf(id, mentorOf.value).forEach((ancestor) => result.delete(ancestor)));
  }
  if (focusRootId.value) {
    const keep = new Set([...ancestorsOf(focusRootId.value, mentorOf.value), ...descendantsOf([focusRootId.value], baseLayout.value.children)]);
    props.people.forEach((person) => { if (!keep.has(person.id)) result.add(person.id); });
  }
  return result;
});
const layout = computed(() => hidden.value.size
  ? layoutConstellation(props.people.map((person) => ({ id: person.id, mentorId: person.mentorId, row: rowOf(person), order: person.name })), { rootId: props.rootId, hidden: hidden.value })
  : baseLayout.value);

const publicGroupRole = (person: Person) => treeGroupRole(person);
const publicDestination = (person: Person) => destinationEligible(person) ? person.destination : null;
const toneOf = (person: Person): Tone => toneFor(person, props.rootId);
const isSecondaryCohort = (cohort: Cohort) => (academicGrade(cohort.year) ?? 0) <= 0;
const cohortContext = (cohort: Cohort) => {
  const grade = academicGrade(cohort.year);
  if (grade === 1) return "大一 · 最新成员";
  if (grade === 2) return "大二 · 核心管理班组";
  return gradeLabel(cohort.year);
};

/** Rows that still hold a visible star; empty rows disappear while a branch is focused. */
const rowBands = computed(() => {
  let top = PAD_TOP;
  return props.rows.flatMap((row, index) => {
    const shown = row.members.filter((member) => layout.value.slots.has(member.id));
    if (!shown.length && (focusRootId.value || hidden.value.size)) return [];
    const collapsed = props.expanded[row.cohort.id] === false;
    const height = collapsed ? ROW_COLLAPSED : ROW_H;
    const band = { ...row, index, top, height, collapsed, orbit: top + (collapsed ? ORBIT_Y_COLLAPSED : ORBIT_Y), count: row.members.length, shown: shown.length };
    top += height;
    return [band];
  });
});
const bandByIndex = computed(() => new Map(rowBands.value.map((band) => [band.index, band])));
type Band = (typeof rowBands.value)[number];
/** Adjacent collapsed rows that are too thin on screen share one label, so labels never pile up. */
const labelGroups = computed(() => {
  const groups: Array<{ key: string; bands: Band[]; orbit: number; merged: boolean }> = [];
  rowBands.value.forEach((band) => {
    const thin = band.collapsed && band.height * view.value.scale < 30;
    const last = groups.at(-1);
    if (thin && last?.merged) { last.bands.push(band); last.orbit = (last.bands[0].orbit + band.orbit) / 2; return; }
    groups.push({ key: band.cohort.id, bands: [band], orbit: band.orbit, merged: thin });
  });
  return groups;
});
function expandBands(bands: Band[]) {
  bands.forEach((band) => emit("toggleRow", band.cohort.id));
}
const content = computed(() => ({
  width: layout.value.span * SLOT + PAD_X * 2,
  height: (rowBands.value.at(-1) ? rowBands.value.at(-1)!.top + rowBands.value.at(-1)!.height : PAD_TOP) + PAD_BOTTOM,
}));

const placed = computed<Placed[]>(() => props.people.flatMap((person) => {
  const slot = layout.value.slots.get(person.id);
  const band = bandByIndex.value.get(rowOf(person));
  if (slot === undefined || !band || band.collapsed) return [];
  const core = person.id === props.rootId ? 68 : 52;
  return [{ person, x: PAD_X + slot * SLOT, y: band.orbit, row: band.index, core, badges: Boolean(publicGroupRole(person) || publicDestination(person)), crest: Boolean(publicGroupRole(person)) }];
}));
const placedById = computed(() => new Map(placed.value.map((item) => [item.person.id, item])));

/** Same-cohort students get stacked arcs, nearest lowest, so a mentor's arcs never merge into one band. */
const sameRowRank = computed(() => {
  const groups = new Map<string, Array<{ id: string; distance: number }>>();
  props.edges.forEach((edge) => {
    const from = placedById.value.get(edge.mentorId);
    const to = placedById.value.get(edge.studentId);
    if (!from || !to || to.row > from.row) return;
    groups.set(edge.mentorId, [...(groups.get(edge.mentorId) ?? []), { id: edge.id, distance: Math.abs(to.x - from.x) }]);
  });
  const rank = new Map<string, number>();
  groups.forEach((list) => list.sort((a, b) => a.distance - b.distance).forEach((item, index) => rank.set(item.id, index)));
  return rank;
});
const links = computed<Link[]>(() => props.edges.flatMap((edge) => {
  const from = placedById.value.get(edge.mentorId);
  const to = placedById.value.get(edge.studentId);
  if (!from || !to) return [];
  const x1 = from.x;
  const x2 = to.x;
  const crossCohort = Math.abs(to.row - from.row) > 1;
  if (to.row <= from.row) {
    // Students recorded in the mentor's own cohort: arc over the orbit instead of cutting through it.
    const y1 = from.y - from.core / 2 - (from.crest ? 30 : 10);
    const y2 = to.y - to.core / 2 - (to.crest ? 30 : 10);
    const lift = Math.min(ROW_H * 0.6, 26 + (sameRowRank.value.get(edge.id) ?? 0) * 11);
    const top = Math.min(y1, y2) - lift;
    return [{ id: edge.id, mentorId: edge.mentorId, studentId: edge.studentId, x1, y1, x2, y2, crossCohort, path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${top.toFixed(1)}, ${x2.toFixed(1)} ${top.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}` }];
  }
  const y1 = from.y + from.core / 2 + 40 + (from.badges ? 26 : 0);
  const y2 = to.y - to.core / 2 - (to.crest ? 32 : 12);
  const bend = Math.max(26, Math.abs(y2 - y1) * 0.55);
  return [{ id: edge.id, mentorId: edge.mentorId, studentId: edge.studentId, x1, y1, x2, y2, crossCohort, path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 + bend).toFixed(1)}, ${x2.toFixed(1)} ${(y2 - bend).toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}` }];
}));

// Only stars near the viewport are mounted, so the map stays light as the lineage grows.
// Bounds snap to a coarse tile grid: while panning inside the same tiles the culled lists keep
// their identity and Vue skips re-rendering the star and trail layers entirely.
const CULL_TILE = 480;
const cullKey = computed(() => {
  const { x, y, scale } = view.value;
  const margin = 200 / scale;
  const snapDown = (value: number) => Math.floor(value / CULL_TILE) * CULL_TILE;
  const snapUp = (value: number) => Math.ceil(value / CULL_TILE) * CULL_TILE;
  return [snapDown(-x / scale - margin), snapUp((viewportSize.value.width - x) / scale + margin), snapDown(-y / scale - margin), snapUp((viewportSize.value.height - y) / scale + margin)].join(",");
});
const viewBounds = computed(() => {
  const [left, right, top, bottom] = cullKey.value.split(",").map(Number);
  return { left, right, top, bottom };
});
const inView = (x: number, y: number) => x >= viewBounds.value.left && x <= viewBounds.value.right && y >= viewBounds.value.top && y <= viewBounds.value.bottom;
const renderedStars = computed(() => placed.value.filter((item) => inView(item.x, item.y) || item.person.id === selected.value?.id));
const renderedLinks = computed(() => links.value.filter((link) => {
  if (searching.value && !props.matchingIds.has(link.mentorId) && !props.matchingIds.has(link.studentId)) return false;
  const left = Math.min(link.x1, link.x2);
  const right = Math.max(link.x1, link.x2);
  const top = Math.min(link.y1, link.y2) - ROW_H;
  const bottom = Math.max(link.y1, link.y2);
  return right >= viewBounds.value.left && left <= viewBounds.value.right && bottom >= viewBounds.value.top && top <= viewBounds.value.bottom;
}));
const showSparks = computed(() => !reducedMotion && view.value.scale >= 0.5 && renderedLinks.value.length <= 140);
const activeKey = computed(() => activeLinkIds.value ? [...activeLinkIds.value].join("|") : "");

const lod = computed(() => view.value.scale >= 0.72 ? "near" : view.value.scale >= 0.42 ? "mid" : "far");
const zoomPercent = computed(() => Math.round(view.value.scale * 100));
const activeLinkIds = computed(() => {
  const id = hoveredId.value ?? selected.value?.id;
  if (!id) return null;
  return new Set(links.value.filter((link) => link.mentorId === id || link.studentId === id).map((link) => link.id));
});
const hoverLabel = computed(() => {
  if (lod.value === "near" || !hoveredId.value || selected.value?.id === hoveredId.value) return null;
  const item = placedById.value.get(hoveredId.value);
  if (!item) return null;
  return { name: item.person.name, left: view.value.x + item.x * view.value.scale, top: view.value.y + (item.y + item.core / 2) * view.value.scale + 10 };
});
const matches = computed(() => searching.value ? placed.value.filter((item) => props.matchingIds.has(item.person.id)).sort((a, b) => a.row - b.row || a.x - b.x) : []);
const focusPerson = computed(() => focusRootId.value ? byId.value.get(focusRootId.value) ?? null : null);
const foldedCount = computed(() => folded.value.size);
const descendantCount = (id: string) => baseLayout.value.descendants.get(id) ?? 0;

/* ---------- Minimap ---------- */
const MINI_W = 200;
const miniScale = computed(() => Math.min(MINI_W / content.value.width, 128 / content.value.height));
const miniSize = computed(() => ({ width: content.value.width * miniScale.value, height: content.value.height * miniScale.value }));
const miniViewport = computed(() => {
  const { x, y, scale } = view.value;
  const s = miniScale.value;
  const left = Math.max(0, -x / scale * s);
  const top = Math.max(0, -y / scale * s);
  const right = Math.min(miniSize.value.width, (viewportSize.value.width - x) / scale * s);
  const bottom = Math.min(miniSize.value.height, (viewportSize.value.height - y) / scale * s);
  return { left, top, width: Math.max(4, right - left), height: Math.max(4, bottom - top) };
});
const showMinimap = computed(() => content.value.width * view.value.scale > viewportSize.value.width * 1.05 || content.value.height * view.value.scale > viewportSize.value.height * 1.05);

/* ---------- View maths ---------- */
function clampView(next: Viewport): Viewport {
  const { width, height } = viewportSize.value;
  const scale = clampScale(next.scale, MIN_SCALE, MAX_SCALE);
  const w = content.value.width * scale;
  const h = content.value.height * scale;
  // Keep at least half of the viewport over the constellation so it can never be lost.
  const x = Math.min(width * 0.5, Math.max(width * 0.5 - w, next.x));
  const y = Math.min(height * 0.5, Math.max(height * 0.5 - h, next.y));
  return { scale, x, y };
}
function setView(next: Viewport) {
  cancelAnimationFrame(animation);
  view.value = clampView(next);
}
function animateTo(target: Viewport, duration = 520) {
  cancelAnimationFrame(animation);
  const end = clampView(target);
  if (reducedMotion || duration <= 0) { view.value = end; return; }
  const start = { ...view.value };
  const began = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / duration);
    const ease = 1 - (1 - t) ** 3;
    view.value = { x: start.x + (end.x - start.x) * ease, y: start.y + (end.y - start.y) * ease, scale: start.scale + (end.scale - start.scale) * ease };
    if (t < 1) animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}
/** Horizontal centre of the area that is not covered by cohort labels. */
const focalX = () => labelGutter.value + (viewportSize.value.width - labelGutter.value) / 2;
const center = () => ({ x: focalX(), y: viewportSize.value.height / 2 });
function zoomBy(factor: number, point = center()) {
  setView(zoomAt(view.value, clampScale(view.value.scale * factor, MIN_SCALE, MAX_SCALE), point));
}
function zoomSmooth(factor: number) {
  animateTo(zoomAt(view.value, clampScale(view.value.scale * factor, MIN_SCALE, MAX_SCALE), center()), 260);
}
/** Fit inside the area right of the label gutter. */
function fitted(box = content.value, options: { min?: number; max?: number; padding?: number } = {}) {
  const gutter = labelGutter.value;
  const result = fitView(box, { width: viewportSize.value.width - gutter, height: viewportSize.value.height }, { min: options.min ?? MIN_SCALE, max: options.max ?? 1, padding: options.padding ?? 28 });
  return { ...result, x: result.x + gutter };
}
function fitAll(duration = 520) {
  animateTo(fitted(), duration);
}
/** Centres a set of canvas points, zooming out just enough to show all of them. */
function frame(points: Array<{ x: number; y: number }>, options: { minScale?: number; maxScale?: number; duration?: number } = {}) {
  if (!points.length) return;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const box = { width: Math.max(...xs) - Math.min(...xs) + SLOT * 2, height: Math.max(...ys) - Math.min(...ys) + ROW_H };
  const { scale } = fitted(box, { min: options.minScale, max: options.maxScale, padding: 40 });
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2 + ROW_H * 0.15;
  animateTo({ scale, x: focalX() - cx * scale, y: viewportSize.value.height / 2 - cy * scale }, options.duration);
}
function initialView() {
  const overview = fitted();
  if (overview.scale >= OVERVIEW_SCALE) { view.value = clampView(overview); return; }
  // Too large for one screen: open at a readable zoom on the left edge of the largest family, top-aligned.
  const scale = READABLE_SCALE;
  view.value = clampView({ scale, x: labelGutter.value - (PAD_X - SLOT * 0.6) * scale, y: 24 });
}

/* ---------- Pointer, wheel and keyboard ---------- */
const pointers = new Map<number, { x: number; y: number }>();
let drag: { x: number; y: number; view: Viewport; moved: boolean } | null = null;
let pinch: { distance: number; scale: number; mid: { x: number; y: number }; view: Viewport } | null = null;
let suppressClick = false;

const local = (event: { clientX: number; clientY: number }) => {
  const rect = viewportRef.value!.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  if ((event.target as Element).closest(".map-overlay")) return;
  cancelAnimationFrame(animation);
  pointers.set(event.pointerId, local(event));
  if (pointers.size === 1) drag = { ...local(event), view: { ...view.value }, moved: false };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.value.scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...view.value } };
    drag = null;
  }
}
function onPointerMove(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, local(event));
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoomed = zoomAt(pinch.view, clampScale(pinch.scale * distance / Math.max(pinch.distance, 1), MIN_SCALE, MAX_SCALE), pinch.mid);
    setView({ ...zoomed, x: zoomed.x + mid.x - pinch.mid.x, y: zoomed.y + mid.y - pinch.mid.y });
    suppressClick = true;
    interacting.value = true;
    return;
  }
  if (!drag) return;
  const point = local(event);
  const dx = point.x - drag.x;
  const dy = point.y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    interacting.value = true;
    viewportRef.value?.setPointerCapture(event.pointerId);
  }
  setView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy });
}
function onPointerUp(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  if (drag?.moved || pinch) suppressClick = true;
  else if (event.pointerType !== "mouse" || event.button === 0) {
    // A plain tap on empty sky closes the preview.
    if (!(event.target as Element).closest(".star-node")) selected.value = null;
  }
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) { drag = null; interacting.value = false; }
}
function onClickCapture(event: MouseEvent) {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}
function onWheel(event: WheelEvent) {
  event.preventDefault();
  cancelAnimationFrame(animation);
  const point = local(event);
  const lineMode = event.deltaMode === 1;
  const mouseWheel = lineMode || (event.deltaX === 0 && Math.abs(event.deltaY) >= 40 && Number.isInteger(event.deltaY));
  if (event.ctrlKey || event.metaKey || mouseWheel) {
    const delta = lineMode ? event.deltaY * 33 : event.deltaY;
    zoomBy(Math.exp(-delta * (event.ctrlKey && !mouseWheel ? 0.012 : 0.0016)), point);
  } else {
    // Trackpad two-finger scrolling pans the sky.
    setView({ ...view.value, x: view.value.x - event.deltaX, y: view.value.y - event.deltaY });
  }
}
function onDoubleClick(event: MouseEvent) {
  if ((event.target as Element).closest(".star-node, .map-overlay")) return;
  animateTo(zoomAt(view.value, clampScale(view.value.scale * 1.7, MIN_SCALE, MAX_SCALE), local(event)), 280);
}
function onViewportKey(event: KeyboardEvent) {
  if ((event.target as Element) !== viewportRef.value) return;
  const step = 90;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => animateTo({ ...view.value, x: view.value.x + step }, 160),
    ArrowRight: () => animateTo({ ...view.value, x: view.value.x - step }, 160),
    ArrowUp: () => animateTo({ ...view.value, y: view.value.y + step }, 160),
    ArrowDown: () => animateTo({ ...view.value, y: view.value.y - step }, 160),
    "+": () => zoomSmooth(1.25), "=": () => zoomSmooth(1.25), "-": () => zoomSmooth(0.8), "0": () => fitAll(),
  };
  const action = actions[event.key];
  if (action) { event.preventDefault(); action(); }
}
/** Keyboard focus on a star that sits outside the viewport pans it into view. */
function onFocusIn(event: FocusEvent) {
  const node = (event.target as Element).closest<HTMLElement>(".star-node");
  const id = node?.dataset.id;
  const item = id ? placedById.value.get(id) : null;
  if (!item || interacting.value) return;
  const sx = view.value.x + item.x * view.value.scale;
  const sy = view.value.y + item.y * view.value.scale;
  const margin = 80;
  if (sx < labelGutter.value + margin / 2 || sy < margin || sx > viewportSize.value.width - margin || sy > viewportSize.value.height - margin) {
    animateTo({ ...view.value, x: focalX() - item.x * view.value.scale, y: viewportSize.value.height / 2 - item.y * view.value.scale }, 300);
  }
}

/* ---------- Minimap pointer ---------- */
let miniDragging = false;
function moveFromMinimap(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const cx = (event.clientX - rect.left) / miniScale.value;
  const cy = (event.clientY - rect.top) / miniScale.value;
  setView({ ...view.value, x: viewportSize.value.width / 2 - cx * view.value.scale, y: viewportSize.value.height / 2 - cy * view.value.scale });
}
function onMiniDown(event: PointerEvent) {
  miniDragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  moveFromMinimap(event);
}
function onMiniMove(event: PointerEvent) { if (miniDragging) moveFromMinimap(event); }
function onMiniUp() { miniDragging = false; }

/* ---------- Stars, preview and branches ---------- */
function setNodeRef(id: string, element: Element | null) {
  if (element instanceof HTMLElement) nodeRefs.set(id, element);
  else nodeRefs.delete(id);
}
function coreRect(id: string) {
  const node = nodeRefs.get(id);
  return (node?.querySelector(".star-avatar-core") ?? node)?.getBoundingClientRect() ?? null;
}
function openPreview(person: Person) {
  const rect = coreRect(person.id);
  if (rect) sparkle(rect.left + rect.width / 2, rect.top + rect.height / 2, toneOf(person) === "aqua" ? "aqua" : "gold", 26);
  selected.value = selected.value?.id === person.id ? null : person;
  void nextTick().then(measurePopup);
}
function measurePopup() {
  const stage = stageRef.value;
  const person = selected.value;
  const item = person ? placedById.value.get(person.id) : null;
  const viewport = viewportRef.value;
  if (!stage || !person || !item || !viewport) return;
  const stageRect = stage.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const width = popoverRef.value?.offsetWidth ?? 320;
  const height = popoverRef.value?.offsetHeight ?? 300;
  const sx = viewportRect.left - stageRect.left + view.value.x + item.x * view.value.scale;
  const coreBottom = viewportRect.top - stageRect.top + view.value.y + (item.y + item.core / 2) * view.value.scale;
  const coreTop = viewportRect.top - stageRect.top + view.value.y + (item.y - item.core / 2) * view.value.scale;
  const below = coreBottom + 14 + height <= viewportRect.bottom - stageRect.top || coreTop - height - 14 < viewportRect.top - stageRect.top;
  const left = Math.max(8, Math.min(sx - width / 2, stageRect.width - width - 8));
  popupPosition.value = { left, top: below ? coreBottom + 14 : coreTop - height - 14, arrow: Math.max(22, Math.min(sx - left, width - 22)), below };
}
function viewDetail(person: Person) {
  emit("openProfile", person, coreRect(person.id), toneOf(person));
}
function toggleFold(person: Person) {
  const next = new Set(folded.value);
  if (next.has(person.id)) next.delete(person.id);
  else next.add(person.id);
  folded.value = next;
  nextTick(() => { const item = placedById.value.get(person.id); if (item) animateTo({ ...view.value, x: focalX() - item.x * view.value.scale }, 360); measurePopup(); });
}
function expandAll() {
  folded.value = new Set();
  nextTick(() => fitAll());
}
function focusBranch(person: Person) {
  focusRootId.value = person.id;
  folded.value = new Set([...folded.value].filter((id) => !descendantsOf([person.id], baseLayout.value.children).has(id) && id !== person.id));
  nextTick(() => { fitAll(); measurePopup(); });
}
function exitFocus() {
  const id = focusRootId.value;
  focusRootId.value = null;
  nextTick(() => { if (id) locate(id, { open: false }); else fitAll(); });
}

/** Pans and zooms to a star, revealing it from folds, focus or collapsed rows first. */
function locate(id: string, options: { open?: boolean; scale?: number } = {}) {
  const person = byId.value.get(id);
  if (!person) return false;
  const chain = new Set(ancestorsOf(id, mentorOf.value));
  if ([...folded.value].some((fold) => chain.has(fold) && fold !== id)) folded.value = new Set([...folded.value].filter((fold) => !chain.has(fold) || fold === id));
  if (focusRootId.value && hidden.value.has(id)) focusRootId.value = null;
  if (person.cohort && props.expanded[person.cohort.id] === false) emit("toggleRow", person.cohort.id);
  // Bring the map itself on screen first when it sits below the fold.
  const rect = viewportRef.value?.getBoundingClientRect();
  if (rect && (rect.top < -rect.height * 0.25 || rect.bottom > window.innerHeight + rect.height * 0.25)) {
    viewportRef.value?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }
  void nextTick().then(() => {
    const item = placedById.value.get(id);
    if (!item) return;
    const scale = Math.max(view.value.scale, options.scale ?? 0.85);
    animateTo({ scale, x: focalX() - item.x * scale, y: viewportSize.value.height * 0.42 - item.y * scale });
    if (options.open !== false) {
      window.setTimeout(() => {
        selected.value = person;
        nodeRefs.get(id)?.focus({ preventScroll: true });
        void nextTick().then(measurePopup);
      }, reducedMotion ? 0 : 540);
    }
  });
  return true;
}
function locateMe() { if (props.myPersonId) locate(props.myPersonId); }
function locateRoot() {
  const root = props.rootId ? placedById.value.get(props.rootId) : null;
  if (root) animateTo({ scale: Math.max(view.value.scale, 0.7), x: focalX() - root.x * Math.max(view.value.scale, 0.7), y: 30 });
}
/** Steps through search matches; Enter in the search field calls this. */
function locateNext() {
  if (!matches.value.length) return;
  locateIndex.value = (locateIndex.value + 1) % matches.value.length;
  locate(matches.value[locateIndex.value].person.id);
}
function toggleFullscreen() {
  fullscreen.value = !fullscreen.value;
  document.body.style.overflow = fullscreen.value ? "hidden" : "";
  // The page column is its own stacking context; lift it above the header while full screen.
  document.body.classList.toggle("map-fullscreen", fullscreen.value);
}

/* ---------- Lifecycle ---------- */
function measureViewport() {
  const element = viewportRef.value;
  if (!element) return;
  const previous = viewportSize.value;
  viewportSize.value = { width: element.clientWidth, height: element.clientHeight };
  if (!initialised && viewportSize.value.width && placed.value.length) {
    initialised = true;
    initialView();
    window.setTimeout(() => { settled.value = true; }, 1800);
  } else if (previous.width && (previous.width !== viewportSize.value.width || previous.height !== viewportSize.value.height)) {
    // Keep the same canvas point under the viewport centre when the stage resizes.
    view.value = clampView({ ...view.value, x: view.value.x + (viewportSize.value.width - previous.width) / 2, y: view.value.y + (viewportSize.value.height - previous.height) / 2 });
  }
  measurePopup();
}
function onWindowKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (selected.value) selected.value = null;
  else if (fullscreen.value) toggleFullscreen();
  else if (focusRootId.value) exitFocus();
}
function onWindowPointer(event: PointerEvent) {
  const target = event.target as Element | null;
  if (selected.value && target && !target.closest(".quick-popover, .map-viewport")) selected.value = null;
}

watch(view, () => { if (selected.value) requestAnimationFrame(measurePopup); }, { deep: true });
watch(() => props.people.length, () => { if (!initialised) nextTick(measureViewport); });
watch(fullscreen, () => nextTick(measureViewport));
watch(() => props.query, () => { locateIndex.value = -1; });
let searchTimer = 0;
watch(() => [props.query, props.matchingIds.size] as const, () => {
  window.clearTimeout(searchTimer);
  if (!searching.value) return;
  // Frame the matching stars once typing pauses.
  searchTimer = window.setTimeout(() => {
    if (matches.value.length) frame(matches.value.map((item) => ({ x: item.x, y: item.y })), { maxScale: 0.95, minScale: 0.3 });
  }, 420);
});
watch(layout, () => { if (selected.value && !layout.value.slots.has(selected.value.id)) selected.value = null; });

onMounted(() => {
  resizeObserver = new ResizeObserver(measureViewport);
  if (viewportRef.value) resizeObserver.observe(viewportRef.value);
  viewportRef.value?.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onWindowKey);
  window.addEventListener("pointerdown", onWindowPointer);
  measureViewport();
});
onUnmounted(() => {
  cancelAnimationFrame(animation);
  window.clearTimeout(searchTimer);
  resizeObserver?.disconnect();
  viewportRef.value?.removeEventListener("wheel", onWheel);
  window.removeEventListener("keydown", onWindowKey);
  window.removeEventListener("pointerdown", onWindowPointer);
  if (fullscreen.value) { document.body.style.overflow = ""; document.body.classList.remove("map-fullscreen"); }
});

defineExpose({ locate, locateNext, fitAll, matchCount: computed(() => matches.value.length), locateIndex });
</script>

<template>
  <section ref="stageRef" class="star-stage" :class="{ fullscreen }" aria-label="成员星谱">
    <div class="map-viewport" ref="viewportRef" :class="[`lod-${lod}`, { interacting, settled, searching }]" tabindex="0"
      aria-label="星谱画布。拖动平移，滚轮或双指缩放，方向键移动，加减号缩放，0 适应全图"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @click.capture="onClickCapture"
      @dblclick="onDoubleClick" @keydown="onViewportKey" @focusin="onFocusIn">
      <div class="map-canvas" :style="{ width: `${content.width}px`, height: `${content.height}px`, transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`, '--inv': 1 / view.scale }">
        <div v-for="band in rowBands" :key="band.cohort.id" class="map-orbit" :class="{ collapsed: band.collapsed, secondary: isSecondaryCohort(band.cohort) }" :style="{ top: `${band.orbit}px` }" aria-hidden="true"></div>
        <svg class="line-layer" :width="content.width" :height="content.height" :viewBox="`0 0 ${content.width} ${content.height}`" aria-hidden="true">
          <defs>
            <filter id="spark-glow" x="-300%" y="-300%" width="700%" height="700%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="trail-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#e7c982" stop-opacity=".9" />
              <stop offset="1" stop-color="#8ed9d0" stop-opacity=".7" />
            </linearGradient>
          </defs>
          <g v-memo="[renderedLinks, activeKey, showSparks]">
          <g v-for="(link, index) in renderedLinks" :key="link.id" class="trail" :class="{ 'cross-cohort': link.crossCohort, active: activeLinkIds?.has(link.id), muted: activeLinkIds && !activeLinkIds.has(link.id) }">
            <path class="trail-glow" :d="link.path" />
            <path class="trail-line" :d="link.path" stroke="url(#trail-gradient)" />
            <circle v-if="showSparks" class="trail-spark" r="2.2" filter="url(#spark-glow)" visibility="hidden">
              <set attributeName="visibility" to="visible" :begin="`${1.2 + (index % 5) * 0.55}s`" />
              <animateMotion :path="link.path" :dur="`${3.4 + (index % 4) * 0.7}s`" :begin="`${1.2 + (index % 5) * 0.55}s`" repeatCount="indefinite" />
            </circle>
          </g>
          </g>
        </svg>
        <div class="map-stars" v-memo="[renderedStars, selected?.id, searching, matchingIds, folded, lod, myPersonId, focusRootId, rootId]">
        <button
          v-for="(item, index) in renderedStars"
          :key="item.person.id"
          :ref="(el) => setNodeRef(item.person.id, el as Element)"
          :data-id="item.person.id"
          class="star-node"
          :class="[destinationClass({ destination: publicDestination(item.person) }), groupRoleClass({ groupRole: publicGroupRole(item.person) }), {
            dimmed: searching && !matchingIds.has(item.person.id), highlighted: searching && matchingIds.has(item.person.id), root: item.person.id === rootId,
            selected: selected?.id === item.person.id, mine: item.person.id === myPersonId, focus: item.person.id === focusRootId,
          }]"
          :style="{ left: `${item.x}px`, top: `${item.y}px`, '--core': `${item.core}px`, '--delay': `${Math.min(item.row * 120 + index * 18, 1400)}ms` }"
          type="button"
          :title="lod === 'near' ? undefined : item.person.name"
          :aria-label="`${item.person.name}，${formatCohort(item.person.cohort)}，${relationLabel(item.person)}${publicGroupRole(item.person) ? `，${groupRoleLabels[publicGroupRole(item.person)!]}` : ''}${item.person.memberType ? `，${membershipLabel(item.person)}` : ''}${publicDestination(item.person) ? `，去向${destinationLabel(item.person)}` : ''}${folded.has(item.person.id) ? `，已收起 ${descendantCount(item.person.id)} 位后辈` : ''}`"
          :aria-expanded="selected?.id === item.person.id"
          @click="openPreview(item.person)"
          @mouseenter="hoveredId = item.person.id"
          @mouseleave="hoveredId = null"
          @focus="hoveredId = item.person.id"
          @blur="hoveredId = null"
        >
          <span v-if="publicGroupRole(item.person)" class="node-crest" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg></span>
          <StarAvatar :name="item.person.name" :avatar-url="item.person.avatarUrl" :tone="toneOf(item.person)" :size="item.person.id === rootId ? 'lg' : 'md'" />
          <span v-if="folded.has(item.person.id)" class="fold-badge" aria-hidden="true">+{{ descendantCount(item.person.id) }}</span>
          <span class="star-name">{{ item.person.name }}</span>
          <span class="star-badges">
            <span v-if="publicGroupRole(item.person)" class="role-tag">{{ groupRoleLabels[publicGroupRole(item.person)!] }}</span>
            <span v-if="publicDestination(item.person)" class="destination-badge">{{ destinationLabel(item.person) }}</span>
          </span>
        </button>
        </div>
      </div>

      <div class="row-labels" :style="{ '--gutter': `${labelGutter}px` }">
        <template v-for="group in labelGroups" :key="group.key">
          <div v-if="group.merged && group.bands.length > 1" class="row-label merged" :style="{ transform: `translateY(${view.y + group.orbit * view.scale}px)` }">
            <span class="orbit-text"><strong>{{ group.bands.map((band) => formatCohort(band.cohort)).join(" · ") }}</strong></span>
            <button class="collapse-button map-overlay merged-expand" type="button" :aria-label="`展开 ${group.bands.length} 条已收起的轨道`" @click="expandBands(group.bands)">+{{ group.bands.length }}</button>
          </div>
          <div v-for="band in (group.merged && group.bands.length > 1 ? [] : group.bands)" :key="band.cohort.id" class="row-label" :class="{ collapsed: band.collapsed, secondary: isSecondaryCohort(band.cohort) }"
            :style="{ transform: `translateY(${view.y + band.orbit * view.scale}px)` }">
            <span class="orbit-year">{{ band.cohort.year ? String(band.cohort.year).slice(-2) : "··" }}</span>
            <span class="orbit-text" :data-count="`${band.count} 颗`">
              <span class="cohort-kicker">{{ cohortContext(band.cohort) }}</span>
              <strong>{{ formatCohort(band.cohort) }}</strong>
              <small>{{ band.shown < band.count ? `${band.shown} / ${band.count}` : band.count }} 颗星</small>
            </span>
            <button class="collapse-button map-overlay" type="button" :aria-expanded="!band.collapsed" :aria-label="`${band.collapsed ? '展开' : '收起'} ${formatCohort(band.cohort)}`" @click="emit('toggleRow', band.cohort.id)">{{ band.collapsed ? "+" : "−" }}</button>
          </div>
        </template>
      </div>

      <div v-if="hoverLabel" class="hover-label" :style="{ left: `${hoverLabel.left}px`, top: `${hoverLabel.top}px` }" aria-hidden="true">{{ hoverLabel.name }}</div>

      <div class="map-controls map-overlay" role="toolbar" aria-label="星谱视图">
        <button type="button" aria-label="缩小" title="缩小（-）" @click="zoomSmooth(0.8)"><svg viewBox="0 0 24 24"><path d="M6 12h12" /></svg></button>
        <button class="zoom-readout" type="button" title="重置为 100%" @click="animateTo(zoomAt(view, 1, center()), 300)">{{ zoomPercent }}%</button>
        <button type="button" aria-label="放大" title="放大（+）" @click="zoomSmooth(1.25)"><svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12" /></svg></button>
        <span class="control-divider" aria-hidden="true"></span>
        <button type="button" title="适应全图（0）" @click="fitAll()"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg><span>全图</span></button>
        <button v-if="rootId" type="button" title="回到星谱起点" @click="locateRoot"><svg viewBox="0 0 24 24"><path d="M12 3.5c.3 3.6 3.2 6.4 6.8 6.8-3.6.3-6.5 3.2-6.8 6.8-.3-3.6-3.2-6.5-6.8-6.8 3.6-.4 6.5-3.2 6.8-6.8Z" /></svg><span>起点</span></button>
        <button v-if="myPersonId" type="button" title="定位到我" @click="locateMe"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg><span>我</span></button>
        <button v-if="foldedCount" type="button" title="展开所有收起的分支" @click="expandAll"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg><span>展开 {{ foldedCount }}</span></button>
        <span class="control-divider" aria-hidden="true"></span>
        <button type="button" :aria-pressed="fullscreen" :title="fullscreen ? '退出全屏（Esc）' : '全屏查看'" @click="toggleFullscreen">
          <svg v-if="!fullscreen" viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></svg>
          <svg v-else viewBox="0 0 24 24"><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" /></svg>
        </button>
      </div>

      <div v-if="focusPerson" class="focus-banner map-overlay" role="status">
        <span><i aria-hidden="true">✦</i>正在查看 <strong>{{ focusPerson.name }}</strong> 的传承分支 · {{ placed.length }} 颗星</span>
        <button type="button" @click="exitFocus">返回全谱</button>
      </div>
      <div v-else-if="searching" class="focus-banner map-overlay" role="status">
        <span v-if="matches.length">匹配 <strong>{{ matches.length }}</strong> 颗星<template v-if="locateIndex >= 0"> · 第 {{ locateIndex + 1 }} 颗</template></span>
        <span v-else>没有找到对应人物</span>
        <button v-if="matches.length" type="button" @click="locateNext">下一颗 ↵</button>
        <button type="button" @click="emit('clearQuery')">清除</button>
      </div>

      <div v-if="showMinimap" class="minimap map-overlay" :style="{ width: `${miniSize.width}px`, height: `${miniSize.height}px` }"
        role="img" aria-label="星谱缩略图，点击或拖动可移动视野" @pointerdown.stop="onMiniDown" @pointermove="onMiniMove" @pointerup="onMiniUp" @pointercancel="onMiniUp">
        <svg v-memo="[placed, searching, matchingIds, myPersonId]" :viewBox="`0 0 ${content.width} ${content.height}`" preserveAspectRatio="none" aria-hidden="true">
          <circle v-for="item in placed" :key="item.person.id" :cx="item.x" :cy="item.y" :r="SLOT * 0.22"
            :class="[`tone-${toneOf(item.person)}`, { match: searching && matchingIds.has(item.person.id), me: item.person.id === myPersonId }]" />
        </svg>
        <span class="minimap-view" :style="{ left: `${miniViewport.left}px`, top: `${miniViewport.top}px`, width: `${miniViewport.width}px`, height: `${miniViewport.height}px` }"></span>
      </div>

      <p class="map-hint" aria-hidden="true">拖动平移 · 滚轮 / 双指缩放 · 双击放大</p>
    </div>

    <div class="star-stage-meta"><span>{{ placed.length }} / {{ people.length }} 颗星可见</span><span>更新于 {{ generatedAt.slice(0, 10) }}</span></div>

    <div
      v-if="selected"
      ref="popoverRef"
      class="quick-popover"
      :class="[destinationClass({ destination: publicDestination(selected) }), groupRoleClass({ groupRole: publicGroupRole(selected) }), { above: !popupPosition.below }]"
      :style="{ left: `${popupPosition.left}px`, top: `${popupPosition.top}px`, '--arrow': `${popupPosition.arrow}px` }"
      role="dialog"
      :aria-label="`${selected.name}简介`"
    >
      <button class="popover-close" type="button" aria-label="关闭简介" @click="selected = null">×</button>
      <span class="popover-kicker">{{ formatCohort(selected.cohort) }} · {{ relationLabel(selected) }}<template v-if="selected.memberType"> · {{ membershipLabel(selected) }}</template></span>
      <div class="popover-person">
        <StarAvatar :name="selected.name" :avatar-url="selected.avatarUrl" :tone="toneOf(selected)" size="sm" />
        <div>
          <h2>{{ selected.name }}<span v-if="publicGroupRole(selected)" class="role-tag">{{ groupRoleLabels[publicGroupRole(selected)!] }}</span></h2>
          <p>{{ selected.motto || selected.role }}</p>
        </div>
      </div>
      <p class="popover-copy">{{ selected.bio || "这颗星暂时保持神秘。" }}</p>
      <span v-if="publicDestination(selected)" class="destination-badge popover-destination">去向 · {{ destinationLabel(selected) }}</span>
      <div class="tag-row compact"><span v-for="tag in selected.tags" :key="tag" class="tag">{{ tag }}</span></div>
      <div v-if="descendantCount(selected.id) || selected.mentorId" class="popover-branch">
        <button v-if="focusRootId !== selected.id" type="button" @click="focusBranch(selected)">只看这一支</button>
        <button v-else type="button" @click="exitFocus">返回全谱</button>
        <button v-if="descendantCount(selected.id)" type="button" @click="toggleFold(selected)">{{ folded.has(selected.id) ? `展开后辈 ${descendantCount(selected.id)}` : `收起后辈 ${descendantCount(selected.id)}` }}</button>
      </div>
      <button class="popover-detail" type="button" @click="viewDetail(selected)">查看完整档案 <span aria-hidden="true">↗</span></button>
    </div>
  </section>
</template>

<style src="./star-map.css"></style>
