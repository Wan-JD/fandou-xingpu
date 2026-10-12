<script setup lang="ts">
import { onMounted, ref } from "vue";
import { validateAccountContacts } from "../lib/accountIdentifier";

type Mentor = { id: string; name: string; cohort: { label: string } | null };
const props = defineProps<{ token: string }>();
const activeToken = ref(props.token);
const manualToken = ref(props.token);
const loading = ref(true);
const submitting = ref(false);
const error = ref("");
const formError = ref("");
const mentor = ref<Mentor | null>(null);
const name = ref("");
const email = ref("");
const phone = ref("");
const password = ref("");
const acceptedName = ref("");
const needsToken = ref(!props.token);

const errorText = (code?: string) => ({
  INVITE_EXPIRED: "这枚邀请已经过期，请联系师傅重新生成。",
  INVITE_NOT_FOUND: "没有找到这枚邀请，请检查链接是否完整。",
  INVITE_ALREADY_ACCEPTED: "这枚邀请已经被使用。",
  EMAIL_ALREADY_REGISTERED: "这个邮箱已经注册，请更换邮箱或直接登录。",
  IDENTIFIER_ALREADY_REGISTERED: "这个邮箱或手机号已经注册，请更换后重试。",
}[code ?? ""] ?? "邀请暂时无法读取，请稍后重试。");

async function loadInvite() {
  loading.value = true;
  error.value = "";
  if (!activeToken.value) {
    needsToken.value = true;
    loading.value = false;
    return;
  }
  try {
    const response = await fetch(`/api/invites/${encodeURIComponent(activeToken.value)}`);
    const payload = await response.json() as { data?: { status: string; mentor: Mentor }; error?: { code?: string } };
    if (!response.ok || !payload.data) throw new Error(errorText(payload.error?.code));
    mentor.value = payload.data.mentor;
    needsToken.value = false;
    if (payload.data.status === "accepted") error.value = "这枚邀请已经被使用。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : errorText();
  } finally {
    loading.value = false;
  }
}

async function acceptInvite() {
  if (!name.value.trim() || password.value.length < 6) return;
  const contactError = validateAccountContacts(email.value, phone.value);
  if (contactError) { formError.value = contactError; return; }
  submitting.value = true;
  formError.value = "";
  try {
    const response = await fetch(`/api/invites/${encodeURIComponent(activeToken.value)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() || undefined, password: password.value }),
    });
    const payload = await response.json() as { data?: { member: { name: string }; mentor: Mentor; session: { token: string } }; error?: { code?: string } };
    if (!response.ok || !payload.data) throw new Error(errorText(payload.error?.code));
    mentor.value = payload.data.mentor;
    acceptedName.value = payload.data.member.name;
    localStorage.setItem("fandou-session", payload.data.session.token);
  } catch (cause) {
    formError.value = cause instanceof Error ? cause.message : errorText();
  } finally {
    submitting.value = false;
  }
}

function checkManualToken() {
  const pasted = manualToken.value.trim();
  try {
    const url = new URL(pasted);
    activeToken.value = url.searchParams.get("invite") ?? pasted;
  } catch {
    activeToken.value = pasted;
  }
  void loadInvite();
}

onMounted(loadInvite);
</script>

<template>
  <section class="register-shell">
    <a class="register-back" href="/">← 返回星谱</a>
    <div v-if="loading" class="register-card status" aria-live="polite">正在确认邀请轨迹…</div>
    <div v-else-if="acceptedName" class="register-card accepted" aria-live="polite">
      <span class="register-kicker">INVITATION ACCEPTED</span>
      <h1>已接受邀请</h1>
      <p><strong>{{ acceptedName }}</strong> 已成为 <strong>{{ mentor?.name }}</strong> 的徒弟，新的师徒关系已经记录。</p>
      <p>账号已经建立并自动登录。</p>
      <a class="register-action" href="/">查看星谱</a>
    </div>
    <div v-else-if="needsToken" class="register-card status">
      <span class="register-kicker">JOIN THE CONSTELLATION</span>
      <h1>输入师傅的邀请码</h1>
      <p>粘贴师傅发来的邀请链接或邀请码，确认后继续注册。</p>
      <label class="manual-token">邀请码<input v-model.trim="manualToken" autocomplete="off" placeholder="粘贴邀请链接或邀请码" /></label>
      <button class="register-action" type="button" :disabled="!manualToken" @click="checkManualToken">确认邀请</button>
    </div>
    <div v-else-if="error" class="register-card status" role="alert">
      <span class="register-kicker">INVITATION UNAVAILABLE</span>
      <h1>邀请无法使用</h1>
      <p>{{ error }}</p>
      <label class="manual-token">邀请码<input v-model.trim="manualToken" autocomplete="off" placeholder="粘贴邀请 token" /></label>
      <button class="register-action" type="button" :disabled="!manualToken" @click="checkManualToken">检查邀请码</button>
    </div>
    <form v-else class="register-card" @submit.prevent="acceptInvite">
      <span class="register-kicker">JOIN THE CONSTELLATION</span>
      <h1>接受 {{ mentor?.name }} 的邀请</h1>
      <p>{{ mentor?.cohort?.label ?? "星谱成员" }} · 注册后将自动建立师徒关系</p>
      <label>姓名<input v-model.trim="name" required maxlength="100" autocomplete="name" /></label>
      <label>邮箱（邮箱或手机号至少填写一项）<input v-model.trim="email" maxlength="254" type="email" autocomplete="email" /></label>
      <label>手机号（可选）<input v-model.trim="phone" maxlength="30" type="tel" autocomplete="tel" /></label>
      <label>密码<input v-model="password" required minlength="6" maxlength="100" type="password" autocomplete="new-password" /></label>
      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <button class="register-action" type="submit" :disabled="submitting || !name || (!email && !phone) || password.length < 6">{{ submitting ? "正在建立账号" : "接受邀请并注册" }}</button>
    </form>
  </section>
</template>

<style scoped>
.register-shell { width: min(620px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0 72px; }
.register-back { display: inline-block; margin-bottom: 24px; color: var(--ink-soft); text-decoration: none; }
.register-card { padding: clamp(28px, 6vw, 48px); border: 1px solid var(--glass-border); border-radius: 22px; background: var(--glass); backdrop-filter: blur(18px); box-shadow: 0 28px 80px rgba(0, 0, 0, .42); }
.register-card.accepted { border-color: rgba(142, 217, 208, .42); }
.register-card.status { text-align: center; }
.register-kicker { font-size: 10px; letter-spacing: .28em; color: var(--aqua); }
h1 { margin: 14px 0 0; font-family: var(--serif); font-size: clamp(1.8rem, 6vw, 2.7rem); font-weight: 400; letter-spacing: .05em; }
p { margin: 12px 0 0; color: var(--ink-soft); line-height: 1.8; }
label { display: grid; gap: 8px; margin-top: 22px; color: var(--ink-soft); font-size: 13px; }
input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; outline: none; background: rgba(5, 10, 24, .7); color: var(--ink); }
input:focus { border-color: rgba(142, 217, 208, .65); box-shadow: 0 0 0 3px rgba(142, 217, 208, .08); }
.register-action { display: inline-block; margin-top: 26px; padding: 11px 18px; border: 1px solid rgba(231, 201, 130, .5); border-radius: 10px; background: rgba(231, 201, 130, .12); color: var(--gold); text-decoration: none; }
.register-action:disabled { opacity: .55; }
</style>
