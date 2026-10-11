<script setup lang="ts">
import { onMounted, ref } from "vue";

type PersonPreview = { id: string; name: string; nickname: string | null; cohort: { label: string } | null; memberType: "formal" | "probationary"; mentor: { name: string } | null };
const props = defineProps<{ token: string }>();
const activeToken = ref(props.token);
const manualToken = ref(props.token);
const loading = ref(true);
const submitting = ref(false);
const error = ref("");
const person = ref<PersonPreview | null>(null);
const name = ref("");
const nickname = ref("");
const email = ref("");
const password = ref("");
const claimed = ref(false);

const errorText = (code?: string) => ({
  CLAIM_EXPIRED: "这条认领链接已经过期，请联系师傅重新生成。",
  CLAIM_NOT_FOUND: "没有找到这条认领链接，请检查链接是否完整。",
  CLAIM_ALREADY_USED: "这条认领链接已经被使用。",
  EMAIL_ALREADY_REGISTERED: "这个邮箱已经注册，请更换邮箱或直接登录。",
}[code ?? ""] ?? "认领链接暂时无法读取，请稍后重试。");

async function loadClaim() {
  loading.value = true;
  error.value = "";
  if (!activeToken.value) { loading.value = false; return; }
  try {
    const response = await fetch(`/api/claims/${encodeURIComponent(activeToken.value)}`);
    const payload = await response.json() as { data?: { person: PersonPreview }; error?: { code?: string; message?: string } };
    if (!response.ok || !payload.data) throw new Error(errorText(payload.error?.code));
    person.value = payload.data.person;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : errorText(); }
  finally { loading.value = false; }
}

async function acceptClaim() {
  if (!email.value || password.value.length < 6) return;
  submitting.value = true;
  error.value = "";
  try {
    const response = await fetch(`/api/claims/${encodeURIComponent(activeToken.value)}/accept`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.value || undefined, nickname: nickname.value || undefined, email: email.value, password: password.value }),
    });
    const payload = await response.json() as { data?: { session: { token: string } }; error?: { code?: string; message?: string } };
    if (!response.ok || !payload.data) throw new Error(errorText(payload.error?.code) || payload.error?.message);
    localStorage.setItem("fandou-session", payload.data.session.token);
    claimed.value = true;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "认领暂时无法完成"; }
  finally { submitting.value = false; }
}

function checkManualToken() {
  const pasted = manualToken.value.trim();
  try { activeToken.value = new URL(pasted).searchParams.get("token") ?? pasted; } catch { activeToken.value = pasted; }
  void loadClaim();
}
onMounted(loadClaim);
</script>

<template>
  <section class="register-shell claim-shell">
    <a class="register-back" href="/">← 返回星谱</a>
    <div v-if="loading" class="register-card status">正在确认认领链接…</div>
    <div v-else-if="claimed" class="register-card accepted">
      <span class="register-kicker">STAR CLAIMED</span>
      <h1>这颗星已经交给你</h1>
      <p>账号已经建立并自动登录。现在可以补充个人资料，让节点慢慢长出自己的光。</p>
      <a class="register-action" href="/">查看星谱</a>
    </div>
    <div v-else-if="!person || error" class="register-card status" role="alert">
      <span class="register-kicker">CLAIM UNAVAILABLE</span>
      <h1>认领链接无法使用</h1>
      <p>{{ error || "请粘贴师傅发来的认领链接。" }}</p>
      <label class="manual-token">认领链接<input v-model.trim="manualToken" autocomplete="off" placeholder="粘贴认领链接或密钥" /></label>
      <button class="register-action" type="button" :disabled="!manualToken" @click="checkManualToken">检查链接</button>
    </div>
    <form v-else class="register-card" @submit.prevent="acceptClaim">
      <span class="register-kicker">CLAIM YOUR STAR</span>
      <h1>认领 {{ person.name }} 这颗星</h1>
      <p>{{ person.mentor?.name ?? "师傅" }} 为你留下了一个节点 · {{ person.cohort?.label ?? "未分级" }}</p>
      <label>姓名（可修改）<input v-model.trim="name" :placeholder="person.name" maxlength="100" /></label>
      <label>昵称（选填）<input v-model.trim="nickname" maxlength="100" /></label>
      <label>邮箱<input v-model.trim="email" required maxlength="254" type="email" autocomplete="email" /></label>
      <label>密码<input v-model="password" required minlength="6" maxlength="100" type="password" autocomplete="new-password" /></label>
      <button class="register-action" type="submit" :disabled="submitting || !email || password.length < 6">{{ submitting ? "正在认领" : "建立账号并认领" }}</button>
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
.register-action { display: inline-block; margin-top: 26px; padding: 11px 18px; border: 1px solid rgba(231, 201, 130, .5); border-radius: 10px; background: rgba(231, 201, 130, .12); color: var(--gold); text-decoration: none; }
.register-action:disabled { opacity: .55; }
</style>

