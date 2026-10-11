<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AuthImage from "./AuthImage.vue";

export type LightboxImage = { key: string; src: string; isPublic: boolean; caption?: string };
const props = defineProps<{ images: LightboxImage[]; start: number; token?: string | null }>();
const emit = defineEmits<{ close: [] }>();
const index = ref(Math.min(Math.max(props.start, 0), Math.max(props.images.length - 1, 0)));
const current = computed(() => props.images[index.value]);
const closeRef = ref<HTMLButtonElement | null>(null);

function step(delta: number) {
  if (props.images.length < 2) return;
  index.value = (index.value + delta + props.images.length) % props.images.length;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.stopPropagation(); emit("close"); }
  else if (event.key === "ArrowLeft") step(-1);
  else if (event.key === "ArrowRight") step(1);
}
onMounted(() => { window.addEventListener("keydown", onKeydown, true); closeRef.value?.focus(); document.body.style.overflow = "hidden"; });
onUnmounted(() => { window.removeEventListener("keydown", onKeydown, true); document.body.style.overflow = ""; });
</script>

<template>
  <div class="lightbox" role="dialog" aria-modal="true" aria-label="图片预览" @click.self="emit('close')">
    <button ref="closeRef" class="lightbox-close" type="button" aria-label="关闭预览" @click="emit('close')">×</button>
    <button v-if="images.length > 1" class="lightbox-nav prev" type="button" aria-label="上一张" @click="step(-1)">‹</button>
    <figure v-if="current" class="lightbox-figure">
      <AuthImage :key="current.key" :src="current.src" :is-public="current.isPublic" :token="token" :alt="current.caption ?? '图片'" />
      <figcaption><span v-if="current.caption">{{ current.caption }}</span><span v-if="images.length > 1">{{ index + 1 }} / {{ images.length }}</span></figcaption>
    </figure>
    <button v-if="images.length > 1" class="lightbox-nav next" type="button" aria-label="下一张" @click="step(1)">›</button>
  </div>
</template>

<style scoped>
.lightbox { position: fixed; inset: 0; z-index: 140; display: grid; grid-template-columns: 64px minmax(0, 1fr) 64px; align-items: center; padding: 28px 12px; background: rgba(2, 4, 12, .9); backdrop-filter: blur(14px); animation: lightbox-in .25s ease-out; }
.lightbox-figure { grid-column: 2; display: grid; justify-items: center; gap: 12px; margin: 0; min-width: 0; }
.lightbox-figure :deep(.auth-image) { width: auto; max-width: 100%; height: auto; max-height: calc(100vh - 120px); min-width: 120px; min-height: 120px; border-radius: 14px; object-fit: contain; box-shadow: 0 30px 90px rgba(0, 0, 0, .6); }
figcaption { display: flex; gap: 14px; color: var(--ink-soft); font-size: 12.5px; letter-spacing: .08em; }
.lightbox-close { position: absolute; top: max(14px, env(safe-area-inset-top)); right: 16px; width: 42px; height: 42px; border: 1px solid var(--line); border-radius: 50%; background: rgba(8, 14, 30, .7); color: var(--ink); font-size: 24px; line-height: 1; }
.lightbox-nav { width: 46px; height: 46px; justify-self: center; border: 1px solid var(--line); border-radius: 50%; background: rgba(8, 14, 30, .6); color: var(--ink); font-size: 28px; line-height: 1; transition: border-color .2s, color .2s; }
.lightbox-nav:hover, .lightbox-close:hover { border-color: rgba(231, 201, 130, .55); color: var(--gold); }
.lightbox-nav.prev { grid-column: 1; grid-row: 1; }
.lightbox-nav.next { grid-column: 3; grid-row: 1; }
@keyframes lightbox-in { from { opacity: 0; } }
@media (max-width: 560px) { .lightbox { grid-template-columns: 40px minmax(0, 1fr) 40px; padding-inline: 4px; } .lightbox-nav { width: 36px; height: 36px; font-size: 22px; } }
</style>
