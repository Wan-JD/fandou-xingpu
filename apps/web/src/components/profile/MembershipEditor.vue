<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ApiError, apiRequest } from "../../lib/api";
import { groupRoleLabels, membershipLabels, type GroupRole, type MembershipType, type Person } from "../../lib/people";

const props = defineProps<{ person: Person; token: string }>();
const emit = defineEmits<{ close: []; saved: [person: Record<string, unknown>]; sessionExpired: [] }>();

const memberType = ref<MembershipType>(props.person.memberType ?? "formal");
const groupRole = ref<GroupRole | "">(props.person.groupRole ?? "");
const saving = ref(false);
const error = ref("");
const changed = computed(() => (
  (props.person.permissions?.canEditMemberType && memberType.value !== (props.person.memberType ?? ""))
  || (props.person.permissions?.canEditGroupRole && groupRole.value !== (props.person.groupRole ?? ""))
));

async function save() {
  if (!changed.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const json: Record<string, unknown> = { version: props.person.version ?? 1 };
    if (props.person.permissions?.canEditMemberType) json.memberType = memberType.value;
    if (props.person.permissions?.canEditGroupRole) json.groupRole = groupRole.value || null;
    const data = await apiRequest<Record<string, unknown>>(`/api/people/${encodeURIComponent(props.person.id)}/membership`, {
      token: props.token,
      method: "PATCH",
      json,
      fallback: "成员身份保存失败",
    });
    emit("saved", data);
    emit("close");
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) emit("sessionExpired");
    if (cause instanceof ApiError && cause.status === 409) {
      try {
        const fresh = await apiRequest<Record<string, unknown>>(`/api/people/${encodeURIComponent(props.person.id)}`, { token: props.token, fallback: "资料刷新失败" });
        emit("saved", fresh);
        error.value = "资料刚刚被其他人更新，已载入最新版本，请确认后重新保存。";
      } catch (refreshCause) {
        error.value = refreshCause instanceof Error ? refreshCause.message : "资料刷新失败";
      }
    } else {
      error.value = cause instanceof Error ? cause.message : "成员身份保存失败";
    }
  } finally {
    saving.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !saving.value) emit("close");
}
onMounted(() => { window.addEventListener("keydown", onKeydown, true); document.body.style.overflow = "hidden"; });
onUnmounted(() => { window.removeEventListener("keydown", onKeydown, true); document.body.style.overflow = ""; });
</script>

<template>
  <div class="membership-backdrop" @click.self="!saving && emit('close')">
    <section class="membership-dialog" role="dialog" aria-modal="true" aria-labelledby="membership-title">
      <header>
        <div><span class="section-label">MEMBER ROLE</span><h2 id="membership-title">设置 {{ person.name }} 的组内身份</h2></div>
        <button type="button" aria-label="关闭" :disabled="saving" @click="emit('close')">×</button>
      </header>
      <p class="membership-note">权限按师承与届次自动校验。每项只会由具有对应权限的成员修改。</p>
      <label v-if="person.permissions?.canEditMemberType" class="form-field">
        <span>组员身份</span>
        <select v-model="memberType"><option v-for="(label, value) in membershipLabels" :key="value" :value="value">{{ label }}</option></select>
        <small>仅该成员的师傅可以设置。</small>
      </label>
      <label v-if="person.permissions?.canEditGroupRole" class="form-field">
        <span>组内职务</span>
        <select v-model="groupRole"><option value="">无</option><option v-for="(label, value) in groupRoleLabels" :key="value" :value="value">{{ label }}</option></select>
        <small>师傅或上一届正副组长可以设置。</small>
      </label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <footer>
        <button class="secondary-command" type="button" :disabled="saving" @click="emit('close')">取消</button>
        <button class="primary-command" type="button" :disabled="saving || !changed" @click="save">{{ saving ? "保存中…" : "保存身份" }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.membership-backdrop { position: fixed; inset: 0; z-index: 125; display: grid; place-items: center; padding: 18px; background: rgba(2, 4, 12, .72); backdrop-filter: blur(8px); }
.membership-dialog { display: grid; gap: 18px; width: min(480px, 100%); padding: 24px; border: 1px solid var(--glass-border); border-radius: 18px; background: linear-gradient(160deg, rgba(16, 30, 58, .98), rgba(5, 9, 21, .99)); box-shadow: 0 28px 90px rgba(0, 0, 0, .58); }
.membership-dialog header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.membership-dialog h2 { margin: 7px 0 0; font-family: var(--serif); font-size: 21px; font-weight: 400; letter-spacing: .06em; }
.membership-dialog header > button { display: grid; flex: none; place-items: center; width: 36px; height: 36px; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--ink-soft); font-size: 21px; }
.membership-dialog header > button:hover { border-color: rgba(231, 201, 130, .5); color: var(--gold); }
.membership-note { margin: 0; padding: 10px 12px; border: 1px solid rgba(142, 217, 208, .18); border-radius: 9px; background: rgba(142, 217, 208, .05); color: var(--muted); font-size: 12.5px; line-height: 1.65; }
.form-field small { color: var(--muted); font-size: 11.5px; line-height: 1.5; }
.membership-dialog footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }
</style>
