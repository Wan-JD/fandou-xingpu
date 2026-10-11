<script setup lang="ts">
// Side drawer for the owner's profile: text fields save together, files and records save immediately.
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AuthImage from "../AuthImage.vue";
import StarAvatar from "../StarAvatar.vue";
import { ApiError, apiRequest } from "../../lib/api";
import { fileSize, occurredLabel } from "../../lib/format";
import { coverThemes, destinationLabels, groupRoleLabels, type Achievement, type Attachment, type CoverTheme, type Destination, type GroupRole, type MembershipType, type Person, type Tone, type UploadCategory } from "../../lib/people";

type Section = "basic" | "story" | "skills" | "files" | "records";
const props = defineProps<{ person: Person; token: string; tone: Tone; initialSection?: Section }>();
const emit = defineEmits<{ close: []; saved: [person: Record<string, unknown>]; changed: []; sessionExpired: [] }>();

const sections: Array<{ id: Section; label: string; hint: string }> = [
  { id: "basic", label: "基本资料", hint: "签名、简介与身份" },
  { id: "story", label: "履历", hint: "教育与经历" },
  { id: "skills", label: "技能与链接", hint: "标签与外部主页" },
  { id: "files", label: "头像与文件", hint: "头像、简历、相册" },
  { id: "records", label: "事迹与荣誉", hint: "时间线记录" },
];
const section = ref<Section>(props.initialSection ?? "basic");
const initial = () => ({
  motto: props.person.motto ?? "",
  bio: props.person.bio ?? "",
  coverTheme: (props.person.coverTheme ?? "nebula") as CoverTheme,
  destination: (props.person.destination ?? "") as Destination | "",
  memberType: (props.person.memberType ?? "") as MembershipType | "",
  groupRole: (props.person.groupRole ?? "") as GroupRole | "",
  contactEmail: props.person.contactEmail ?? "",
  education: props.person.education ?? "",
  experience: props.person.experience ?? "",
  skills: [...(props.person.skills ?? [])],
  links: (props.person.links ?? []).map((link) => ({ ...link })),
});
const form = ref(initial());
const snapshot = ref(JSON.stringify(form.value));
const dirty = computed(() => JSON.stringify(form.value) !== snapshot.value);
const skillDraft = ref("");
const saving = ref(false);
const saved = ref(false);
const error = ref("");
const conflict = ref(false);
const uploading = ref<UploadCategory | "">("");
const fileError = ref("");
const busyId = ref("");
const recordForm = ref({ id: "", version: 1, kind: "achievement" as Achievement["kind"], title: "", content: "", occurredOn: "" });
const recordSaving = ref(false);
const recordError = ref("");

const attachments = computed(() => props.person.attachments ?? []);
const filesOf = (category: UploadCategory) => attachments.value.filter((item) => item.category === category);
const records = computed(() => props.person.achievements ?? []);
const uploadCards: Array<{ category: Exclude<UploadCategory, "avatar">; title: string; description: string; accept: string; multiple: boolean }> = [
  { category: "resume", title: "简历", description: "一份 PDF，重新上传会替换旧版本。", accept: "application/pdf", multiple: false },
  { category: "photo", title: "相册照片", description: "旅途、活动或作品，JPG / PNG / WebP，单张 5 MB 内。", accept: "image/jpeg,image/png,image/webp", multiple: true },
  { category: "certificate", title: "证书与证明", description: "图片或 PDF，登录成员可查看。", accept: "image/jpeg,image/png,image/webp,application/pdf", multiple: true },
];

function handleError(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.status === 401) emit("sessionExpired");
  return cause instanceof Error ? cause.message : fallback;
}

function addSkill() {
  const values = skillDraft.value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
  for (const value of values) if (!form.value.skills.includes(value) && form.value.skills.length < 30) form.value.skills.push(value.slice(0, 80));
  skillDraft.value = "";
}
function onSkillKey(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addSkill(); }
  else if (event.key === "Backspace" && !skillDraft.value && form.value.skills.length) form.value.skills.pop();
}

async function saveProfile() {
  addSkill();
  saving.value = true;
  error.value = "";
  conflict.value = false;
  saved.value = false;
  try {
    const links = form.value.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label || link.url);
    if (links.some((link) => !link.label || !/^https?:\/\/\S+$/i.test(link.url))) throw new Error("链接需要填写名称，并以 http:// 或 https:// 开头");
    const data = await apiRequest<Record<string, unknown>>("/api/me/profile", {
      token: props.token, method: "PATCH", fallback: "资料保存失败",
      json: {
        version: props.person.version ?? 1,
        motto: form.value.motto.trim() || null,
        bio: form.value.bio.trim(),
        coverTheme: form.value.coverTheme,
        destination: form.value.destination || null,
        memberType: form.value.memberType || null,
        groupRole: form.value.groupRole || null,
        contactEmail: form.value.contactEmail.trim() || null,
        education: form.value.education.trim() || null,
        experience: form.value.experience.trim() || null,
        skills: form.value.skills,
        links,
      },
    });
    snapshot.value = JSON.stringify(form.value);
    saved.value = true;
    emit("saved", data);
  } catch (cause) {
    conflict.value = cause instanceof ApiError && cause.status === 409;
    error.value = conflict.value ? "资料已在别处更新。重新载入后再修改，可以避免覆盖新内容。" : handleError(cause, "资料保存失败");
  } finally {
    saving.value = false;
  }
}

let resetOnReload = false;
function reloadAfterConflict() {
  resetOnReload = true;
  conflict.value = false;
  error.value = "";
  emit("changed");
}
// A fresh copy of the profile replaces the form unless the member is midway through edits.
watch(() => props.person.version, () => {
  if (!dirty.value || resetOnReload) {
    form.value = initial();
    snapshot.value = JSON.stringify(form.value);
    resetOnReload = false;
  }
});

async function upload(event: Event, category: UploadCategory) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = "";
  if (!files.length) return;
  uploading.value = category;
  fileError.value = "";
  try {
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      body.append("category", category);
      body.append("visibility", "members");
      await apiRequest("/api/me/attachments", { token: props.token, form: body, fallback: "上传失败" });
    }
    emit("changed");
  } catch (cause) {
    fileError.value = handleError(cause, "上传失败");
    emit("changed");
  } finally {
    uploading.value = "";
  }
}

async function removeFile(item: Attachment) {
  if (!window.confirm(`删除「${item.originalName}」？`)) return;
  busyId.value = item.id;
  fileError.value = "";
  try {
    await apiRequest(`/api/me/attachments/${encodeURIComponent(item.id)}`, { token: props.token, method: "DELETE", fallback: "删除失败" });
    emit("changed");
  } catch (cause) {
    fileError.value = handleError(cause, "删除失败");
  } finally {
    busyId.value = "";
  }
}

async function removeAvatar() {
  const id = props.person.avatarUrl?.split("/").pop();
  if (!id || !window.confirm("移除当前头像？")) return;
  busyId.value = "avatar";
  try {
    await apiRequest(`/api/me/attachments/${encodeURIComponent(id)}`, { token: props.token, method: "DELETE", fallback: "删除失败" });
    emit("changed");
  } catch (cause) {
    fileError.value = handleError(cause, "删除失败");
  } finally {
    busyId.value = "";
  }
}

function editRecord(item: Achievement) {
  recordError.value = "";
  recordForm.value = { id: item.id, version: item.version, kind: item.kind, title: item.title, content: item.content, occurredOn: item.occurredOn ?? "" };
}
function resetRecord() {
  recordForm.value = { id: "", version: 1, kind: "achievement", title: "", content: "", occurredOn: "" };
  recordError.value = "";
}
async function saveRecord() {
  const value = recordForm.value;
  if (!value.title.trim() || !value.content.trim()) return;
  recordError.value = "";
  const occurredOn = value.occurredOn || null;
  if (occurredOn && !/^\d{4}(-\d{2}){0,2}$/.test(occurredOn)) { recordError.value = "时间请写成 2024、2024-05 或 2024-05-20"; return; }
  recordSaving.value = true;
  const datePrecision = occurredOn ? ({ 4: "year", 7: "month", 10: "day" } as Record<number, string>)[occurredOn.length] ?? null : null;
  try {
    if (value.id) {
      await apiRequest(`/api/me/achievements/${encodeURIComponent(value.id)}`, { token: props.token, method: "PATCH", fallback: "记录保存失败", json: { version: value.version, kind: value.kind, title: value.title.trim(), content: value.content.trim(), occurredOn, datePrecision } });
    } else {
      await apiRequest("/api/me/achievements", { token: props.token, fallback: "记录保存失败", json: { kind: value.kind, title: value.title.trim(), content: value.content.trim(), occurredOn, datePrecision } });
    }
    resetRecord();
    emit("changed");
  } catch (cause) {
    recordError.value = handleError(cause, "记录保存失败");
  } finally {
    recordSaving.value = false;
  }
}
async function removeRecord(item: Achievement) {
  if (!window.confirm(`删除「${item.title}」？`)) return;
  busyId.value = item.id;
  try {
    await apiRequest(`/api/me/achievements/${encodeURIComponent(item.id)}?version=${item.version}`, { token: props.token, method: "DELETE", fallback: "删除失败" });
    if (recordForm.value.id === item.id) resetRecord();
    emit("changed");
  } catch (cause) {
    recordError.value = handleError(cause, "删除失败");
  } finally {
    busyId.value = "";
  }
}

function requestClose() {
  if (saving.value) return;
  if (dirty.value && !window.confirm("还有未保存的资料修改，确定关闭吗？")) return;
  emit("close");
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.stopPropagation(); requestClose(); }
}
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault();
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("beforeunload", onBeforeUnload);
  document.body.style.overflow = "hidden";
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
  window.removeEventListener("beforeunload", onBeforeUnload);
  document.body.style.overflow = "";
});
</script>

<template>
  <div class="editor-backdrop" @click.self="requestClose">
    <aside class="editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <header class="editor-head">
        <div>
          <span class="section-label">EDIT PROFILE</span>
          <h2 id="editor-title">编辑我的主页</h2>
        </div>
        <button class="editor-close" type="button" aria-label="关闭编辑" @click="requestClose">×</button>
      </header>
      <nav class="editor-nav" aria-label="编辑分区">
        <button v-for="item in sections" :key="item.id" type="button" :class="{ active: section === item.id }" :aria-current="section === item.id ? 'true' : undefined" @click="section = item.id">
          <strong>{{ item.label }}</strong><small>{{ item.hint }}</small>
        </button>
      </nav>

      <div class="editor-body">
        <section v-show="section === 'basic'" class="editor-section">
          <label class="form-field"><span>个性签名</span><input v-model="form.motto" maxlength="120" placeholder="一句话介绍自己，会显示在名字下方" /><small class="field-count">{{ form.motto.length }}/120</small></label>
          <label class="form-field"><span>个人简介</span><textarea v-model="form.bio" maxlength="10000" rows="6" placeholder="可以写写你是谁、在做什么、想留下什么"></textarea></label>
          <fieldset class="theme-field">
            <legend>封面星云</legend>
            <div class="theme-options">
              <label v-for="theme in coverThemes" :key="theme.id" class="theme-option" :class="[`theme-${theme.id}`, { active: form.coverTheme === theme.id }]">
                <input v-model="form.coverTheme" class="visually-hidden" type="radio" name="cover-theme" :value="theme.id" />
                <span class="theme-swatch" aria-hidden="true"></span>{{ theme.label }}
              </label>
            </div>
          </fieldset>
          <div class="field-grid">
            <label class="form-field"><span>去向</span><select v-model="form.destination"><option value="">暂未填写</option><option v-for="(label, value) in destinationLabels" :key="value" :value="value">{{ label }}</option></select></label>
            <label class="form-field"><span>组员身份</span><select v-model="form.memberType"><option value="">暂未标记</option><option value="formal">正式组员</option><option value="probationary">预备组员</option></select></label>
            <label class="form-field"><span>组内职务</span><select v-model="form.groupRole"><option value="">无</option><option v-for="(label, value) in groupRoleLabels" :key="value" :value="value">{{ label }}</option></select></label>
          </div>
          <label class="form-field"><span>联系邮箱（所有访客可见）</span><input v-model="form.contactEmail" type="email" maxlength="254" placeholder="可留空" /></label>
        </section>

        <section v-show="section === 'story'" class="editor-section">
          <label class="form-field"><span>教育经历</span><textarea v-model="form.education" maxlength="10000" rows="6" placeholder="学校、专业、研究方向，每段经历可以另起一行"></textarea></label>
          <label class="form-field"><span>工作与项目经历</span><textarea v-model="form.experience" maxlength="20000" rows="9" placeholder="实习、工作、项目或作品"></textarea></label>
        </section>

        <section v-show="section === 'skills'" class="editor-section">
          <div class="form-field">
            <span>技能标签（回车添加，最多 30 个）</span>
            <div class="chip-input" @click="($event.currentTarget as HTMLElement).querySelector('input')?.focus()">
              <span v-for="(skill, index) in form.skills" :key="skill" class="chip">{{ skill }}<button type="button" :aria-label="`移除 ${skill}`" @click.stop="form.skills.splice(index, 1)">×</button></span>
              <input v-model="skillDraft" maxlength="80" :placeholder="form.skills.length ? '' : '例如：产品设计、TypeScript、写作'" aria-label="新增技能" @keydown="onSkillKey" @blur="addSkill" />
            </div>
          </div>
          <div class="form-field">
            <span>个人链接</span>
            <div class="link-rows">
              <div v-for="(link, index) in form.links" :key="index" class="link-row">
                <input v-model="link.label" maxlength="80" placeholder="名称，如 作品集" :aria-label="`第 ${index + 1} 个链接名称`" />
                <input v-model="link.url" maxlength="500" type="url" placeholder="https://" :aria-label="`第 ${index + 1} 个链接地址`" />
                <button type="button" :aria-label="`删除第 ${index + 1} 个链接`" @click="form.links.splice(index, 1)">×</button>
              </div>
              <button v-if="form.links.length < 20" class="ghost-add" type="button" @click="form.links.push({ label: '', url: '' })">＋ 添加链接</button>
            </div>
          </div>
        </section>

        <section v-show="section === 'files'" class="editor-section">
          <p class="editor-note">文件上传后立即保存，不需要点击下方的“保存资料”。</p>
          <div class="avatar-card">
            <StarAvatar :name="person.name" :avatar-url="person.avatarUrl" :tone="tone" size="lg" />
            <div>
              <h3>头像</h3>
              <p>用于星谱节点与主页，JPG / PNG / WebP，2 MB 内。</p>
              <div class="file-actions">
                <label class="upload-pill">{{ uploading === "avatar" ? "上传中…" : person.avatarUrl ? "更换头像" : "选择头像" }}<input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" :disabled="Boolean(uploading)" @change="upload($event, 'avatar')" /></label>
                <button v-if="person.avatarUrl" class="text-button danger" type="button" :disabled="busyId === 'avatar'" @click="removeAvatar">移除</button>
              </div>
            </div>
          </div>
          <article v-for="card in uploadCards" :key="card.category" class="file-card">
            <header>
              <div><h3>{{ card.title }}</h3><p>{{ card.description }}</p></div>
              <label class="upload-pill">{{ uploading === card.category ? "上传中…" : filesOf(card.category).length && !card.multiple ? "替换" : "上传" }}<input class="visually-hidden" type="file" :accept="card.accept" :multiple="card.multiple" :disabled="Boolean(uploading)" @change="upload($event, card.category)" /></label>
            </header>
            <div v-if="card.category === 'photo' && filesOf('photo').length" class="photo-grid">
              <figure v-for="item in filesOf('photo')" :key="item.id">
                <AuthImage :src="`/api/attachments/${item.id}`" :token="token" :alt="item.originalName" />
                <button type="button" :aria-label="`删除 ${item.originalName}`" :disabled="busyId === item.id" @click="removeFile(item)">×</button>
              </figure>
            </div>
            <ul v-else-if="filesOf(card.category).length" class="file-list">
              <li v-for="item in filesOf(card.category)" :key="item.id">
                <span class="file-icon" aria-hidden="true">{{ item.mimeType === "application/pdf" ? "PDF" : "IMG" }}</span>
                <span class="file-name">{{ item.originalName }}<small>{{ fileSize(item.size) }}</small></span>
                <button class="text-button danger" type="button" :disabled="busyId === item.id" @click="removeFile(item)">删除</button>
              </li>
            </ul>
            <p v-else class="file-empty">还没有上传</p>
          </article>
          <p v-if="fileError" class="form-error" role="alert">{{ fileError }}</p>
        </section>

        <section v-show="section === 'records'" class="editor-section">
          <form class="record-form" @submit.prevent="saveRecord">
            <h3>{{ recordForm.id ? "编辑记录" : "新增记录" }}</h3>
            <div class="record-kind" role="radiogroup" aria-label="记录类型">
              <label :class="{ active: recordForm.kind === 'achievement' }"><input v-model="recordForm.kind" class="visually-hidden" type="radio" value="achievement" />事迹</label>
              <label :class="{ active: recordForm.kind === 'honor' }"><input v-model="recordForm.kind" class="visually-hidden" type="radio" value="honor" />荣誉</label>
            </div>
            <div class="field-grid two">
              <label class="form-field"><span>标题</span><input v-model="recordForm.title" maxlength="200" placeholder="例如：获得某某奖学金" required /></label>
              <label class="form-field"><span>时间（可选）</span><input v-model.trim="recordForm.occurredOn" inputmode="numeric" maxlength="10" pattern="\d{4}(-\d{2}){0,2}" placeholder="2024 或 2024-05" title="填写年份，或 年-月、年-月-日" /></label>
            </div>
            <label class="form-field"><span>内容</span><textarea v-model="recordForm.content" maxlength="20000" rows="4" placeholder="写下这段经历" required></textarea></label>
            <p v-if="recordError" class="form-error" role="alert">{{ recordError }}</p>
            <div class="form-actions">
              <button v-if="recordForm.id" class="secondary-command" type="button" @click="resetRecord">取消编辑</button>
              <button class="primary-command" type="submit" :disabled="recordSaving || !recordForm.title.trim() || !recordForm.content.trim()">{{ recordSaving ? "保存中…" : recordForm.id ? "保存记录" : "添加记录" }}</button>
            </div>
          </form>
          <ol v-if="records.length" class="record-list">
            <li v-for="item in records" :key="item.id" :class="{ editing: recordForm.id === item.id }">
              <span class="record-kind-badge" :class="item.kind">{{ item.kind === "honor" ? "荣誉" : "事迹" }}</span>
              <div><strong>{{ item.title }}</strong><small v-if="item.occurredOn">{{ occurredLabel(item.occurredOn) }}</small></div>
              <span class="record-actions">
                <button class="text-button" type="button" @click="editRecord(item)">编辑</button>
                <button class="text-button danger" type="button" :disabled="busyId === item.id" @click="removeRecord(item)">删除</button>
              </span>
            </li>
          </ol>
          <p v-else class="file-empty">还没有记录。荣誉和事迹会以时间线的形式出现在主页“履历”页。</p>
        </section>
      </div>

      <footer class="editor-foot">
        <p v-if="error" class="form-error" role="alert">{{ error }} <button v-if="conflict" class="text-button" type="button" @click="reloadAfterConflict">重新载入</button></p>
        <p v-else-if="saved && !dirty" class="editor-saved" role="status">资料已保存</p>
        <p v-else-if="dirty" class="editor-dirty">有未保存的修改</p>
        <div class="form-actions">
          <button class="secondary-command" type="button" :disabled="saving" @click="requestClose">关闭</button>
          <button class="primary-command" type="button" :disabled="saving || !dirty" @click="saveProfile">{{ saving ? "保存中…" : "保存资料" }}</button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.editor-backdrop { position: fixed; inset: 0; z-index: 110; display: flex; justify-content: flex-end; background: rgba(2, 4, 12, .62); backdrop-filter: blur(6px); animation: editor-fade .25s ease-out; }
.editor { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; width: min(760px, 100%); height: 100%; border-left: 1px solid var(--glass-border); background: linear-gradient(170deg, rgba(14, 26, 52, .98), rgba(5, 9, 21, .99)); box-shadow: -30px 0 80px rgba(0, 0, 0, .5); animation: editor-slide .38s var(--ease-out); }
.editor-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: max(22px, env(safe-area-inset-top)) 28px 14px; }
.editor-head h2 { margin: 8px 0 0; font-family: var(--serif); font-size: 26px; font-weight: 400; letter-spacing: .08em; }
.editor-close { display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--ink-soft); font-size: 22px; line-height: 1; }
.editor-close:hover { border-color: rgba(231, 201, 130, .5); color: var(--gold); }
.editor-nav { display: flex; gap: 6px; padding: 0 28px 14px; overflow-x: auto; border-bottom: 1px solid var(--line); scrollbar-width: none; }
.editor-nav button { display: grid; flex: none; gap: 2px; min-width: 108px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: rgba(3, 6, 15, .35); color: var(--ink-soft); text-align: left; transition: border-color .2s, background .2s, color .2s; }
.editor-nav button strong { font-size: 13px; font-weight: 500; letter-spacing: .06em; }
.editor-nav button small { color: var(--muted); font-size: 10.5px; }
.editor-nav button:hover { border-color: rgba(142, 217, 208, .32); color: var(--ink); }
.editor-nav button.active { border-color: rgba(231, 201, 130, .5); background: rgba(231, 201, 130, .08); color: var(--gold); }
.editor-body { overflow-y: auto; padding: 22px 28px 28px; overscroll-behavior: contain; }
.editor-section { display: grid; gap: 18px; animation: editor-fade .3s ease-out; }
.editor-note { margin: 0; color: var(--muted); font-size: 12.5px; }
.field-count { justify-self: end; margin-top: -2px; color: var(--muted); font-size: 11px; }
.field-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.field-grid.two { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
.theme-field { margin: 0; padding: 0; border: 0; }
.theme-field legend { margin-bottom: 8px; color: var(--ink-soft); font-size: 11px; letter-spacing: .14em; }
.theme-options { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.theme-option { display: grid; gap: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; color: var(--ink-soft); font-size: 12px; text-align: center; cursor: pointer; transition: border-color .2s, color .2s, transform .2s; }
.theme-option:hover { transform: translateY(-1px); border-color: rgba(142, 217, 208, .3); }
.theme-option.active { border-color: rgba(231, 201, 130, .6); color: var(--gold); box-shadow: 0 0 20px rgba(231, 201, 130, .1); }
.theme-option:has(input:focus-visible) { outline: 2px solid var(--gold); outline-offset: 3px; }
.theme-swatch { height: 46px; border-radius: 9px; background: var(--cover-gradient); }
.chip-input { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 48px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 10px; background: rgba(3, 6, 15, .58); cursor: text; }
.chip-input:focus-within { border-color: rgba(231, 201, 130, .62); }
.chip-input input { flex: 1; min-width: 120px; min-height: 30px; border: 0; background: transparent; color: var(--ink); outline: none; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border: 1px solid rgba(142, 217, 208, .3); border-radius: 999px; background: rgba(142, 217, 208, .08); color: var(--aqua); font-size: 12px; }
.chip button { display: grid; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; font-size: 13px; line-height: 1; }
.chip button:hover { background: rgba(142, 217, 208, .2); }
.link-rows { display: grid; gap: 8px; }
.link-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 38px; gap: 8px; }
.link-row input { min-height: 42px; padding: 0 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(3, 6, 15, .58); color: var(--ink); }
.link-row input:focus { outline: none; border-color: rgba(231, 201, 130, .62); }
.link-row button { border: 1px solid var(--line); border-radius: 10px; background: transparent; color: var(--muted); font-size: 18px; }
.link-row button:hover { color: #ffb4a8; border-color: rgba(255, 180, 168, .4); }
.ghost-add { justify-self: start; padding: 8px 14px; border: 1px dashed rgba(142, 217, 208, .35); border-radius: 10px; background: transparent; color: var(--aqua); font-size: 12.5px; }
.avatar-card, .file-card { padding: 16px 18px; border: 1px solid var(--line); border-radius: 16px; background: rgba(3, 8, 20, .3); }
.avatar-card { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 18px; }
.avatar-card :deep(.star-avatar) { justify-self: center; }
.avatar-card h3, .file-card h3, .record-form h3 { margin: 0; color: var(--ink); font-size: 14.5px; font-weight: 500; letter-spacing: .08em; }
.avatar-card p, .file-card p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.file-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.file-card { display: grid; gap: 14px; }
.file-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.upload-pill { display: inline-flex; flex: none; align-items: center; justify-content: center; min-height: 34px; padding: 6px 15px; border: 1px solid rgba(142, 217, 208, .35); border-radius: 999px; color: var(--aqua); font-size: 12.5px; cursor: pointer; transition: border-color .2s, background .2s, color .2s; }
.upload-pill:hover { border-color: rgba(231, 201, 130, .55); background: rgba(231, 201, 130, .08); color: var(--gold); }
.upload-pill:has(input:focus-visible) { outline: 2px solid var(--gold); outline-offset: 3px; }
.text-button { padding: 4px 6px; border: 0; background: none; color: var(--aqua); font-size: 12.5px; }
.text-button:hover { color: var(--gold); }
.text-button.danger { color: #ffb4a8; }
.photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.photo-grid figure { position: relative; aspect-ratio: 1; margin: 0; overflow: hidden; border-radius: 10px; background: rgba(3, 8, 20, .5); }
.photo-grid figure button { position: absolute; top: 5px; right: 5px; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: rgba(3, 6, 15, .78); color: #fff; font-size: 15px; line-height: 1; }
.photo-grid figure button:hover { background: #ffb4a8; color: #2a0f0b; }
.file-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.file-list li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(3, 8, 20, .45); }
.file-icon { display: grid; place-items: center; height: 30px; border: 1px solid rgba(231, 201, 130, .35); border-radius: 7px; color: var(--gold); font-size: 9.5px; letter-spacing: .08em; }
.file-name { display: grid; overflow: hidden; color: var(--ink-soft); font-size: 12.5px; white-space: nowrap; text-overflow: ellipsis; }
.file-name small { color: var(--muted); font-size: 11px; }
.file-empty { margin: 0; color: var(--muted); font-size: 12.5px; }
.record-form { display: grid; gap: 14px; padding: 18px; border: 1px solid rgba(231, 201, 130, .24); border-radius: 16px; background: rgba(3, 8, 20, .3); }
.record-kind { display: inline-flex; gap: 4px; width: fit-content; padding: 4px; border: 1px solid var(--line); border-radius: 12px; }
.record-kind label { padding: 6px 16px; border-radius: 9px; color: var(--muted); font-size: 12.5px; cursor: pointer; }
.record-kind label.active { background: rgba(142, 217, 208, .12); color: var(--aqua); }
.record-kind label:has(input:focus-visible) { outline: 2px solid var(--gold); }
.record-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.record-list li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: rgba(3, 8, 20, .3); }
.record-list li.editing { border-color: rgba(231, 201, 130, .5); }
.record-list strong { display: block; overflow: hidden; color: var(--ink); font-size: 13.5px; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.record-list small { color: var(--muted); font-size: 11.5px; }
.record-kind-badge { padding: 3px 9px; border-radius: 999px; background: rgba(142, 217, 208, .1); color: var(--aqua); font-size: 11px; }
.record-kind-badge.honor { background: rgba(231, 201, 130, .12); color: var(--gold); }
.record-actions { display: flex; gap: 2px; }
.editor-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 28px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: rgba(5, 9, 21, .9); }
.editor-foot .form-error { margin: 0; }
.editor-foot .form-actions { margin-left: auto; }
.editor-saved { margin: 0; color: var(--aqua); font-size: 12.5px; }
.editor-dirty { margin: 0; color: var(--gold); font-size: 12.5px; }
@keyframes editor-slide { from { transform: translateX(40px); opacity: 0; } }
@keyframes editor-fade { from { opacity: 0; } }
@media (max-width: 640px) {
  .editor-head, .editor-nav, .editor-body, .editor-foot { padding-inline: 18px; }
  .field-grid, .field-grid.two { grid-template-columns: 1fr; }
  .theme-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .avatar-card { grid-template-columns: 1fr; justify-items: center; text-align: center; }
  .file-actions { justify-content: center; }
  .link-row { grid-template-columns: minmax(0, 1fr) 38px; }
  .link-row input:first-child { grid-column: 1 / -1; }
}
</style>
