<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AuthImage from "../AuthImage.vue";
import StarAvatar from "../StarAvatar.vue";
import PostComposer from "./PostComposer.vue";
import { apiRequest } from "../../lib/api";
import { fullTime, inlineAttachmentIds, linkify, markdownExcerpt, readingMinutes, relativeTime } from "../../lib/format";
import type { Post, PersonSummary, Tone } from "../../lib/people";

const props = defineProps<{ post: Post; author: PersonSummary; tone: Tone; token: string | null; isOwner: boolean }>();
const emit = defineEmits<{ updated: [post: Post]; deleted: [id: string]; openImage: [index: number]; requireAuth: []; navigate: [path: string] }>();

const editing = ref(false);
const menuOpen = ref(false);
const busy = ref(false);
const error = ref("");
const expandedText = ref(false);
const liking = ref(false);
const sparkKey = ref(0);
const menuRef = ref<HTMLElement | null>(null);

const isExperience = computed(() => props.post.kind === "experience");
// Articles are read on their own page; the feed shows a teaser with a cover.
const articlePath = computed(() => `/posts/${encodeURIComponent(props.post.id)}`);
const excerpt = computed(() => markdownExcerpt(props.post.content, 160));
const cover = computed(() => {
  const inline = [...inlineAttachmentIds(props.post.content)];
  return props.post.images.find((image) => image.id === inline[0]) ?? props.post.images[0] ?? null;
});
function startEdit() {
  menuOpen.value = false;
  if (isExperience.value) emit("navigate", `${articlePath.value}/edit`);
  else editing.value = true;
}
const longText = computed(() => !isExperience.value && (props.post.content.length > 360 || props.post.content.split("\n").length > 8));
const tokens = computed(() => linkify(props.post.content));
const edited = computed(() => props.post.updatedAt && props.post.updatedAt.slice(0, 16) !== props.post.createdAt.slice(0, 16));
const imageLayout = computed(() => props.post.images.length === 1 ? "single" : props.post.images.length === 2 || props.post.images.length === 4 ? "pair" : props.post.images.length > 9 ? "many" : "grid");

async function toggleLike() {
  if (!props.token) { emit("requireAuth"); return; }
  if (liking.value) return;
  liking.value = true;
  const next = !props.post.likedByViewer;
  if (next) sparkKey.value += 1;
  // Optimistic update keeps the button responsive; the server count wins afterwards.
  emit("updated", { ...props.post, likedByViewer: next, likeCount: Math.max(0, props.post.likeCount + (next ? 1 : -1)) });
  try {
    const result = await apiRequest<{ likeCount: number; likedByViewer: boolean }>(`/api/posts/${encodeURIComponent(props.post.id)}/like`, { token: props.token, method: next ? "PUT" : "DELETE" });
    emit("updated", { ...props.post, ...result });
  } catch (cause) {
    emit("updated", { ...props.post, likedByViewer: !next, likeCount: props.post.likeCount });
    error.value = cause instanceof Error ? cause.message : "暂时无法点亮";
  } finally {
    liking.value = false;
  }
}

async function togglePin() {
  menuOpen.value = false;
  if (!props.token) return;
  busy.value = true;
  error.value = "";
  try {
    const updated = await apiRequest<Post>(`/api/me/posts/${encodeURIComponent(props.post.id)}`, { token: props.token, method: "PATCH", json: { version: props.post.version, isPinned: !props.post.isPinned }, fallback: "置顶失败" });
    emit("updated", updated);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "置顶失败";
  } finally {
    busy.value = false;
  }
}

async function remove() {
  menuOpen.value = false;
  if (!props.token || !window.confirm("删除这条动态？图片会一起删除，且无法恢复。")) return;
  busy.value = true;
  error.value = "";
  try {
    await apiRequest(`/api/me/posts/${encodeURIComponent(props.post.id)}`, { token: props.token, method: "DELETE", fallback: "删除失败" });
    emit("deleted", props.post.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除失败";
    busy.value = false;
  }
}

function onSaved(post: Post) {
  editing.value = false;
  emit("updated", post);
}

function onOutside(event: PointerEvent) {
  if (menuOpen.value && menuRef.value && !menuRef.value.contains(event.target as Node)) menuOpen.value = false;
}
onMounted(() => window.addEventListener("pointerdown", onOutside));
onUnmounted(() => window.removeEventListener("pointerdown", onOutside));
</script>

<template>
  <article class="post-card" :class="{ pinned: post.isPinned, busy }">
    <header class="post-head">
      <StarAvatar :name="author.name" :avatar-url="author.avatarUrl" :tone="tone" size="sm" />
      <div class="post-meta">
        <strong>{{ author.name }}</strong>
        <span>
          <b class="post-kind" :class="{ experience: isExperience }">{{ isExperience ? "经验分享" : "随手记" }}</b>
          <time :datetime="post.createdAt" :title="fullTime(post.createdAt)">{{ relativeTime(post.createdAt) }}</time>
          <template v-if="edited"> · 已编辑</template>
          · <span class="post-visibility" :title="post.visibility === 'public' ? '所有人可见' : '仅登录成员可见'">{{ post.visibility === "public" ? "公开" : "仅成员" }}</span>
        </span>
      </div>
      <span v-if="post.isPinned" class="post-pin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.4 4.4 3.9 7.9 8.3 8.3-4.4.4-7.9 3.9-8.3 8.3-.4-4.4-3.9-7.9-8.3-8.3 4.4-.4 7.9-3.9 8.3-8.3Z" /></svg>置顶</span>
      <div v-if="isOwner && !editing" ref="menuRef" class="post-menu">
        <button class="post-menu-trigger" type="button" aria-label="动态操作" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="post-menu-list" role="menu">
          <button type="button" role="menuitem" @click="togglePin">{{ post.isPinned ? "取消置顶" : "置顶到主页" }}</button>
          <button type="button" role="menuitem" @click="startEdit">编辑</button>
          <button type="button" role="menuitem" class="danger" @click="remove">删除</button>
        </div>
      </div>
    </header>

    <PostComposer v-if="editing && token" :token="token" :post="post" @saved="onSaved" @cancel="editing = false" />
    <a v-else-if="isExperience" class="article-teaser" :class="{ 'has-cover': cover }" :href="articlePath" @click.prevent="emit('navigate', articlePath)">
      <span class="teaser-copy">
        <h3 class="post-title">{{ post.title || "无标题经验" }}</h3>
        <span class="teaser-excerpt">{{ excerpt }}</span>
        <span class="teaser-meta">约 {{ readingMinutes(post.content) }} 分钟读完<template v-if="post.images.length"> · {{ post.images.length }} 张图</template><b>阅读全文 →</b></span>
      </span>
      <span v-if="cover" class="teaser-cover"><AuthImage :src="cover.url" :token="token" :is-public="post.visibility === 'public'" alt="文章封面" /></span>
    </a>
    <template v-else>
      <h3 v-if="post.title" class="post-title">{{ post.title }}</h3>
      <p class="post-text" :class="{ clamped: longText && !expandedText }"><template v-for="(piece, index) in tokens" :key="index"><a v-if="piece.href" :href="piece.href" target="_blank" rel="noopener noreferrer nofollow">{{ piece.text }}</a><template v-else>{{ piece.text }}</template></template></p>
      <button v-if="longText" class="post-more" type="button" @click="expandedText = !expandedText">{{ expandedText ? "收起" : "展开全文" }}</button>
      <div v-if="post.images.length" class="post-images" :class="`layout-${imageLayout}`">
        <button v-for="(image, index) in post.images" :key="image.id" class="post-image" type="button" :aria-label="`查看第 ${index + 1} 张图片`" @click="emit('openImage', index)">
          <AuthImage :src="image.url" :token="token" :is-public="post.visibility === 'public'" fit="contain" :alt="`${author.name}的动态图片`" />
        </button>
      </div>
    </template>

    <footer v-if="!editing" class="post-foot">
      <button class="post-like" :class="{ liked: post.likedByViewer }" type="button" :aria-pressed="post.likedByViewer" :disabled="liking" @click="toggleLike">
        <span class="post-like-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 2.5c.4 4.4 3.9 7.9 8.3 8.3-4.4.4-7.9 3.9-8.3 8.3-.4-4.4-3.9-7.9-8.3-8.3 4.4-.4 7.9-3.9 8.3-8.3Z" /></svg>
          <i v-if="sparkKey" :key="sparkKey" class="post-like-burst"></i>
        </span>
        {{ post.likedByViewer ? "已点亮" : "点亮" }}<b v-if="post.likeCount">{{ post.likeCount }}</b>
      </button>
      <p v-if="error" class="post-error" role="alert">{{ error }}</p>
    </footer>
  </article>
</template>

<style scoped>
.post-card { position: relative; display: grid; gap: 14px; padding: 20px clamp(16px, 2.6vw, 24px) 14px; border: 1px solid var(--line); border-radius: 20px; background: linear-gradient(160deg, rgba(16, 30, 58, .62), rgba(7, 12, 27, .66)); backdrop-filter: blur(12px); transition: border-color .3s, opacity .3s; animation: post-in .5s var(--ease-out) backwards; }
.post-card:hover { border-color: rgba(142, 217, 208, .26); }
.post-card.pinned { border-color: rgba(231, 201, 130, .32); background: linear-gradient(160deg, rgba(40, 38, 50, .55), rgba(10, 14, 28, .7)); }
.post-card.pinned::before { content: ""; position: absolute; top: 0; left: 24px; right: 24px; height: 1px; background: linear-gradient(90deg, transparent, rgba(231, 201, 130, .7), transparent); }
.post-card.busy { opacity: .6; pointer-events: none; }
.post-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.post-head :deep(.star-avatar) { --s: 38px; }
.post-head :deep(.star-avatar-ring) { inset: -5px; }
.post-meta { display: grid; gap: 2px; min-width: 0; flex: 1; }
.post-meta strong { overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 500; letter-spacing: .06em; text-overflow: ellipsis; white-space: nowrap; }
.post-meta > span { color: var(--muted); font-size: 11.5px; }
.post-kind { display: inline-flex; margin-right: 7px; padding: 1px 6px; border-radius: 4px; background: rgba(142, 217, 208, .1); color: var(--aqua); font-size: 10px; font-weight: 500; letter-spacing: .06em; }
.article-teaser { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding: 14px 16px; border: 1px solid rgba(231, 201, 130, .18); border-radius: 16px; background: rgba(3, 8, 20, .32); color: inherit; text-decoration: none; transition: border-color .25s, background .25s; }
.article-teaser.has-cover { grid-template-columns: minmax(0, 1fr) 168px; }
.article-teaser:hover { border-color: rgba(231, 201, 130, .45); background: rgba(231, 201, 130, .05); }
.article-teaser:hover .post-title { color: var(--gold); }
.teaser-copy { display: grid; align-content: start; gap: 8px; min-width: 0; }
.teaser-copy .post-title { margin: 0; transition: color .2s; }
.teaser-excerpt { display: -webkit-box; overflow: hidden; color: var(--ink-soft); font-size: 13.5px; line-height: 1.8; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.teaser-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--muted); font-size: 12px; }
.teaser-meta b { margin-left: auto; color: var(--gold); font-weight: 500; }
.teaser-cover { aspect-ratio: 4 / 3; overflow: hidden; border-radius: 12px; background: rgba(3, 8, 20, .6); }
@media (max-width: 560px) { .article-teaser.has-cover { grid-template-columns: minmax(0, 1fr); } .teaser-cover { order: -1; aspect-ratio: 16 / 9; } }
.post-kind.experience { background: rgba(231, 201, 130, .12); color: var(--gold); }
.post-pin { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border: 1px solid rgba(231, 201, 130, .4); border-radius: 999px; color: var(--gold); font-size: 11px; letter-spacing: .1em; }
.post-pin svg { width: 11px; height: 11px; fill: currentColor; }
.post-menu { position: relative; }
.post-menu-trigger { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ink-soft); font-size: 18px; letter-spacing: 1px; }
.post-menu-trigger:hover, .post-menu-trigger[aria-expanded="true"] { background: rgba(145, 177, 210, .12); color: var(--ink); }
.post-menu-list { position: absolute; top: 38px; right: 0; z-index: 5; display: grid; min-width: 132px; padding: 6px; border: 1px solid var(--glass-border); border-radius: 12px; background: rgba(10, 18, 38, .96); box-shadow: 0 18px 40px rgba(0, 0, 0, .45); animation: post-in .18s ease-out; }
.post-menu-list button { padding: 9px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-soft); font-size: 13px; text-align: left; }
.post-menu-list button:hover { background: rgba(142, 217, 208, .1); color: var(--ink); }
.post-menu-list button.danger { color: #ffb4a8; }
.post-title { margin: 0; font-family: var(--serif); font-size: 19px; font-weight: 400; letter-spacing: .05em; line-height: 1.5; }
.post-text { margin: 0; color: var(--ink); font-size: 14.5px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.post-text.clamped { display: -webkit-box; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden; }
.post-text a { color: var(--aqua); text-decoration: underline; text-decoration-color: rgba(142, 217, 208, .4); text-underline-offset: 3px; }
.post-more { justify-self: start; margin-top: -6px; padding: 0; border: 0; background: none; color: var(--gold); font-size: 12.5px; }
.post-images { display: grid; gap: 6px; overflow: hidden; width: 100%; border-radius: 14px; }
.post-images.layout-single { grid-template-columns: minmax(0, 1fr); max-width: 620px; }
.post-images.layout-single .post-image { min-height: 160px; max-height: 680px; }
.post-images.layout-single .post-image :deep(.auth-image) { width: auto; max-width: 100%; height: auto; max-height: 680px; margin: 0 auto; object-fit: contain; }
.post-images.layout-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 520px; }
.post-images.layout-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 560px; }
.post-images.layout-many { grid-template-columns: repeat(4, minmax(0, 1fr)); max-width: 640px; }
.post-image { aspect-ratio: 1; min-width: 0; padding: 0; overflow: hidden; border: 0; background: rgba(3, 8, 20, .72); }
.post-image :deep(.auth-image) { transition: filter .3s; }
.post-image:hover :deep(.auth-image) { filter: brightness(1.08); }
.post-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding-top: 10px; border-top: 1px solid rgba(145, 177, 210, .1); }
.post-like { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 5px 13px 5px 10px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: var(--ink-soft); font-size: 12.5px; transition: background .2s, color .2s, border-color .2s; }
.post-like:hover:not(:disabled) { background: rgba(231, 201, 130, .08); color: var(--gold); }
.post-like:disabled { cursor: progress; opacity: 1; }
.post-like.liked { border-color: rgba(231, 201, 130, .35); background: rgba(231, 201, 130, .1); color: var(--gold); }
.post-like b { font-weight: 500; font-variant-numeric: tabular-nums; }
.post-like-icon { position: relative; display: grid; place-items: center; width: 18px; height: 18px; }
.post-like-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; transition: transform .35s var(--ease-out); }
.post-like.liked .post-like-icon svg { fill: currentColor; filter: drop-shadow(0 0 6px rgba(231, 201, 130, .8)); transform: rotate(45deg) scale(1.08); }
.post-like-burst { position: absolute; inset: -9px; border-radius: 50%; border: 1px solid rgba(231, 201, 130, .8); animation: like-burst .6s ease-out forwards; pointer-events: none; }
.post-error { margin: 0; color: #ffcfc4; font-size: 12px; }
@keyframes post-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes like-burst { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.6); } }
@media (max-width: 560px) { .post-images.layout-many { grid-template-columns: repeat(3, minmax(0, 1fr)); } .post-images.layout-single .post-image { min-height: 120px; } }
</style>
