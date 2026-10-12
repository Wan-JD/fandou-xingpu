<script setup lang="ts">
// 徒弟管理：the mentor's own workspace for students, invitations and delegated accounts.
import { computed, onMounted, ref } from "vue";
import StarAvatar from "../StarAvatar.vue";
import { ApiError, apiRequest, copyText } from "../../lib/api";
import { isValidAccountIdentifier } from "../../lib/accountIdentifier";
import { fullTime, joinedSeasonLabel, relativeTime } from "../../lib/format";
import { destinationLabels, formatCohort, groupRoleLabels, membershipLabels, toneFor, type Destination, type GroupRole, type MembershipType, type Person, type SessionUser, type Status, type Tone } from "../../lib/people";
import { joinSeasonAt, type JoinSeason } from "@fandou-xingpu/shared";

type Account = { identifier: string; status: "active" | "disabled"; activated: boolean; mustChangePassword: boolean; canResetPassword: boolean };
type Student = {
  personId: string; name: string; memberType: MembershipType; status: Status; groupRole: GroupRole | null; destination: Destination | null;
  version: number; cohort: { id: string; label: string; year: number } | null; avatarUrl: string | null; studentCount: number;
  birthday: string | null; joinedYear: number | null; joinedSeason: JoinSeason | null;
  createdAt: string; joinedAt: string; account: Account | null; claim: { state: "pending" | "expired" | "claimed"; expiresAt: string } | null;
};
type Invite = { id: string; createdAt: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null; acceptedPerson: { id: string; name: string } | null; state: "pending" | "accepted" | "expired" | "revoked" };
type Filter = "all" | "active" | "archived" | "pending";
type Credentials = { title: string; identifier: string; temporaryPassword: string; claimUrl?: string };

const props = defineProps<{ sessionToken: string; sessionUser: SessionUser; people: Person[]; rootPersonId: string | null }>();
const emit = defineEmits<{ navigate: [path: string, origin?: DOMRect | null, tone?: Tone]; changed: []; sessionExpired: [] }>();

const students = ref<Student[]>([]);
const invites = ref<Invite[]>([]);
const loading = ref(true);
const failure = ref("");
const notice = ref("");
const busy = ref("");
const query = ref("");
const filter = ref<Filter>("all");
const sort = ref<"recent" | "cohort" | "name">("recent");
const inviteResult = ref<{ url: string; expiresAt: string } | null>(null);
const inviteCopied = ref(false);
const credentials = ref<Credentials | null>(null);
const credentialCopied = ref("");
const createOpen = ref(false);
const currentJoin = joinSeasonAt();
const createForm = ref({ name: "", loginIdentifier: "", cohortYear: "", birthday: "", joinedYear: String(currentJoin.joinedYear), joinedSeason: currentJoin.joinedSeason, memberType: "probationary" as MembershipType, groupRole: "" as GroupRole | "" });
const createError = ref("");
const editTarget = ref<Student | null>(null);
const editForm = ref({ name: "", cohortYear: "", birthday: "", joinedYear: "", joinedSeason: "autumn" as JoinSeason, memberType: "probationary" as MembershipType, groupRole: "" as GroupRole | "", status: "active" as Status });
const editError = ref("");

const me = computed(() => props.people.find((person) => person.id === props.sessionUser.personId) ?? null);
/** Students always belong to a later cohort than their mentor. */
const minStudentYear = computed(() => me.value?.cohort?.year ? me.value.cohort.year + 1 : 1900);
const isPendingAccount = (student: Student) => student.account ? !student.account.activated && student.account.status === "active" : student.claim?.state === "pending" || student.claim?.state === "expired";
const counts = computed(() => ({
  total: students.value.length,
  active: students.value.filter((item) => item.status === "active").length,
  archived: students.value.filter((item) => item.status === "archived").length,
  pending: students.value.filter(isPendingAccount).length,
  invites: invites.value.filter((item) => item.state === "pending").length,
}));
/** Descendants below the direct students, grouped by generation, from the public tree. */
const descendantRings = computed(() => {
  const childrenOf = new Map<string, Person[]>();
  props.people.forEach((person) => { if (person.mentorId) childrenOf.set(person.mentorId, [...(childrenOf.get(person.mentorId) ?? []), person]); });
  const rings: Person[][] = [];
  const seen = new Set([props.sessionUser.personId]);
  let frontier = childrenOf.get(props.sessionUser.personId) ?? [];
  while (frontier.length && rings.length < 12) {
    const ring = frontier.filter((person) => !seen.has(person.id));
    ring.forEach((person) => seen.add(person.id));
    if (!ring.length) break;
    rings.push(ring);
    frontier = ring.flatMap((person) => childrenOf.get(person.id) ?? []);
  }
  return rings;
});
const descendantTotal = computed(() => descendantRings.value.reduce((sum, ring) => sum + ring.length, 0));
const visibleStudents = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  const list = students.value.filter((student) => {
    if (filter.value === "active" && student.status !== "active") return false;
    if (filter.value === "archived" && student.status !== "archived") return false;
    if (filter.value === "pending" && !isPendingAccount(student)) return false;
    if (!text) return true;
    return [student.name, student.cohort?.label ?? "", student.account?.identifier ?? "", membershipLabels[student.memberType], student.groupRole ? groupRoleLabels[student.groupRole] : ""].join(" ").toLocaleLowerCase().includes(text);
  });
  return list.slice().sort((a, b) => sort.value === "name" ? a.name.localeCompare(b.name, "zh-CN")
    : sort.value === "cohort" ? (b.cohort?.year ?? 0) - (a.cohort?.year ?? 0) || a.name.localeCompare(b.name, "zh-CN")
    : b.createdAt.localeCompare(a.createdAt));
});
const filters: Array<{ id: Filter; label: string; count: () => number }> = [
  { id: "all", label: "全部", count: () => counts.value.total },
  { id: "active", label: "在读", count: () => counts.value.active },
  { id: "archived", label: "已毕业", count: () => counts.value.archived },
  { id: "pending", label: "待激活", count: () => counts.value.pending },
];
const toneOf = (student: Student): Tone => toneFor({ id: student.personId, status: student.status }, props.rootPersonId);

function accountState(student: Student) {
  if (!student.account) {
    if (student.claim?.state === "pending") return { label: "等待认领", tone: "warn", detail: `认领链接有效至 ${fullTime(student.claim.expiresAt)}` };
    if (student.claim?.state === "expired") return { label: "认领链接已过期", tone: "warn", detail: "可以重新生成认领链接" };
    return { label: "未建立账号", tone: "muted", detail: "可请管理员建立账号" };
  }
  if (!student.account.identifier) return { label: "未设置邮箱或手机号", tone: "warn", detail: "请通过认领链接补充" };
  if (student.account.status === "disabled") return { label: "账号已停用", tone: "muted", detail: student.account.identifier };
  if (!student.account.activated) return { label: "待首次登录", tone: "warn", detail: `登录标识：${student.account.identifier}` };
  return { label: "已激活", tone: "ok", detail: `登录标识：${student.account.identifier}` };
}

function fail(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.status === 401) emit("sessionExpired");
  return cause instanceof Error ? cause.message : fallback;
}

async function load() {
  loading.value = true;
  failure.value = "";
  try {
    const data = await apiRequest<{ students: Student[]; invites: Invite[] }>("/api/me/students", { token: props.sessionToken, fallback: "徒弟资料读取失败" });
    students.value = data.students;
    invites.value = data.invites;
  } catch (cause) {
    failure.value = fail(cause, "徒弟资料读取失败");
  } finally {
    loading.value = false;
  }
}

async function run(key: string, task: () => Promise<void>, fallback: string) {
  busy.value = key;
  failure.value = "";
  notice.value = "";
  try { await task(); }
  catch (cause) { failure.value = fail(cause, fallback); }
  finally { busy.value = ""; }
}

function createInvite() {
  return run("invite", async () => {
    const data = await apiRequest<{ token: string; expiresAt: string }>("/api/invites", { token: props.sessionToken, json: {}, fallback: "邀请暂时无法生成" });
    inviteResult.value = { url: `${window.location.origin}/register?invite=${encodeURIComponent(data.token)}`, expiresAt: data.expiresAt };
    inviteCopied.value = false;
    await load();
  }, "邀请暂时无法生成");
}
async function copyInvite() {
  if (inviteResult.value) inviteCopied.value = await copyText(inviteResult.value.url);
}
function revokeInvite(invite: Invite) {
  if (!window.confirm("撤销这枚邀请？已经发出的链接会立即失效。")) return;
  return run(`revoke-${invite.id}`, async () => {
    await apiRequest(`/api/me/invites/${encodeURIComponent(invite.id)}`, { token: props.sessionToken, method: "DELETE", fallback: "邀请撤销失败" });
    notice.value = "邀请已撤销";
    await load();
  }, "邀请撤销失败");
}

function openCreate() {
  createError.value = "";
  createForm.value = { name: "", loginIdentifier: "", cohortYear: String((me.value?.cohort?.year ?? currentJoin.joinedYear) + 1), birthday: "", joinedYear: String(currentJoin.joinedYear), joinedSeason: currentJoin.joinedSeason, memberType: "probationary", groupRole: "" };
  createOpen.value = true;
}
async function submitCreate() {
  if (!createForm.value.name.trim()) return;
  const loginIdentifier = createForm.value.loginIdentifier.trim();
  if (!isValidAccountIdentifier(loginIdentifier)) {
    createError.value = "登录标识请填写有效邮箱或手机号";
    return;
  }
  busy.value = "create";
  createError.value = "";
  try {
    const data = await apiRequest<{ person: { id: string; version: number }; claimPath: string; loginIdentifier: string; temporaryPassword: string }>("/api/me/placeholder-students", {
      token: props.sessionToken, fallback: "徒弟账号暂时无法建立",
      json: {
        name: createForm.value.name.trim(), loginIdentifier,
        cohortYear: createForm.value.cohortYear ? Number(createForm.value.cohortYear) : null,
        birthday: createForm.value.birthday || null,
        joinedYear: Number(createForm.value.joinedYear), joinedSeason: createForm.value.joinedSeason,
        memberType: createForm.value.memberType,
      },
    });
    if (createForm.value.groupRole && data.person?.id) {
      await apiRequest(`/api/me/placeholder-students/${encodeURIComponent(data.person.id)}`, { token: props.sessionToken, method: "PATCH", json: { version: data.person.version ?? 1, groupRole: createForm.value.groupRole } }).catch(() => undefined);
    }
    credentials.value = { title: `${createForm.value.name.trim()} 的账号已建立`, identifier: data.loginIdentifier, temporaryPassword: data.temporaryPassword, claimUrl: `${window.location.origin}${data.claimPath}` };
    credentialCopied.value = "";
    createOpen.value = false;
    await load();
    emit("changed");
  } catch (cause) {
    createError.value = fail(cause, "徒弟账号暂时无法建立");
  } finally {
    busy.value = "";
  }
}

function openEdit(student: Student) {
  editError.value = "";
  editTarget.value = student;
  editForm.value = {
    name: student.name, cohortYear: student.cohort?.year ? String(student.cohort.year) : "", birthday: student.birthday ?? "",
    joinedYear: String(student.joinedYear ?? student.joinedAt.slice(0, 4) ?? ""),
    joinedSeason: student.joinedSeason ?? (Number(student.joinedAt.slice(5, 7)) < 9 ? "spring" : "autumn"),
    memberType: student.memberType, groupRole: student.groupRole ?? "", status: student.status,
  };
}
async function submitEdit() {
  const target = editTarget.value;
  if (!target || !editForm.value.name.trim()) return;
  busy.value = "edit";
  editError.value = "";
  try {
    await apiRequest(`/api/me/placeholder-students/${encodeURIComponent(target.personId)}`, {
      token: props.sessionToken, method: "PATCH", fallback: "徒弟资料保存失败",
      json: {
        version: target.version, name: editForm.value.name.trim(),
        cohortYear: editForm.value.cohortYear ? Number(editForm.value.cohortYear) : null,
        birthday: editForm.value.birthday || null,
        joinedYear: Number(editForm.value.joinedYear), joinedSeason: editForm.value.joinedSeason,
        memberType: editForm.value.memberType, groupRole: editForm.value.groupRole || null, status: editForm.value.status,
      },
    });
    editTarget.value = null;
    notice.value = `${editForm.value.name.trim()} 的资料已更新`;
    await load();
    emit("changed");
  } catch (cause) {
    editError.value = cause instanceof ApiError && cause.status === 409 ? "资料已在别处更新，请关闭后刷新再试" : fail(cause, "徒弟资料保存失败");
  } finally {
    busy.value = "";
  }
}

function resetPassword(student: Student) {
  if (!window.confirm(`为 ${student.name} 重新生成初始密码？旧的初始密码会立即失效。`)) return;
  return run(`reset-${student.personId}`, async () => {
    const account = await apiRequest<{ identifier: string; temporaryPassword: string }>(`/api/me/students/${encodeURIComponent(student.personId)}/reset-password`, { token: props.sessionToken, method: "POST", fallback: "初始密码重置失败" });
    credentials.value = { title: `${student.name} 的新初始密码`, identifier: account.identifier, temporaryPassword: account.temporaryPassword };
    credentialCopied.value = "";
    await load();
  }, "初始密码重置失败");
}
function rotateClaim(student: Student) {
  return run(`claim-${student.personId}`, async () => {
    const data = await apiRequest<{ claimPath: string }>(`/api/me/placeholder-students/${encodeURIComponent(student.personId)}/claim`, { token: props.sessionToken, method: "POST", fallback: "认领链接暂时无法更新" });
    const url = `${window.location.origin}${data.claimPath}`;
    credentials.value = { title: `${student.name} 的新认领链接`, identifier: student.account?.identifier ?? "", temporaryPassword: "", claimUrl: url };
    credentialCopied.value = "";
    await load();
  }, "认领链接暂时无法更新");
}
async function copyCredential(key: string, value: string) {
  if (await copyText(value)) credentialCopied.value = key;
}
const credentialText = computed(() => credentials.value ? [
  `翻斗星谱登录地址：${window.location.origin}`,
  credentials.value.identifier ? `登录标识：${credentials.value.identifier}` : "未设置邮箱或手机号，请通过认领链接补充。",
  credentials.value.temporaryPassword ? `初始密码：${credentials.value.temporaryPassword}（首次登录需修改）` : "",
  credentials.value.claimUrl ? `认领链接：${credentials.value.claimUrl}` : "",
].filter(Boolean).join("\n") : "");

function visit(student: { personId?: string; id?: string }, event: Event) {
  const id = student.personId ?? student.id ?? "";
  const avatar = (event.currentTarget as HTMLElement | null)?.closest(".student-card, .ring-star")?.querySelector(".star-avatar-core");
  emit("navigate", `/person/${encodeURIComponent(id)}`, avatar?.getBoundingClientRect() ?? null, "aqua");
}

onMounted(load);
</script>

<template>
  <section class="studio" aria-labelledby="studio-title">
    <header class="studio-hero">
      <div class="studio-hero-copy">
        <span class="section-label">MENTOR STUDIO</span>
        <h1 id="studio-title">徒弟管理</h1>
        <p>从 {{ sessionUser.displayName }} 延伸出的每一条轨迹都在这里：邀请新徒弟、代建账号、维护身份与状态。</p>
      </div>
      <div class="studio-actions">
        <button class="action-tile" type="button" :disabled="busy === 'invite'" @click="createInvite">
          <span class="action-icon" aria-hidden="true">✉</span>
          <strong>{{ busy === "invite" ? "正在生成…" : "生成邀请链接" }}</strong>
          <small>一次性链接，7 天有效，对方自行注册</small>
        </button>
        <button class="action-tile" type="button" @click="openCreate">
          <span class="action-icon" aria-hidden="true">✦</span>
          <strong>代建徒弟账号</strong>
          <small>先保留节点，把初始凭据交给本人</small>
        </button>
      </div>
    </header>

    <div v-if="inviteResult" class="invite-result" role="status">
      <div><strong>邀请链接已生成</strong><small>有效期至 {{ fullTime(inviteResult.expiresAt) }}，只能使用一次。</small></div>
      <input :value="inviteResult.url" readonly aria-label="邀请链接" @focus="($event.target as HTMLInputElement).select()" />
      <button class="primary-command" type="button" @click="copyInvite">{{ inviteCopied ? "已复制" : "复制链接" }}</button>
      <button class="icon-close" type="button" aria-label="收起邀请链接" @click="inviteResult = null">×</button>
    </div>

    <dl class="studio-stats">
      <div><dt>直系徒弟</dt><dd>{{ counts.total }}</dd></div>
      <div><dt>在读</dt><dd>{{ counts.active }}</dd></div>
      <div><dt>已毕业</dt><dd>{{ counts.archived }}</dd></div>
      <div :class="{ warn: counts.pending }"><dt>待激活</dt><dd>{{ counts.pending }}</dd></div>
      <div><dt>后辈总数</dt><dd>{{ descendantTotal }}</dd></div>
      <div><dt>有效邀请</dt><dd>{{ counts.invites }}</dd></div>
    </dl>

    <p v-if="failure" class="studio-message error" role="alert">{{ failure }}</p>
    <p v-if="notice" class="studio-message ok" role="status">{{ notice }}</p>

    <div class="studio-layout">
      <div class="studio-main">
        <div class="studio-toolbar">
          <label class="studio-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
            <input v-model="query" type="search" placeholder="搜索姓名、级别、登录标识" aria-label="搜索徒弟" />
          </label>
          <div class="filter-chips" role="tablist" aria-label="筛选徒弟">
            <button v-for="item in filters" :key="item.id" type="button" role="tab" :aria-selected="filter === item.id" :class="{ active: filter === item.id }" @click="filter = item.id">{{ item.label }}<small>{{ item.count() }}</small></button>
          </div>
          <label class="studio-sort"><span class="visually-hidden">排序</span>
            <select v-model="sort"><option value="recent">最近加入</option><option value="cohort">按级别</option><option value="name">按姓名</option></select>
          </label>
        </div>

        <div v-if="loading" class="studio-loading"><span class="loading-ring"></span>正在读取徒弟</div>
        <div v-else-if="!students.length" class="studio-empty">
          <span aria-hidden="true">✧</span>
          <h2>还没有徒弟</h2>
          <p>生成一枚邀请链接交给徒弟，或者先为TA代建一个账号。加入后，TA 会出现在你的星轨下方。</p>
        </div>
        <p v-else-if="!visibleStudents.length" class="studio-empty small">没有符合条件的徒弟。<button class="text-link" type="button" @click="query = ''; filter = 'all'">清除筛选</button></p>
        <div v-else class="student-grid">
          <article v-for="student in visibleStudents" :key="student.personId" class="student-card" :class="{ graduated: student.status === 'archived' }">
            <header>
              <button class="student-avatar" type="button" :aria-label="`打开 ${student.name} 的主页`" @click="visit(student, $event)">
                <StarAvatar :name="student.name" :avatar-url="student.avatarUrl" :tone="toneOf(student)" size="sm" />
              </button>
              <div class="student-title">
                <h3><button type="button" @click="visit(student, $event)">{{ student.name }}</button></h3>
                <p>{{ formatCohort(student.cohort) }} · 进组于 {{ joinedSeasonLabel(student.joinedAt) }}</p>
              </div>
              <span class="status-pill" :class="student.status">{{ student.status === "archived" ? "已毕业" : "在读" }}</span>
            </header>
            <div class="student-chips">
              <span class="chip" :class="`membership-${student.memberType}`">{{ membershipLabels[student.memberType] }}</span>
              <span v-if="student.groupRole" class="chip role" :class="`group-${student.groupRole}`">{{ groupRoleLabels[student.groupRole] }}</span>
              <span v-if="student.destination" class="chip">去向 · {{ destinationLabels[student.destination] }}</span>
              <span v-if="student.studentCount" class="chip">徒弟 {{ student.studentCount }}</span>
            </div>
            <div class="account-line" :class="accountState(student).tone">
              <i aria-hidden="true"></i>
              <span><strong>{{ accountState(student).label }}</strong><small>{{ accountState(student).detail }}</small></span>
            </div>
            <footer>
              <button class="text-link" type="button" @click="visit(student, $event)">主页</button>
              <button class="text-link" type="button" @click="openEdit(student)">编辑</button>
              <button v-if="student.account?.canResetPassword" class="text-link" type="button" :disabled="busy === `reset-${student.personId}`" @click="resetPassword(student)">重置初始密码</button>
              <button v-if="student.claim && student.claim.state !== 'claimed' && !student.account?.activated" class="text-link" type="button" :disabled="busy === `claim-${student.personId}`" @click="rotateClaim(student)">更新认领链接</button>
            </footer>
          </article>
        </div>
      </div>

      <aside class="studio-aside">
        <article class="aside-card">
          <header><span class="section-label">CONSTELLATION</span><h2>我的传承</h2></header>
          <div v-if="descendantRings.length" class="rings">
            <div v-for="(ring, index) in descendantRings" :key="index" class="ring">
              <p>{{ index === 0 ? "徒弟" : index === 1 ? "徒孙" : `第 ${index + 1} 代后辈` }}<b>{{ ring.length }}</b></p>
              <div class="ring-stars">
                <button v-for="person in ring" :key="person.id" class="ring-star" type="button" :title="person.name" @click="visit(person, $event)">
                  <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="toneFor(person, rootPersonId)" size="sm" />
                  <span>{{ person.name }}</span>
                </button>
              </div>
            </div>
          </div>
          <p v-else class="aside-empty">徒弟加入后，这里会展开你的传承星图。</p>
        </article>
        <article class="aside-card">
          <header><span class="section-label">INVITES</span><h2>邀请记录</h2></header>
          <ul v-if="invites.length" class="invite-list">
            <li v-for="invite in invites" :key="invite.id" :class="invite.state">
              <span class="invite-state">{{ { pending: "待使用", accepted: "已使用", expired: "已过期", revoked: "已撤销" }[invite.state] }}</span>
              <span class="invite-meta">
                <strong v-if="invite.acceptedPerson">{{ invite.acceptedPerson.name }} 已加入</strong>
                <strong v-else>{{ relativeTime(invite.createdAt) }}生成</strong>
                <small>{{ invite.state === "pending" ? `有效期至 ${fullTime(invite.expiresAt)}` : fullTime(invite.acceptedAt ?? invite.revokedAt ?? invite.expiresAt) }}</small>
              </span>
              <button v-if="invite.state === 'pending'" class="text-link danger" type="button" :disabled="busy === `revoke-${invite.id}`" @click="revokeInvite(invite)">撤销</button>
            </li>
          </ul>
          <p v-else class="aside-empty">还没有发出过邀请。</p>
        </article>
        <article class="aside-card tips">
          <header><span class="section-label">NOTES</span><h2>说明</h2></header>
          <ul>
            <li>邀请链接与认领链接都只显示一次，丢失后可以重新生成。</li>
            <li>代建账号的初始密码只在徒弟首次登录前可以重置；徒弟设置自己的密码后，师傅不再能接触这个账号。</li>
            <li>徒弟的师徒关系调整、账号停用等操作由管理员处理。</li>
          </ul>
        </article>
      </aside>
    </div>

    <Teleport to="body">
    <div v-if="createOpen" class="modal-backdrop" @click.self="busy !== 'create' && (createOpen = false)">
      <section class="auth-dialog studio-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <button class="popover-close" type="button" aria-label="关闭" @click="createOpen = false">×</button>
        <span class="section-label">DELEGATED ACCOUNT</span>
        <h2 id="create-title">为徒弟留下一颗星</h2>
        <p class="dialog-copy">建立后会生成初始密码和认领链接，二者都只显示一次。徒弟首次登录时必须修改密码。</p>
        <form class="auth-form" @submit.prevent="submitCreate">
          <label class="form-field"><span>姓名</span><input v-model.trim="createForm.name" maxlength="100" required autofocus /></label>
          <label class="form-field"><span>登录邮箱或手机号</span><input v-model="createForm.loginIdentifier" maxlength="254" placeholder="请输入邮箱或手机号" autocomplete="username" required /></label>
          <div class="dialog-row">
            <label class="form-field"><span>级别年份</span><input v-model.trim="createForm.cohortYear" type="number" :min="minStudentYear" max="2200" :title="`徒弟的级别需晚于你（${me?.cohort?.year ?? '未分级'}）`" /></label>
            <label class="form-field"><span>生日</span><input v-model="createForm.birthday" type="date" /></label>
            <label class="form-field"><span>进组年份</span><input v-model.trim="createForm.joinedYear" type="number" min="1900" max="2200" required /></label>
            <label class="form-field"><span>进组季节</span><select v-model="createForm.joinedSeason"><option value="spring">春季</option><option value="autumn">秋季</option></select></label>
            <label class="form-field"><span>组员身份</span><select v-model="createForm.memberType"><option value="probationary">预备组员</option><option value="formal">正式组员</option></select></label>
            <label class="form-field"><span>组内职务</span><select v-model="createForm.groupRole"><option value="">无</option><option value="leader">组长</option><option value="vice_leader">副组长</option></select></label>
          </div>
          <p v-if="createError" class="form-error" role="alert">{{ createError }}</p>
          <div class="form-actions">
            <button class="secondary-command" type="button" :disabled="busy === 'create'" @click="createOpen = false">取消</button>
            <button class="primary-command" type="submit" :disabled="busy === 'create' || !createForm.name || !createForm.loginIdentifier.trim()">{{ busy === "create" ? "正在建立…" : "建立账号" }}</button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="editTarget" class="modal-backdrop" @click.self="busy !== 'edit' && (editTarget = null)">
      <section class="auth-dialog studio-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <button class="popover-close" type="button" aria-label="关闭" @click="editTarget = null">×</button>
        <span class="section-label">STUDENT</span>
        <h2 id="edit-title">编辑 {{ editTarget.name }}</h2>
        <form class="auth-form" @submit.prevent="submitEdit">
          <label class="form-field"><span>姓名</span><input v-model.trim="editForm.name" maxlength="100" required /></label>
          <div class="dialog-row">
            <label class="form-field"><span>级别年份</span><input v-model.trim="editForm.cohortYear" type="number" :min="minStudentYear" max="2200" /></label>
            <label class="form-field"><span>生日</span><input v-model="editForm.birthday" type="date" /></label>
            <label class="form-field"><span>进组年份</span><input v-model.trim="editForm.joinedYear" type="number" min="1900" max="2200" required /></label>
            <label class="form-field"><span>进组季节</span><select v-model="editForm.joinedSeason"><option value="spring">春季</option><option value="autumn">秋季</option></select></label>
            <label class="form-field"><span>组员身份</span><select v-model="editForm.memberType"><option value="probationary">预备组员</option><option value="formal">正式组员</option></select></label>
          </div>
          <div class="dialog-row">
            <label class="form-field"><span>组内职务</span><select v-model="editForm.groupRole"><option value="">无</option><option value="leader">组长</option><option value="vice_leader">副组长</option></select></label>
            <label class="form-field"><span>状态</span><select v-model="editForm.status"><option value="active">在读</option><option value="archived">已毕业</option></select></label>
          </div>
          <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
          <div class="form-actions">
            <button class="secondary-command" type="button" :disabled="busy === 'edit'" @click="editTarget = null">取消</button>
            <button class="primary-command" type="submit" :disabled="busy === 'edit' || !editForm.name">{{ busy === "edit" ? "保存中…" : "保存" }}</button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="credentials" class="modal-backdrop">
      <section class="auth-dialog studio-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-title">
        <span class="section-label">ONE-TIME CREDENTIALS</span>
        <h2 id="credential-title">{{ credentials.title }}</h2>
        <p class="dialog-copy warn">以下信息只显示这一次，请现在复制并私下交给徒弟本人。</p>
        <div class="credential-list">
          <div v-if="credentials.identifier"><span>登录标识</span><code>{{ credentials.identifier }}</code><button class="text-link" type="button" @click="copyCredential('id', credentials.identifier)">{{ credentialCopied === "id" ? "已复制" : "复制" }}</button></div>
          <div v-else><span>登录标识</span><code>未设置邮箱或手机号，请通过认领链接补充</code></div>
          <div v-if="credentials.temporaryPassword"><span>初始密码</span><code>{{ credentials.temporaryPassword }}</code><button class="text-link" type="button" @click="copyCredential('password', credentials.temporaryPassword)">{{ credentialCopied === "password" ? "已复制" : "复制" }}</button></div>
          <div v-if="credentials.claimUrl"><span>认领链接</span><code>{{ credentials.claimUrl }}</code><button class="text-link" type="button" @click="copyCredential('claim', credentials.claimUrl)">{{ credentialCopied === "claim" ? "已复制" : "复制" }}</button></div>
        </div>
        <p class="dialog-copy">{{ credentials.identifier ? "徒弟可以用初始密码登录后修改密码，也可以打开认领链接自己设置邮箱和密码，两种方式任选其一。" : "徒弟需要打开认领链接，补充邮箱或手机号并设置密码。" }}</p>
        <div class="form-actions">
          <button class="secondary-command" type="button" @click="copyCredential('all', credentialText)">{{ credentialCopied === "all" ? "已复制全部" : "复制全部信息" }}</button>
          <button class="primary-command" type="button" @click="credentials = null">我已保存</button>
        </div>
      </section>
    </div>
    </Teleport>
  </section>
</template>

<style src="./studio.css" scoped></style>
