<script setup lang="ts">
// Writes a new post, or edits an existing one in place (text, visibility and images).
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import AuthImage from "../AuthImage.vue";
import { apiRequest } from "../../lib/api";
import type { Post } from "../../lib/people";

const IMAGE_LIMIT = 6;
const CONTENT_LIMIT = 10_000;
const props = defineProps<{ token: string; post?: Post | null; compact?: boolean }>();
const emit = defineEmits<{ saved: [post: Post]; cancel: [] }>();

const editing = computed(() => Boolean(props.post));
const title = ref(props.post?.title ?? "");
const content = ref(props.post?.content ?? "");
const visibility = ref<"public" | "members">(props.post?.visibility ?? "public");
const showTitle = ref(Boolean(props.post?.title));
const keptImages = ref(props.post?.images.slice() ?? []);
const pending = ref<Array<{ file: File; preview: string }>>([]);
const saving = ref(false);
const error = ref("");
const focused = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileRef = ref<HTMLInputElement | null>(null);

const imageCount = computed(() => keptImages.value.length + pending.value.length);
const canSubmit = computed(() => content.value.trim().length > 0 && content.value.length <= CONTENT_LIMIT && !saving.value);
const expanded = computed(() => editing.value || focused.value || content.value.length > 0 || pending.value.length > 0 || showTitle.value);

function autosize() {
  const element = textareaRef.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 420)}px`;
}

function pickImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  error.value = "";
  for (const file of files) {
    if (imageCount.value >= IMAGE_LIMIT) { error.value = `每条动态最多 ${IMAGE_LIMIT} 张图片`; break; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { error.value = "图片仅支持 JPG、PNG 或 WebP"; continue; }
    if (file.size > 5 * 1024 * 1024) { error.value = "单张图片不能超过 5 MB"; continue; }
    pending.value.push({ file, preview: URL.createObjectURL(file) });
  }
}

function dropPending(index: number) {
  const [removed] = pending.value.splice(index, 1);
  if (removed) URL.revokeObjectURL(removed.preview);
}

function reset() {
  pending.value.forEach((item) => URL.revokeObjectURL(item.preview));
  pending.value = [];
  title.value = "";
  content.value = "";
  showTitle.value = false;
  visibility.value = "public";
  focused.value = false;
  nextTick(autosize);
}

async function submit() {
  if (!canSubmit.value) return;
  saving.value = true;
  error.value = "";
  try {
    let saved: Post;
    if (!props.post) {
      const form = new FormData();
      if (showTitle.value && title.value.trim()) form.append("title", title.value.trim());
      form.append("content", content.value.trim());
      form.append("visibility", visibility.value);
      pending.value.forEach((item) => form.append("images", item.file, item.file.name));
      saved = await apiRequest<Post>("/api/me/posts", { token: props.token, form, fallback: "动态发布失败" });
      reset();
    } else {
      saved = props.post;
      const nextTitle = showTitle.value ? title.value.trim() || null : null;
      if (nextTitle !== props.post.title || content.value.trim() !== props.post.content || visibility.value !== props.post.visibility) {
        saved = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}`, {
          token: props.token, method: "PATCH", fallback: "动态保存失败",
          json: { version: props.post.version, title: nextTitle, content: content.value.trim(), visibility: visibility.value },
        });
      }
      for (const image of props.post.images.filter((item) => !keptImages.value.some((kept) => kept.id === item.id))) {
        saved = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}/images/${encodeURIComponent(image.id)}`, { token: props.token, method: "DELETE", fallback: "图片删除失败" });
      }
      if (pending.value.length) {
        const form = new FormData();
        pending.value.forEach((item) => form.append("images", item.file, item.file.name));
        saved = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}/images`, { token: props.token, form, fallback: "图片上传失败" });
      }
    }
    emit("saved", saved);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "动态保存失败";
  } finally {
    saving.value = false;
  }
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit();
}

onMounted(() => { nextTick(autosize); if (editing.value) textareaRef.value?.focus(); });
onUnmounted(() => pending.value.forEach((item) => URL.revokeObjectURL(item.preview)));
</script>

<template>
  <form class="composer" :class="{ expanded, editing }" @submit.prevent="submit">
    <input v-if="showTitle" v-model="title" class="composer-title" maxlength="120" placeholder="标题（可选）" aria-label="动态标题" />
    <textarea
      ref="textareaRef"
      v-model="content"
      class="composer-text"
      :maxlength="CONTENT_LIMIT"
      :rows="expanded ? 3 : 1"
      :placeholder="editing ? '编辑这条动态' : '此刻想分享些什么？一段经历、一张照片，或一句给后来者的话'"
      aria-label="动态正文"
      @input="autosize"
      @focus="focused = true"
      @keydown="onKeydown"
    ></textarea>
    <div v-if="imageCount" class="composer-images" :aria-label="`已选择 ${imageCount} 张图片`">
      <div v-for="image in keptImages" :key="image.id" class="composer-thumb">
        <AuthImage :src="image.url" :token="token" :is-public="post?.visibility === 'public'" alt="动态图片" />
        <button type="button" aria-label="移除这张图片" @click="keptImages = keptImages.filter((item) => item.id !== image.id)">×</button>
      </div>
      <div v-for="(item, index) in pending" :key="item.preview" class="composer-thumb">
        <img :src="item.preview" alt="待上传图片" />
        <button type="button" aria-label="移除这张图片" @click="dropPending(index)">×</button>
      </div>
    </div>
    <p v-if="error" class="composer-error" role="alert">{{ error }}</p>
    <div v-if="expanded" class="composer-bar">
      <div class="composer-tools">
        <button class="composer-tool" type="button" :disabled="imageCount >= IMAGE_LIMIT" @click="fileRef?.click()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></svg>
          图片 <small>{{ imageCount }}/{{ IMAGE_LIMIT }}</small>
        </button>
        <input ref="fileRef" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple tabindex="-1" @change="pickImages" />
        <button class="composer-tool" type="button" :aria-pressed="showTitle" @click="showTitle = !showTitle">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v13M9 19h6" /></svg>
          {{ showTitle ? "去掉标题" : "加标题" }}
        </button>
        <label class="composer-visibility">
          <span class="visually-hidden">可见范围</span>
          <select v-model="visibility">
            <option value="public">所有人可见</option>
            <option value="members">仅成员可见</option>
          </select>
        </label>
      </div>
      <div class="composer-submit">
        <span class="composer-count" :class="{ over: content.length > CONTENT_LIMIT * 0.95 }">{{ content.length }}</span>
        <button v-if="editing" class="secondary-command" type="button" :disabled="saving" @click="emit('cancel')">取消</button>
        <button v-else-if="content || pending.length" class="secondary-command" type="button" :disabled="saving" @click="reset">清空</button>
        <button class="primary-command" type="submit" :disabled="!canSubmit">{{ saving ? "发布中…" : editing ? "保存" : "发布" }}</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.composer { display: grid; gap: 12px; min-width: 0; }
.composer-title, .composer-text { width: 100%; border: 0; background: transparent; color: var(--ink); outline: none; }
.composer-title { padding: 4px 2px 8px; border-bottom: 1px solid var(--line); font-family: var(--serif); font-size: 18px; letter-spacing: .04em; }
.composer-text { min-height: 44px; padding: 10px 2px; font-size: 15px; line-height: 1.75; resize: none; }
.composer-title::placeholder, .composer-text::placeholder { color: var(--muted); }
.composer-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
.composer-thumb { position: relative; aspect-ratio: 1; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: rgba(3, 8, 20, .6); }
.composer-thumb img, .composer-thumb :deep(.auth-image) { width: 100%; height: 100%; object-fit: cover; }
.composer-thumb button { position: absolute; top: 5px; right: 5px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: rgba(3, 6, 15, .78); color: #fff; font-size: 15px; line-height: 1; }
.composer-thumb button:hover { background: rgba(231, 201, 130, .9); color: #10131c; }
.composer-error { margin: 0; color: #ffcfc4; font-size: 12.5px; }
.composer-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
.composer-tools, .composer-submit { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.composer-tool { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 5px 11px; border: 1px solid transparent; border-radius: 999px; background: rgba(142, 217, 208, .07); color: var(--aqua); font-size: 12.5px; transition: border-color .2s, background .2s, color .2s; }
.composer-tool:hover:not(:disabled), .composer-tool[aria-pressed="true"] { border-color: rgba(142, 217, 208, .35); background: rgba(142, 217, 208, .12); }
.composer-tool:disabled { cursor: not-allowed; }
.composer-tool svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.composer-tool small { color: var(--muted); font-size: 11px; }
.composer-visibility select { min-height: 34px; padding: 0 30px 0 12px; border: 1px solid var(--line); border-radius: 999px; background: rgba(3, 6, 15, .5); color: var(--ink-soft); font-size: 12.5px; color-scheme: dark; }
.composer-count { min-width: 3em; color: var(--muted); font-size: 11.5px; text-align: right; font-variant-numeric: tabular-nums; }
.composer-count.over { color: var(--gold); }
.composer-submit .primary-command, .composer-submit .secondary-command { min-height: 36px; padding: 6px 16px; }
@media (max-width: 560px) { .composer-bar { align-items: stretch; } .composer-submit { width: 100%; justify-content: flex-end; } }
</style>
