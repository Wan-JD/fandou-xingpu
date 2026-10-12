<script setup lang="ts">
// Notes stay lightweight; experience posts add a Markdown toolbar, preview and a larger image allowance.
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import AuthImage from "../AuthImage.vue";
import MarkdownContent from "./MarkdownContent.vue";
import { apiRequest } from "../../lib/api";
import type { Post } from "../../lib/people";

type PostKind = "note" | "experience";
type EditorMode = "write" | "preview";
type MarkdownAction = { label: string; title: string; before: string; after: string; fallback: string; block?: boolean };

const props = defineProps<{ token: string; post?: Post | null; compact?: boolean }>();
const emit = defineEmits<{ saved: [post: Post]; cancel: [] }>();

const editing = computed(() => Boolean(props.post));
const kind = ref<PostKind>(props.post?.kind ?? "note");
const title = ref(props.post?.title ?? "");
const content = ref(props.post?.content ?? "");
const visibility = ref<"public" | "members">(props.post?.visibility ?? "public");
const showTitle = ref(kind.value === "experience" || Boolean(props.post?.title));
const keptImages = ref(props.post?.images.slice() ?? []);
const pending = ref<Array<{ file: File; preview: string }>>([]);
const saving = ref(false);
const error = ref("");
const focused = ref(false);
const editorMode = ref<EditorMode>("write");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileRef = ref<HTMLInputElement | null>(null);
const baseVersion = ref(props.post?.version ?? 1);
const deletedImageIds = new Set<string>();

const imageLimit = computed(() => kind.value === "experience" ? 24 : 6);
const contentLimit = computed(() => kind.value === "experience" ? 100_000 : 10_000);
const imageCount = computed(() => keptImages.value.length + pending.value.length);
const canSubmit = computed(() => content.value.trim().length > 0 && content.value.length <= contentLimit.value && imageCount.value <= imageLimit.value && !saving.value);
const expanded = computed(() => editing.value || focused.value || content.value.length > 0 || pending.value.length > 0 || showTitle.value || kind.value === "experience");

const markdownActions: MarkdownAction[] = [
  { label: "B", title: "粗体", before: "**", after: "**", fallback: "重点文字" },
  { label: "I", title: "斜体", before: "*", after: "*", fallback: "强调文字" },
  { label: "H2", title: "二级标题", before: "## ", after: "", fallback: "小标题", block: true },
  { label: "❝", title: "引用", before: "> ", after: "", fallback: "引用内容", block: true },
  { label: "</>", title: "代码", before: "`", after: "`", fallback: "code" },
  { label: "—", title: "无序列表", before: "- ", after: "", fallback: "列表项", block: true },
  { label: "↗", title: "链接", before: "[", after: "](https://)", fallback: "链接文字" },
];

function autosize() {
  const element = textareaRef.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, kind.value === "experience" ? 680 : 420)}px`;
}

function setKind(next: PostKind) {
  kind.value = next;
  editorMode.value = "write";
  if (next === "experience") showTitle.value = true;
  error.value = imageCount.value > imageLimit.value ? `随手记最多保留 ${imageLimit.value} 张图片，请先移除多余图片` : "";
  void nextTick(autosize);
}

function applyMarkdown(action: MarkdownAction) {
  const element = textareaRef.value;
  if (!element) return;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  const selected = content.value.slice(start, end) || action.fallback;
  const needsLineBreak = Boolean(action.block && start > 0 && content.value[start - 1] !== "\n");
  const prefix = `${needsLineBreak ? "\n" : ""}${action.before}`;
  const insertion = `${prefix}${selected}${action.after}`;
  content.value = `${content.value.slice(0, start)}${insertion}${content.value.slice(end)}`;
  const selectionStart = start + prefix.length;
  void nextTick(() => {
    element.focus();
    element.setSelectionRange(selectionStart, selectionStart + selected.length);
    autosize();
  });
}

function pickImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  error.value = "";
  for (const file of files) {
    if (imageCount.value >= imageLimit.value) { error.value = `${kind.value === "experience" ? "经验分享" : "随手记"}最多 ${imageLimit.value} 张图片`; break; }
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
  kind.value = "note";
  title.value = "";
  content.value = "";
  showTitle.value = false;
  visibility.value = "public";
  focused.value = false;
  editorMode.value = "write";
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
      form.append("kind", kind.value);
      if (showTitle.value && title.value.trim()) form.append("title", title.value.trim());
      form.append("content", content.value.trim());
      form.append("visibility", visibility.value);
      pending.value.forEach((item) => form.append("images", item.file, item.file.name));
      saved = await apiRequest<Post>("/api/me/posts", { token: props.token, form, fallback: "动态发布失败" });
      reset();
    } else {
      saved = props.post;
      const nextTitle = showTitle.value ? title.value.trim() || null : null;
      // Remove overflow first so an experience post with 7+ images can validly become a note.
      for (const image of props.post.images.filter((item) => !keptImages.value.some((kept) => kept.id === item.id) && !deletedImageIds.has(item.id))) {
        saved = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}/images/${encodeURIComponent(image.id)}`, { token: props.token, method: "DELETE", fallback: "图片删除失败" });
        deletedImageIds.add(image.id);
        baseVersion.value = saved.version;
      }
      if (kind.value !== (props.post.kind ?? "note") || nextTitle !== props.post.title || content.value.trim() !== props.post.content || visibility.value !== props.post.visibility) {
        saved = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}`, {
          token: props.token, method: "PATCH", fallback: "动态保存失败",
          json: { version: baseVersion.value, kind: kind.value, title: nextTitle, content: content.value.trim(), visibility: visibility.value },
        });
        baseVersion.value = saved.version;
      }
      if (pending.value.length) {
        const form = new FormData();
        pending.value.forEach((item) => form.append("images", item.file, item.file.name));
        saved = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}/images`, { token: props.token, form, fallback: "图片上传失败" });
        baseVersion.value = saved.version;
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
  if (kind.value !== "experience" || !(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "b") { event.preventDefault(); applyMarkdown(markdownActions[0]); }
  if (event.key.toLowerCase() === "i") { event.preventDefault(); applyMarkdown(markdownActions[1]); }
}

onMounted(() => { nextTick(autosize); if (editing.value) textareaRef.value?.focus(); });
onUnmounted(() => pending.value.forEach((item) => URL.revokeObjectURL(item.preview)));
</script>

<template>
  <form class="composer" :class="[{ expanded, editing }, `kind-${kind}`]" @submit.prevent="submit">
    <div class="composer-kind" role="radiogroup" aria-label="动态类型">
      <button type="button" role="radio" :aria-checked="kind === 'note'" :class="{ active: kind === 'note' }" @click="setKind('note')"><strong>随手记</strong><small>简短记录</small></button>
      <button type="button" role="radio" :aria-checked="kind === 'experience'" :class="{ active: kind === 'experience' }" @click="setKind('experience')"><strong>经验分享</strong><small>Markdown 长文</small></button>
    </div>

    <input v-if="showTitle" v-model="title" class="composer-title" maxlength="120" :placeholder="kind === 'experience' ? '给这篇经验起个标题（可选）' : '标题（可选）'" aria-label="动态标题" />

    <div v-if="kind === 'experience'" class="markdown-editor">
      <div class="markdown-head">
        <div class="markdown-tools" aria-label="Markdown 格式工具">
          <button v-for="action in markdownActions" :key="action.title" type="button" :title="action.title" :aria-label="action.title" @click="applyMarkdown(action)">{{ action.label }}</button>
        </div>
        <div class="editor-mode" role="tablist" aria-label="编辑模式">
          <button type="button" role="tab" :aria-selected="editorMode === 'write'" :class="{ active: editorMode === 'write' }" @click="editorMode = 'write'">编辑</button>
          <button type="button" role="tab" :aria-selected="editorMode === 'preview'" :class="{ active: editorMode === 'preview' }" @click="editorMode = 'preview'">预览</button>
        </div>
      </div>
      <textarea v-show="editorMode === 'write'" ref="textareaRef" v-model="content" class="composer-text markdown-source" :maxlength="contentLimit" rows="8" placeholder="用 Markdown 写下可复用的经验、步骤和思考……" aria-label="经验分享正文，支持 Markdown" @input="autosize" @focus="focused = true" @keydown="onKeydown"></textarea>
      <div v-show="editorMode === 'preview'" class="markdown-preview">
        <MarkdownContent v-if="content.trim()" :source="content" />
        <p v-else>预览会显示在这里。</p>
      </div>
    </div>
    <textarea v-else ref="textareaRef" v-model="content" class="composer-text" :maxlength="contentLimit" :rows="expanded ? 3 : 1" :placeholder="editing ? '编辑这条随手记' : '此刻想分享些什么？一句话、一张照片，或一段近况'" aria-label="随手记正文" @input="autosize" @focus="focused = true" @keydown="onKeydown"></textarea>

    <div v-if="imageCount" class="composer-images" :aria-label="`已选择 ${imageCount} 张图片`">
      <div v-for="image in keptImages" :key="image.id" class="composer-thumb"><AuthImage :src="image.url" :token="token" :is-public="post?.visibility === 'public'" fit="contain" alt="动态图片" /><button type="button" aria-label="移除这张图片" @click="keptImages = keptImages.filter((item) => item.id !== image.id)">×</button></div>
      <div v-for="(item, index) in pending" :key="item.preview" class="composer-thumb"><img :src="item.preview" alt="待上传图片" /><button type="button" aria-label="移除这张图片" @click="dropPending(index)">×</button></div>
    </div>
    <p v-if="error" class="composer-error" role="alert">{{ error }}</p>
    <div v-if="expanded" class="composer-bar">
      <div class="composer-tools">
        <button class="composer-tool" type="button" :disabled="imageCount >= imageLimit" @click="fileRef?.click()"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></svg>图片 <small>{{ imageCount }}/{{ imageLimit }}</small></button>
        <input ref="fileRef" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple tabindex="-1" @change="pickImages" />
        <button v-if="kind === 'note'" class="composer-tool" type="button" :aria-pressed="showTitle" @click="showTitle = !showTitle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v13M9 19h6" /></svg>{{ showTitle ? "去掉标题" : "加标题" }}</button>
        <label class="composer-visibility"><span class="visually-hidden">可见范围</span><select v-model="visibility"><option value="public">所有人可见</option><option value="members">仅成员可见</option></select></label>
      </div>
      <div class="composer-submit">
        <span class="composer-count" :class="{ over: content.length > contentLimit * 0.95 }">{{ content.length.toLocaleString() }} / {{ contentLimit.toLocaleString() }}</span>
        <button v-if="editing" class="secondary-command" type="button" :disabled="saving" @click="emit('cancel')">取消</button>
        <button v-else-if="content || pending.length" class="secondary-command" type="button" :disabled="saving" @click="reset">清空</button>
        <button class="primary-command" type="submit" :disabled="!canSubmit">{{ saving ? "发布中…" : editing ? "保存" : "发布" }}</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.composer { display: grid; gap: 12px; min-width: 0; }
.composer-kind { display: inline-flex; justify-self: start; gap: 3px; padding: 3px; border: 1px solid var(--line); border-radius: 10px; background: rgba(3, 6, 15, .35); }
.composer-kind button { display: grid; gap: 1px; min-width: 92px; padding: 6px 12px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); text-align: left; }
.composer-kind button strong { font-size: 12.5px; font-weight: 500; }
.composer-kind button small { font-size: 9.5px; }
.composer-kind button.active { background: rgba(142, 217, 208, .11); color: var(--aqua); box-shadow: inset 0 0 0 1px rgba(142, 217, 208, .18); }
.composer-kind button:last-child.active { background: rgba(231, 201, 130, .1); color: var(--gold); box-shadow: inset 0 0 0 1px rgba(231, 201, 130, .2); }
.composer-title, .composer-text { width: 100%; border: 0; background: transparent; color: var(--ink); outline: none; }
.composer-title { padding: 4px 2px 8px; border-bottom: 1px solid var(--line); font-family: var(--serif); font-size: 18px; letter-spacing: .04em; }
.composer-text { min-height: 44px; padding: 10px 2px; font-size: 15px; line-height: 1.75; resize: none; }
.composer-title::placeholder, .composer-text::placeholder { color: var(--muted); }
.markdown-editor { overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: rgba(3, 8, 20, .28); }
.markdown-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border-bottom: 1px solid var(--line); }
.markdown-tools, .editor-mode { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; }
.markdown-tools button { min-width: 31px; height: 30px; padding: 0 7px; border: 0; border-radius: 6px; background: transparent; color: var(--ink-soft); font: 600 12px/1 var(--sans); }
.markdown-tools button:hover { background: rgba(142, 217, 208, .1); color: var(--aqua); }
.editor-mode { padding: 2px; border: 1px solid var(--line); border-radius: 8px; }
.editor-mode button { padding: 5px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); font-size: 11.5px; }
.editor-mode button.active { background: rgba(231, 201, 130, .12); color: var(--gold); }
.markdown-source { display: block; min-height: 230px; padding: 14px 16px; font-family: Consolas, "Courier New", monospace; font-size: 13.5px; line-height: 1.75; }
.markdown-preview { min-height: 230px; padding: 14px 16px; }
.markdown-preview > p { margin: 0; color: var(--muted); font-size: 13px; }
.composer-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.composer-thumb { position: relative; aspect-ratio: 1; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: rgba(3, 8, 20, .6); }
.composer-thumb img, .composer-thumb :deep(.auth-image) { width: 100%; height: 100%; object-fit: contain; }
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
@media (max-width: 560px) { .composer-kind { width: 100%; } .composer-kind button { flex: 1; } .markdown-head { align-items: flex-start; } .composer-bar { align-items: stretch; } .composer-submit { width: 100%; justify-content: flex-end; } .composer-count { width: 100%; } }
</style>
