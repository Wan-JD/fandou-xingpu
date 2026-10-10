<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ mentorId: string; mentorName: string; sessionToken: string }>();
const loading = ref(false);
const error = ref("");
const inviteUrl = ref("");
const expiresAt = ref("");
const copied = ref(false);

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
    <span class="invite-label">05 / 邀请徒弟</span>
    <h2>从 {{ mentorName }} 延伸一条新轨迹</h2>
    <p>生成一次性邀请链接。对方注册后，会自动记录为你的徒弟。</p>
    <button v-if="!inviteUrl" class="invite-action" type="button" :disabled="loading" @click="createInvite">
      {{ loading ? "正在生成" : "生成邀请链接" }}
    </button>
    <div v-else class="invite-result">
      <input :value="inviteUrl" readonly aria-label="邀请链接" @focus="($event.target as HTMLInputElement).select()" />
      <button class="invite-action" type="button" @click="copyInvite">{{ copied ? "已复制" : "复制链接" }}</button>
      <small>有效期至 {{ new Date(expiresAt).toLocaleString("zh-CN") }}</small>
    </div>
    <p v-if="error" class="invite-error" role="alert">{{ error }}</p>
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
.invite-result { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin-top: 18px; }
.invite-result input { min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(5, 10, 24, .65); color: var(--ink-soft); }
.invite-result .invite-action { margin: 0; }
.invite-result small { grid-column: 1 / -1; color: var(--muted); }
.invite-error { color: #ffb4a8; }
@media (max-width: 560px) { .invite-result { grid-template-columns: 1fr; } .invite-result small { grid-column: auto; } }
</style>
