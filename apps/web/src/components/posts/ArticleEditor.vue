<script setup lang="ts">
// Full-page editor for 经验分享 articles: Markdown with live preview, inline images, autosaved drafts.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import AuthImage from "../AuthImage.vue";
import MarkdownContent from "../profile/MarkdownContent.vue";
import { ApiError, apiRequest } from "../../lib/api";
import { articleLength, fullTime, inlineAttachmentIds, markdownExcerpt, relativeTime } from "../../lib/format";
import { setLeaveGuard } from "../../lib/navigation";
import type { Post, SessionUser } from "../../lib/people";

type View = "write" | "split" | "preview";
type MarkdownAction = { label: string; title: string; before: string; after: string; fallback: string; block?: boolean };

const IMAGE_LIMIT = 24;
const CONTENT_LIMIT = 100_000;
const AUTOSAVE_MS = 20_000;

const props = defineProps<{ postId: string | null; sessionToken: string; sessionUser: SessionUser; openDrafts?: boolean }>();
const emit = defineEmits<{ navigate: [path: string]; sessionExpired: [] }>();

const post = ref<Post | null>(null);
const title = ref("");
const content = ref("");
const visibility = ref<"public" | "members">("public");
const snapshot = ref("");
const loading = ref(Boolean(props.postId));
const loadError = ref("");
const saving = ref<"" | "draft" | "publish" | "auto" | "upload">("");
const error = ref("");
const savedAt = ref<string | null>(null);
const view = ref<View>(window.matchMedia("(min-width: 1100px)").matches ? "split" : "write");
const draftsOpen = ref(Boolean(props.openDrafts));
const drafts = ref<Post[]>([]);
const draftsLoading = ref(false);
const backup = ref<{ title: string; content: string; visibility: "public" | "members"; savedAt: string } | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileRef = ref<HTMLInputElement | null>(null);
let autosaveTimer = 0;
let backupTimer = 0;

const isDraft = computed(() => !post.value || post.value.status === "draft");
const state = () => JSON.stringify([title.value.trim(), content.value, visibility.value]);
snapshot.value = state();
const dirty = computed(() => state() !== snapshot.value);
const length = computed(() => articleLength(content.value));
const images = computed(() => post.value?.images ?? []);
const inlineIds = computed(() => inlineAttachmentIds(content.value));
const canPublish = computed(() => Boolean(title.value.trim() && content.value.trim()) && content.value.length <= CONTENT_LIMIT && !saving.value);
const backupKey = computed(() => `fandou-article-backup:${props.sessionUser.personId}:${post.value?.id ?? props.postId ?? "new"}`);
const statusText = computed(() => {
  if (saving.value === "auto" || saving.value === "draft") return "正在保存草稿…";
  if (saving.value === "upload") return "正在上传图片…";
  if (saving.value === "publish") return isDraft.value ? "正在发布…" : "正在更新…";
  if (dirty.value) return isDraft.value ? "有未保存的修改，稍后会自动存入草稿箱" : "有未保存的修改";
  if (savedAt.value) return `${isDraft.value ? "草稿已保存" : "已保存"} · ${relativeTime(savedAt.value)}`;
  return isDraft.value ? "新草稿" : "已发布";
});

const markdownActions: MarkdownAction[] = [
  { label: "H2", title: "二级标题", before: "## ", after: "", fallback: "小标题", block: true },
  { label: "H3", title: "三级标题", before: "### ", after: "", fallback: "小标题", block: true },
  { label: "B", title: "粗体（Ctrl+B）", before: "**", after: "**", fallback: "重点文字" },
  { label: "I", title: "斜体（Ctrl+I）", before: "*", after: "*", fallback: "强调文字" },
  { label: "❝", title: "引用", before: "> ", after: "", fallback: "引用内容", block: true },
  { label: "•", title: "无序列表", before: "- ", after: "", fallback: "列表项", block: true },
  { label: "1.", title: "有序列表", before: "1. ", after: "", fallback: "第一步", block: true },
  { label: "</>", title: "行内代码", before: "`", after: "`", fallback: "code" },
  { label: "{ }", title: "代码块", before: "```\n", after: "\n```", fallback: "代码", block: true },
  { label: "↗", title: "链接", before: "[", after: "](https://)", fallback: "链接文字" },
  { label: "—", title: "分割线", before: "\n---\n", after: "", fallback: "", block: true },
];

function fail(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.status === 401) emit("sessionExpired");
  return cause instanceof Error ? cause.message : fallback;
}

function applyPost(next: Post) {
  post.value = next;
  title.value = next.title ?? "";
  content.value = next.content;
  visibility.value = next.visibility;
  snapshot.value = state();
  savedAt.value = next.updatedAt;
}

async function load() {
  if (!props.postId) {
    restoreCheck();
    return;
  }
  loading.value = true;
  loadError.value = "";
  try {
    const next = await apiRequest<Post>(`/api/posts/${encodeURIComponent(props.postId)}`, { token: props.sessionToken, fallback: "文章暂时无法读取" });
    if (next.personId !== props.sessionUser.personId) throw new Error("只能编辑自己的文章");
    if (next.kind !== "experience") throw new Error("随手记请在个人主页里直接编辑");
    applyPost(next);
    restoreCheck();
  } catch (cause) {
    loadError.value = fail(cause, "文章暂时无法读取");
  } finally {
    loading.value = false;
  }
}

/** A local copy survives crashes and closed tabs; offer it when it is newer than the saved version. */
function restoreCheck() {
  try {
    const raw = localStorage.getItem(backupKey.value);
    if (!raw) return;
    const saved = JSON.parse(raw) as typeof backup.value;
    if (!saved) return;
    const serverTime = post.value ? Date.parse(post.value.updatedAt.replace(" ", "T") + (post.value.updatedAt.includes("T") ? "" : "Z")) : 0;
    const differs = JSON.stringify([saved.title.trim(), saved.content, saved.visibility]) !== state();
    if (differs && Date.parse(saved.savedAt) > serverTime && (saved.title || saved.content)) backup.value = saved;
    else localStorage.removeItem(backupKey.value);
  } catch { /* ignore unreadable backups */ }
}
function restoreBackup() {
  if (!backup.value) return;
  title.value = backup.value.title;
  content.value = backup.value.content;
  visibility.value = backup.value.visibility;
  backup.value = null;
}
function discardBackup() {
  localStorage.removeItem(backupKey.value);
  backup.value = null;
}
function writeBackup() {
  window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    if (!dirty.value) { localStorage.removeItem(backupKey.value); return; }
    try { localStorage.setItem(backupKey.value, JSON.stringify({ title: title.value, content: content.value, visibility: visibility.value, savedAt: new Date().toISOString() })); }
    catch { /* storage full or disabled */ }
  }, 800);
}

/** Creates the draft on first save, then keeps it in sync. Published articles are never turned back into drafts. */
async function saveDraft(mode: "draft" | "auto" = "draft") {
  if (!isDraft.value || saving.value) return post.value;
  if (!title.value.trim() && !content.value.trim()) {
    if (mode === "draft") error.value = "写点内容再保存吧";
    return post.value;
  }
  saving.value = mode;
  if (mode === "draft") error.value = "";
  // The server trims text, so "saved" is measured against what was sent rather than what came back.
  const sent = state();
  try {
    let next: Post;
    if (!post.value) {
      const form = new FormData();
      form.append("kind", "experience");
      form.append("status", "draft");
      if (title.value.trim()) form.append("title", title.value.trim());
      form.append("content", content.value);
      form.append("visibility", visibility.value);
      next = await apiRequest<Post>("/api/me/posts", { token: props.sessionToken, form, fallback: "草稿保存失败" });
      window.history.replaceState({}, "", `/posts/${encodeURIComponent(next.id)}/edit`);
      localStorage.removeItem(`fandou-article-backup:${props.sessionUser.personId}:new`);
    } else {
      next = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(post.value.id)}`, {
        token: props.sessionToken, method: "PATCH", fallback: "草稿保存失败",
        json: { version: post.value.version, title: title.value.trim() || null, content: content.value, visibility: visibility.value },
      });
    }
    post.value = next;
    savedAt.value = next.updatedAt;
    // Typing that happened while the request was in flight stays dirty.
    snapshot.value = sent;
    if (!dirty.value) localStorage.removeItem(backupKey.value);
    return next;
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 409 ? "草稿在别处被修改了，请刷新后再保存" : fail(cause, "草稿保存失败");
    return null;
  } finally {
    saving.value = "";
  }
}

async function publish() {
  if (!title.value.trim()) { error.value = "给文章起个标题再发布"; return; }
  if (!content.value.trim()) { error.value = "正文不能为空"; return; }
  if (saving.value) return;
  saving.value = "publish";
  error.value = "";
  try {
    let next: Post;
    const fields = { title: title.value.trim(), content: content.value, visibility: visibility.value };
    if (!post.value) {
      const form = new FormData();
      form.append("kind", "experience");
      form.append("status", "published");
      form.append("title", fields.title);
      form.append("content", fields.content);
      form.append("visibility", fields.visibility);
      next = await apiRequest<Post>("/api/me/posts", { token: props.sessionToken, form, fallback: "发布失败" });
    } else {
      next = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(post.value.id)}`, {
        token: props.sessionToken, method: "PATCH", fallback: "发布失败",
        json: { version: post.value.version, ...fields, ...(isDraft.value ? { status: "published" } : {}) },
      });
    }
    post.value = next;
    snapshot.value = state();
    localStorage.removeItem(backupKey.value);
    localStorage.removeItem(`fandou-article-backup:${props.sessionUser.personId}:new`);
    emit("navigate", `/posts/${encodeURIComponent(next.id)}`);
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 409 ? "文章在别处被修改了，请刷新后再试" : fail(cause, "发布失败");
  } finally {
    saving.value = "";
  }
}

/* ---------- Markdown editing ---------- */
function insertAtCursor(text: string, selectFrom?: number, selectLength = 0) {
  const element = textareaRef.value;
  const start = element?.selectionStart ?? content.value.length;
  const end = element?.selectionEnd ?? start;
  content.value = `${content.value.slice(0, start)}${text}${content.value.slice(end)}`;
  void nextTick(() => {
    if (!element) return;
    element.focus();
    const from = start + (selectFrom ?? text.length);
    element.setSelectionRange(from, from + selectLength);
  });
}
function applyMarkdown(action: MarkdownAction) {
  if (view.value === "preview") view.value = "write";
  const element = textareaRef.value;
  const start = element?.selectionStart ?? content.value.length;
  const end = element?.selectionEnd ?? start;
  const selected = content.value.slice(start, end) || action.fallback;
  const needsLineBreak = Boolean(action.block && start > 0 && content.value[start - 1] !== "\n");
  const prefix = `${needsLineBreak ? "\n" : ""}${action.before}`;
  content.value = `${content.value.slice(0, start)}${prefix}${selected}${action.after}${content.value.slice(end)}`;
  void nextTick(() => {
    element?.focus();
    element?.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  });
}
function onEditorKey(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) {
    // Tab indents instead of leaving the editor.
    if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); insertAtCursor("  "); }
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "b") { event.preventDefault(); applyMarkdown(markdownActions[2]); }
  else if (key === "i") { event.preventDefault(); applyMarkdown(markdownActions[3]); }
  else if (key === "k") { event.preventDefault(); applyMarkdown(markdownActions[9]); }
}
function onWindowKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (isDraft.value) void saveDraft();
    else void publish();
  }
  if (event.key === "Escape" && draftsOpen.value) draftsOpen.value = false;
}

/* ---------- Images ---------- */
async function uploadImages(files: File[]) {
  const accepted = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 5 * 1024 * 1024);
  if (accepted.length < files.length) error.value = "部分文件未上传：图片仅支持 JPG、PNG、WebP，单张不超过 5 MB";
  if (!accepted.length) return;
  if (images.value.length + accepted.length > IMAGE_LIMIT) { error.value = `每篇文章最多 ${IMAGE_LIMIT} 张图片`; return; }
  // Images attach to a post, so a brand new article is first stored as a draft.
  let target = post.value;
  if (!target) {
    if (!title.value.trim() && !content.value.trim()) title.value = "未命名经验";
    target = await saveDraft("draft");
    if (!target) return;
  }
  saving.value = "upload";
  try {
    const known = new Set(images.value.map((image) => image.id));
    const form = new FormData();
    accepted.forEach((file) => form.append("images", file, file.name));
    const next = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(target.id)}/images`, { token: props.sessionToken, form, fallback: "图片上传失败" });
    const added = next.images.filter((image) => !known.has(image.id));
    post.value = { ...next, title: post.value?.title ?? next.title, content: post.value?.content ?? next.content };
    const markup = added.map((image, index) => `![${accepted[index]?.name.replace(/\.[^.]+$/, "") || "图片"}](/api/attachments/${image.id})`).join("\n\n");
    const element = textareaRef.value;
    const at = element?.selectionStart ?? content.value.length;
    insertAtCursor(`${at > 0 && content.value[at - 1] !== "\n" ? "\n\n" : ""}${markup}\n`);
  } catch (cause) {
    error.value = fail(cause, "图片上传失败");
  } finally {
    saving.value = "";
  }
}
function pickImages(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  void uploadImages(files);
}
function onPaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  void uploadImages(files);
}
function onDrop(event: DragEvent) {
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  void uploadImages(files);
}
function insertImage(id: string) {
  if (view.value === "preview") view.value = "write";
  insertAtCursor(`\n![图片](/api/attachments/${id})\n`);
}
async function removeImage(id: string) {
  if (!post.value || !window.confirm("删除这张图片？正文中引用它的位置也会一起移除。")) return;
  saving.value = "upload";
  try {
    const next = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(post.value.id)}/images/${encodeURIComponent(id)}`, { token: props.sessionToken, method: "DELETE", fallback: "图片删除失败" });
    post.value = { ...next, title: post.value.title, content: post.value.content };
    content.value = content.value.replace(new RegExp(`\\n?!\\[[^\\]]*\\]\\(/api/attachments/${id}\\)\\n?`, "g"), "\n");
  } catch (cause) {
    error.value = fail(cause, "图片删除失败");
  } finally {
    saving.value = "";
  }
}

/* ---------- Drafts box ---------- */
async function loadDrafts() {
  draftsLoading.value = true;
  try {
    drafts.value = (await apiRequest<Post[]>("/api/me/posts/drafts", { token: props.sessionToken, fallback: "草稿箱暂时无法读取" })).filter((item) => item.kind === "experience");
  } catch (cause) {
    error.value = fail(cause, "草稿箱暂时无法读取");
  } finally {
    draftsLoading.value = false;
  }
}
function openDraft(draft: Post) {
  if (draft.id === post.value?.id) { draftsOpen.value = false; return; }
  emit("navigate", `/posts/${encodeURIComponent(draft.id)}/edit`);
}
async function deleteDraft(draft: Post) {
  if (!window.confirm(`删除草稿「${draft.title || "无标题草稿"}」？图片会一起删除，且无法恢复。`)) return;
  try {
    await apiRequest(`/api/me/posts/${encodeURIComponent(draft.id)}`, { token: props.sessionToken, method: "DELETE", fallback: "草稿删除失败" });
    drafts.value = drafts.value.filter((item) => item.id !== draft.id);
    if (draft.id === post.value?.id) {
      snapshot.value = state();
      emit("navigate", "/write");
    }
  } catch (cause) {
    error.value = fail(cause, "草稿删除失败");
  }
}
function newArticle() {
  emit("navigate", "/write");
}

function leaveGuard() {
  if (!dirty.value || saving.value === "publish") return true;
  if (isDraft.value && (title.value.trim() || content.value.trim())) {
    // Leaving a draft keeps the latest text in the drafts box.
    void saveDraft("auto");
    return true;
  }
  return window.confirm("还有未保存的修改，确定离开吗？本机仍会保留一份临时备份。");
}
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault();
}

watch([title, content, visibility], () => {
  writeBackup();
  if (!isDraft.value) return;
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => { if (dirty.value) void saveDraft("auto"); }, AUTOSAVE_MS);
});
watch(draftsOpen, (open) => { if (open) void loadDrafts(); });

onMounted(() => {
  void load();
  void loadDrafts();
  setLeaveGuard(leaveGuard);
  window.addEventListener("keydown", onWindowKey);
  window.addEventListener("beforeunload", onBeforeUnload);
  if (!props.postId) nextTick(() => document.querySelector<HTMLInputElement>(".article-title-input")?.focus());
});
onUnmounted(() => {
  window.clearTimeout(autosaveTimer);
  window.clearTimeout(backupTimer);
  setLeaveGuard(null);
  window.removeEventListener("keydown", onWindowKey);
  window.removeEventListener("beforeunload", onBeforeUnload);
});
</script>

<template>
  <section class="article-editor" aria-labelledby="article-editor-title">
    <header class="editor-bar">
      <div class="editor-bar-left">
        <button class="back-link" type="button" @click="emit('navigate', `/person/${encodeURIComponent(sessionUser.personId)}`)">← 我的主页</button>
        <div>
          <h1 id="article-editor-title">{{ isDraft ? "写经验分享" : "编辑文章" }}</h1>
          <p class="editor-status" :class="{ dirty, busy: Boolean(saving) }" role="status">{{ statusText }}</p>
        </div>
      </div>
      <div class="editor-bar-actions">
        <button class="secondary-command" type="button" :aria-expanded="draftsOpen" @click="draftsOpen = !draftsOpen">草稿箱<span v-if="drafts.length" class="count">{{ drafts.length }}</span></button>
        <button v-if="isDraft" class="secondary-command" type="button" :disabled="Boolean(saving) || (!dirty && Boolean(post))" @click="saveDraft()">保存草稿</button>
        <button class="primary-command" type="button" :disabled="!canPublish" @click="publish">{{ saving === "publish" ? (isDraft ? "发布中…" : "更新中…") : isDraft ? "发布" : "更新文章" }}</button>
      </div>
    </header>

    <div v-if="loading" class="editor-loading"><span class="loading-ring"></span>正在打开文章</div>
    <div v-else-if="loadError" class="editor-loading">
      <p>{{ loadError }}</p>
      <button class="secondary-command" type="button" @click="newArticle">写一篇新的</button>
    </div>
    <template v-else>
      <div v-if="backup" class="editor-banner" role="status">
        <span>本机保留了一份 {{ relativeTime(backup.savedAt) }}的未保存修改。</span>
        <button class="text-link" type="button" @click="restoreBackup">恢复</button>
        <button class="text-link muted" type="button" @click="discardBackup">丢弃</button>
      </div>
      <p v-if="error" class="editor-banner error" role="alert">{{ error }}</p>

      <div class="editor-shell" :class="`view-${view}`">
        <div class="editor-meta">
          <input v-model="title" class="article-title-input" maxlength="120" placeholder="文章标题" aria-label="文章标题" />
          <div class="editor-meta-row">
            <label class="meta-select"><span class="visually-hidden">可见范围</span>
              <select v-model="visibility"><option value="public">所有人可见</option><option value="members">仅成员可见</option></select>
            </label>
            <span class="meta-count" :class="{ over: content.length > CONTENT_LIMIT * 0.95 }">{{ length.toLocaleString() }} 字</span>
            <span v-if="post && !isDraft" class="meta-count">发布于 {{ fullTime(post.publishedAt ?? post.createdAt) }}</span>
          </div>
        </div>

        <div class="editor-toolbar" role="toolbar" aria-label="Markdown 格式">
          <div class="tool-group">
            <button v-for="action in markdownActions" :key="action.title" type="button" :title="action.title" :aria-label="action.title" @click="applyMarkdown(action)">{{ action.label }}</button>
            <button type="button" title="插入图片（也可以直接粘贴或拖入）" aria-label="插入图片" :disabled="images.length >= IMAGE_LIMIT || Boolean(saving)" @click="fileRef?.click()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></svg>
            </button>
            <input ref="fileRef" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple tabindex="-1" @change="pickImages" />
          </div>
          <div class="view-toggle" role="tablist" aria-label="编辑视图">
            <button type="button" role="tab" :aria-selected="view === 'write'" :class="{ active: view === 'write' }" @click="view = 'write'">编辑</button>
            <button type="button" role="tab" class="split-only" :aria-selected="view === 'split'" :class="{ active: view === 'split' }" @click="view = 'split'">分栏</button>
            <button type="button" role="tab" :aria-selected="view === 'preview'" :class="{ active: view === 'preview' }" @click="view = 'preview'">预览</button>
          </div>
        </div>

        <div class="editor-panes">
          <textarea
            v-show="view !== 'preview'"
            ref="textareaRef"
            v-model="content"
            class="editor-source"
            :maxlength="CONTENT_LIMIT"
            spellcheck="false"
            placeholder="用 Markdown 写下可以复用的经验：背景、步骤、踩过的坑、给后来者的建议……&#10;&#10;图片可以直接粘贴或拖进来，会插入到光标位置。"
            aria-label="文章正文，支持 Markdown"
            @keydown="onEditorKey"
            @paste="onPaste"
            @drop="onDrop"
            @dragover.prevent
          ></textarea>
          <article v-show="view !== 'write'" class="editor-preview" aria-label="预览">
            <h1 v-if="title.trim()" class="preview-title">{{ title }}</h1>
            <MarkdownContent v-if="content.trim()" :source="content" :token="sessionToken" />
            <p v-else class="preview-empty">预览会显示在这里。</p>
          </article>
        </div>

        <div class="image-tray" :aria-label="`文章图片 ${images.length}/${IMAGE_LIMIT}`">
          <div class="tray-head">
            <strong>图片</strong><span>{{ images.length }} / {{ IMAGE_LIMIT }}</span>
            <small>点击缩略图插入到光标处；未插入正文的图片会作为图集显示在文末</small>
          </div>
          <div v-if="images.length" class="tray-list">
            <figure v-for="image in images" :key="image.id" :class="{ inline: inlineIds.has(image.id) }">
              <button type="button" :title="inlineIds.has(image.id) ? '已在正文中，点击再次插入' : '插入到正文'" @click="insertImage(image.id)">
                <AuthImage :src="image.url" :token="sessionToken" alt="文章图片" />
              </button>
              <span v-if="inlineIds.has(image.id)" class="tray-badge">正文</span>
              <button class="tray-remove" type="button" aria-label="删除这张图片" @click="removeImage(image.id)">×</button>
            </figure>
          </div>
          <p v-else class="tray-empty">还没有图片。</p>
        </div>
      </div>
    </template>

    <Teleport to="body">
    <div v-if="draftsOpen" class="drafts-backdrop" @click.self="draftsOpen = false">
      <aside class="drafts-panel" role="dialog" aria-modal="true" aria-labelledby="drafts-title">
        <header>
          <div><span class="section-label">DRAFTS</span><h2 id="drafts-title">草稿箱</h2></div>
          <button class="drafts-close" type="button" aria-label="关闭草稿箱" @click="draftsOpen = false">×</button>
        </header>
        <p class="drafts-note">草稿只有你自己能看到，编辑时每 20 秒自动保存一次。</p>
        <button class="drafts-new" type="button" @click="newArticle">＋ 新建一篇</button>
        <div v-if="draftsLoading" class="editor-loading small"><span class="loading-ring"></span></div>
        <ul v-else-if="drafts.length" class="drafts-list">
          <li v-for="draft in drafts" :key="draft.id" :class="{ current: draft.id === post?.id }">
            <button class="draft-open" type="button" @click="openDraft(draft)">
              <strong>{{ draft.title || "无标题草稿" }}</strong>
              <span>{{ markdownExcerpt(draft.content, 60) || "还没有正文" }}</span>
              <small>{{ relativeTime(draft.updatedAt) }}保存 · {{ articleLength(draft.content).toLocaleString() }} 字<template v-if="draft.images.length"> · {{ draft.images.length }} 张图</template></small>
            </button>
            <button class="draft-delete" type="button" :aria-label="`删除草稿 ${draft.title || '无标题草稿'}`" @click="deleteDraft(draft)">删除</button>
          </li>
        </ul>
        <p v-else class="drafts-empty">草稿箱是空的。</p>
      </aside>
    </div>
    </Teleport>
  </section>
</template>

<style src="./article.css" scoped></style>
