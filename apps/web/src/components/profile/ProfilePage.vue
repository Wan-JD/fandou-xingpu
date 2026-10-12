<script setup lang="ts">
// A member's personal starfield: blog-style home with posts, story, gallery and lineage.
import { computed, onUnmounted, ref, watch } from "vue";
import { formatJoinedSeason, zodiacForBirthday } from "@fandou-xingpu/shared";
import AuthImage from "../AuthImage.vue";
import ImageLightbox, { type LightboxImage } from "../ImageLightbox.vue";
import StarAvatar from "../StarAvatar.vue";
import PostCard from "./PostCard.vue";
import PostComposer from "./PostComposer.vue";
import MembershipEditor from "./MembershipEditor.vue";
import ProfileEditor from "./ProfileEditor.vue";
import ZodiacConstellation from "./ZodiacConstellation.vue";
import { ApiError, apiRequest, authHeaders, copyText, openProtectedFile } from "../../lib/api";
import { fileSize, linkify, occurredLabel } from "../../lib/format";
import {
  destinationClass, destinationEligible, destinationLabel, formatCohort, groupRoleClass, groupRoleLabels, membershipLabel, normaliseNode, relationLabel, toneFor,
  type Attachment, type Person, type PersonSummary, type Post, type SessionUser, type Tone,
} from "../../lib/people";

type Tab = "posts" | "story" | "gallery";
const props = defineProps<{ personId: string; people: Person[]; rootPersonId: string | null; sessionToken: string | null; sessionUser: SessionUser | null }>();
const emit = defineEmits<{
  navigate: [path: string, origin?: DOMRect | null, tone?: Tone];
  personUpdated: [person: Person];
  requireAuth: [];
  sessionExpired: [];
}>();

const detail = ref<Person | null>(null);
const loading = ref(false);
const error = ref("");
const tab = ref<Tab>("posts");
const posts = ref<Post[]>([]);
const postsLoading = ref(false);
const postsError = ref("");
const postsHasMore = ref(false);
const editorOpen = ref(false);
const draftCount = ref(0);
const membershipEditorOpen = ref(false);
const editorSection = ref<"basic" | "story" | "skills" | "files" | "records">("basic");
const bioExpanded = ref(false);
const copied = ref(false);
const fileBusy = ref("");
const fileError = ref("");
const lightbox = ref<{ images: LightboxImage[]; start: number } | null>(null);
let detailRequest = 0;
let postsRequest = 0;

const local = computed(() => props.people.find((person) => person.id === props.personId) ?? null);
const person = computed(() => detail.value ?? local.value);
const isOwn = computed(() => Boolean(person.value && props.sessionUser?.personId === person.value.id));
const signedIn = computed(() => Boolean(props.sessionToken && props.sessionUser));
const tone = computed<Tone>(() => person.value ? toneFor(person.value, props.rootPersonId) : "aqua");
const theme = computed(() => person.value?.coverTheme ?? (tone.value === "gold" ? "dawn" : tone.value === "fog" ? "abyss" : "nebula"));
const summaryTone = (summary: PersonSummary) => toneFor(summary, props.rootPersonId);
const mentor = computed(() => person.value?.mentor ?? (person.value?.mentorId ? props.people.find((item) => item.id === person.value?.mentorId) ?? null : null));
const lineagePath = computed<PersonSummary[]>(() => {
  if (person.value?.lineagePath) return person.value.lineagePath;
  const chain: PersonSummary[] = [];
  const seen = new Set<string>([props.personId]);
  let cursor = mentor.value ? props.people.find((item) => item.id === mentor.value?.id) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.mentorId ? props.people.find((item) => item.id === cursor?.mentorId) : undefined;
  }
  return chain;
});
const students = computed<PersonSummary[]>(() => person.value?.students ?? props.people.filter((item) => item.mentorId === props.personId));
const peers = computed<PersonSummary[]>(() => person.value?.cohortPeers ?? (person.value?.cohort?.year ? props.people.filter((item) => item.id !== props.personId && item.cohort?.year === person.value?.cohort?.year).slice(0, 12) : []));
const generation = computed(() => lineagePath.value.length + 1);
const achievements = computed(() => person.value?.achievements ?? []);
const attachments = computed(() => person.value?.attachments ?? []);
const photos = computed(() => attachments.value.filter((item) => item.category === "photo"));
const documents = computed(() => attachments.value.filter((item) => item.category === "resume" || item.category === "certificate" || item.category === "other"));
const bioTokens = computed(() => linkify(person.value?.bio ?? ""));
const bioLong = computed(() => (person.value?.bio ?? "").length > 220);
const postCount = computed(() => person.value?.postCount ?? posts.value.length);
const hasStory = computed(() => Boolean(person.value?.education || person.value?.experience || achievements.value.length));
const zodiac = computed(() => zodiacForBirthday(person.value?.birthday));
const canManageMembership = computed(() => Boolean(props.sessionToken && person.value && !isOwn.value && (person.value.permissions?.canEditMemberType || person.value.permissions?.canEditGroupRole)));
const joinedLabel = computed(() => {
  if (!person.value) return "—";
  try {
    if (person.value.joinedYear && person.value.joinedSeason) return formatJoinedSeason({ joinedYear: person.value.joinedYear, joinedSeason: person.value.joinedSeason });
    return person.value.joinedAt ? formatJoinedSeason(person.value.joinedAt) : "—";
  } catch { return "—"; }
});
const stats = computed(() => [
  { label: "动态", value: postCount.value, tab: "posts" as Tab },
  { label: "徒弟", value: students.value.length },
  { label: "后辈", value: person.value?.descendantCount ?? students.value.length },
  { label: "事迹荣誉", value: signedIn.value ? achievements.value.length : "—", tab: "story" as Tab },
]);

function handleError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.status === 401) emit("sessionExpired");
  return cause instanceof Error ? cause.message : fallback;
}

async function loadDetail() {
  const id = props.personId;
  const request = ++detailRequest;
  loading.value = true;
  error.value = "";
  try {
    const response = await fetch(`/api/people/${encodeURIComponent(id)}`, { headers: authHeaders(props.sessionToken) });
    if (!response.ok) throw new Error(response.status === 404 ? "档案不存在" : "档案暂时无法读取");
    const payload = await response.json() as { data?: Record<string, unknown> };
    if (!payload.data) throw new Error("档案数据为空");
    if (request !== detailRequest) return;
    detail.value = normaliseNode({ ...payload.data, id });
    document.title = `${detail.value.name} · 翻斗星谱`;
  } catch (cause) {
    if (request === detailRequest) error.value = cause instanceof Error ? cause.message : "档案暂时无法读取";
  } finally {
    if (request === detailRequest) loading.value = false;
  }
}

async function loadPosts(append = false) {
  const request = ++postsRequest;
  postsLoading.value = true;
  postsError.value = "";
  try {
    const offset = append ? posts.value.length : 0;
    const response = await fetch(`/api/people/${encodeURIComponent(props.personId)}/posts?offset=${offset}&limit=10`, { headers: authHeaders(props.sessionToken) });
    if (!response.ok) throw new Error("动态暂时无法读取");
    const payload = await response.json() as { data?: Post[]; meta?: { hasMore?: boolean } };
    if (request !== postsRequest) return;
    posts.value = append ? [...posts.value, ...(payload.data ?? [])] : payload.data ?? [];
    postsHasMore.value = Boolean(payload.meta?.hasMore);
  } catch (cause) {
    if (request === postsRequest) postsError.value = cause instanceof Error ? cause.message : "动态暂时无法读取";
  } finally {
    if (request === postsRequest) postsLoading.value = false;
  }
}

async function loadDraftCount() {
  draftCount.value = 0;
  if (props.sessionUser?.personId !== props.personId || !props.sessionToken) return;
  try {
    const drafts = await apiRequest<Post[]>("/api/me/posts/drafts", { token: props.sessionToken });
    draftCount.value = drafts.filter((item) => item.kind === "experience").length;
  } catch { /* the drafts link is optional */ }
}
function resetForPerson() {
  detail.value = null;
  posts.value = [];
  postsHasMore.value = false;
  tab.value = "posts";
  bioExpanded.value = false;
  editorOpen.value = false;
  membershipEditorOpen.value = false;
  lightbox.value = null;
  fileError.value = "";
  void loadDetail();
  void loadPosts();
  void loadDraftCount();
}

watch(() => props.personId, resetForPerson, { immediate: true });
watch(() => props.sessionToken, () => { void loadDetail(); void loadPosts(); void loadDraftCount(); });
onUnmounted(() => { document.title = "翻斗星谱"; });

function onPostSaved(post: Post) {
  const rest = posts.value.filter((item) => item.id !== post.id);
  const pinnedCount = rest.filter((item) => item.isPinned).length;
  posts.value = [...rest.slice(0, pinnedCount), post, ...rest.slice(pinnedCount)];
  if (detail.value) detail.value = { ...detail.value, postCount: (detail.value.postCount ?? 0) + 1 };
}
function onPostUpdated(post: Post) {
  if (post.isPinned && !posts.value.find((item) => item.id === post.id)?.isPinned) {
    // Pinning is exclusive on the server; mirror it and float the post to the top.
    posts.value = [post, ...posts.value.filter((item) => item.id !== post.id).map((item) => ({ ...item, isPinned: false }))];
    return;
  }
  const wasPinned = posts.value.find((item) => item.id === post.id)?.isPinned;
  posts.value = posts.value.map((item) => item.id === post.id ? post : item);
  if (wasPinned && !post.isPinned) void loadPosts();
}
function onPostDeleted(id: string) {
  posts.value = posts.value.filter((item) => item.id !== id);
  if (detail.value) detail.value = { ...detail.value, postCount: Math.max(0, (detail.value.postCount ?? 1) - 1) };
}
function openPostImage(post: Post, index: number) {
  lightbox.value = { start: index, images: post.images.map((image) => ({ key: image.id, src: image.url, isPublic: post.visibility === "public" })) };
}
function openPhoto(index: number) {
  lightbox.value = { start: index, images: photos.value.map((item) => ({ key: item.id, src: `/api/attachments/${item.id}`, isPublic: false, caption: item.originalName })) };
}

function openEditor(section: typeof editorSection.value = "basic") {
  editorSection.value = section;
  editorOpen.value = true;
}
function onProfileSaved(data: Record<string, unknown>) {
  if (!person.value) return;
  const updated = normaliseNode({ ...person.value, ...data, id: person.value.id });
  detail.value = updated;
  emit("personUpdated", updated);
}
function onMembershipSaved(data: Record<string, unknown>) {
  onProfileSaved(data);
}
async function onEditorChanged() {
  await loadDetail();
  if (detail.value) emit("personUpdated", detail.value);
}

async function openFile(item: Attachment, download = false) {
  fileBusy.value = item.id;
  fileError.value = "";
  try { await openProtectedFile(item.id, item.originalName, props.sessionToken, download); }
  catch (cause) { fileError.value = handleError(cause, "附件暂时无法读取"); }
  finally { fileBusy.value = ""; }
}

function visit(summary: PersonSummary, event: Event) {
  const avatar = (event.currentTarget as HTMLElement | null)?.querySelector(".star-avatar-core") ?? event.currentTarget as HTMLElement | null;
  emit("navigate", `/person/${encodeURIComponent(summary.id)}`, avatar?.getBoundingClientRect() ?? null, summaryTone(summary));
}
async function copyLink() {
  copied.value = await copyText(window.location.href);
  window.setTimeout(() => { copied.value = false; }, 2000);
}
function selectTab(next: Tab) {
  tab.value = next;
  document.getElementById("profile-tabs")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
</script>

<template>
  <div class="profile" :class="[`theme-${theme}`, destinationClass({ destination: person && destinationEligible(person) ? person.destination : null })]">
    <div class="profile-topbar">
      <button class="back-link" type="button" @click="emit('navigate', '/')">← 返回星谱</button>
      <div v-if="person" class="profile-topbar-actions">
        <button class="ghost-pill" type="button" @click="emit('navigate', `/?focus=${encodeURIComponent(person.id)}`)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>在星谱中定位
        </button>
        <button class="ghost-pill" type="button" @click="copyLink">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>{{ copied ? "已复制链接" : "复制主页链接" }}
        </button>
      </div>
    </div>

    <template v-if="person">
      <section class="profile-hero">
        <div class="profile-cover">
          <div class="cover-nebula"></div>
          <ZodiacConstellation v-if="zodiac" :zodiac="zodiac" :owner-name="person.name" />
          <div v-else class="zodiac-empty">
            <span aria-hidden="true">✦</span>
            <div><strong>生日待完善</strong><small>补充生日后，这里会点亮专属星座图</small></div>
            <button v-if="isOwn" type="button" @click="openEditor('basic')">去完善</button>
          </div>
          <span class="cover-caption">{{ formatCohort(person.cohort) }} · PERSONAL STARFIELD</span>
        </div>

        <div class="profile-identity">
          <div class="identity-avatar" :class="groupRoleClass(person)">
            <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="tone" size="xl" />
            <span v-if="person.groupRole" class="identity-crest" :title="groupRoleLabels[person.groupRole]">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18 4.5 7l5 4.5L12 4l2.5 7.5 5-4.5L21 18Z" /></svg>
            </span>
          </div>
          <div class="identity-main">
            <p class="identity-eyebrow">PERSONAL STARFIELD<span>第 {{ generation }} 代 · {{ formatCohort(person.cohort) }}</span></p>
            <h1>{{ person.name }}<span v-if="person.groupRole" class="role-badge" :class="groupRoleClass(person)">{{ formatCohort(person.cohort) }}{{ groupRoleLabels[person.groupRole] }}</span></h1>
            <p v-if="person.motto" class="identity-motto">{{ person.motto }}</p>
            <p v-else-if="isOwn" class="identity-motto placeholder"><button type="button" @click="openEditor('basic')">写一句个性签名</button></p>
            <div class="identity-chips">
              <span class="chip-status" :class="{ graduated: person.status === 'archived' }"><i></i>{{ relationLabel(person) }}</span>
              <span v-if="person.memberType" class="chip-soft" :class="`membership-${person.memberType}`">{{ membershipLabel(person) }}</span>
              <span v-if="person.destination && destinationEligible(person)" class="destination-badge">去向 · {{ destinationLabel(person) }}</span>
              <span v-if="person.role && person.role !== '星谱成员'" class="chip-soft">{{ person.role }}</span>
              <span v-for="tag in person.tags" :key="tag" class="chip-soft tag-chip">{{ tag }}</span>
            </div>
          </div>
          <div class="identity-actions">
            <template v-if="isOwn">
              <button class="primary-command" type="button" @click="openEditor()">编辑主页</button>
              <button class="secondary-command" type="button" @click="emit('navigate', '/students')">徒弟管理</button>
            </template>
            <template v-else>
              <button v-if="canManageMembership" class="primary-command" type="button" @click="membershipEditorOpen = true">设置成员身份</button>
              <a v-if="person.contactEmail" class="secondary-command as-link" :href="`mailto:${person.contactEmail}`">写信给 TA</a>
            </template>
          </div>
          <div class="identity-stats">
            <component :is="item.tab ? 'button' : 'div'" v-for="item in stats" :key="item.label" class="stat" :type="item.tab ? 'button' : undefined" @click="item.tab && selectTab(item.tab)">
              <strong>{{ item.value }}</strong><span>{{ item.label }}</span>
            </component>
            <div class="stat"><strong class="small">{{ joinedLabel }}</strong><span>进组时间</span></div>
          </div>
        </div>
      </section>

      <p v-if="error" class="profile-alert" role="status">{{ error }}，当前显示的是星谱中的摘要。<button type="button" @click="loadDetail">重试</button></p>

      <div class="profile-grid">
        <aside class="profile-aside primary">
          <article class="side-card">
            <header><span class="section-label">ABOUT</span><h2>简介</h2></header>
            <p v-if="person.bio" class="side-bio" :class="{ clamped: bioLong && !bioExpanded }"><template v-for="(piece, index) in bioTokens" :key="index"><a v-if="piece.href" :href="piece.href" target="_blank" rel="noopener noreferrer nofollow">{{ piece.text }}</a><template v-else>{{ piece.text }}</template></template></p>
            <button v-if="bioLong" class="text-link" type="button" @click="bioExpanded = !bioExpanded">{{ bioExpanded ? "收起" : "展开全部" }}</button>
            <p v-if="!person.bio" class="side-empty">这颗星还在积攒星尘，简介稍后回来。<button v-if="isOwn" class="text-link" type="button" @click="openEditor('basic')">去填写</button></p>
          </article>
          <article v-if="person.skills?.length || isOwn" class="side-card">
            <header><span class="section-label">SKILLS</span><h2>技能星点</h2></header>
            <div v-if="person.skills?.length" class="skill-cloud"><span v-for="(skill, index) in person.skills" :key="skill" class="skill" :style="{ '--i': index }">{{ skill }}</span></div>
            <p v-else class="side-empty">还没有技能标签。<button class="text-link" type="button" @click="openEditor('skills')">添加</button></p>
          </article>
          <article v-if="person.links?.length || person.contactEmail" class="side-card">
            <header><span class="section-label">ELSEWHERE</span><h2>链接与联系</h2></header>
            <ul class="link-list">
              <li v-if="person.contactEmail"><a :href="`mailto:${person.contactEmail}`"><span class="link-glyph" aria-hidden="true">@</span><span><strong>邮箱</strong><small>{{ person.contactEmail }}</small></span></a></li>
              <li v-for="link in person.links" :key="link.url"><a :href="link.url" target="_blank" rel="noopener noreferrer nofollow"><span class="link-glyph" aria-hidden="true">↗</span><span><strong>{{ link.label }}</strong><small>{{ link.url.replace(/^https?:\/\//, "") }}</small></span></a></li>
            </ul>
          </article>
        </aside>

        <main class="profile-main">
          <nav id="profile-tabs" class="profile-tabs" aria-label="主页内容">
            <button type="button" :class="{ active: tab === 'posts' }" :aria-current="tab === 'posts' ? 'page' : undefined" @click="tab = 'posts'">动态<small>{{ postCount }}</small></button>
            <button type="button" :class="{ active: tab === 'story' }" :aria-current="tab === 'story' ? 'page' : undefined" @click="tab = 'story'">履历</button>
            <button type="button" :class="{ active: tab === 'gallery' }" :aria-current="tab === 'gallery' ? 'page' : undefined" @click="tab = 'gallery'">相册与资料<small v-if="signedIn && attachments.length">{{ attachments.length }}</small></button>
          </nav>

          <section v-if="tab === 'posts'" class="tab-panel" aria-label="动态">
            <div v-if="isOwn && sessionToken" class="composer-card">
              <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="tone" size="sm" />
              <div class="composer-stack">
                <PostComposer :token="sessionToken" @saved="onPostSaved" @write-article="emit('navigate', '/write')" />
                <button v-if="draftCount" class="drafts-link" type="button" @click="emit('navigate', '/write?drafts=1')">草稿箱 · {{ draftCount }} 篇未发布</button>
              </div>
            </div>
            <div class="post-list">
              <PostCard
                v-for="post in posts"
                :key="post.id"
                :post="post"
                :author="person"
                :tone="tone"
                :token="sessionToken"
                :is-owner="isOwn"
                @updated="onPostUpdated"
                @deleted="onPostDeleted"
                @open-image="openPostImage(post, $event)"
                @require-auth="emit('requireAuth')"
                @navigate="emit('navigate', $event)"
              />
            </div>
            <div v-if="postsLoading && !posts.length" class="post-skeletons" aria-label="动态加载中"><span v-for="index in 2" :key="index"></span></div>
            <p v-if="postsError" class="profile-alert" role="alert">{{ postsError }} <button type="button" @click="loadPosts()">重试</button></p>
            <div v-if="!postsLoading && !postsError && !posts.length" class="empty-orbit">
              <span class="empty-star" aria-hidden="true">✦</span>
              <p v-if="isOwn">写下第一条动态吧。它只会出现在你的主页上，可以选择公开或仅成员可见。</p>
              <p v-else>{{ person.name }} 还没有公开的动态。<template v-if="!signedIn">登录后可以看到仅成员可见的内容。</template></p>
            </div>
            <button v-if="postsHasMore" class="load-more" type="button" :disabled="postsLoading" @click="loadPosts(true)">{{ postsLoading ? "加载中…" : "加载更早的动态" }}</button>
          </section>

          <section v-else-if="tab === 'story'" class="tab-panel story" aria-label="履历">
            <div v-if="person.education || person.experience" class="story-grid">
              <article v-if="person.education" class="story-card"><span class="section-label">EDUCATION</span><h3>教育经历</h3><p>{{ person.education }}</p></article>
              <article v-if="person.experience" class="story-card"><span class="section-label">EXPERIENCE</span><h3>工作与项目</h3><p>{{ person.experience }}</p></article>
            </div>
            <article class="story-card timeline-card">
              <header class="timeline-head">
                <div><span class="section-label">MILESTONES</span><h3>事迹与荣誉</h3></div>
                <button v-if="isOwn" class="ghost-pill" type="button" @click="openEditor('records')">＋ 添加记录</button>
              </header>
              <ol v-if="achievements.length" class="timeline">
                <li v-for="item in achievements" :key="item.id" :class="item.kind">
                  <span class="timeline-dot" aria-hidden="true"></span>
                  <div class="timeline-body">
                    <p class="timeline-meta"><span class="timeline-kind">{{ item.kind === "honor" ? "荣誉" : "事迹" }}</span><time v-if="item.occurredOn">{{ occurredLabel(item.occurredOn) }}</time></p>
                    <h4>{{ item.title }}</h4>
                    <p>{{ item.content }}</p>
                  </div>
                </li>
              </ol>
              <p v-else-if="!signedIn" class="locked-note"><span aria-hidden="true">✧</span>事迹与荣誉仅对登录成员展示。<button class="text-link" type="button" @click="emit('requireAuth')">登录查看</button></p>
              <p v-else class="side-empty">{{ isOwn ? "还没有记录。获奖、项目、值得纪念的时刻，都可以留在这里。" : "暂时没有公开的事迹与荣誉。" }}</p>
            </article>
            <p v-if="!hasStory && !isOwn && signedIn" class="side-empty">履历还在整理中。</p>
            <p v-if="isOwn && !person.education && !person.experience" class="side-empty">补充教育与项目经历，让后来的人更了解你。<button class="text-link" type="button" @click="openEditor('story')">去填写</button></p>
          </section>

          <section v-else class="tab-panel gallery" aria-label="相册与资料">
            <template v-if="signedIn">
              <article class="story-card">
                <header class="timeline-head">
                  <div><span class="section-label">GALLERY</span><h3>相册</h3></div>
                  <button v-if="isOwn" class="ghost-pill" type="button" @click="openEditor('files')">管理相册</button>
                </header>
                <div v-if="photos.length" class="photo-wall">
                  <button v-for="(photo, index) in photos" :key="photo.id" class="photo-tile" type="button" :aria-label="`查看照片 ${photo.originalName}`" @click="openPhoto(index)">
                    <AuthImage :src="`/api/attachments/${photo.id}`" :token="sessionToken" :alt="photo.originalName" />
                  </button>
                </div>
                <p v-else class="side-empty">{{ isOwn ? "上传旅途、活动或作品照片，组成你的星光相册。" : "相册还空着。" }}</p>
              </article>
              <article class="story-card">
                <header class="timeline-head"><div><span class="section-label">DOCUMENTS</span><h3>简历与证明</h3></div></header>
                <ul v-if="documents.length" class="doc-list">
                  <li v-for="item in documents" :key="item.id">
                    <span class="doc-icon" :class="item.category" aria-hidden="true">{{ item.category === "resume" ? "简历" : item.mimeType === "application/pdf" ? "PDF" : "图片" }}</span>
                    <span class="doc-name"><strong>{{ item.originalName }}</strong><small>{{ item.category === "resume" ? "简历" : "证书 / 证明" }} · {{ fileSize(item.size) }} · {{ item.visibility === "private" ? "仅自己可见" : "成员可见" }}</small></span>
                    <span class="doc-actions">
                      <button class="text-link" type="button" :disabled="Boolean(fileBusy)" @click="openFile(item)">{{ fileBusy === item.id ? "处理中…" : "打开" }}</button>
                      <button class="text-link" type="button" :disabled="Boolean(fileBusy)" @click="openFile(item, true)">下载</button>
                    </span>
                  </li>
                </ul>
                <p v-else class="side-empty">{{ isOwn ? "可以上传 PDF 简历和证书，登录成员可以查看。" : "暂时没有公开的文件。" }}</p>
                <p v-if="fileError" class="form-error" role="alert">{{ fileError }}</p>
              </article>
            </template>
            <div v-else class="empty-orbit">
              <span class="empty-star" aria-hidden="true">✧</span>
              <p>相册、简历和证明材料仅对登录成员开放。</p>
              <button class="secondary-command" type="button" @click="emit('requireAuth')">登录查看</button>
            </div>
          </section>
        </main>

        <aside class="profile-aside secondary">
          <article class="side-card lineage-card">
            <header><span class="section-label">LINEAGE</span><h2>传承之路</h2></header>
            <ol class="lineage-path">
              <li v-for="ancestor in lineagePath" :key="ancestor.id">
                <button class="lineage-node" type="button" @click="visit(ancestor, $event)">
                  <StarAvatar :name="ancestor.name" :avatar-url="ancestor.avatarUrl" :tone="summaryTone(ancestor)" size="sm" />
                  <span><strong>{{ ancestor.name }}</strong><small>{{ ancestor.id === mentor?.id ? "师傅" : "师承" }} · {{ formatCohort(ancestor.cohort) }}</small></span>
                </button>
              </li>
              <li class="current">
                <div class="lineage-node">
                  <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="tone" size="sm" />
                  <span><strong>{{ person.name }}</strong><small>{{ lineagePath.length ? `第 ${generation} 代` : "星谱起点" }}</small></span>
                </div>
              </li>
            </ol>
            <div class="lineage-students">
              <p class="lineage-sub">徒弟 <b>{{ students.length }}</b><template v-if="(person.descendantCount ?? 0) > students.length"> · 后辈共 <b>{{ person.descendantCount }}</b></template></p>
              <div v-if="students.length" class="mini-stars">
                <button v-for="student in students" :key="student.id" class="mini-star" type="button" :title="`${student.name} · ${formatCohort(student.cohort)}`" @click="visit(student, $event)">
                  <StarAvatar :name="student.name" :avatar-url="student.avatarUrl" :tone="summaryTone(student)" size="sm" />
                  <span>{{ student.name }}</span>
                </button>
              </div>
              <p v-else class="side-empty">{{ isOwn ? "还没有徒弟。可以在徒弟管理中发出邀请。" : "这条轨迹还在延伸。" }}</p>
            </div>
          </article>
          <article v-if="peers.length" class="side-card">
            <header><span class="section-label">COHORT</span><h2>同级星友</h2></header>
            <div class="mini-stars peers">
              <button v-for="peer in peers" :key="peer.id" class="mini-star" type="button" :title="peer.name" @click="visit(peer, $event)">
                <StarAvatar :name="peer.name" :avatar-url="peer.avatarUrl" :tone="summaryTone(peer)" size="sm" />
                <span>{{ peer.name }}</span>
              </button>
            </div>
          </article>
        </aside>
      </div>
    </template>

    <div v-else class="profile-loading">
      <template v-if="loading"><span class="loading-ring"></span><span>正在展开这片星域</span></template>
      <template v-else><span>{{ error || "没有找到这份档案" }}</span><button type="button" class="secondary-command" @click="loadDetail">重试</button></template>
    </div>

    <Teleport to="body">
    <ProfileEditor
      v-if="editorOpen && person && isOwn && sessionToken"
      :person="person"
      :token="sessionToken"
      :tone="tone"
      :initial-section="editorSection"
      @close="editorOpen = false"
      @saved="onProfileSaved"
      @changed="onEditorChanged"
      @session-expired="emit('sessionExpired')"
    />
    <MembershipEditor
      v-if="membershipEditorOpen && person && canManageMembership && sessionToken"
      :person="person"
      :token="sessionToken"
      @close="membershipEditorOpen = false"
      @saved="onMembershipSaved"
      @session-expired="emit('sessionExpired')"
    />
    <ImageLightbox v-if="lightbox" :images="lightbox.images" :start="lightbox.start" :token="sessionToken" @close="lightbox = null" />
    </Teleport>
  </div>
</template>

<style src="./profile.css" scoped></style>
