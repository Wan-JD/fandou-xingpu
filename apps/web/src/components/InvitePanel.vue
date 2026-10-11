<script setup lang="ts">
import { onMounted, ref } from "vue";

const props = defineProps<{ mentorId: string; mentorName: string; sessionToken: string }>();
const loading = ref(false);
const error = ref("");
const inviteUrl = ref("");
const expiresAt = ref("");
const copied = ref(false);
type Cohort = { id: string; label: string; year: number | null };
type Placeholder = { personId: string; name: string; memberType: "formal" | "probationary"; cohort: Cohort | null; expiresAt: string; claimedAt: string | null; state: "pending" | "expired" | "claimed" | "account-created"; account?: { identifier?: string; temporaryPassword?: string } | null };
const placeholders = ref<Placeholder[]>([]);
const placeholderForm = ref({ name: "", loginIdentifier: "", cohortYear: "", memberType: "probationary" as "formal" | "probationary" });
const placeholderLoading = ref(false);
const placeholderError = ref("");
const claimPath = ref("");
const claimCopied = ref(false);
const createdAccount = ref<{ identifier: string; temporaryPassword: string; mustChangePassword: boolean } | null>(null);

async function loadPlaceholders() {
  try {
    const response = await fetch("/api/me/placeholder-students", { headers: { Authorization: `Bearer ${props.sessionToken}` } });
    const payload = await response.json() as { data?: Placeholder[] };
    if (response.ok && payload.data) placeholders.value = payload.data;
  } catch { /* profile page remains usable if this secondary list is unavailable */ }
}

async function createPlaceholder() {
  if (!placeholderForm.value.name.trim()) return;
  placeholderLoading.value = true;
  placeholderError.value = "";
  claimPath.value = "";
  claimCopied.value = false;
  createdAccount.value = null;
  try {
    const response = await fetch("/api/me/placeholder-students", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${props.sessionToken}` },
      body: JSON.stringify({ ...placeholderForm.value, loginIdentifier: placeholderForm.value.loginIdentifier.trim() || null, cohortYear: placeholderForm.value.cohortYear ? Number(placeholderForm.value.cohortYear) : null }),
    });
    const payload = await response.json() as { data?: { claimPath?: string; account?: { identifier?: string; loginIdentifier?: string; temporaryPassword?: string; initialPassword?: string; mustChangePassword?: boolean }; temporaryPassword?: string; initialPassword?: string; loginIdentifier?: string }; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "节点暂时无法创建");
    if (payload.data.claimPath) claimPath.value = `${window.location.origin}${payload.data.claimPath}`;
    const account = payload.data.account;
    const identifier = account?.identifier ?? account?.loginIdentifier ?? payload.data.loginIdentifier ?? (placeholderForm.value.loginIdentifier.trim() || placeholderForm.value.name.trim());
    const temporaryPassword = account?.temporaryPassword ?? account?.initialPassword ?? payload.data.temporaryPassword ?? payload.data.initialPassword ?? "";
    if (temporaryPassword) createdAccount.value = { identifier, temporaryPassword, mustChangePassword: account?.mustChangePassword !== false };
    placeholderForm.value.name = "";
    placeholderForm.value.loginIdentifier = "";
    placeholderForm.value.cohortYear = "";
    await loadPlaceholders();
  } catch (cause) {
    placeholderError.value = cause instanceof Error ? cause.message : "节点暂时无法创建";
  } finally {
    placeholderLoading.value = false;
  }
}

async function copyClaim() {
  if (!claimPath.value) return;
  try {
    await navigator.clipboard.writeText(claimPath.value);
    claimCopied.value = true;
  } catch {
    const input = document.createElement("textarea");
    input.value = claimPath.value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    claimCopied.value = document.execCommand("copy");
    input.remove();
  }
}

async function rotateClaim(personId: string) {
  placeholderError.value = "";
  try {
    const response = await fetch(`/api/me/placeholder-students/${encodeURIComponent(personId)}/claim`, { method: "POST", headers: { Authorization: `Bearer ${props.sessionToken}` } });
    const payload = await response.json() as { data?: { claimPath: string }; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "认领链接暂时无法更新");
    claimPath.value = `${window.location.origin}${payload.data.claimPath}`;
    claimCopied.value = false;
    await loadPlaceholders();
  } catch (cause) { placeholderError.value = cause instanceof Error ? cause.message : "认领链接暂时无法更新"; }
}

onMounted(() => { void loadPlaceholders(); });

async function createInvite() {
  loading.value = true;
  error.value = "";
  copied.value = false;
  try {
    const response = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${props.sessionToken}` },
      body: JSON.stringify({ mentorId: props.mentorId }),
    });
    const payload = await response.json() as { data?: { token: string; expiresAt: string }; error?: { message?: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "邀请暂时无法生成");
    inviteUrl.value = `${window.location.origin}/register?invite=${encodeURIComponent(payload.data.token)}`;
    expiresAt.value = payload.data.expiresAt;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "邀请暂时无法生成";
  } finally {
    loading.value = false;
  }
}

async function copyInvite() {
  if (!inviteUrl.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    copied.value = true;
  } catch {
    const input = document.createElement("textarea");
    input.value = inviteUrl.value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    copied.value = document.execCommand("copy");
    input.remove();
  }
}
</script>

<template>
  <article class="invite-panel">
    <span class="invite-label">邀请与徒弟账号</span>
    <h2>从 {{ mentorName }} 延伸一条新轨迹</h2>
    <p>可以生成一次性邀请，也可以直接为徒弟建立账号。直接建立的账号会在首次登录时要求设置新密码。</p>
    <div class="invite-modes">
      <section class="invite-mode">
        <span class="invite-mode-label">徒弟自行注册</span>
        <p>把一次性链接交给对方，对方填写姓名和登录方式后加入谱系。</p>
        <button v-if="!inviteUrl" class="invite-action" type="button" :disabled="loading" @click="createInvite">
          {{ loading ? "正在生成" : "生成邀请链接" }}
        </button>
        <div v-else class="invite-result">
          <input :value="inviteUrl" readonly aria-label="邀请链接" @focus="($event.target as HTMLInputElement).select()" />
          <button class="invite-action" type="button" @click="copyInvite">{{ copied ? "已复制" : "复制链接" }}</button>
          <small>有效期至 {{ new Date(expiresAt).toLocaleString("zh-CN") }}</small>
        </div>
        <p v-if="error" class="invite-error" role="alert">{{ error }}</p>
      </section>
      <section class="invite-mode">
        <span class="invite-mode-label">师傅代建账号</span>
        <p>为暂时不便登记的徒弟保留节点，并把生成的登录凭据交给本人。</p>
    <form class="placeholder-form" @submit.prevent="createPlaceholder">
      <label>姓名<input v-model.trim="placeholderForm.name" maxlength="100" required /></label>
      <label>登录标识（可选）<input v-model.trim="placeholderForm.loginIdentifier" maxlength="254" placeholder="邮箱、手机号；留空则使用姓名登录" autocomplete="username" /></label>
      <div class="placeholder-row">
        <label>级别年份（选填）<input v-model.trim="placeholderForm.cohortYear" type="number" min="1900" max="2200" placeholder="例如 2023" /></label>
        <label>身份<select v-model="placeholderForm.memberType"><option value="probationary">预备组员</option><option value="formal">正式组员</option></select></label>
      </div>
      <button class="invite-action" type="submit" :disabled="placeholderLoading || !placeholderForm.name">{{ placeholderLoading ? "正在建立账号" : "建立徒弟账号" }}</button>
    </form>
    <div v-if="createdAccount || claimPath" class="claim-result">
      <strong v-if="createdAccount">账号已建立，请把下面的初始凭据交给徒弟（密码只显示这一次）</strong>
      <div v-if="createdAccount" class="credential-grid">
        <label>登录标识<input :value="createdAccount.identifier" readonly aria-label="徒弟登录标识" /></label>
        <label>初始密码<input :value="createdAccount.temporaryPassword" readonly aria-label="徒弟初始密码" /></label>
      </div>
      <small v-if="createdAccount?.mustChangePassword">首次登录会要求修改密码。</small>
      <template v-if="claimPath">
        <strong>认领链接仅展示这一次</strong>
        <input :value="claimPath" readonly aria-label="徒弟认领链接" @focus="($event.target as HTMLInputElement).select()" />
        <button class="invite-action" type="button" @click="copyClaim">{{ claimCopied ? "已复制" : "复制认领链接" }}</button>
      </template>
    </div>
    <p v-if="placeholderError" class="invite-error" role="alert">{{ placeholderError }}</p>
      </section>
    </div>
    <div v-if="placeholders.length" class="placeholder-list">
      <div v-for="item in placeholders" :key="item.personId" class="placeholder-item">
        <span><strong>{{ item.name }}</strong><small>{{ item.cohort?.label ?? "未分级" }} · {{ item.memberType === "probationary" ? "预备组员" : "正式组员" }}<template v-if="item.account?.identifier"> · 登录：{{ item.account.identifier }}</template></small></span>
        <span class="placeholder-state"><em>{{ item.state === "account-created" ? "账号已建立" : item.state === "claimed" ? "已认领" : item.state === "expired" ? "链接过期" : "等待认领" }}</em><button v-if="item.state !== 'claimed' && item.state !== 'account-created'" type="button" @click="rotateClaim(item.personId)">更新链接</button></span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.invite-panel { position: relative; padding: 28px clamp(20px, 3vw, 32px); border: 1px solid rgba(231, 201, 130, .24); border-radius: 22px; background: linear-gradient(150deg, rgba(20, 36, 68, .72), rgba(7, 12, 27, .7)); overflow: hidden; }
.invite-panel::before { content: ""; position: absolute; inset: 0 18% auto; height: 1px; background: linear-gradient(90deg, transparent, rgba(231, 201, 130, .65), transparent); }
.invite-label { font-size: 11px; letter-spacing: .26em; color: var(--aqua); }
h2 { margin: 14px 0 0; font-family: var(--serif); font-size: 20px; font-weight: 400; letter-spacing: .06em; }
p { margin: 8px 0 0; color: var(--ink-soft); font-size: 13.5px; line-height: 1.8; }
.invite-action { margin-top: 18px; padding: 10px 16px; border: 1px solid rgba(231, 201, 130, .48); border-radius: 10px; background: rgba(231, 201, 130, .1); color: var(--gold); }
.invite-action:disabled { opacity: .55; }
.invite-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 24px; }
.invite-mode { min-width: 0; padding: 16px; border: 1px solid rgba(142, 217, 208, .18); border-radius: 14px; background: rgba(3, 8, 20, .26); }
.invite-mode-label { display: block; color: var(--gold); font-size: 12px; letter-spacing: .1em; }
.invite-mode p { font-size: 12px; line-height: 1.65; }
.invite-result { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin-top: 18px; }
.invite-result input { min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(5, 10, 24, .65); color: var(--ink-soft); }
.invite-result .invite-action { margin: 0; }
.invite-result small { grid-column: 1 / -1; color: var(--muted); }
.invite-error { color: #ffb4a8; }
.placeholder-divider { height: 1px; margin: 28px 0; background: rgba(231, 201, 130, .16); }
.placeholder-form { display: grid; gap: 12px; margin-top: 16px; }
.placeholder-form label { display: grid; gap: 6px; color: var(--ink-soft); font-size: 12px; }
.placeholder-form input, .placeholder-form select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: rgba(5, 10, 24, .65); color: var(--ink); }
.placeholder-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.claim-result { display: grid; gap: 9px; margin-top: 18px; padding: 14px; border: 1px solid rgba(142, 217, 208, .28); border-radius: 12px; background: rgba(142, 217, 208, .06); }
.claim-result strong { color: var(--aqua); font-size: 12px; }
.claim-result input { min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: rgba(5, 10, 24, .65); color: var(--ink-soft); }
.claim-result .invite-action { margin: 0; }
.claim-result small { color: var(--muted); }
.credential-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.credential-grid label { display: grid; gap: 6px; color: var(--muted); font-size: 11px; }
.credential-grid input { min-width: 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: rgba(5, 10, 24, .65); color: var(--ink-soft); }
.placeholder-list { display: grid; gap: 8px; margin-top: 18px; }
.placeholder-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(5, 10, 24, .25); }
.placeholder-item span { display: grid; gap: 4px; }
.placeholder-item small { color: var(--muted); }
.placeholder-item em { color: var(--gold); font-size: 11px; font-style: normal; white-space: nowrap; }
.placeholder-state { display: grid; justify-items: end; gap: 5px; }
.placeholder-state button { border: 0; background: transparent; color: var(--aqua); font-size: 11px; cursor: pointer; }
@media (max-width: 700px) { .invite-modes { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .invite-result { grid-template-columns: 1fr; } .invite-result small { grid-column: auto; } .credential-grid { grid-template-columns: 1fr; } }
</style>
