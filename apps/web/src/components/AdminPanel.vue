<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type Member = {
  id: string; name: string; cohort_id: string | null; cohort_label: string | null;
  status: "active" | "archived"; destination: string | null; mentor_id: string | null;
  mentor_name: string | null; relation_scope: "lineage" | "cohort_guest"; version: number;
  nickname: string | null; bio: string; role: string; is_featured: number; featured_note: string | null; tags_json: string;
  account_id: string | null; email: string | null; account_role: "member" | "admin" | null;
  account_status: "active" | "disabled" | null;
};
type Cohort = { id: string; label: string; year: number | null; sort_order: number; description: string; member_count: number };
type Invite = { id: string; mentor_id: string; mentor_name: string; created_at: string; expires_at: string; accepted_at: string | null; accepted_person_id: string | null; revoked_at: string | null };
type AuditLog = { id: string; actor_name: string; action: string; target_type: string; target_id: string; details_json: string; created_at: string };
type Tab = "members" | "cohorts" | "invites" | "audit";

const props = defineProps<{ sessionToken: string }>();
const emit = defineEmits<{ changed: [] }>();
const tab = ref<Tab>("members");
const loading = ref(true);
const saving = ref("");
const notice = ref("");
const failure = ref("");
const members = ref<Member[]>([]);
const cohorts = ref<Cohort[]>([]);
const invites = ref<Invite[]>([]);
const logs = ref<AuditLog[]>([]);
const editingId = ref("");
const editForm = ref({ name: "", nickname: "", bio: "", role: "", isFeatured: false, featuredNote: "", tags: "", cohortId: "", status: "active", destination: "", mentorId: "", relationScope: "lineage" });
const memberForm = ref({ name: "", cohortId: "", status: "active", destination: "", mentorId: "", relationScope: "lineage" });
const cohortForm = ref({ label: "", year: new Date().getFullYear(), sortOrder: new Date().getFullYear(), description: "" });
const accountForm = ref({ personId: "", email: "", password: "", role: "member" });
const resetPasswords = ref<Record<string, string>>({});

const tabs: { id: Tab; label: string }[] = [
  { id: "members", label: "成员与账号" },
  { id: "cohorts", label: "届次" },
  { id: "invites", label: "邀请" },
  { id: "audit", label: "审计日志" },
];
const destinationOptions = [
  ["", "暂未填写"], ["big_tech", "大厂"], ["postgraduate_985", "985 研"],
  ["postgraduate_211", "211 研"], ["startup", "创业"], ["further_study", "继续深造"], ["other", "其他"],
];
const accountlessMembers = computed(() => members.value.filter((member) => !member.account_id));
const headers = computed(() => ({ Authorization: `Bearer ${props.sessionToken}`, "Content-Type": "application/json" }));

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/admin${path}`, { ...init, headers: { ...headers.value, ...(init.headers ?? {}) } });
  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "管理请求失败");
  return payload?.data as T;
}

async function loadAll() {
  loading.value = true;
  failure.value = "";
  try {
    const [memberRows, cohortRows, inviteRows, auditRows] = await Promise.all([
      api<Member[]>("/members"), api<Cohort[]>("/cohorts"), api<Invite[]>("/invites"), api<AuditLog[]>("/audit-logs?limit=100"),
    ]);
    members.value = memberRows;
    cohorts.value = cohortRows;
    invites.value = inviteRows;
    logs.value = auditRows;
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : "管理资料读取失败";
  } finally {
    loading.value = false;
  }
}

async function mutate(key: string, task: () => Promise<unknown>, message: string, treeChanged = false) {
  saving.value = key;
  failure.value = "";
  notice.value = "";
  try {
    await task();
    notice.value = message;
    await loadAll();
    if (treeChanged) emit("changed");
    return true;
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : "保存失败";
    return false;
  } finally {
    saving.value = "";
  }
}

async function createMember() {
  const ok = await mutate("member-new", () => api("/members", { method: "POST", body: JSON.stringify({
    ...memberForm.value,
    cohortId: memberForm.value.cohortId || null,
    mentorId: memberForm.value.mentorId || null,
    destination: memberForm.value.destination || null,
  }) }), "人物已加入星谱", true);
  if (ok) memberForm.value = { name: "", cohortId: "", status: "active", destination: "", mentorId: "", relationScope: "lineage" };
}

function editMember(member: Member) {
  editingId.value = member.id;
  editForm.value = {
    name: member.name, nickname: member.nickname ?? "", bio: member.bio, role: member.role,
    isFeatured: Boolean(member.is_featured), featuredNote: member.featured_note ?? "",
    tags: (() => { try { return (JSON.parse(member.tags_json) as string[]).join("、"); } catch { return ""; } })(),
    cohortId: member.cohort_id ?? "", status: member.status,
    destination: member.destination ?? "", mentorId: member.mentor_id ?? "", relationScope: member.relation_scope,
  };
}

async function saveMember(member: Member) {
  const ok = await mutate(`member-${member.id}`, () => api(`/members/${encodeURIComponent(member.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...editForm.value, version: member.version, nickname: editForm.value.nickname || null,
      featuredNote: editForm.value.featuredNote || null,
      tags: editForm.value.tags.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean),
      cohortId: editForm.value.cohortId || null, mentorId: editForm.value.mentorId || null, destination: editForm.value.destination || null }),
  }), "成员资料已保存", true);
  if (ok) editingId.value = "";
}

async function createCohort() {
  const ok = await mutate("cohort-new", () => api("/cohorts", { method: "POST", body: JSON.stringify(cohortForm.value) }), "届次已创建", true);
  if (ok) cohortForm.value = { label: "", year: new Date().getFullYear(), sortOrder: new Date().getFullYear(), description: "" };
}

async function saveCohort(cohort: Cohort) {
  await mutate(`cohort-${cohort.id}`, () => api(`/cohorts/${encodeURIComponent(cohort.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ label: cohort.label, year: cohort.year, sortOrder: Number(cohort.sort_order), description: cohort.description }),
  }), "届次已保存", true);
}

async function deleteCohort(cohort: Cohort) {
  if (cohort.member_count > 0 || !window.confirm(`删除届次“${cohort.label}”？`)) return;
  await mutate(`cohort-${cohort.id}`, () => api(`/cohorts/${encodeURIComponent(cohort.id)}`, { method: "DELETE" }), "届次已删除", true);
}

async function setAccountStatus(member: Member) {
  if (!member.account_id || !member.account_status) return;
  const status = member.account_status === "active" ? "disabled" : "active";
  if (status === "disabled" && !window.confirm(`停用 ${member.name} 的账号？`)) return;
  await mutate(`account-${member.account_id}`, () => api(`/accounts/${encodeURIComponent(member.account_id!)}/status`, {
    method: "PATCH", body: JSON.stringify({ status }),
  }), status === "active" ? "账号已启用" : "账号已停用");
}

async function setAccountRole(member: Member, role: "member" | "admin") {
  if (!member.account_id || member.account_role === role) return;
  await mutate(`role-${member.account_id}`, () => api(`/accounts/${encodeURIComponent(member.account_id!)}/role`, {
    method: "PATCH", body: JSON.stringify({ role }),
  }), role === "admin" ? "已授予管理员权限" : "已改为普通成员");
}

async function resetPassword(member: Member) {
  if (!member.account_id) return;
  const password = resetPasswords.value[member.account_id] ?? "";
  if (password.length < 8) { failure.value = "新密码至少 8 位"; return; }
  const ok = await mutate(`password-${member.account_id}`, () => api(`/accounts/${encodeURIComponent(member.account_id!)}/reset-password`, {
    method: "POST", body: JSON.stringify({ password }),
  }), "密码已重置，旧会话已失效");
  if (ok) resetPasswords.value[member.account_id] = "";
}

async function createAccount() {
  const ok = await mutate("account-new", () => api("/accounts", { method: "POST", body: JSON.stringify(accountForm.value) }), "账号已创建");
  if (ok) accountForm.value = { personId: "", email: "", password: "", role: "member" };
}

async function revokeInvite(invite: Invite) {
  if (!window.confirm(`撤销 ${invite.mentor_name} 的这枚邀请？`)) return;
  await mutate(`invite-${invite.id}`, () => api(`/invites/${encodeURIComponent(invite.id)}`, { method: "DELETE" }), "邀请已撤销");
}

function inviteStatus(invite: Invite) {
  if (invite.revoked_at) return "已撤销";
  if (invite.accepted_at) return "已使用";
  if (Date.parse(invite.expires_at) <= Date.now()) return "已过期";
  return "待使用";
}

function displayDetails(raw: string) {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

onMounted(loadAll);
</script>

<template>
  <section class="admin-panel" aria-label="星谱管理后台">
    <header class="admin-heading">
      <div><span class="admin-kicker">CONSTELLATION CONTROL</span><h1>星谱管理</h1></div>
      <button class="quiet-button" type="button" :disabled="loading" title="刷新管理资料" @click="loadAll">↻</button>
    </header>
    <nav class="admin-tabs" aria-label="管理功能">
      <button v-for="item in tabs" :key="item.id" type="button" :class="{ active: tab === item.id }" @click="tab = item.id">{{ item.label }}</button>
    </nav>
    <p v-if="failure" class="admin-message error" role="alert">{{ failure }}</p>
    <p v-if="notice" class="admin-message success" role="status">{{ notice }}</p>
    <div v-if="loading" class="admin-loading">正在读取管理资料</div>

    <template v-else-if="tab === 'members'">
      <form class="admin-form new-member" @submit.prevent="createMember">
        <h2>新增无账号人物</h2>
        <label>姓名<input v-model.trim="memberForm.name" maxlength="100" required /></label>
        <label>届次<select v-model="memberForm.cohortId"><option value="">未分届次</option><option v-for="cohort in cohorts" :key="cohort.id" :value="cohort.id">{{ cohort.label }}</option></select></label>
        <label>状态<select v-model="memberForm.status"><option value="active">在读</option><option value="archived">毕业</option></select></label>
        <label>去向<select v-model="memberForm.destination"><option v-for="option in destinationOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option></select></label>
        <label>师傅<select v-model="memberForm.mentorId"><option value="">无</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option></select></label>
        <label>归属<select v-model="memberForm.relationScope"><option value="lineage">谱系</option><option value="cohort_guest">同届成员</option></select></label>
        <button class="primary-button" type="submit" :disabled="saving === 'member-new'">新增人物</button>
      </form>

      <div class="member-list">
        <article v-for="member in members" :key="member.id" class="member-row">
          <template v-if="editingId === member.id">
            <div class="member-grid editing">
              <label>姓名<input v-model.trim="editForm.name" maxlength="100" /></label>
              <label>昵称<input v-model.trim="editForm.nickname" maxlength="100" /></label>
              <label>身份说明<input v-model.trim="editForm.role" maxlength="160" /></label>
              <label>届次<select v-model="editForm.cohortId"><option value="">未分届次</option><option v-for="cohort in cohorts" :key="cohort.id" :value="cohort.id">{{ cohort.label }}</option></select></label>
              <label>状态<select v-model="editForm.status"><option value="active">在读</option><option value="archived">毕业</option></select></label>
              <label>去向<select v-model="editForm.destination"><option v-for="option in destinationOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option></select></label>
              <label>师傅<select v-model="editForm.mentorId"><option value="">无</option><option v-for="candidate in members.filter((item) => item.id !== member.id)" :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option></select></label>
              <label>归属<select v-model="editForm.relationScope"><option value="lineage">谱系</option><option value="cohort_guest">同届成员</option></select></label>
              <label class="wide-field">简介<textarea v-model="editForm.bio" maxlength="10000" rows="3"></textarea></label>
              <label>标签<input v-model.trim="editForm.tags" maxlength="1000" placeholder="以顿号或逗号分隔" /></label>
              <label>重点人物<select v-model="editForm.isFeatured"><option :value="false">否</option><option :value="true">是</option></select></label>
              <label>重点说明<input v-model.trim="editForm.featuredNote" maxlength="1000" /></label>
            </div>
            <div class="row-actions"><button type="button" @click="editingId = ''">取消</button><button class="primary-button" type="button" :disabled="saving === `member-${member.id}`" @click="saveMember(member)">保存</button></div>
          </template>
          <template v-else>
            <div class="member-summary"><strong>{{ member.name }}</strong><span>{{ member.cohort_label ?? "未分届次" }} · {{ member.status === "active" ? "在读" : "毕业" }} · {{ member.mentor_name ? `师从 ${member.mentor_name}` : "无师傅" }}</span></div>
            <div class="account-summary">
              <template v-if="member.account_id">
                <span>{{ member.email }} · {{ member.account_role === "admin" ? "管理员" : "成员" }} · {{ member.account_status === "active" ? "已启用" : "已停用" }}</span>
                <select :value="member.account_role ?? 'member'" aria-label="账号权限" :disabled="saving === `role-${member.account_id}`" @change="setAccountRole(member, ($event.target as HTMLSelectElement).value as 'member' | 'admin')"><option value="member">成员</option><option value="admin">管理员</option></select>
                <button type="button" :disabled="saving === `account-${member.account_id}`" @click="setAccountStatus(member)">{{ member.account_status === "active" ? "停用" : "启用" }}</button>
                <input v-model="resetPasswords[member.account_id]" type="password" minlength="8" maxlength="100" autocomplete="new-password" placeholder="输入新密码" aria-label="新密码" />
                <button type="button" :disabled="saving === `password-${member.account_id}`" @click="resetPassword(member)">重置密码</button>
              </template>
              <span v-else>尚未绑定账号</span>
            </div>
            <button class="edit-button" type="button" title="编辑成员" @click="editMember(member)">编辑</button>
          </template>
        </article>
      </div>

      <form v-if="accountlessMembers.length" class="admin-form account-form" @submit.prevent="createAccount">
        <h2>为人物建立账号</h2>
        <label>人物<select v-model="accountForm.personId" required><option value="" disabled>选择人物</option><option v-for="member in accountlessMembers" :key="member.id" :value="member.id">{{ member.name }}</option></select></label>
        <label>邮箱<input v-model.trim="accountForm.email" type="email" required maxlength="254" /></label>
        <label>初始密码<input v-model="accountForm.password" type="password" required minlength="8" maxlength="100" autocomplete="new-password" /></label>
        <label>权限<select v-model="accountForm.role"><option value="member">成员</option><option value="admin">管理员</option></select></label>
        <button class="primary-button" type="submit" :disabled="saving === 'account-new'">建立账号</button>
      </form>
    </template>

    <template v-else-if="tab === 'cohorts'">
      <form class="admin-form cohort-new" @submit.prevent="createCohort">
        <h2>新增届次</h2>
        <label>名称<input v-model.trim="cohortForm.label" maxlength="100" required placeholder="例如 2027届" /></label>
        <label>年份<input v-model.number="cohortForm.year" type="number" min="1900" max="2200" /></label>
        <label>排序<input v-model.number="cohortForm.sortOrder" type="number" /></label>
        <label class="wide">说明<textarea v-model="cohortForm.description" maxlength="1000" rows="2"></textarea></label>
        <button class="primary-button" type="submit" :disabled="saving === 'cohort-new'">新增届次</button>
      </form>
      <div class="cohort-list">
        <article v-for="cohort in cohorts" :key="cohort.id" class="cohort-row">
          <input v-model.trim="cohort.label" aria-label="届次名称" maxlength="100" />
          <input v-model.number="cohort.year" aria-label="年份" type="number" min="1900" max="2200" />
          <input v-model.number="cohort.sort_order" aria-label="排序" type="number" />
          <input v-model.trim="cohort.description" aria-label="届次说明" maxlength="1000" />
          <span>{{ cohort.member_count }} 人</span>
          <button type="button" :disabled="saving === `cohort-${cohort.id}`" @click="saveCohort(cohort)">保存</button>
          <button type="button" :disabled="cohort.member_count > 0 || saving === `cohort-${cohort.id}`" title="仅空届次可删除" @click="deleteCohort(cohort)">删除</button>
        </article>
      </div>
    </template>

    <div v-else-if="tab === 'invites'" class="table-shell">
      <table><thead><tr><th>师傅</th><th>创建时间</th><th>失效时间</th><th>状态</th><th></th></tr></thead>
        <tbody><tr v-for="invite in invites" :key="invite.id"><td>{{ invite.mentor_name }}</td><td>{{ new Date(invite.created_at).toLocaleString("zh-CN") }}</td><td>{{ new Date(invite.expires_at).toLocaleString("zh-CN") }}</td><td>{{ inviteStatus(invite) }}</td><td><button v-if="inviteStatus(invite) === '待使用'" type="button" :disabled="saving === `invite-${invite.id}`" @click="revokeInvite(invite)">撤销</button></td></tr></tbody>
      </table>
      <p v-if="!invites.length" class="empty-state">还没有邀请记录。</p>
    </div>

    <div v-else class="audit-list">
      <article v-for="log in logs" :key="log.id"><time>{{ new Date(log.created_at).toLocaleString("zh-CN") }}</time><strong>{{ log.actor_name }} · {{ log.action }}</strong><span>{{ log.target_type }} / {{ log.target_id }}</span><pre v-if="log.details_json !== '{}'">{{ displayDetails(log.details_json) }}</pre></article>
      <p v-if="!logs.length" class="empty-state">还没有管理操作记录。</p>
    </div>
  </section>
</template>

<style scoped>
.admin-panel { width: min(1180px, calc(100% - 32px)); margin: 24px auto 80px; padding: clamp(20px, 4vw, 36px); border: 1px solid var(--glass-border); border-radius: 8px; background: rgba(7, 13, 29, .88); box-shadow: 0 24px 80px rgba(0, 0, 0, .38); backdrop-filter: blur(18px); }
.admin-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.admin-kicker { color: var(--aqua); font-size: 10px; letter-spacing: .26em; }
h1 { margin: 8px 0 0; font-family: var(--serif); font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 400; letter-spacing: 0; }
h2 { grid-column: 1 / -1; margin: 0; font-family: var(--serif); font-size: 18px; font-weight: 400; letter-spacing: 0; }
.quiet-button { width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 50%; background: rgba(142, 217, 208, .06); color: var(--aqua); font-size: 20px; }
.admin-tabs { display: flex; gap: 4px; margin: 24px 0; padding-bottom: 1px; border-bottom: 1px solid var(--line); overflow-x: auto; }
.admin-tabs button { padding: 10px 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); white-space: nowrap; }
.admin-tabs button.active { border-bottom-color: var(--gold); color: var(--gold); }
.admin-message { padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; }
.admin-message.error { border-color: rgba(255, 155, 140, .35); color: #ffb4a8; }
.admin-message.success { border-color: rgba(142, 217, 208, .35); color: var(--aqua); }
.admin-loading, .empty-state { padding: 40px 0; color: var(--muted); text-align: center; }
.admin-form { display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); gap: 12px; margin-bottom: 24px; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: rgba(16, 35, 66, .28); }
.admin-form label, .member-grid label { display: grid; gap: 6px; color: var(--ink-soft); font-size: 11px; }
input, select, textarea { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; outline: 0; background: rgba(3, 8, 20, .72); color: var(--ink); }
input:focus, select:focus, textarea:focus { border-color: rgba(142, 217, 208, .55); }
.primary-button, .admin-form > button { align-self: end; min-height: 38px; padding: 8px 13px; border: 1px solid rgba(231, 201, 130, .48); border-radius: 6px; background: rgba(231, 201, 130, .1); color: var(--gold); }
.member-list, .cohort-list, .audit-list { display: grid; gap: 8px; }
.member-row, .cohort-row, .audit-list article { position: relative; padding: 14px; border: 1px solid var(--line); border-radius: 6px; background: rgba(9, 18, 39, .58); }
.member-summary { display: grid; gap: 4px; padding-right: 62px; }
.member-summary strong { font-family: var(--serif); font-size: 17px; font-weight: 400; }
.member-summary span, .account-summary { color: var(--muted); font-size: 12px; }
.account-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.account-summary input { width: 150px; min-height: 32px; }
button { border: 1px solid var(--line); border-radius: 6px; background: rgba(145, 177, 210, .07); color: var(--ink-soft); }
.account-summary button, .row-actions button, .cohort-row button, table button { min-height: 32px; padding: 5px 10px; }
.edit-button { position: absolute; top: 14px; right: 14px; min-height: 32px; padding: 5px 10px; }
.member-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.member-grid .wide-field { grid-column: span 2; }
.row-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.account-form { grid-template-columns: 2fr 2fr 2fr 1fr auto; margin-top: 24px; }
.cohort-new { grid-template-columns: 2fr 1fr 1fr 3fr auto; }
.cohort-new .wide { min-width: 0; }
.cohort-row { display: grid; grid-template-columns: 1.4fr .6fr .5fr 2fr auto auto auto; align-items: center; gap: 8px; }
.cohort-row span { color: var(--muted); font-size: 12px; white-space: nowrap; }
.table-shell { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 12px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { color: var(--aqua); font-size: 10px; font-weight: 500; letter-spacing: .14em; }
td { color: var(--ink-soft); }
.audit-list article { display: grid; grid-template-columns: 170px 1fr 1fr; gap: 8px 16px; align-items: baseline; font-size: 12px; }
.audit-list time, .audit-list span { color: var(--muted); }
.audit-list pre { grid-column: 2 / -1; margin: 0; color: var(--ink-soft); white-space: pre-wrap; }
@media (max-width: 900px) { .admin-form, .account-form, .cohort-new { grid-template-columns: repeat(2, 1fr); } .admin-form h2, .admin-form > button, .admin-form .wide { grid-column: 1 / -1; } .cohort-row { grid-template-columns: repeat(2, 1fr); } .member-grid { grid-template-columns: repeat(2, 1fr); } .audit-list article { grid-template-columns: 1fr; } .audit-list pre { grid-column: auto; } }
@media (max-width: 560px) { .admin-panel { width: calc(100% - 20px); padding: 16px; } .admin-form, .account-form, .cohort-new, .member-grid, .cohort-row { grid-template-columns: 1fr; } .admin-form h2, .admin-form > button, .admin-form .wide, .member-grid .wide-field { grid-column: auto; } }
</style>
