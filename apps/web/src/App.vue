<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import StarAvatar from "./components/StarAvatar.vue";
import { mountStarfield, sparkle, type Starfield } from "./lib/starfield";

type Status = "active" | "archived";
type Cohort = { id: string; label: string; year: number | null; sortOrder: number };
type Person = { id: string; name: string; nickname: string | null; avatarUrl: string | null; cohort: Cohort | null; relationScope: "lineage" | "cohort_guest"; isFeatured: boolean; status: Status; mentorId: string | null; depth: number | null; directStudentIds: string[]; role: string; joinedAt: string; tags: string[]; bio: string; mentor?: Person | null; students?: Person[]; achievements?: unknown[]; attachments?: unknown[]; featuredNote?: string | null };
type Edge = { id: string; mentorId: string; studentId: string };
type Tree = { rootPersonId: string | null; nodes: Person[]; edges: Edge[]; generatedAt: string; demo: boolean };
type LinkSegment = { id: string; mentorId: string; studentId: string; path: string; x1: number; y1: number; x2: number; y2: number; crossCohort: boolean };
type Tone = "gold" | "aqua" | "fog";

const fallbackPeople: Person[] = [
  { id: "demo-person-001", name: "林砚", nickname: "砚叔", avatarUrl: null, cohort: { id: "cohort-2019", label: "2019 届", year: 2019, sortOrder: 0 }, relationScope: "lineage", isFeatured: true, status: "active", mentorId: null, depth: 0, directStudentIds: ["demo-person-002", "demo-person-003"], role: "发起人 / 产品顾问", joinedAt: "2019-06-18", tags: ["产品", "社区"], bio: "从一张白纸开始，记录每一次认真连接。" },
  { id: "demo-person-002", name: "周予安", nickname: null, avatarUrl: null, cohort: { id: "cohort-2021", label: "2021 届", year: 2021, sortOrder: 1 }, relationScope: "lineage", isFeatured: false, status: "active", mentorId: "demo-person-001", depth: 1, directStudentIds: ["demo-person-004", "demo-person-005"], role: "全栈开发者", joinedAt: "2021-03-22", tags: ["工程", "开源"], bio: "喜欢把复杂的问题拆成可以一起走的路。" },
  { id: "demo-person-003", name: "许棠", nickname: null, avatarUrl: null, cohort: { id: "cohort-2021", label: "2021 届", year: 2021, sortOrder: 1 }, relationScope: "lineage", isFeatured: false, status: "active", mentorId: "demo-person-001", depth: 1, directStudentIds: ["demo-person-006"], role: "研究与内容", joinedAt: "2021-04-08", tags: ["研究", "写作"], bio: "在资料、田野和人之间，寻找能被传下去的东西。" },
  { id: "demo-person-004", name: "苏禾", nickname: null, avatarUrl: null, cohort: { id: "cohort-2023", label: "2023 届", year: 2023, sortOrder: 2 }, relationScope: "lineage", isFeatured: false, status: "active", mentorId: "demo-person-002", depth: 2, directStudentIds: [], role: "交互设计师", joinedAt: "2023-09-01", tags: ["设计", "体验"], bio: "让每一个重要的瞬间都被好好看见。" },
  { id: "demo-person-005", name: "陈放", nickname: null, avatarUrl: null, cohort: { id: "cohort-2023", label: "2023 届", year: 2023, sortOrder: 2 }, relationScope: "lineage", isFeatured: false, status: "active", mentorId: "demo-person-002", depth: 2, directStudentIds: [], role: "数据工程师", joinedAt: "2023-10-12", tags: ["数据", "工具"], bio: "把看不见的结构，整理成可被理解的秩序。" },
  { id: "demo-person-006", name: "唐宁", nickname: null, avatarUrl: null, cohort: { id: "cohort-2024", label: "2024 届", year: 2024, sortOrder: 3 }, relationScope: "lineage", isFeatured: false, status: "archived", mentorId: "demo-person-003", depth: 2, directStudentIds: [], role: "社会创新实践者", joinedAt: "2024-03-16", tags: ["公益", "组织"], bio: "在真实世界里验证每一个好想法。" },
];
const fallbackTree: Tree = { rootPersonId: "demo-person-001", nodes: fallbackPeople, edges: fallbackPeople.slice(1).map((person) => ({ id: `edge-${person.id}`, mentorId: person.mentorId!, studentId: person.id })), generatedAt: "2026-10-08T00:00:00.000Z", demo: true };

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tree = ref<Tree>(fallbackTree);
const loading = ref(true);
const apiFailed = ref(false);
const query = ref("");
const selectedPerson = ref<Person | null>(null);
const detailPerson = ref<Person | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const hoveredId = ref<string | null>(null);
const pathname = ref(window.location.pathname);
const expanded = ref<Record<string, boolean>>({});
const skyRef = ref<HTMLCanvasElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const nodeRefs = new Map<string, HTMLElement>();
const links = ref<LinkSegment[]>([]);
const canvasSize = ref({ width: 0, height: 0 });
const popupPosition = ref({ left: 0, top: 0, arrow: 0 });
let starfield: Starfield | null = null;
let resizeObserver: ResizeObserver | null = null;
let centeredOnce = false;
let detailRequestId = 0;

const people = computed(() => tree.value.nodes);
const rootPerson = computed(() => people.value.find((person) => person.id === tree.value.rootPersonId) ?? people.value[0] ?? null);
const groups = computed(() => {
  const map = new Map<string, { cohort: Cohort; members: Person[] }>();
  people.value.forEach((person) => {
    const cohort = person.cohort ?? { id: "uncategorized", label: "未分届次", year: null, sortOrder: 99 };
    const group = map.get(cohort.id) ?? { cohort, members: [] };
    group.members.push(person);
    map.set(cohort.id, group);
  });
  return [...map.values()].sort((a, b) => (a.cohort.year ?? 9999) - (b.cohort.year ?? 9999) || (a.cohort.sortOrder ?? 99) - (b.cohort.sortOrder ?? 99));
});

/**
 * Tidy tree layout on a shared horizontal axis: leaves take consecutive slots, mentors sit centred
 * above their students, cohort guests flank their row, and the whole constellation is centred on zero.
 */
const layout = computed(() => {
  const nodes = people.value;
  const ids = new Set(nodes.map((person) => person.id));
  const cohortRank = new Map(groups.value.map((group, index) => [group.cohort.id, index]));
  const rank = (person: Person) => cohortRank.get(person.cohort?.id ?? "uncategorized") ?? 99;
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, "zh-CN");
  const hasMentor = (person: Person) => Boolean(person.mentorId && person.mentorId !== person.id && ids.has(person.mentorId));
  const lineage = nodes.filter((person) => person.relationScope !== "cohort_guest" || hasMentor(person));
  const guests = nodes.filter((person) => !lineage.includes(person));

  const children = new Map<string, Person[]>();
  lineage.forEach((person) => {
    if (!hasMentor(person)) return;
    const list = children.get(person.mentorId!) ?? [];
    list.push(person);
    children.set(person.mentorId!, list);
  });
  children.forEach((list) => list.sort((a, b) => rank(a) - rank(b) || byName(a, b)));

  const slots = new Map<string, number>();
  const depths = new Map<string, number>();
  let cursor = 0;
  const place = (person: Person, depth: number): number => {
    depths.set(person.id, depth);
    const kids = (children.get(person.id) ?? []).filter((kid) => !depths.has(kid.id));
    if (!kids.length) {
      slots.set(person.id, cursor);
      cursor += 1;
      return slots.get(person.id)!;
    }
    const xs = kids.map((kid) => place(kid, depth + 1));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    slots.set(person.id, x);
    return x;
  };
  const rootId = tree.value.rootPersonId;
  const roots = lineage.filter((person) => !hasMentor(person)).sort((a, b) => Number(b.id === rootId) - Number(a.id === rootId) || rank(a) - rank(b) || byName(a, b));
  roots.forEach((root, index) => {
    if (index > 0) cursor += 0.5;
    place(root, 0);
  });
  // Members caught in a mentor cycle are unreachable from any root; keep them visible anyway.
  lineage.filter((person) => !depths.has(person.id)).forEach((person) => place(person, 0));

  const lineageXs = [...slots.values()];
  const middle = lineageXs.length ? (Math.min(...lineageXs) + Math.max(...lineageXs)) / 2 : 0;
  groups.value.forEach((group) => {
    const rowGuests = guests.filter((guest) => group.members.includes(guest)).sort(byName);
    const rowXs = group.members.filter((member) => slots.has(member.id)).map((member) => slots.get(member.id)!);
    let right = rowXs.length ? Math.max(...rowXs) : middle - 0.5;
    let left = rowXs.length ? Math.min(...rowXs) : middle + 0.5;
    rowGuests.forEach((guest, index) => {
      if (index % 2 === 0) slots.set(guest.id, (right += 1));
      else slots.set(guest.id, (left -= 1));
    });
    // Students of different mentors can land on the same slot; nudge them apart within the row.
    const ordered = group.members.slice().sort((a, b) => slots.get(a.id)! - slots.get(b.id)!);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = slots.get(ordered[index - 1].id)!;
      if (slots.get(ordered[index].id)! < previous + 1) slots.set(ordered[index].id, previous + 1);
    }
  });

  const xs = [...slots.values()];
  const min = xs.length ? Math.min(...xs) : 0;
  const max = xs.length ? Math.max(...xs) : 0;
  const center = (min + max) / 2;
  const offsets = new Map([...slots].map(([id, x]) => [id, x - center]));
  const generations = depths.size ? Math.max(...depths.values()) + 1 : 0;
  return { offsets, span: max - min, generations };
});

const rows = computed(() => groups.value.map((group) => ({ ...group, members: group.members.slice().sort((a, b) => (layout.value.offsets.get(a.id) ?? 0) - (layout.value.offsets.get(b.id) ?? 0)) })));
const formatCohort = (cohort: Cohort | null) => cohort?.year ? `${cohort.year} 届` : "未分届次";
const matchingIds = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  if (!text) return new Set(people.value.map((person) => person.id));
  return new Set(people.value.filter((person) => [person.name, person.nickname ?? "", person.role, formatCohort(person.cohort), ...person.tags].join(" ").toLocaleLowerCase().includes(text)).map((person) => person.id));
});
const detailRouteId = computed(() => {
  const match = pathname.value.match(/^\/person\/([^/]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
});
const isDetailRoute = computed(() => Boolean(detailRouteId.value));
const currentDetail = computed(() => detailRouteId.value ? people.value.find((person) => person.id === detailRouteId.value) ?? null : null);
const detail = computed(() => detailPerson.value ?? currentDetail.value);
const detailMentor = computed(() => {
  const person = detail.value;
  if (!person) return null;
  return person.mentor ?? (person.mentorId ? people.value.find((candidate) => candidate.id === person.mentorId) ?? null : null);
});
const detailStudents = computed(() => {
  const person = detail.value;
  if (!person) return [];
  if (person.students?.length) return person.students;
  const ids = new Set(person.directStudentIds ?? []);
  tree.value.edges.forEach((edge) => { if (edge.mentorId === person.id) ids.add(edge.studentId); });
  return [...ids].map((id) => people.value.find((candidate) => candidate.id === id)).filter((candidate): candidate is Person => Boolean(candidate));
});
const visibleLinks = computed(() => links.value.filter((link) => !query.value || matchingIds.value.has(link.mentorId) || matchingIds.value.has(link.studentId)));
const isVisible = (person: Person) => matchingIds.value.has(person.id);
const relationLabel = (person: Person) => person.status === "archived" ? "已归档" : person.relationScope === "cohort_guest" ? "同届人物" : "在册成员";
const toneOf = (person: Person): Tone => person.status === "archived" ? "fog" : person.isFeatured || person.id === rootPerson.value?.id ? "gold" : "aqua";
const isLinkActive = (link: LinkSegment) => hoveredId.value !== null && (link.mentorId === hoveredId.value || link.studentId === hoveredId.value);

function setNodeRef(id: string, element: Element | null) {
  if (element instanceof HTMLElement) nodeRefs.set(id, element);
  else nodeRefs.delete(id);
}
function normaliseNode(node: Record<string, unknown>, index: number): Person {
  const source = fallbackPeople.find((person) => person.id === node.id) ?? fallbackPeople[index % fallbackPeople.length];
  const rawCohort = node.cohort as Partial<Cohort> | null | undefined;
  const fallbackCohort = source.cohort;
  const rawYear = rawCohort?.year ?? String(rawCohort?.label ?? "").match(/\d{4}/)?.[0];
  const year = rawYear ? Number(rawYear) : (fallbackCohort?.year ?? null);
  const cohort = rawCohort || fallbackCohort ? { ...(fallbackCohort ?? {}), ...(rawCohort ?? {}), id: year ? `cohort-${year}` : String(rawCohort?.id ?? fallbackCohort?.id ?? "uncategorized"), label: year ? `${year} 届` : "未分届次", year, sortOrder: Number(rawCohort?.sortOrder ?? fallbackCohort?.sortOrder ?? 99) } as Cohort : null;
  const directStudentIds = Array.isArray(node.directStudentIds) ? node.directStudentIds.map(String) : source.directStudentIds;
  return { ...source, ...node, id: String(node.id ?? source.id), name: String(node.name ?? source.name), cohort, mentorId: node.mentorId == null ? source.mentorId : String(node.mentorId), directStudentIds, nickname: node.nickname == null ? source.nickname : String(node.nickname), avatarUrl: node.avatarUrl == null ? source.avatarUrl : String(node.avatarUrl), role: String(node.role ?? source.role), joinedAt: String(node.joinedAt ?? source.joinedAt), tags: Array.isArray(node.tags) ? node.tags.map(String) : source.tags, bio: String(node.bio ?? source.bio) } as Person;
}
async function loadTree() {
  loading.value = true;
  try {
    const response = await fetch("/api/tree");
    if (!response.ok) throw new Error("tree unavailable");
    const payload = await response.json() as { data?: { nodes?: Record<string, unknown>[]; edges?: Edge[]; rootPersonId?: string; generatedAt?: string; demo?: boolean } };
    if (!payload.data?.nodes?.length) throw new Error("invalid tree");
    const nodes = payload.data.nodes.map(normaliseNode);
    const ids = new Set(nodes.map((person) => person.id));
    const edges = (payload.data.edges ?? []).filter((edge) => ids.has(edge.mentorId) && ids.has(edge.studentId)).map((edge) => ({ id: String(edge.id ?? `${edge.mentorId}::${edge.studentId}`), mentorId: String(edge.mentorId), studentId: String(edge.studentId) }));
    tree.value = { rootPersonId: payload.data.rootPersonId && ids.has(payload.data.rootPersonId) ? payload.data.rootPersonId : nodes[0].id, nodes, edges, generatedAt: payload.data.generatedAt ?? new Date().toISOString(), demo: Boolean(payload.data.demo) };
    apiFailed.value = false;
  } catch {
    apiFailed.value = true;
    tree.value = fallbackTree;
  } finally {
    expanded.value = Object.fromEntries(groups.value.map((group) => [group.cohort.id, true]));
    loading.value = false;
    await nextTick();
    observeCanvas();
    measureGraph();
    if (detailRouteId.value) {
      const routePerson = people.value.find((person) => person.id === detailRouteId.value);
      if (routePerson && detailPerson.value?.id !== routePerson.id) void openDetail(routePerson);
    }
  }
}
function toggleGroup(id: string) {
  expanded.value[id] = expanded.value[id] === false;
  if (selectedPerson.value?.cohort?.id === id) selectedPerson.value = null;
  nextTick(measureGraph);
}
function closePreview() { selectedPerson.value = null; }
function navigate(path: string) {
  window.history.pushState({}, "", path);
  pathname.value = path;
  selectedPerson.value = null;
  detailPerson.value = null;
  detailError.value = null;
  hoveredId.value = null;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  if (path === "/") {
    centeredOnce = false;
    nextTick(() => { observeCanvas(); measureGraph(); });
  } else {
    const routeId = path.match(/^\/person\/([^/]+)/)?.[1];
    if (routeId) {
      let id = routeId;
      try { id = decodeURIComponent(routeId); } catch { /* keep the encoded id for the API */ }
      const local = people.value.find((person) => person.id === id) ?? fallbackPeople.find((person) => person.id === id);
      if (local) void openDetail(local);
      else void openDetailById(id);
    }
  }
}
function onPopState() {
  pathname.value = window.location.pathname;
  selectedPerson.value = null;
  detailPerson.value = null;
  detailError.value = null;
  if (detailRouteId.value) void openDetailById(detailRouteId.value);
  else nextTick(() => { observeCanvas(); measureGraph(); });
}
async function openDetail(person: Person) {
  await openDetailById(person.id, person);
}
async function openDetailById(id: string, localPerson?: Person) {
  const requestId = ++detailRequestId;
  const fallback = localPerson ?? people.value.find((person) => person.id === id) ?? fallbackPeople.find((person) => person.id === id) ?? null;
  detailLoading.value = true;
  detailError.value = null;
  detailPerson.value = fallback;
  try {
    const response = await fetch(`/api/people/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(response.status === 404 ? "档案不存在" : "档案暂时无法读取");
    const payload = await response.json() as { data?: Record<string, unknown> };
    if (!payload.data) throw new Error("档案数据为空");
    if (requestId === detailRequestId) detailPerson.value = normaliseNode({ ...(fallback ?? {}), ...payload.data, id }, 0);
  } catch (error) {
    if (requestId !== detailRequestId) return;
    detailError.value = error instanceof Error ? error.message : "档案暂时无法读取";
    if (!fallback) detailPerson.value = null;
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false;
  }
}
function viewDetail(person: Person) { navigate(`/person/${encodeURIComponent(person.id)}`); }
function coreRect(id: string) {
  const node = nodeRefs.get(id);
  return (node?.querySelector(".star-avatar-core") ?? node)?.getBoundingClientRect() ?? null;
}
function openPreview(person: Person) {
  const rect = coreRect(person.id);
  if (rect) sparkle(rect.left + rect.width / 2, rect.top + rect.height / 2, toneOf(person) === "aqua" ? "aqua" : "gold", 26);
  selectedPerson.value = selectedPerson.value?.id === person.id ? null : person;
  void nextTick().then(measurePopup);
}
function measureGraph() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const canvasRect = canvas.getBoundingClientRect();
  canvasSize.value = { width: canvas.scrollWidth, height: canvas.scrollHeight };
  const studentCohort = new Map(people.value.map((person) => [person.id, person.cohort?.id ?? ""]));
  const rowIndex = new Map(groups.value.map((group, index) => [group.cohort.id, index]));
  links.value = tree.value.edges.flatMap((edge) => {
    const mentor = nodeRefs.get(edge.mentorId);
    const from = coreRect(edge.mentorId);
    const to = coreRect(edge.studentId);
    if (!mentor || !from || !to) return [];
    const x1 = from.left - canvasRect.left + from.width / 2;
    const y1 = mentor.getBoundingClientRect().bottom - canvasRect.top + 6;
    const x2 = to.left - canvasRect.left + to.width / 2;
    const y2 = to.top - canvasRect.top - 12;
    const bend = Math.max(24, (y2 - y1) * 0.55);
    const skipped = Math.abs((rowIndex.get(studentCohort.get(edge.studentId) ?? "") ?? 0) - (rowIndex.get(studentCohort.get(edge.mentorId) ?? "") ?? 0)) > 1;
    return [{ id: `${edge.mentorId}::${edge.studentId}`, mentorId: edge.mentorId, studentId: edge.studentId, x1, y1, x2, y2, crossCohort: skipped, path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${(y1 + bend).toFixed(1)}, ${x2.toFixed(1)} ${(y2 - bend).toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}` }];
  });
  const scroller = scrollRef.value;
  if (scroller && !centeredOnce && scroller.scrollWidth > scroller.clientWidth) {
    scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    centeredOnce = true;
  }
}
function measurePopup() {
  const stage = stageRef.value;
  const person = selectedPerson.value;
  if (!stage || !person) return;
  const node = nodeRefs.get(person.id);
  const core = coreRect(person.id);
  if (!node || !core) return;
  const stageRect = stage.getBoundingClientRect();
  const width = popoverRef.value?.offsetWidth ?? 300;
  const center = core.left - stageRect.left + core.width / 2;
  const left = Math.max(8, Math.min(center - width / 2, stageRect.width - width - 8));
  popupPosition.value = { left, top: node.getBoundingClientRect().bottom - stageRect.top + 14, arrow: Math.max(22, Math.min(center - left, width - 22)) };
}
function observeCanvas() {
  resizeObserver?.disconnect();
  if (canvasRef.value) resizeObserver?.observe(canvasRef.value);
}
// Stars scale in on entry, so trails measured mid-animation need a final pass once they settle.
function onStarSettled(event: AnimationEvent) { if (event.animationName === "star-rise") onResize(); }
function onTreeScroll() { if (selectedPerson.value) measurePopup(); }
function onResize() { measureGraph(); if (selectedPerson.value) measurePopup(); }
function onKeydown(event: KeyboardEvent) { if (event.key === "Escape") closePreview(); }
function onPointerDown(event: PointerEvent) {
  const target = event.target as Element | null;
  if (selectedPerson.value && target && !target.closest(".quick-popover, .star-node")) closePreview();
}

watch([query, expanded, layout], () => nextTick(() => { measureGraph(); requestAnimationFrame(measureGraph); }), { deep: true });
onMounted(() => {
  if (skyRef.value) starfield = mountStarfield(skyRef.value);
  resizeObserver = new ResizeObserver(() => onResize());
  void loadTree();
  window.addEventListener("popstate", onPopState);
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pointerdown", onPointerDown);
  if (detailRouteId.value) void openDetailById(detailRouteId.value);
});
onUnmounted(() => {
  starfield?.destroy();
  resizeObserver?.disconnect();
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("pointerdown", onPointerDown);
});
</script>
<template>
  <div class="app-shell">
    <div class="sky" aria-hidden="true">
      <div class="sky-nebula"></div>
      <div class="sky-milkyway"></div>
      <canvas ref="skyRef" class="sky-canvas"></canvas>
      <div class="sky-vignette"></div>
    </div>

    <header class="site-header">
      <a class="brand" href="/" @click.prevent="navigate('/')">
        <span class="brand-sigil" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5-.5-5.6-4.9-10-10.5-10.5C7.1 11.5 11.5 7.1 12 1.5Z" /></svg>
        </span>
        <span class="brand-name">翻斗星谱<small>FANDOU LINEAGE ARCHIVE</small></span>
      </a>
      <div class="header-meta">
        <span class="status-dot" :class="{ offline: apiFailed }"></span>
        <span>{{ apiFailed ? "本地演示资料" : "星谱已连接" }}</span>
        <span class="read-only">只读档案</span>
      </div>
    </header>

    <main v-if="!isDetailRoute" class="home-page">
      <section class="hero">
        <p class="eyebrow">THE LINEAGE CONSTELLATION</p>
        <h1>让每颗星，<em>找到自己的轨道。</em></h1>
        <p class="hero-description">上一届是下一届的师傅。同届成员并肩排列，跨届的牵引会沿着更长的轨迹抵达。</p>
        <div class="hero-stats">
          <div><strong>{{ people.length }}</strong><span>颗星</span></div>
          <div><strong>{{ groups.length }}</strong><span>条届次轨道</span></div>
          <div><strong>{{ layout.generations }}</strong><span>代传承</span></div>
        </div>
      </section>

      <section class="toolbar">
        <label class="search-field">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input v-model="query" type="search" placeholder="搜索姓名、方向或届次" aria-label="搜索姓名、方向或届次" />
          <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">×</button>
        </label>
        <div class="legend">
          <span v-if="query" class="legend-count">匹配 {{ matchingIds.size }} 颗星</span>
          <span class="legend-item"><i class="legend-star gold"></i>星源 / 重点</span>
          <span class="legend-item"><i class="legend-star aqua"></i>在册</span>
          <span class="legend-item"><i class="legend-star fog"></i>已归档</span>
          <span class="legend-item"><i class="legend-line"></i>传承轨迹</span>
        </div>
      </section>
      <section ref="stageRef" class="star-stage" aria-label="成员星谱">
        <div v-if="loading" class="state-message"><span class="loading-ring"></span>正在整理星谱</div>
        <template v-else>
          <div class="star-stage-meta"><span>ROOT TO CONSTELLATION</span><span>更新于 {{ tree.generatedAt.slice(0, 10) }}</span></div>
          <div ref="scrollRef" class="tree-scroll" @scroll.passive="onTreeScroll">
            <div ref="canvasRef" class="tree-canvas" :style="{ '--span': layout.span }" @animationend="onStarSettled">
              <svg class="line-layer" :width="canvasSize.width" :height="canvasSize.height" :viewBox="`0 0 ${canvasSize.width} ${canvasSize.height}`" aria-hidden="true">
                <defs>
                  <filter id="spark-glow" x="-300%" y="-300%" width="700%" height="700%">
                    <feGaussianBlur stdDeviation="2.4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <linearGradient v-for="(link, index) in visibleLinks" :id="`trail-${index}`" :key="link.id" gradientUnits="userSpaceOnUse" :x1="link.x1" :y1="link.y1" :x2="link.x2" :y2="link.y2">
                    <stop offset="0" stop-color="#e7c982" stop-opacity=".9" />
                    <stop offset="1" stop-color="#8ed9d0" stop-opacity=".7" />
                  </linearGradient>
                </defs>
                <g v-for="(link, index) in visibleLinks" :key="link.id" class="trail" :class="{ 'cross-cohort': link.crossCohort, active: isLinkActive(link) }">
                  <path class="trail-glow" :d="link.path" />
                  <path class="trail-line" :d="link.path" :stroke="`url(#trail-${index})`" :pathLength="link.crossCohort ? undefined : 1" />
                  <circle v-if="!reducedMotion" :key="link.path" class="trail-spark" r="2.2" filter="url(#spark-glow)" visibility="hidden">
                    <!-- Hidden until its motion starts, otherwise the spark idles at the SVG origin. -->
                    <set attributeName="visibility" to="visible" :begin="`${1.6 + (index % 5) * 0.55}s`" />
                    <animateMotion :path="link.path" :dur="`${3.4 + (index % 4) * 0.7}s`" :begin="`${1.6 + (index % 5) * 0.55}s`" repeatCount="indefinite" />
                  </circle>
                </g>
              </svg>

              <div v-for="(group, rowIndex) in rows" :key="group.cohort.id" class="cohort-row" :class="{ collapsed: expanded[group.cohort.id] === false }">
                <div class="orbit-label">
                  <span class="orbit-year">{{ group.cohort.year ? String(group.cohort.year).slice(-2) : "··" }}</span>
                  <div class="orbit-text">
                    <span class="cohort-kicker">ORBIT {{ String(rowIndex + 1).padStart(2, "0") }}</span>
                    <h2>{{ formatCohort(group.cohort) }}</h2>
                    <span class="orbit-count">{{ group.members.length }} 颗星</span>
                  </div>
                  <button class="collapse-button" type="button" :aria-expanded="expanded[group.cohort.id] !== false" :aria-label="`${expanded[group.cohort.id] === false ? '展开' : '收起'} ${formatCohort(group.cohort)}`" @click="toggleGroup(group.cohort.id)">{{ expanded[group.cohort.id] === false ? "+" : "−" }}</button>
                </div>
                <div class="orbit-line" aria-hidden="true"></div>
                <div v-if="expanded[group.cohort.id] !== false" class="orbit-track">
                  <button
                    v-for="(person, index) in group.members"
                    :key="person.id"
                    :ref="(el) => setNodeRef(person.id, el as Element)"
                    class="star-node"
                    :class="{ dimmed: query && !isVisible(person), highlighted: query && isVisible(person), root: person.id === rootPerson?.id, guest: person.relationScope === 'cohort_guest', selected: selectedPerson?.id === person.id }"
                    :style="{ '--x': layout.offsets.get(person.id) ?? 0, '--delay': `${rowIndex * 140 + index * 60}ms` }"
                    type="button"
                    :aria-label="`${person.name}，${formatCohort(person.cohort)}`"
                    :aria-expanded="selectedPerson?.id === person.id"
                    @click="openPreview(person)"
                    @mouseenter="hoveredId = person.id"
                    @mouseleave="hoveredId = null"
                    @focus="hoveredId = person.id"
                    @blur="hoveredId = null"
                  >
                    <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="toneOf(person)" :size="person.id === rootPerson?.id ? 'lg' : 'md'" />
                    <span class="star-name">{{ person.name }}</span>
                    <span v-if="person.id === rootPerson?.id" class="star-badge">星源</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="query && matchingIds.size === 0" class="state-message empty">没有找到对应人物 <button type="button" @click="query = ''">清除搜索</button></div>
          <div
            v-if="selectedPerson"
            ref="popoverRef"
            class="quick-popover"
            :style="{ left: `${popupPosition.left}px`, top: `${popupPosition.top}px`, '--arrow': `${popupPosition.arrow}px` }"
            role="dialog"
            :aria-label="`${selectedPerson.name}简介`"
          >
            <button class="popover-close" type="button" aria-label="关闭简介" @click="closePreview">×</button>
            <span class="popover-kicker">{{ formatCohort(selectedPerson.cohort) }} · {{ relationLabel(selectedPerson) }}</span>
            <div class="popover-person">
              <StarAvatar :name="selectedPerson.name" :avatar-url="selectedPerson.avatarUrl" :tone="toneOf(selectedPerson)" size="sm" />
              <div>
                <h2>{{ selectedPerson.name }}</h2>
                <p>{{ selectedPerson.role }}</p>
              </div>
            </div>
            <p class="popover-copy">{{ selectedPerson.bio }}</p>
            <div class="tag-row compact"><span v-for="tag in selectedPerson.tags" :key="tag" class="tag">{{ tag }}</span></div>
            <button class="popover-detail" type="button" @click="viewDetail(selectedPerson)">查看完整档案 <span aria-hidden="true">↗</span></button>
          </div>
        </template>
      </section>
      <footer class="page-footer"><span>翻斗星谱 · 早期演示版</span><span>资料仅用于界面演示，真实成员档案接入中</span></footer>
    </main>
    <main v-else class="detail-page" aria-live="polite">
      <button class="back-link" type="button" @click="navigate('/')">← 返回星谱</button>
      <div v-if="detail" class="detail-layout">
        <section class="detail-intro">
          <p class="eyebrow">PERSONAL ARCHIVE <span>{{ formatCohort(detail.cohort) }}</span></p>
          <div class="detail-avatar">
            <StarAvatar :name="detail.name" :avatar-url="detail.avatarUrl" :tone="toneOf(detail)" size="xl" />
          </div>
          <h1>{{ detail.name }}</h1>
          <p class="detail-role">{{ detail.role }}</p>
          <div class="tag-row"><span v-for="tag in detail.tags" :key="tag" class="tag">{{ tag }}</span></div>
          <span class="record-note"><i></i>{{ relationLabel(detail) }} · 演示档案</span>
        </section>
        <section class="detail-sections">
          <article class="detail-section">
            <span class="section-label">01 / 简介</span>
            <p class="detail-copy">{{ detail.bio }}</p>
          </article>
          <article class="detail-section split-section">
            <div>
              <span class="section-label">02 / 关系</span>
              <h2>{{ detailMentor ? "沿着一条主线继续" : "谱系起点" }}</h2>
              <p>{{ detailMentor ? "这位成员从上一届连接而来，并把自己的经验继续传给下一位。" : "从这里出发，连接仍在发生。" }}</p>
              <button v-if="detailMentor" class="popover-detail" type="button" @click="viewDetail(detailMentor)">师傅：{{ detailMentor.name }} <span aria-hidden="true">↗</span></button>
              <p v-else class="relation-muted">暂无已记录的师傅</p>
              <div v-if="detailStudents.length" class="relation-students">
                <span class="section-label">传给下一届</span>
                <button v-for="student in detailStudents" :key="student.id" class="popover-detail" type="button" @click="viewDetail(student)">学生：{{ student.name }} <span aria-hidden="true">↗</span></button>
              </div>
            </div>
            <div>
              <span class="section-label">03 / 加入时间</span>
              <h2>{{ detail.joinedAt }}</h2>
              <p>{{ formatCohort(detail.cohort) }}</p>
            </div>
          </article>
          <article class="detail-section">
            <span class="section-label">04 / 事迹与附件</span>
            <div class="empty-detail"><span>＋</span><p>尚未添加事迹、荣誉或附件。</p></div>
          </article>
        </section>
      </div>
      <div v-else class="state-message">
        <span v-if="detailLoading" class="loading-ring"></span>
        <span>{{ detailLoading ? "正在读取档案" : (detailError ?? "没有找到这份档案") }}</span>
        <button v-if="detailError" type="button" @click="detailRouteId && openDetailById(detailRouteId)">重试</button>
      </div>
      <p v-if="detail && detailError" class="state-message" role="status">{{ detailError }}，当前显示本地演示资料。</p>
    </main>
  </div>
</template>
