<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import InviteRegistration from "./components/InviteRegistration.vue";
import ClaimRegistration from "./components/ClaimRegistration.vue";
import AdminPanel from "./components/AdminPanel.vue";
import StarAvatar from "./components/StarAvatar.vue";
import ProfilePage from "./components/profile/ProfilePage.vue";
import StudentStudio from "./components/students/StudentStudio.vue";
import StarMap from "./components/map/StarMap.vue";
import ArticleEditor from "./components/posts/ArticleEditor.vue";
import ArticleView from "./components/posts/ArticleView.vue";
import { canLeave } from "./lib/navigation";
import { apiErrorMessage } from "./lib/api";
import { isValidAccountIdentifier } from "./lib/accountIdentifier";
import {
  academicGrade, destinationLabels, formatCohort, groupRoleLabels, membershipLabels,
  normaliseNode, relationLabel, type Cohort, type Person, type SessionUser, type Tone,
} from "./lib/people";
import { mountStarfield, type Starfield } from "./lib/starfield";
import { warpTo } from "./lib/warp";

type Edge = { id: string; mentorId: string; studentId: string };
type Tree = { rootPersonId: string | null; nodes: Person[]; edges: Edge[]; generatedAt: string };
type AuthMode = "login" | "register";

const emptyTree: Tree = { rootPersonId: null, nodes: [], edges: [], generatedAt: new Date(0).toISOString() };

const tree = ref<Tree>(emptyTree);
const loading = ref(true);
const apiFailed = ref(false);
const query = ref("");
const pathname = ref(window.location.pathname);
const search = ref(window.location.search);
const expanded = ref<Record<string, boolean>>({});
const skyRef = ref<HTMLCanvasElement | null>(null);
const mapRef = ref<InstanceType<typeof StarMap> | null>(null);
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
  return [...map.values()].sort((a, b) => {
    const aSecondary = (academicGrade(a.cohort.year) ?? 0) <= 0;
    const bSecondary = (academicGrade(b.cohort.year) ?? 0) <= 0;
    return Number(bSecondary) - Number(aSecondary)
      || (a.cohort.year ?? -1) - (b.cohort.year ?? -1)
      || (a.cohort.sortOrder ?? 99) - (b.cohort.sortOrder ?? 99);
  });
});

const generations = computed(() => people.value.reduce((max, person) => Math.max(max, (person.depth ?? 0) + 1), 0));
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
/** `/write` starts a new article, `/posts/:id` reads one and `/posts/:id/edit` reopens it in the editor. */
const articleRoute = computed(() => {
  if (pathname.value === "/write") return { mode: "edit" as const, id: null };
  const match = pathname.value.match(/^\/posts\/([^/]+)(\/edit)?\/?$/);
  if (!match) return null;
  let id = match[1];
  try { id = decodeURIComponent(id); } catch { /* keep the raw id */ }
  return { mode: match[2] ? "edit" as const : "read" as const, id };
});
const isHomeRoute = computed(() => !isDetailRoute.value && !isRegisterRoute.value && !isClaimRoute.value && !isAdminRoute.value && !isStudentsRoute.value && !articleRoute.value);
const inviteToken = computed(() => new URLSearchParams(search.value).get("invite") ?? "");
const claimToken = computed(() => new URLSearchParams(search.value).get("token") ?? "");
const focusId = computed(() => new URLSearchParams(search.value).get("focus"));
const openDraftsFlag = computed(() => new URLSearchParams(search.value).has("drafts"));
const myPersonId = computed(() => sessionUser.value?.personId ?? null);
const legendDestinations = Object.entries(destinationLabels) as Array<[keyof typeof destinationLabels, string]>;
const isSecondaryCohort = (cohort: Cohort) => (academicGrade(cohort.year) ?? 0) <= 0;

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
    expanded.value = Object.fromEntries(groups.value.map((group) => [group.cohort.id, !isSecondaryCohort(group.cohort)]));
    loading.value = false;
    await nextTick();
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
  const identifier = authForm.value.identifier.trim();
  if (!isValidAccountIdentifier(identifier)) {
    authError.value = "请输入有效的邮箱或手机号";
    return;
  }
  authLoading.value = true;
  authError.value = null;
  try {
    const response = await fetch("/api/session/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password: authForm.value.password }) });
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
}
function applyLocation() {
  pathname.value = window.location.pathname;
  search.value = window.location.search;
  if (isHomeRoute.value && focusId.value) nextTick(() => focusStar(focusId.value!));
}
function navigate(path: string) {
  if (!canLeave()) return;
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
function openProfileFromMap(person: Person, origin: DOMRect | null, tone: Tone) {
  go(`/person/${encodeURIComponent(person.id)}`, origin, tone);
}
/** Pans the map to a member's star (used by "在星谱中定位") and opens its preview. */
function focusStar(id: string) {
  query.value = "";
  // The map mounts after the tree loads; retry briefly until it can place the star.
  let attempts = 0;
  const tryLocate = () => {
    if (mapRef.value?.locate(id)) return;
    if ((attempts += 1) < 20) window.setTimeout(tryLocate, 100);
  };
  nextTick(tryLocate);
}
function onSearchEnter() {
  mapRef.value?.locateNext();
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
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (authOpen.value) closeAuth();
}
onMounted(() => {
  if (skyRef.value) starfield = mountStarfield(skyRef.value);
  void loadTree();
  void loadSession();
  window.addEventListener("popstate", onPopState);
  window.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  starfield?.destroy();
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("keydown", onKeydown);
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
    <main v-else-if="articleRoute?.mode === 'edit'" class="workspace-page">
      <ArticleEditor
        v-if="sessionUser && sessionToken"
        :key="`${articleRoute.id ?? 'new'}:${sessionUser.personId}`"
        :post-id="articleRoute.id"
        :session-token="sessionToken"
        :session-user="sessionUser"
        :open-drafts="openDraftsFlag"
        @navigate="navigate"
        @session-expired="onSessionExpired"
      />
      <section v-else-if="!sessionLoading" class="state-message" role="status"><p>登录后才能写经验分享。</p><button type="button" @click="() => openAuth()">登录</button></section>
      <div v-else class="state-message"><span class="loading-ring"></span>正在读取账号</div>
    </main>
    <main v-else-if="articleRoute?.mode === 'read' && articleRoute.id" class="workspace-page" aria-live="polite">
      <ArticleView
        :key="articleRoute.id"
        :post-id="articleRoute.id"
        :people="people"
        :root-person-id="rootPerson?.id ?? null"
        :session-token="sessionToken"
        :session-user="sessionUser"
        @navigate="navigate"
        @require-auth="openAuth()"
        @session-expired="onSessionExpired"
      />
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
          <div><strong>{{ generations }}</strong><span>代传承</span></div>
        </div>
      </section>

      <section class="toolbar">
        <label class="search-field">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input v-model="query" type="search" placeholder="搜索姓名、方向、级别或去向，回车逐个定位" aria-label="搜索姓名、方向、级别或去向" @keydown.enter.prevent="onSearchEnter" />
          <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">×</button>
        </label>
        <div class="legend">
          <span class="legend-item"><i class="legend-star aqua"></i>在读</span>
          <span class="legend-item"><i class="legend-star fog"></i>毕业</span>
          <span class="legend-divider" aria-hidden="true"></span>
          <span v-for="[value, label] in legendDestinations" :key="value" class="legend-item destination-key" :class="`destination-${value}`"><i></i>{{ label }}</span>
          <span class="legend-divider" aria-hidden="true"></span>
          <span class="legend-item role-key group-leader"><i><svg viewBox="0 0 24 24"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg></i>组长</span>
          <span class="legend-item role-key group-vice_leader"><i><svg viewBox="0 0 24 24"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg></i>副组长</span>
          <span class="legend-item"><i class="legend-line"></i>传承轨迹</span>
        </div>
      </section>
      <div v-if="loading" class="state-message"><span class="loading-ring"></span>正在整理星谱</div>
      <div v-else-if="apiFailed" class="state-message" role="status">星海暂时起雾，请稍后重新连接。<button class="back-link" type="button" @click="loadTree">重新连接</button></div>
      <div v-else-if="!people.length" class="state-message empty">还没有星星入谱，第一束光正在路上。</div>
      <StarMap
        v-else
        ref="mapRef"
        :people="people"
        :edges="tree.edges"
        :rows="groups"
        :expanded="expanded"
        :root-id="rootPerson?.id ?? null"
        :query="query"
        :matching-ids="matchingIds"
        :my-person-id="myPersonId"
        :generated-at="tree.generatedAt"
        @toggle-row="toggleGroup"
        @open-profile="openProfileFromMap"
        @clear-query="query = ''"
      />
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
            <span>邮箱或手机号</span>
            <input v-model="authForm.identifier" type="text" maxlength="254" autocomplete="username" placeholder="请输入邮箱或手机号" required />
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
