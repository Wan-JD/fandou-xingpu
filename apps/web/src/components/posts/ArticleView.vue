<script setup lang="ts">
// Reading page for a 经验分享 article.
import { computed, onUnmounted, ref, watch } from "vue";
import AuthImage from "../AuthImage.vue";
import ImageLightbox, { type LightboxImage } from "../ImageLightbox.vue";
import StarAvatar from "../StarAvatar.vue";
import MarkdownContent from "../profile/MarkdownContent.vue";
import { ApiError, apiRequest, authHeaders, copyText } from "../../lib/api";
import { fullTime, inlineAttachmentIds, readingMinutes, relativeTime } from "../../lib/format";
import { formatCohort, normaliseSummary, toneFor, type Person, type PersonSummary, type Post, type SessionUser } from "../../lib/people";

const props = defineProps<{ postId: string; people: Person[]; rootPersonId: string | null; sessionToken: string | null; sessionUser: SessionUser | null }>();
const emit = defineEmits<{ navigate: [path: string]; requireAuth: []; sessionExpired: [] }>();

const post = ref<Post | null>(null);
const author = ref<PersonSummary | null>(null);
const loading = ref(true);
const error = ref("");
const status = ref(0);
const busy = ref(false);
const actionError = ref("");
const copied = ref(false);
const lightbox = ref<{ images: LightboxImage[]; start: number } | null>(null);
let request = 0;

const isOwner = computed(() => Boolean(post.value && props.sessionUser?.personId === post.value.personId));
const isPublic = computed(() => post.value?.visibility === "public" && post.value.status !== "draft");
const inlineIds = computed(() => inlineAttachmentIds(post.value?.content ?? ""));
const gallery = computed(() => (post.value?.images ?? []).filter((image) => !inlineIds.value.has(image.id)));
const minutes = computed(() => readingMinutes(post.value?.content ?? ""));
const edited = computed(() => post.value && post.value.status !== "draft" && post.value.updatedAt.slice(0, 16) > (post.value.publishedAt ?? post.value.createdAt).slice(0, 16));

async function load() {
  const id = ++request;
  loading.value = true;
  error.value = "";
  try {
    const next = await apiRequest<Post>(`/api/posts/${encodeURIComponent(props.postId)}`, { token: props.sessionToken, fallback: "文章暂时无法读取" });
    if (id !== request) return;
    post.value = next;
    const local = props.people.find((person) => person.id === next.personId);
    if (local) author.value = local;
    else {
      const response = await fetch(`/api/people/${encodeURIComponent(next.personId)}`, { headers: authHeaders(props.sessionToken) });
      const payload = response.ok ? await response.json() as { data?: Record<string, unknown> } : null;
      if (payload?.data && id === request) author.value = normaliseSummary(payload.data);
    }
    document.title = `${next.title || "经验分享"} · 翻斗星谱`;
  } catch (cause) {
    if (id !== request) return;
    status.value = cause instanceof ApiError ? cause.status : 0;
    error.value = cause instanceof Error ? cause.message : "文章暂时无法读取";
  } finally {
    if (id === request) loading.value = false;
  }
}

async function toggleLike() {
  if (!post.value) return;
  if (!props.sessionToken) { emit("requireAuth"); return; }
  const next = !post.value.likedByViewer;
  const before = post.value;
  post.value = { ...before, likedByViewer: next, likeCount: Math.max(0, before.likeCount + (next ? 1 : -1)) };
  try {
    const result = await apiRequest<{ likeCount: number; likedByViewer: boolean }>(`/api/posts/${encodeURIComponent(before.id)}/like`, { token: props.sessionToken, method: next ? "PUT" : "DELETE" });
    post.value = { ...post.value, ...result };
  } catch (cause) {
    post.value = before;
    actionError.value = cause instanceof Error ? cause.message : "暂时无法点亮";
  }
}

async function togglePin() {
  if (!post.value || !props.sessionToken) return;
  busy.value = true;
  actionError.value = "";
  try {
    post.value = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(post.value.id)}`, { token: props.sessionToken, method: "PATCH", json: { version: post.value.version, isPinned: !post.value.isPinned }, fallback: "置顶失败" });
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) emit("sessionExpired");
    actionError.value = cause instanceof Error ? cause.message : "置顶失败";
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!post.value || !props.sessionToken || !window.confirm("删除这篇文章？图片会一起删除，且无法恢复。")) return;
  busy.value = true;
  try {
    await apiRequest(`/api/me/posts/${encodeURIComponent(post.value.id)}`, { token: props.sessionToken, method: "DELETE", fallback: "删除失败" });
    emit("navigate", `/person/${encodeURIComponent(post.value.personId)}`);
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : "删除失败";
    busy.value = false;
  }
}

function openImage(attachmentId: string) {
  const all = post.value?.images ?? [];
  // Inline images first in reading order, then the trailing gallery.
  const order = [...inlineIds.value].filter((id) => all.some((image) => image.id === id)).concat(gallery.value.map((image) => image.id));
  const start = Math.max(0, order.indexOf(attachmentId));
  lightbox.value = { start, images: order.map((id) => ({ key: id, src: `/api/attachments/${id}`, isPublic: isPublic.value })) };
}

async function copyLink() {
  copied.value = await copyText(window.location.href);
  window.setTimeout(() => { copied.value = false; }, 2000);
}

watch(() => [props.postId, props.sessionToken], load, { immediate: true });
onUnmounted(() => { request += 1; document.title = "翻斗星谱"; });
</script>

<template>
  <section class="article-view">
    <div class="article-topbar">
      <button class="back-link" type="button" @click="emit('navigate', author ? `/person/${encodeURIComponent(author.id)}` : '/')">← {{ author ? `${author.name} 的主页` : "返回" }}</button>
      <button v-if="post" class="ghost-pill" type="button" @click="copyLink">{{ copied ? "已复制链接" : "复制链接" }}</button>
    </div>

    <div v-if="loading && !post" class="article-state"><span class="loading-ring"></span>正在展开这篇经验</div>
    <div v-else-if="error && !post" class="article-state">
      <p>{{ error }}</p>
      <button v-if="status === 401" class="secondary-command" type="button" @click="emit('requireAuth')">登录查看</button>
    </div>

    <article v-else-if="post" class="article">
      <p v-if="post.status === 'draft'" class="draft-banner">这是一篇草稿，只有你能看到。<button class="text-link" type="button" @click="emit('navigate', `/posts/${encodeURIComponent(post.id)}/edit`)">继续编辑</button></p>
      <header class="article-head">
        <span class="article-kind">经验分享<template v-if="post.isPinned"> · 置顶</template></span>
        <h1>{{ post.title || "无标题经验" }}</h1>
        <div class="article-byline">
          <button v-if="author" class="byline-author" type="button" @click="emit('navigate', `/person/${encodeURIComponent(author.id)}`)">
            <StarAvatar :name="author.name" :avatar-url="author.avatarUrl" :tone="toneFor(author, rootPersonId)" size="sm" />
            <span><strong>{{ author.name }}</strong><small>{{ formatCohort(author.cohort) }}</small></span>
          </button>
          <span class="byline-meta">
            <time :datetime="post.publishedAt ?? post.createdAt" :title="fullTime(post.publishedAt ?? post.createdAt)">{{ post.status === "draft" ? `${relativeTime(post.updatedAt)}保存` : fullTime(post.publishedAt ?? post.createdAt).slice(0, 10) }}</time>
            <template v-if="edited"> · 已编辑</template>
            · 约 {{ minutes }} 分钟读完
            · {{ post.visibility === "public" ? "公开" : "仅成员" }}
          </span>
        </div>
      </header>

      <MarkdownContent class="article-body" :source="post.content" :token="sessionToken" :public-images="isPublic" @image-click="openImage" />

      <section v-if="gallery.length" class="article-gallery" aria-label="图集">
        <h2>图集</h2>
        <div class="gallery-grid">
          <button v-for="image in gallery" :key="image.id" type="button" :aria-label="'查看图片'" @click="openImage(image.id)">
            <AuthImage :src="image.url" :token="sessionToken" :is-public="isPublic" alt="文章配图" />
          </button>
        </div>
      </section>

      <footer class="article-foot">
        <button v-if="post.status !== 'draft'" class="post-like" :class="{ liked: post.likedByViewer }" type="button" :aria-pressed="post.likedByViewer" @click="toggleLike">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.4 4.4 3.9 7.9 8.3 8.3-4.4.4-7.9 3.9-8.3 8.3-.4-4.4-3.9-7.9-8.3-8.3 4.4-.4 7.9-3.9 8.3-8.3Z" /></svg>
          {{ post.likedByViewer ? "已点亮" : "点亮" }}<b v-if="post.likeCount">{{ post.likeCount }}</b>
        </button>
        <div v-if="isOwner" class="owner-actions">
          <button class="secondary-command" type="button" :disabled="busy" @click="emit('navigate', `/posts/${encodeURIComponent(post.id)}/edit`)">编辑</button>
          <button v-if="post.status !== 'draft'" class="secondary-command" type="button" :disabled="busy" @click="togglePin">{{ post.isPinned ? "取消置顶" : "置顶到主页" }}</button>
          <button class="secondary-command danger" type="button" :disabled="busy" @click="remove">删除</button>
        </div>
        <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
      </footer>
    </article>

    <Teleport to="body">
      <ImageLightbox v-if="lightbox" :images="lightbox.images" :start="lightbox.start" :token="sessionToken" @close="lightbox = null" />
    </Teleport>
  </section>
</template>

<style scoped>
.article-view { max-width: 860px; margin: 0 auto; padding: 4px clamp(14px, 4vw, 32px) 80px; animation: view-in .5s var(--ease-out) both; }
.article-topbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.ghost-pill { min-height: 36px; padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: rgba(8, 14, 30, .5); color: var(--ink-soft); font-size: 12.5px; }
.ghost-pill:hover { border-color: rgba(231, 201, 130, .5); color: var(--gold); }
.article-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 45vh; color: var(--ink-soft); }
.article { position: relative; margin-top: 18px; padding: clamp(24px, 5vw, 52px) clamp(18px, 5vw, 56px); border: 1px solid var(--glass-border); border-radius: 28px; background: linear-gradient(170deg, rgba(16, 30, 58, .72), rgba(6, 11, 25, .82)); box-shadow: 0 30px 80px rgba(0, 0, 0, .35); backdrop-filter: blur(16px); }
.article::before { content: ""; position: absolute; top: 0; left: 40px; right: 40px; height: 1px; background: linear-gradient(90deg, transparent, rgba(231, 201, 130, .6), transparent); }
.draft-banner { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 22px; padding: 10px 14px; border: 1px dashed rgba(231, 201, 130, .45); border-radius: 12px; color: var(--gold); font-size: 13px; }
.text-link { padding: 0; border: 0; background: none; color: var(--aqua); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
.article-kind { color: var(--gold); font-size: 11px; letter-spacing: .28em; }
.article-head h1 { margin: 12px 0 0; font-family: var(--serif); font-size: clamp(1.8rem, 4.4vw, 2.6rem); font-weight: 400; line-height: 1.35; letter-spacing: .04em; text-wrap: balance; }
.article-byline { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.byline-author { display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none; color: inherit; text-align: left; }
.byline-author :deep(.star-avatar) { --s: 36px; }
.byline-author :deep(.star-avatar-ring) { inset: -5px; }
.byline-author span { display: grid; }
.byline-author strong { color: var(--ink); font-size: 14px; font-weight: 500; }
.byline-author small { color: var(--muted); font-size: 11.5px; }
.byline-author:hover strong { color: var(--gold); }
.byline-meta { color: var(--muted); font-size: 12.5px; }
.article-body { margin-top: 30px; font-size: 16px; line-height: 1.95; }
.article-body :deep(h2) { padding-top: .4em; }
.article-gallery { margin-top: 36px; padding-top: 22px; border-top: 1px solid var(--line); }
.article-gallery h2 { margin: 0 0 12px; font-family: var(--serif); font-size: 17px; font-weight: 400; letter-spacing: .1em; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.gallery-grid button { aspect-ratio: 1; padding: 0; overflow: hidden; border: 0; border-radius: 12px; background: rgba(3, 8, 20, .6); cursor: zoom-in; }
.article-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 36px; padding-top: 20px; border-top: 1px solid var(--line); }
.owner-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.owner-actions .danger { color: #ffb4a8; }
.post-like { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 18px 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--ink-soft); font-size: 13px; }
.post-like svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.5; }
.post-like.liked { border-color: rgba(231, 201, 130, .4); background: rgba(231, 201, 130, .1); color: var(--gold); }
.post-like.liked svg { fill: currentColor; }
.post-like b { font-weight: 500; }
@keyframes view-in { from { opacity: 0; transform: translateY(12px); } }
</style>
