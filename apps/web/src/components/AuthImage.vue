<script setup lang="ts">
// Images behind member-only access are fetched with the session header and shown from a blob URL.
import { onUnmounted, ref, watch } from "vue";
import { authHeaders } from "../lib/api";

const props = defineProps<{ src: string; alt: string; token?: string | null; isPublic?: boolean }>();
const emit = defineEmits<{ loaded: [url: string] }>();
const objectUrl = ref("");
const failed = ref(false);
const loading = ref(false);
let requestId = 0;

function release() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = "";
}

async function load() {
  const id = ++requestId;
  release();
  failed.value = false;
  if (props.isPublic) return;
  loading.value = true;
  try {
    const response = await fetch(props.src, { headers: authHeaders(props.token) });
    if (!response.ok) throw new Error("image unavailable");
    const url = URL.createObjectURL(await response.blob());
    if (id !== requestId) { URL.revokeObjectURL(url); return; }
    objectUrl.value = url;
    emit("loaded", url);
  } catch {
    if (id === requestId) failed.value = true;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

watch(() => [props.src, props.token, props.isPublic], load, { immediate: true });
onUnmounted(() => { requestId += 1; release(); });
</script>

<template>
  <img v-if="isPublic" class="auth-image" :src="src" :alt="alt" loading="lazy" decoding="async" @error="failed = true" />
  <img v-else-if="objectUrl" class="auth-image" :src="objectUrl" :alt="alt" decoding="async" />
  <span v-else class="auth-image auth-image-placeholder" :class="{ failed, loading }" role="img" :aria-label="failed ? `${alt}暂时无法读取` : `${alt}加载中`">
    <svg v-if="failed" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" /><path d="m4 15 4-4 4 4 3-3 5 5" /><path d="m3 3 18 18" /></svg>
  </span>
</template>

<style scoped>
.auth-image { display: block; width: 100%; height: 100%; object-fit: cover; }
.auth-image-placeholder { display: grid; place-items: center; background: linear-gradient(110deg, rgba(16, 35, 66, .5) 30%, rgba(142, 217, 208, .12) 50%, rgba(16, 35, 66, .5) 70%); background-size: 220% 100%; }
.auth-image-placeholder.loading { animation: auth-image-shimmer 1.4s linear infinite; }
.auth-image-placeholder.failed { background: rgba(16, 35, 66, .45); }
.auth-image-placeholder svg { width: 26px; height: 26px; fill: none; stroke: var(--muted); stroke-width: 1.4; }
@keyframes auth-image-shimmer { to { background-position: -220% 0; } }
</style>
