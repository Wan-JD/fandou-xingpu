<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import InviteRegistration from "./components/InviteRegistration.vue";
import ClaimRegistration from "./components/ClaimRegistration.vue";
import AdminPanel from "./components/AdminPanel.vue";
import StarAvatar from "./components/StarAvatar.vue";
import ProfilePage from "./components/profile/ProfilePage.vue";
import StudentStudio from "./components/students/StudentStudio.vue";
import { apiErrorMessage } from "./lib/api";
import {
  destinationClass, destinationLabel, destinationLabels, formatCohort, groupRoleClass, groupRoleLabels, membershipLabel, membershipLabels,
  normaliseNode, relationLabel, toneFor, type Cohort, type Person, type SessionUser, type Tone,
} from "./lib/people";
import { mountStarfield, sparkle, type Starfield } from "./lib/starfield";
import { warpTo } from "./lib/warp";

type Edge = { id: string; mentorId: string; studentId: string };
type Tree = { rootPersonId: string | null; nodes: Person[]; edges: Edge[]; generatedAt: string };
type LinkSegment = { id: string; mentorId: string; studentId: string; path: string; x1: number; y1: number; x2: number; y2: number; crossCohort: boolean };
type AuthMode = "login" | "register";

const emptyTree: Tree = { rootPersonId: null, nodes: [], edges: [], generatedAt: new Date(0).toISOString() };

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tree = ref<Tree>(emptyTree);
const loading = ref(true);
const apiFailed = ref(false);
const query = ref("");
const selectedPerson = ref<Person | null>(null);
const hoveredId = ref<string | null>(null);
const pathname = ref(window.location.pathname);
const search = ref(window.location.search);
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
const sessionToken = ref(localStorage.getItem("fandou-session"));
const sessionUser = ref<SessionUser | null>(null);
const sessionLoading = ref(Boolean(sessionToken.value));
const authOpen = ref(false);
const authMode = ref<AuthMode>("login");
const authLoading = ref(false);
const authError = ref<string | null>(null);
const authForm = ref({ identifier: "", password: "" });
const passwordChangeOpen = ref(false);
const passwordChangeSaving = ref(false);
const passwordChangeError = ref("");
const passwordChangeForm = ref({ currentPassword: "", newPassword: "", confirmPassword: "" });
let starfield: Starfield | null = null;
let resizeObserver: ResizeObserver | null = null;
let centeredOnce = false;

const people = computed(() => tree.value.nodes);
const rootPerson = computed(() => people.value.find((person) => person.id === tree.value.rootPersonId) ?? people.value[0] ?? null);
const groups = computed(() => {
  const map = new Map<string, { cohort: Cohort; members: Person[] }>();
  people.value.forEach((person) => {
    const cohort = person.cohort ?? { id: "uncategorized", label: "未分级", year: null, sortOrder: 99 };
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
const matchingIds = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  if (!text) return new Set(people.value.map((person) => person.id));
  return new Set(people.value.filter((person) => [
    person.name, person.role, formatCohort(person.cohort), relationLabel(person),
    person.memberType ? membershipLabels[person.memberType] : "", person.destination ? destinationLabels[person.destination] : "",
    person.groupRole ? groupRoleLabels[person.groupRole] : "", ...person.tags,
  ].join(" ").toLocaleLowerCase().includes(text)).map((person) => person.id));
});
const detailRouteId = computed(() => {
  const match = pathname.value.match(/^\/person\/([^/]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
});
const isDetailRoute = computed(() => Boolean(detailRouteId.value));
const isRegisterRoute = computed(() => pathname.value === "/register");
const isClaimRoute = computed(() => pathname.value === "/claim");
const isAdminRoute = computed(() => pathname.value === "/admin");
const isStudentsRoute = computed(() => pathname.value === "/students");
const isHomeRoute = computed(() => !isDetailRoute.value && !isRegisterRoute.value && !isClaimRoute.value && !isAdminRoute.value && !isStudentsRoute.value);
const inviteToken = computed(() => new URLSearchParams(search.value).get("invite") ?? "");
const claimToken = computed(() => new URLSearchParams(search.value).get("token") ?? "");
const focusId = computed(() => new URLSearchParams(search.value).get("focus"));
const myPersonId = computed(() => sessionUser.value?.personId ?? null);
const visibleLinks = computed(() => links.value.filter((link) => !query.value || matchingIds.value.has(link.mentorId) || matchingIds.value.has(link.studentId)));
const isVisible = (person: Person) => matchingIds.value.has(person.id);
const toneOf = (person: Person): Tone => toneFor(person, rootPerson.value?.id);
const legendDestinations = Object.entries(destinationLabels) as Array<[keyof typeof destinationLabels, string]>;
const isLinkActive = (link: LinkSegment) => hoveredId.value !== null && (link.mentorId === hoveredId.value || link.studentId === hoveredId.value);

function setNodeRef(id: string, element: Element | null) {
  if (element instanceof HTMLElement) nodeRefs.set(id, element);
  else nodeRefs.delete(id);
}
async function loadTree() {
  loading.value = true;
  try {
    const response = await fetch("/api/tree");
    if (!response.ok) throw new Error("tree unavailable");
    const payload = await response.json() as { data?: { nodes?: Record<string, unknown>[]; edges?: Edge[]; rootPersonId?: string; generatedAt?: string } };
    if (!Array.isArray(payload.data?.nodes)) throw new Error("invalid tree");
    const nodes = payload.data.nodes.map(normaliseNode);
    const ids = new Set(nodes.map((person) => person.id));
    const edges = (payload.data.edges ?? []).filter((edge) => ids.has(edge.mentorId) && ids.has(edge.studentId)).map((edge) => ({ id: String(edge.id ?? `${edge.mentorId}::${edge.studentId}`), mentorId: String(edge.mentorId), studentId: String(edge.studentId) }));
    tree.value = { rootPersonId: payload.data.rootPersonId && ids.has(payload.data.rootPersonId) ? payload.data.rootPersonId : (nodes[0]?.id ?? null), nodes, edges, generatedAt: payload.data.generatedAt ?? new Date().toISOString() };
    apiFailed.value = false;
  } catch {
    apiFailed.value = true;
    tree.value = emptyTree;
  } finally {
    expanded.value = Object.fromEntries(groups.value.map((group) => [group.cohort.id, true]));
    loading.value = false;
    await nextTick();
    observeCanvas();
    measureGraph();
    if (isHomeRoute.value && focusId.value) focusStar(focusId.value);
  }
}
function clearSession() {
  sessionToken.value = null;
  sessionUser.value = null;
  localStorage.removeItem("fandou-session");
  passwordChangeOpen.value = false;
  passwordChangeForm.value = { currentPassword: "", newPassword: "", confirmPassword: "" };
}
async function loadSession() {
  const token = sessionToken.value;
  if (!token) {
    sessionLoading.value = false;
    return;
  }
  sessionLoading.value = true;
  try {
    const response = await fetch("/api/session", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("session unavailable");
    const payload = await response.json() as { data?: { user?: SessionUser } };
    if (!payload.data?.user) throw new Error("invalid session");
    sessionUser.value = payload.data.user;
    if (payload.data.user.mustChangePassword) passwordChangeOpen.value = true;
  } catch {
    clearSession();
  } finally {
    sessionLoading.value = false;
  }
}
function setAuthMode(mode: AuthMode) {
  authMode.value = mode;
  authError.value = null;
  if (mode === "login") authForm.value = { identifier: "", password: "" };
}
function openAuth(mode: AuthMode = "login") {
  setAuthMode(mode);
  authOpen.value = true;
}
function closeAuth() {
  if (authLoading.value) return;
  authOpen.value = false;
  authError.value = null;
}
async function submitAuth() {
  if (authMode.value !== "login") return;
  authLoading.value = true;
  authError.value = null;
  try {
    const response = await fetch("/api/session/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(authForm.value) });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "登录失败"));
    const payload = await response.json() as { data?: { token?: string; user?: SessionUser } };
    if (!payload.data?.token || !payload.data.user) throw new Error("会话数据不完整");
    sessionToken.value = payload.data.token;
    sessionUser.value = payload.data.user;
    localStorage.setItem("fandou-session", payload.data.token);
    authOpen.value = false;
    if (payload.data.user.mustChangePassword) {
      passwordChangeForm.value.currentPassword = authForm.value.password;
      passwordChangeOpen.value = true;
    }
    // Signing in from a profile or workspace keeps the visitor where they were.
    if (isHomeRoute.value) navigate(`/person/${encodeURIComponent(payload.data.user.personId)}`);
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "暂时无法连接账号服务";
  } finally {
    authLoading.value = false;
  }
}
async function changePassword() {
  if (!sessionToken.value || passwordChangeSaving.value) return;
  if (passwordChangeForm.value.newPassword.length < 8) { passwordChangeError.value = "新密码至少 8 位"; return; }
  if (passwordChangeForm.value.newPassword !== passwordChangeForm.value.confirmPassword) { passwordChangeError.value = "两次输入的新密码不一致"; return; }
  passwordChangeSaving.value = true;
  passwordChangeError.value = "";
  try {
    const response = await fetch("/api/session/password", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken.value}` }, body: JSON.stringify({ currentPassword: passwordChangeForm.value.currentPassword, newPassword: passwordChangeForm.value.newPassword }) });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "密码修改失败"));
    passwordChangeOpen.value = false;
    passwordChangeForm.value = { currentPassword: "", newPassword: "", confirmPassword: "" };
    if (sessionUser.value) sessionUser.value = { ...sessionUser.value, mustChangePassword: false };
  } catch (error) { passwordChangeError.value = error instanceof Error ? error.message : "密码修改失败"; }
  finally { passwordChangeSaving.value = false; }
}
async function logout() {
  const token = sessionToken.value;
  clearSession();
  if (token) await fetch("/api/session", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
}
function openMyProfile() {
  if (!sessionUser.value) {
    openAuth();
    return;
  }
  navigate(`/person/${encodeURIComponent(sessionUser.value.personId)}`);
}
async function refreshAfterAdminChange() {
  await Promise.all([loadTree(), loadSession()]);
}
function toggleGroup(id: string) {
  expanded.value[id] = expanded.value[id] === false;
  if (selectedPerson.value?.cohort?.id === id) selectedPerson.value = null;
  nextTick(measureGraph);
}
function closePreview() { selectedPerson.value = null; }
function applyLocation() {
  pathname.value = window.location.pathname;
  search.value = window.location.search;
  selectedPerson.value = null;
  hoveredId.value = null;
  if (isHomeRoute.value) {
    centeredOnce = false;
    nextTick(() => {
      observeCanvas();
      measureGraph();
      if (focusId.value) focusStar(focusId.value);
    });
  }
}
function navigate(path: string) {
  const target = new URL(path, window.location.origin);
  if (target.pathname + target.search !== window.location.pathname + window.location.search) window.history.pushState({}, "", target.pathname + target.search);
  applyLocation();
  window.scrollTo({ top: 0, behavior: "auto" });
}
/** Route changes that start from a star bloom into the destination page. */
function go(path: string, origin?: DOMRect | null, tone: Tone = "aqua") {
  if (origin && path.startsWith("/person/")) void warpTo(origin, tone, () => navigate(path));
  else navigate(path);
}
function onPopState() { applyLocation(); }
function viewDetail(person: Person) {
  go(`/person/${encodeURIComponent(person.id)}`, coreRect(person.id), toneOf(person));
}
/** Centres a member's star in the map (used by “在星谱中定位”) and opens its preview. */
function focusStar(id: string) {
  const person = people.value.find((item) => item.id === id);
  if (!person) return;
  query.value = "";
  if (person.cohort && expanded.value[person.cohort.id] === false) expanded.value[person.cohort.id] = true;
  nextTick(() => {
    const node = nodeRefs.get(id);
    const scroller = scrollRef.value;
    if (!node || !scroller) return;
    const nodeRect = node.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollLeft += nodeRect.left + nodeRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2);
    centeredOnce = true;
    node.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    window.setTimeout(() => { selectedPerson.value = null; openPreview(person); node.focus({ preventScroll: true }); }, reducedMotion ? 0 : 450);
  });
}
function onPersonUpdated(updated: Person) {
  tree.value.nodes = tree.value.nodes.map((node) => node.id === updated.id ? {
    ...node, avatarUrl: updated.avatarUrl, bio: updated.bio, motto: updated.motto, destination: updated.destination, memberType: updated.memberType,
    groupRole: updated.groupRole, version: updated.version, education: updated.education, experience: updated.experience, skills: updated.skills, links: updated.links,
  } : node);
}
function onSessionExpired() {
  clearSession();
  openAuth();
  authError.value = "会话已失效，请重新登录";
}
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
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (authOpen.value) closeAuth();
  else closePreview();
}
function onPointerDown(event: PointerEvent) {
  const target = event.target as Element | null;
  if (selectedPerson.value && target && !target.closest(".quick-popover, .star-node")) closePreview();
}

watch([query, expanded, layout], () => nextTick(() => { measureGraph(); requestAnimationFrame(measureGraph); }), { deep: true });
onMounted(() => {
  if (skyRef.value) starfield = mountStarfield(skyRef.value);
  resizeObserver = new ResizeObserver(() => onResize());
  void loadTree();
  void loadSession();
  window.addEventListener("popstate", onPopState);
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pointerdown", onPointerDown);
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
        <span class="brand-name">翻斗星谱<small>FANDOU LINEAGE</small></span>
      </a>
      <nav class="site-nav" aria-label="主导航">
        <a href="/" :class="{ active: isHomeRoute }" :aria-current="isHomeRoute ? 'page' : undefined" @click.prevent="navigate('/')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c.3 3.6 3.2 6.4 6.8 6.8-3.6.3-6.5 3.2-6.8 6.8-.3-3.6-3.2-6.5-6.8-6.8 3.6-.4 6.5-3.2 6.8-6.8Z" /><circle cx="19" cy="19" r="1.2" /><circle cx="5" cy="18" r="1" /></svg><span>星谱</span>
        </a>
        <a v-if="sessionUser" :href="`/person/${encodeURIComponent(sessionUser.personId)}`" :class="{ active: detailRouteId === myPersonId }" :aria-current="detailRouteId === myPersonId ? 'page' : undefined" @click.prevent="openMyProfile">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg><span>我的主页</span>
        </a>
        <a v-if="sessionUser" href="/students" :class="{ active: isStudentsRoute }" :aria-current="isStudentsRoute ? 'page' : undefined" @click.prevent="navigate('/students')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="2.2" /><circle cx="6" cy="17" r="2.2" /><circle cx="18" cy="17" r="2.2" /><path d="M11 7.5 7 15M13 7.5l4 7.5" /></svg><span>徒弟管理</span>
        </a>
        <a v-if="sessionUser?.role === 'admin'" href="/admin" :class="{ active: isAdminRoute }" :aria-current="isAdminRoute ? 'page' : undefined" @click.prevent="navigate('/admin')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></svg><span>管理</span>
        </a>
      </nav>
      <div class="header-meta">
        <template v-if="apiFailed">
          <span class="status-dot offline"></span>
          <span>星谱暂离线</span>
        </template>
        <button v-if="!sessionUser" class="account-entry" type="button" :disabled="sessionLoading" @click="openAuth()">
          <span class="account-orb" aria-hidden="true"></span>
          {{ sessionLoading ? "读取账号" : "登录 / 加入" }}
        </button>
        <template v-else>
          <button class="account-chip" type="button" :title="`${sessionUser.displayName} 的主页`" @click="openMyProfile">
            <StarAvatar :name="sessionUser.displayName" :avatar-url="people.find((item) => item.id === sessionUser?.personId)?.avatarUrl ?? null" tone="gold" size="sm" />
            <span>{{ sessionUser.displayName }}</span>
          </button>
          <button class="account-logout" type="button" aria-label="退出登录" @click="logout">退出</button>
        </template>
      </div>
    </header>

    <main v-if="isRegisterRoute" class="detail-page" aria-live="polite">
      <InviteRegistration :token="inviteToken" />
    </main>
    <main v-else-if="isClaimRoute" class="detail-page" aria-live="polite">
      <ClaimRegistration :token="claimToken" />
    </main>
    <main v-else-if="isAdminRoute" class="detail-page" aria-live="polite">
      <AdminPanel v-if="sessionUser?.role === 'admin' && sessionToken" :session-token="sessionToken" @changed="refreshAfterAdminChange" />
      <section v-else class="state-message" role="status"><p>管理员账号登录后才能打开维护工作台。</p><button type="button" @click="() => openAuth()">登录管理员账号</button></section>
    </main>
    <main v-else-if="isStudentsRoute" class="workspace-page" aria-live="polite">
      <StudentStudio
        v-if="sessionUser && sessionToken"
        :key="sessionUser.personId"
        :session-token="sessionToken"
        :session-user="sessionUser"
        :people="people"
        :root-person-id="rootPerson?.id ?? null"
        @navigate="go"
        @changed="loadTree"
        @session-expired="onSessionExpired"
      />
      <section v-else-if="!sessionLoading" class="state-message" role="status"><p>登录后可以管理自己的徒弟、邀请和代建账号。</p><button type="button" @click="() => openAuth()">登录</button></section>
      <div v-else class="state-message"><span class="loading-ring"></span>正在读取账号</div>
    </main>
    <main v-else-if="isDetailRoute && detailRouteId" class="workspace-page" aria-live="polite">
      <ProfilePage
        :person-id="detailRouteId"
        :people="people"
        :root-person-id="rootPerson?.id ?? null"
        :session-token="sessionToken"
        :session-user="sessionUser"
        @navigate="go"
        @person-updated="onPersonUpdated"
        @require-auth="openAuth()"
        @session-expired="onSessionExpired"
      />
    </main>
    <main v-else class="home-page">
      <section class="hero">
        <p class="eyebrow">THE LINEAGE CONSTELLATION</p>
        <h1>让每颗星，<em>找到自己的轨道。</em></h1>
        <div class="hero-stats">
          <div><strong>{{ people.length }}</strong><span>颗星</span></div>
          <div><strong>{{ groups.length }}</strong><span>条级别轨道</span></div>
          <div><strong>{{ layout.generations }}</strong><span>代传承</span></div>
        </div>
      </section>

      <section class="toolbar">
        <label class="search-field">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input v-model="query" type="search" placeholder="搜索姓名、方向、级别或去向" aria-label="搜索姓名、方向、级别或去向" />
          <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">×</button>
        </label>
        <div class="legend">
          <span v-if="query" class="legend-count">匹配 {{ matchingIds.size }} 颗星</span>
          <span class="legend-item"><i class="legend-star aqua"></i>在读</span>
          <span class="legend-item"><i class="legend-star fog"></i>毕业</span>
          <span v-for="[value, label] in legendDestinations" :key="value" class="legend-item destination-key" :class="`destination-${value}`"><i></i>{{ label }}</span>
          <span class="legend-divider" aria-hidden="true"></span>
          <span class="legend-item role-key group-leader"><i><svg viewBox="0 0 24 24"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg></i>组长</span>
          <span class="legend-item role-key group-vice_leader"><i><svg viewBox="0 0 24 24"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg></i>副组长</span>
          <span class="legend-item"><i class="legend-line"></i>传承轨迹</span>
        </div>
      </section>
      <section ref="stageRef" class="star-stage" aria-label="成员星谱">
        <div v-if="loading" class="state-message"><span class="loading-ring"></span>正在整理星谱</div>
        <template v-else>
          <div v-if="apiFailed" class="state-message" role="status">星海暂时起雾，请稍后重新连接。<button class="back-link" type="button" @click="loadTree">重新连接</button></div>
          <div v-else-if="!people.length" class="state-message empty">还没有星星入谱，第一束光正在路上。</div>
          <div class="star-stage-meta"><span>ROOT TO CONSTELLATION</span><span>更新于 {{ tree.generatedAt.slice(0, 10) }}</span></div>
          <div v-if="people.length" ref="scrollRef" class="tree-scroll" @scroll.passive="onTreeScroll">
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
                    :class="[destinationClass(person), groupRoleClass(person), { dimmed: query && !isVisible(person), highlighted: query && isVisible(person), root: person.id === rootPerson?.id, guest: person.relationScope === 'cohort_guest', selected: selectedPerson?.id === person.id, mine: person.id === myPersonId }]"
                    :style="{ '--x': layout.offsets.get(person.id) ?? 0, '--delay': `${rowIndex * 140 + index * 60}ms` }"
                    type="button"
                    :aria-label="`${person.name}，${formatCohort(person.cohort)}，${relationLabel(person)}${person.groupRole ? `，${groupRoleLabels[person.groupRole]}` : ''}${person.memberType ? `，${membershipLabel(person)}` : ''}${person.destination ? `，去向${destinationLabel(person)}` : ''}`"
                    :aria-expanded="selectedPerson?.id === person.id"
                    @click="openPreview(person)"
                    @mouseenter="hoveredId = person.id"
                    @mouseleave="hoveredId = null"
                    @focus="hoveredId = person.id"
                    @blur="hoveredId = null"
                  >
                    <span v-if="person.groupRole" class="node-crest" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg></span>
                    <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="toneOf(person)" :size="person.id === rootPerson?.id ? 'lg' : 'md'" />
                    <span class="star-name">{{ person.name }}</span>
                    <span class="star-badges">
                      <span v-if="person.groupRole" class="role-tag">{{ groupRoleLabels[person.groupRole] }}</span>
                      <span v-if="person.destination" class="destination-badge">{{ destinationLabel(person) }}</span>
                    </span>
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
            :class="[destinationClass(selectedPerson), groupRoleClass(selectedPerson)]"
            :style="{ left: `${popupPosition.left}px`, top: `${popupPosition.top}px`, '--arrow': `${popupPosition.arrow}px` }"
            role="dialog"
            :aria-label="`${selectedPerson.name}简介`"
          >
            <button class="popover-close" type="button" aria-label="关闭简介" @click="closePreview">×</button>
            <span class="popover-kicker">{{ formatCohort(selectedPerson.cohort) }} · {{ relationLabel(selectedPerson) }}<template v-if="selectedPerson.memberType"> · {{ membershipLabel(selectedPerson) }}</template></span>
            <div class="popover-person">
              <StarAvatar :name="selectedPerson.name" :avatar-url="selectedPerson.avatarUrl" :tone="toneOf(selectedPerson)" size="sm" />
              <div>
                <h2>{{ selectedPerson.name }}<span v-if="selectedPerson.groupRole" class="role-tag">{{ groupRoleLabels[selectedPerson.groupRole] }}</span></h2>
                <p>{{ selectedPerson.motto || selectedPerson.role }}</p>
              </div>
            </div>
            <p class="popover-copy">{{ selectedPerson.bio || "这颗星暂时保持神秘。" }}</p>
            <span v-if="selectedPerson.destination" class="destination-badge popover-destination">去向 · {{ destinationLabel(selectedPerson) }}</span>
            <div class="tag-row compact"><span v-for="tag in selectedPerson.tags" :key="tag" class="tag">{{ tag }}</span></div>
            <button class="popover-detail" type="button" @click="viewDetail(selectedPerson)">查看完整档案 <span aria-hidden="true">↗</span></button>
          </div>
        </template>
      </section>
      <footer class="page-footer"><span>翻斗星谱</span><span>成员资料持续更新中</span></footer>
    </main>
    <div v-if="authOpen" class="modal-backdrop" @click.self="closeAuth">
      <section class="auth-dialog" role="dialog" aria-modal="true" :aria-labelledby="`auth-${authMode}-title`">
        <button class="popover-close" type="button" aria-label="关闭账号窗口" @click="closeAuth">×</button>
        <span class="section-label">MEMBER ACCESS</span>
        <h2 :id="`auth-${authMode}-title`">{{ authMode === "login" ? "登录星谱" : "注册账号" }}</h2>
        <div class="auth-tabs" role="tablist" aria-label="账号方式">
          <button type="button" role="tab" :aria-selected="authMode === 'login'" :class="{ active: authMode === 'login' }" @click="setAuthMode('login')">登录</button>
          <button type="button" role="tab" :aria-selected="authMode === 'register'" :class="{ active: authMode === 'register' }" @click="setAuthMode('register')">注册</button>
        </div>
        <form v-if="authMode === 'login'" class="auth-form" @submit.prevent="submitAuth">
          <label class="form-field">
            <span>邮箱、手机号或姓名</span>
            <input v-model.trim="authForm.identifier" type="text" maxlength="254" autocomplete="username" required />
          </label>
          <label class="form-field">
            <span>密码</span>
            <input v-model="authForm.password" type="password" minlength="6" maxlength="100" :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'" required />
          </label>
          <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
          <button class="primary-command auth-submit" type="submit" :disabled="authLoading">{{ authLoading ? "登录中" : "登录" }}</button>
        </form>
        <div v-else class="invite-guidance">
          <span class="account-orb" aria-hidden="true"></span>
          <p>新成员需要通过师傅发出的专属邀请链接加入。邀请码只能使用一次，注册后会自动建立师徒关系。</p>
          <button class="secondary-command auth-submit" type="button" @click="setAuthMode('login')">已有账号，返回登录</button>
        </div>
      </section>
    </div>
    <div v-if="passwordChangeOpen" class="modal-backdrop password-change-backdrop">
      <section class="auth-dialog password-change-dialog" role="dialog" aria-modal="true" aria-labelledby="password-change-title">
        <span class="section-label">ACCOUNT SECURITY</span>
        <h2 id="password-change-title">首次登录，请设置新密码</h2>
        <p class="detail-copy">这是师傅创建账号时生成的初始密码。完成修改后才能继续使用账号。</p>
        <form class="auth-form" @submit.prevent="changePassword">
          <label class="form-field"><span>当前密码</span><input v-model="passwordChangeForm.currentPassword" type="password" minlength="6" maxlength="100" autocomplete="current-password" required /></label>
          <label class="form-field"><span>新密码</span><input v-model="passwordChangeForm.newPassword" type="password" minlength="8" maxlength="100" autocomplete="new-password" required /></label>
          <label class="form-field"><span>确认新密码</span><input v-model="passwordChangeForm.confirmPassword" type="password" minlength="8" maxlength="100" autocomplete="new-password" required /></label>
          <p v-if="passwordChangeError" class="form-error" role="alert">{{ passwordChangeError }}</p>
          <button class="primary-command auth-submit" type="submit" :disabled="passwordChangeSaving">{{ passwordChangeSaving ? "保存中" : "设置新密码" }}</button>
        </form>
      </section>
    </div>
  </div>
</template>
