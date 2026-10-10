<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import InvitePanel from "./components/InvitePanel.vue";
import InviteRegistration from "./components/InviteRegistration.vue";
import AdminPanel from "./components/AdminPanel.vue";
import StarAvatar from "./components/StarAvatar.vue";
import { mountStarfield, sparkle, type Starfield } from "./lib/starfield";

type Status = "active" | "archived";
type Destination = "big_tech" | "postgraduate_985" | "postgraduate_211" | "startup" | "further_study" | "other";
type Cohort = { id: string; label: string; year: number | null; sortOrder: number };
type Achievement = { id: string; kind: "achievement" | "honor"; title: string; content: string; occurredOn: string | null; version: number };
type Attachment = { id: string; originalName: string; mimeType: string; size: number; category: string; visibility: string; url: string | null };
type ProfileLink = { label: string; url: string };
type Person = { id: string; name: string; nickname: string | null; avatarUrl: string | null; cohort: Cohort | null; relationScope: "lineage" | "cohort_guest"; isFeatured: boolean; status: Status; destination: Destination | null; mentorId: string | null; depth: number | null; directStudentIds: string[]; role: string; joinedAt: string; tags: string[]; bio: string; contactEmail?: string | null; education?: string | null; experience?: string | null; skills?: string[]; links?: ProfileLink[]; resume?: Attachment | null; version?: number; mentor?: Person | null; students?: Person[]; achievements?: Achievement[]; attachments?: Attachment[]; featuredNote?: string | null };
type Edge = { id: string; mentorId: string; studentId: string };
type Tree = { rootPersonId: string | null; nodes: Person[]; edges: Edge[]; generatedAt: string };
type LinkSegment = { id: string; mentorId: string; studentId: string; path: string; x1: number; y1: number; x2: number; y2: number; crossCohort: boolean };
type Tone = "gold" | "aqua" | "fog";
type SessionUser = { id: string; email: string; displayName: string; personId: string; role: "member" | "admin" };
type AuthMode = "login" | "register";

const emptyTree: Tree = { rootPersonId: null, nodes: [], edges: [], generatedAt: new Date(0).toISOString() };

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tree = ref<Tree>(emptyTree);
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
const sessionToken = ref(localStorage.getItem("fandou-session"));
const sessionUser = ref<SessionUser | null>(null);
const sessionLoading = ref(Boolean(sessionToken.value));
const authOpen = ref(false);
const authMode = ref<AuthMode>("login");
const authLoading = ref(false);
const authError = ref<string | null>(null);
const authForm = ref({ email: "", password: "" });
const profileEditing = ref(false);
const profileSaving = ref(false);
const profileError = ref<string | null>(null);
const profileSaved = ref(false);
const profileForm = ref<{ nickname: string; bio: string; destination: Destination | ""; contactEmail: string; education: string; experience: string; skills: string; links: string }>({ nickname: "", bio: "", destination: "", contactEmail: "", education: "", experience: "", skills: "", links: "" });
const achievementForm = ref({ kind: "achievement" as "achievement" | "honor", title: "", content: "" });
const achievementSaving = ref(false);
const uploadSaving = ref(false);
const uploadError = ref("");
const uploadCategory = ref<"avatar" | "resume" | "photo">("photo");
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
const destinationLabels: Record<Destination, string> = {
  big_tech: "大厂",
  postgraduate_985: "985研",
  postgraduate_211: "211研",
  startup: "创业",
  further_study: "继续深造",
  other: "其他",
};
const isDestination = (value: unknown): value is Destination => typeof value === "string" && value in destinationLabels;
const destinationLabel = (person: Person) => person.destination ? destinationLabels[person.destination] : "去向待补充";
const destinationClass = (person: Person) => person.destination ? `destination-${person.destination}` : "destination-unset";
const matchingIds = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  if (!text) return new Set(people.value.map((person) => person.id));
  return new Set(people.value.filter((person) => [person.name, person.nickname ?? "", person.role, formatCohort(person.cohort), person.status === "archived" ? "毕业" : "在读", person.destination ? destinationLabels[person.destination] : "", ...person.tags].join(" ").toLocaleLowerCase().includes(text)).map((person) => person.id));
});
const detailRouteId = computed(() => {
  const match = pathname.value.match(/^\/person\/([^/]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
});
const isDetailRoute = computed(() => Boolean(detailRouteId.value));
const isRegisterRoute = computed(() => pathname.value === "/register");
const isAdminRoute = computed(() => pathname.value === "/admin");
const inviteToken = computed(() => new URLSearchParams(window.location.search).get("invite") ?? "");
const currentDetail = computed(() => detailRouteId.value ? people.value.find((person) => person.id === detailRouteId.value) ?? null : null);
const detail = computed(() => detailPerson.value ?? currentDetail.value);
const isOwnDetail = computed(() => Boolean(detail.value && sessionUser.value?.personId === detail.value.id));
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
const detailAchievements = computed(() => detail.value?.achievements ?? []);
const detailAttachments = computed(() => detail.value?.attachments ?? []);
const visibleLinks = computed(() => links.value.filter((link) => !query.value || matchingIds.value.has(link.mentorId) || matchingIds.value.has(link.studentId)));
const isVisible = (person: Person) => matchingIds.value.has(person.id);
const relationLabel = (person: Person) => person.status === "archived" ? "毕业" : "在读";
const toneOf = (person: Person): Tone => person.status === "archived" ? "fog" : person.isFeatured || person.id === rootPerson.value?.id ? "gold" : "aqua";
const isLinkActive = (link: LinkSegment) => hoveredId.value !== null && (link.mentorId === hoveredId.value || link.studentId === hoveredId.value);

function setNodeRef(id: string, element: Element | null) {
  if (element instanceof HTMLElement) nodeRefs.set(id, element);
  else nodeRefs.delete(id);
}
function normaliseNode(node: Record<string, unknown>): Person {
  if (typeof node.id !== "string" || !node.id.trim() || typeof node.name !== "string" || !node.name.trim()) throw new Error("invalid person");
  const source = {
    id: node.id, name: node.name, nickname: null, avatarUrl: null,
    cohort: null, relationScope: "cohort_guest" as const, isFeatured: false, status: "active" as const, destination: null,
    mentorId: null, depth: null, directStudentIds: [], role: "星谱成员", joinedAt: "", tags: [], bio: "",
  };
  const rawCohort = node.cohort as Partial<Cohort> | null | undefined;
  const fallbackCohort = source.cohort;
  const rawYear = rawCohort?.year ?? String(rawCohort?.label ?? "").match(/\d{4}/)?.[0];
  const year = rawYear ? Number(rawYear) : (fallbackCohort?.year ?? null);
  const cohort = rawCohort || fallbackCohort ? { ...(fallbackCohort ?? {}), ...(rawCohort ?? {}), id: year ? `cohort-${year}` : String(rawCohort?.id ?? fallbackCohort?.id ?? "uncategorized"), label: year ? `${year} 届` : "未分届次", year, sortOrder: Number(rawCohort?.sortOrder ?? fallbackCohort?.sortOrder ?? 99) } as Cohort : null;
  const directStudentIds = Array.isArray(node.directStudentIds) ? node.directStudentIds.map(String) : source.directStudentIds;
  const destination = isDestination(node.destination) ? node.destination : null;
  const nickname = Object.prototype.hasOwnProperty.call(node, "nickname") ? (node.nickname == null ? null : String(node.nickname)) : source.nickname;
  const skills = Array.isArray(node.skills) ? node.skills.filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim())) : [];
  const profileLinks = Array.isArray(node.links) ? node.links.filter((link): link is ProfileLink => Boolean(link && typeof link === "object" && typeof (link as ProfileLink).label === "string" && typeof (link as ProfileLink).url === "string")) : [];
  return { ...source, ...node, id: source.id, name: source.name, cohort, destination, version: Number(node.version ?? 1), mentorId: node.mentorId == null ? null : String(node.mentorId), directStudentIds, nickname, avatarUrl: node.avatarUrl == null ? null : String(node.avatarUrl), role: String(node.role ?? source.role), joinedAt: String(node.joinedAt ?? ""), tags: Array.isArray(node.tags) ? node.tags.map(String) : [], bio: String(node.bio ?? ""), contactEmail: node.contactEmail == null ? null : String(node.contactEmail), education: node.education == null ? null : String(node.education), experience: node.experience == null ? null : String(node.experience), skills, links: profileLinks } as Person;
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
    if (detailRouteId.value) {
      const routePerson = people.value.find((person) => person.id === detailRouteId.value);
      if (routePerson && detailPerson.value?.id !== routePerson.id) void openDetail(routePerson);
    }
  }
}
async function apiErrorMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? fallback;
}
function clearSession() {
  sessionToken.value = null;
  sessionUser.value = null;
  localStorage.removeItem("fandou-session");
  profileEditing.value = false;
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
  } catch {
    clearSession();
  } finally {
    sessionLoading.value = false;
  }
}
function setAuthMode(mode: AuthMode) {
  authMode.value = mode;
  authError.value = null;
  if (mode === "login") authForm.value = { email: "", password: "" };
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
    navigate(`/person/${encodeURIComponent(payload.data.user.personId)}`);
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "暂时无法连接账号服务";
  } finally {
    authLoading.value = false;
  }
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
function startProfileEdit() {
  if (!detail.value || !isOwnDetail.value) return;
  profileForm.value = {
    nickname: detail.value.nickname ?? "", bio: detail.value.bio, destination: detail.value.destination ?? "",
    contactEmail: detail.value.contactEmail ?? "", education: detail.value.education ?? "", experience: detail.value.experience ?? "",
    skills: (detail.value.skills ?? []).join(", "), links: (detail.value.links ?? []).map((link) => `${link.label} | ${link.url}`).join("\n"),
  };
  profileError.value = null;
  profileSaved.value = false;
  profileEditing.value = true;
}
function cancelProfileEdit() {
  if (profileSaving.value) return;
  profileEditing.value = false;
  profileError.value = null;
}
async function saveProfile() {
  const token = sessionToken.value;
  const person = detail.value;
  if (!token || !person || !isOwnDetail.value) return;
  profileSaving.value = true;
  profileError.value = null;
  profileSaved.value = false;
  try {
    const response = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        nickname: profileForm.value.nickname.trim() || null,
        bio: profileForm.value.bio.trim(), destination: profileForm.value.destination || null,
        contactEmail: profileForm.value.contactEmail.trim() || null,
        education: profileForm.value.education.trim() || null, experience: profileForm.value.experience.trim() || null,
        skills: profileForm.value.skills.split(",").map((item) => item.trim()).filter(Boolean),
        links: profileForm.value.links.split("\n").map((line) => line.split("|")).map(([label, url]) => ({ label: (label ?? "").trim(), url: (url ?? "").trim() })).filter((link) => link.label && link.url),
        version: person.version ?? 1,
      }),
    });
    if (response.status === 401) {
      clearSession();
      openAuth();
      throw new Error("会话已失效，请重新登录");
    }
    if (!response.ok) throw new Error(await apiErrorMessage(response, "资料保存失败"));
    const payload = await response.json() as { data?: Record<string, unknown> };
    if (!payload.data) throw new Error("资料响应为空");
    const updated = normaliseNode({ ...person, ...payload.data, id: person.id });
    detailPerson.value = updated;
    tree.value.nodes = tree.value.nodes.map((node) => node.id === updated.id ? { ...node, nickname: updated.nickname, bio: updated.bio, destination: updated.destination, version: updated.version, contactEmail: updated.contactEmail, education: updated.education, experience: updated.experience, skills: updated.skills, links: updated.links } : node);
    profileEditing.value = false;
    profileSaved.value = true;
  } catch (error) {
    profileError.value = error instanceof Error ? error.message : "资料保存失败";
  } finally {
    profileSaving.value = false;
  }
}
async function addAchievement() {
  if (!sessionToken.value || !isOwnDetail.value || !achievementForm.value.title.trim() || !achievementForm.value.content.trim()) return;
  achievementSaving.value = true; uploadError.value = "";
  try {
    const response = await fetch("/api/me/achievements", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken.value}` }, body: JSON.stringify(achievementForm.value) });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "事迹保存失败"));
    const payload = await response.json() as { data?: Achievement };
    if (payload.data && detailPerson.value) detailPerson.value = { ...detailPerson.value, achievements: [payload.data, ...(detailPerson.value.achievements ?? [])] };
    achievementForm.value = { kind: "achievement", title: "", content: "" };
  } catch (error) { uploadError.value = error instanceof Error ? error.message : "事迹保存失败"; }
  finally { achievementSaving.value = false; }
}
async function uploadAttachment(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !sessionToken.value || !isOwnDetail.value) return;
  uploadSaving.value = true; uploadError.value = "";
  try {
    const form = new FormData(); form.append("file", file); form.append("category", uploadCategory.value); form.append("visibility", "members");
    const response = await fetch("/api/me/attachments", { method: "POST", headers: { Authorization: `Bearer ${sessionToken.value}` }, body: form });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "附件上传失败"));
    const payload = await response.json() as { data?: Attachment };
    if (payload.data && detailPerson.value) {
      detailPerson.value = { ...detailPerson.value, avatarUrl: uploadCategory.value === "avatar" ? `/api/attachments/${payload.data.id}` : detailPerson.value.avatarUrl, resume: uploadCategory.value === "resume" ? payload.data : detailPerson.value.resume, attachments: [payload.data, ...(detailPerson.value.attachments ?? [])] };
      if (uploadCategory.value === "avatar") tree.value.nodes = tree.value.nodes.map((node) => node.id === detailPerson.value?.id ? { ...node, avatarUrl: `/api/attachments/${payload.data!.id}` } : node);
    }
  } catch (error) { uploadError.value = error instanceof Error ? error.message : "附件上传失败"; }
  finally { uploadSaving.value = false; input.value = ""; }
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
  profileEditing.value = false;
  profileSaved.value = false;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  if (path === "/") {
    centeredOnce = false;
    nextTick(() => { observeCanvas(); measureGraph(); });
  } else {
    const routeId = path.match(/^\/person\/([^/]+)/)?.[1];
    if (routeId) {
      let id = routeId;
      try { id = decodeURIComponent(routeId); } catch { /* keep the encoded id for the API */ }
      const local = people.value.find((person) => person.id === id);
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
  profileEditing.value = false;
  profileSaved.value = false;
  if (detailRouteId.value) void openDetailById(detailRouteId.value);
  else nextTick(() => { observeCanvas(); measureGraph(); });
}
async function openDetail(person: Person) {
  await openDetailById(person.id, person);
}
async function openDetailById(id: string, localPerson?: Person) {
  const requestId = ++detailRequestId;
  const fallback = localPerson ?? people.value.find((person) => person.id === id) ?? null;
  detailLoading.value = true;
  detailError.value = null;
  detailPerson.value = fallback;
  try {
    const response = await fetch(`/api/people/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(response.status === 404 ? "档案不存在" : "档案暂时无法读取");
    const payload = await response.json() as { data?: Record<string, unknown> };
    if (!payload.data) throw new Error("档案数据为空");
    if (requestId === detailRequestId) detailPerson.value = normaliseNode({ ...(fallback ?? {}), ...payload.data, id });
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
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (authOpen.value) closeAuth();
  else if (profileEditing.value) cancelProfileEdit();
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
        <span class="brand-name">翻斗星谱<small>FANDOU LINEAGE</small></span>
      </a>
      <div class="header-meta">
        <span class="status-dot" :class="{ offline: apiFailed }"></span>
        <span>{{ apiFailed ? "星谱暂离线" : "星谱已连接" }}</span>
        <span class="read-only">公开档案</span>
        <button class="account-entry" type="button" :disabled="sessionLoading" @click="openMyProfile">
          <span class="account-orb" aria-hidden="true"></span>
          {{ sessionLoading ? "读取账号" : (sessionUser?.displayName ?? "登录 / 加入") }}
        </button>
        <button v-if="sessionUser" class="account-logout" type="button" aria-label="退出登录" @click="logout">退出</button>
        <a v-if="sessionUser?.role === 'admin'" class="account-logout" href="/admin" @click.prevent="navigate('/admin')">管理</a>
      </div>
    </header>

    <main v-if="isRegisterRoute" class="detail-page" aria-live="polite">
      <InviteRegistration :token="inviteToken" />
    </main>
    <main v-else-if="isAdminRoute" class="detail-page" aria-live="polite">
      <AdminPanel v-if="sessionUser?.role === 'admin' && sessionToken" :session-token="sessionToken" @changed="loadTree" />
      <section v-else class="state-message" role="status"><p>管理员账号登录后才能打开维护工作台。</p><button type="button" @click="() => openAuth()">登录管理员账号</button></section>
    </main>
    <main v-else-if="!isDetailRoute" class="home-page">
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
          <input v-model="query" type="search" placeholder="搜索姓名、方向、届次或去向" aria-label="搜索姓名、方向、届次或去向" />
          <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">×</button>
        </label>
        <div class="legend">
          <span v-if="query" class="legend-count">匹配 {{ matchingIds.size }} 颗星</span>
          <span class="legend-item"><i class="legend-star aqua"></i>在读</span>
          <span class="legend-item"><i class="legend-star fog"></i>毕业</span>
          <span class="legend-item destination-key destination-big_tech"><i></i>大厂</span>
          <span class="legend-item destination-key destination-postgraduate_985"><i></i>985研</span>
          <span class="legend-item destination-key destination-postgraduate_211"><i></i>211研</span>
          <span class="legend-item destination-key destination-startup"><i></i>创业</span>
          <span class="legend-item destination-key destination-further_study"><i></i>继续深造</span>
          <span class="legend-item destination-key destination-other"><i></i>其他</span>
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
                    :class="[destinationClass(person), { dimmed: query && !isVisible(person), highlighted: query && isVisible(person), root: person.id === rootPerson?.id, guest: person.relationScope === 'cohort_guest', selected: selectedPerson?.id === person.id }]"
                    :style="{ '--x': layout.offsets.get(person.id) ?? 0, '--delay': `${rowIndex * 140 + index * 60}ms` }"
                    type="button"
                    :aria-label="`${person.name}，${formatCohort(person.cohort)}，${relationLabel(person)}${person.destination ? `，去向${destinationLabel(person)}` : ''}`"
                    :aria-expanded="selectedPerson?.id === person.id"
                    @click="openPreview(person)"
                    @mouseenter="hoveredId = person.id"
                    @mouseleave="hoveredId = null"
                    @focus="hoveredId = person.id"
                    @blur="hoveredId = null"
                  >
                    <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="toneOf(person)" :size="person.id === rootPerson?.id ? 'lg' : 'md'" />
                    <span class="star-name">{{ person.name }}</span>
                    <span v-if="person.destination" class="destination-badge">{{ destinationLabel(person) }}</span>
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
            :class="destinationClass(selectedPerson)"
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
            <span v-if="selectedPerson.destination" class="destination-badge popover-destination" :class="destinationClass(selectedPerson)">去向 · {{ destinationLabel(selectedPerson) }}</span>
            <div class="tag-row compact"><span v-for="tag in selectedPerson.tags" :key="tag" class="tag">{{ tag }}</span></div>
            <button class="popover-detail" type="button" @click="viewDetail(selectedPerson)">查看完整档案 <span aria-hidden="true">↗</span></button>
          </div>
        </template>
      </section>
      <footer class="page-footer"><span>翻斗星谱 · 公开档案</span><span>成员资料持续更新中</span></footer>
    </main>
    <main v-else class="detail-page" aria-live="polite">
      <button class="back-link" type="button" @click="navigate('/')">← 返回星谱</button>
      <div v-if="detail" class="detail-layout">
        <section class="detail-intro" :class="destinationClass(detail)">
          <p class="eyebrow">PERSONAL PROFILE <span>{{ formatCohort(detail.cohort) }}</span></p>
          <div class="detail-avatar">
            <StarAvatar :name="detail.name" :avatar-url="detail.avatarUrl" :tone="toneOf(detail)" size="xl" />
          </div>
          <h1>{{ detail.name }}</h1>
          <p v-if="detail.nickname" class="detail-nickname">{{ detail.nickname }}</p>
          <p class="detail-role">{{ detail.role }}</p>
          <span v-if="detail.destination" class="destination-badge detail-destination" :class="destinationClass(detail)">去向 · {{ destinationLabel(detail) }}</span>
          <div class="tag-row"><span v-for="tag in detail.tags" :key="tag" class="tag">{{ tag }}</span></div>
          <span class="record-note" :class="{ graduated: detail.status === 'archived' }"><i></i>{{ relationLabel(detail) }} · 公开档案</span>
          <button v-if="isOwnDetail" class="profile-edit-trigger" type="button" @click="startProfileEdit">编辑我的资料</button>
          <p v-if="isOwnDetail && profileSaved" class="profile-success" role="status">资料已保存</p>
        </section>
        <section class="detail-sections">
          <article v-if="isOwnDetail && profileEditing" class="detail-section profile-editor">
            <span class="section-label">编辑我的资料</span>
            <form @submit.prevent="saveProfile">
              <label class="form-field">
                <span>昵称</span>
                <input v-model="profileForm.nickname" type="text" maxlength="100" autocomplete="nickname" placeholder="可留空" />
              </label>
              <label class="form-field">
                <span>简介</span>
                <textarea v-model="profileForm.bio" maxlength="10000" rows="5" required></textarea>
              </label>
              <label class="form-field">
                <span>去向</span>
                <select v-model="profileForm.destination">
                  <option value="">暂未填写</option>
                  <option v-for="(label, value) in destinationLabels" :key="value" :value="value">{{ label }}</option>
                </select>
              </label>
              <label class="form-field"><span>联系邮箱（仅本人和管理员可见）</span><input v-model="profileForm.contactEmail" type="email" maxlength="254" placeholder="可留空" /></label>
              <label class="form-field"><span>教育经历</span><textarea v-model="profileForm.education" maxlength="10000" rows="3" placeholder="学校、专业、研究方向等，可留空"></textarea></label>
              <label class="form-field"><span>工作 / 项目经历</span><textarea v-model="profileForm.experience" maxlength="20000" rows="4" placeholder="可留空"></textarea></label>
              <label class="form-field"><span>技能（用逗号分隔）</span><input v-model="profileForm.skills" maxlength="2400" placeholder="例如：产品设计，TypeScript，写作" /></label>
              <label class="form-field"><span>个人链接（每行：名称 | URL）</span><textarea v-model="profileForm.links" maxlength="10000" rows="3" placeholder="作品集 | https://example.com"></textarea></label>
              <p v-if="profileError" class="form-error" role="alert">{{ profileError }}</p>
              <div class="form-actions">
                <button class="secondary-command" type="button" :disabled="profileSaving" @click="cancelProfileEdit">取消</button>
                <button class="primary-command" type="submit" :disabled="profileSaving">{{ profileSaving ? "保存中" : "保存资料" }}</button>
              </div>
            </form>
          </article>
          <article class="detail-section">
            <span class="section-label">01 / 简介</span>
            <p v-if="detail.bio" class="detail-copy">{{ detail.bio }}</p>
            <div v-else class="empty-detail"><span>✦</span><p>这颗星还在积攒星尘，简介稍后回来。</p></div>
          </article>
          <article v-if="detail.education" class="detail-section"><span class="section-label">02 / 教育经历</span><p class="detail-copy profile-preline">{{ detail.education }}</p></article>
          <article v-if="detail.experience" class="detail-section"><span class="section-label">03 / 工作与项目</span><p class="detail-copy profile-preline">{{ detail.experience }}</p></article>
          <article v-if="detail.skills?.length" class="detail-section"><span class="section-label">04 / 技能</span><div class="tag-row"><span v-for="skill in detail.skills" :key="skill" class="tag">{{ skill }}</span></div></article>
          <article v-if="detail.links?.length" class="detail-section"><span class="section-label">05 / 个人链接</span><div class="profile-content-list"><a v-for="link in detail.links" :key="link.url" class="content-item attachment-item" :href="link.url" target="_blank" rel="noreferrer"><strong>{{ link.label }}</strong><p>{{ link.url }}</p></a></div></article>
          <article v-if="detail.contactEmail" class="detail-section"><span class="section-label">06 / 联系方式</span><a class="content-item attachment-item" :href="`mailto:${detail.contactEmail}`">{{ detail.contactEmail }}</a></article>
          <article class="detail-section split-section">
            <div>
              <span class="section-label">07 / 关系</span>
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
              <span class="section-label">08 / 加入时间</span>
              <h2>{{ detail.joinedAt }}</h2>
              <p>{{ formatCohort(detail.cohort) }}</p>
            </div>
          </article>
          <article class="detail-section">
            <span class="section-label">09 / 事迹与附件</span>
            <div v-if="detailAchievements.length || detailAttachments.length" class="profile-content-list">
              <article v-for="item in detailAchievements" :key="item.id" class="content-item"><strong>{{ item.kind === 'honor' ? '荣誉' : '事迹' }} · {{ item.title }}</strong><p>{{ item.content }}</p></article>
              <a v-for="item in detailAttachments" :key="item.id" class="content-item attachment-item" :href="item.url ?? `/api/attachments/${item.id}`" target="_blank" rel="noreferrer">{{ item.category === 'resume' ? '简历' : item.category === 'photo' ? '照片' : item.category === 'avatar' ? '头像' : '附件' }} · {{ item.originalName }} <span>· {{ item.visibility === 'private' ? '仅自己可见' : '成员可见' }}</span></a>
            </div>
            <div v-else class="empty-detail"><span>✦</span><p>星尘还没有留下记录，等一段故事抵达这里。</p></div>
            <form v-if="isOwnDetail && sessionToken" class="content-editor" @submit.prevent="addAchievement">
              <div class="content-editor-row"><select v-model="achievementForm.kind"><option value="achievement">事迹</option><option value="honor">荣誉</option></select><input v-model.trim="achievementForm.title" maxlength="200" placeholder="标题" required /></div>
              <textarea v-model.trim="achievementForm.content" maxlength="20000" rows="3" placeholder="写下这段经历" required></textarea>
              <div class="form-actions"><select v-model="uploadCategory" class="upload-category"><option value="avatar">头像</option><option value="resume">简历</option><option value="photo">照片</option></select><label class="upload-button">{{ uploadSaving ? '上传中…' : '上传文件' }}<input type="file" :accept="uploadCategory === 'resume' ? 'application/pdf' : 'image/jpeg,image/png,image/webp'" :disabled="uploadSaving" @change="uploadAttachment" /></label><button class="primary-command" type="submit" :disabled="achievementSaving">{{ achievementSaving ? '保存中…' : '添加记录' }}</button></div>
              <p v-if="uploadError" class="form-error" role="alert">{{ uploadError }}</p>
            </form>
          </article>
          <InvitePanel v-if="isOwnDetail && sessionToken" :mentor-id="detail.id" :mentor-name="detail.name" :session-token="sessionToken" />
        </section>
      </div>
      <div v-else class="state-message">
        <span v-if="detailLoading" class="loading-ring"></span>
        <span>{{ detailLoading ? "正在读取档案" : (detailError ?? "没有找到这份档案") }}</span>
        <button v-if="detailError" type="button" @click="detailRouteId && openDetailById(detailRouteId)">重试</button>
      </div>
      <p v-if="detail && detailError" class="state-message" role="status">{{ detailError }}，当前显示已读取的档案摘要。</p>
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
            <span>邮箱</span>
            <input v-model="authForm.email" type="email" maxlength="254" autocomplete="email" required />
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
  </div>
</template>
