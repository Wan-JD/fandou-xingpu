import assert from "node:assert/strict";

const base = (process.env.API_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD for the local admin.");
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

async function request(path, { token, body, ...init } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

async function requestMultipart(path, { token, form, ...init } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

async function login(email, password) {
  const result = await request("/api/session/login", { method: "POST", body: { email, password } });
  assert.equal(result.response.status, 200, `login failed for ${email}: ${JSON.stringify(result.payload)}`);
  return result.payload.data;
}

assert.equal((await request("/api/health")).response.status, 200);
assert.equal((await request("/api/admin/members")).response.status, 401);

const admin = await login(adminEmail, adminPassword);
assert.equal(admin.user.role, "admin");
const ordinaryEmail = `ordinary-${runId}@example.com`;
const ordinaryPerson = await request("/api/admin/members", { token: admin.token, method: "POST", body: {
  name: `Ordinary ${runId}`, status: "active", destination: null, mentorId: null, relationScope: "cohort_guest",
} });
assert.equal(ordinaryPerson.response.status, 201, JSON.stringify(ordinaryPerson.payload));
const ordinaryCreated = await request("/api/admin/accounts", { token: admin.token, method: "POST", body: {
  personId: ordinaryPerson.payload.data.id, email: ordinaryEmail, password: "ordinary-password-2026", role: "member",
} });
assert.equal(ordinaryCreated.response.status, 201, JSON.stringify(ordinaryCreated.payload));
const ordinary = await login(ordinaryEmail, "ordinary-password-2026");
assert.equal((await request("/api/admin/members", { token: ordinary.token })).response.status, 403);

const cohortCreated = await request("/api/admin/cohorts", { token: admin.token, method: "POST", body: {
  label: `Smoke ${runId}`, year: 2098, sortOrder: 2098, description: "integration smoke",
} });
assert.equal(cohortCreated.response.status, 201, JSON.stringify(cohortCreated.payload));
const cohortId = cohortCreated.payload.data.id;

async function createPerson(name, mentorId = null) {
  const result = await request("/api/admin/members", { token: admin.token, method: "POST", body: {
    name, cohortId, status: "active", destination: null, mentorId, relationScope: "lineage",
  } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.data.id;
}
const parentId = await createPerson(`Smoke parent ${runId}`);
const childId = await createPerson(`Smoke child ${runId}`, parentId);
const members = await request("/api/admin/members", { token: admin.token });
const child = members.payload.data.find((item) => item.id === childId);
assert.ok(child);

const updated = await request(`/api/admin/members/${childId}`, { token: admin.token, method: "PATCH", body: {
  version: child.version, nickname: "CAS ok", tags: ["smoke"], bio: "updated", role: "测试成员",
} });
assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
assert.equal((await request(`/api/admin/members/${childId}`, { token: admin.token, method: "PATCH", body: { version: child.version, name: "stale" } })).response.status, 409);
const refreshedMembers = await request("/api/admin/members", { token: admin.token });
const parent = refreshedMembers.payload.data.find((item) => item.id === parentId);
assert.equal((await request(`/api/admin/members/${parentId}`, { token: admin.token, method: "PATCH", body: { version: parent.version, mentorId: parentId } })).response.status, 409);
assert.equal((await request(`/api/admin/members/${parentId}`, { token: admin.token, method: "PATCH", body: { version: parent.version, mentorId: "missing-person" } })).response.status, 404);
assert.equal((await request(`/api/admin/members/${parentId}`, { token: admin.token, method: "PATCH", body: { version: parent.version, mentorId: childId } })).response.status, 409);

const accountEmail = `smoke-${runId}@example.com`;
const accountPassword = "smoke-password-2026";
const accountCreated = await request("/api/admin/accounts", { token: admin.token, method: "POST", body: {
  personId: childId, email: accountEmail, password: accountPassword, role: "member",
} });
assert.equal(accountCreated.response.status, 201, JSON.stringify(accountCreated.payload));
const memberSession = await login(accountEmail, accountPassword);

const ownerInvite = await request("/api/invites", { token: memberSession.token, method: "POST", body: { mentorId: parentId } });
assert.equal(ownerInvite.response.status, 201, JSON.stringify(ownerInvite.payload));
assert.equal(ownerInvite.payload.data.mentor.id, childId, "invite must bind to current session person");
assert.equal((await request("/api/invites/missing-token")).response.status, 404);

const acceptedEmail = `accepted-${runId}@example.com`;
const acceptBody = { name: `Accepted ${runId}`, email: acceptedEmail, password: "accepted-password" };
assert.equal((await request(`/api/invites/${encodeURIComponent(ownerInvite.payload.data.token)}/accept`, { method: "POST", body: acceptBody })).response.status, 201);
assert.equal((await request(`/api/invites/${encodeURIComponent(ownerInvite.payload.data.token)}/accept`, { method: "POST", body: { ...acceptBody, email: `duplicate-${runId}@example.com` } })).response.status, 409);

const concurrentInvite = await request("/api/invites", { token: memberSession.token, method: "POST", body: {} });
const concurrentToken = encodeURIComponent(concurrentInvite.payload.data.token);
const concurrent = await Promise.all([
  request(`/api/invites/${concurrentToken}/accept`, { method: "POST", body: { name: "Concurrent A", email: `concurrent-a-${runId}@example.com`, password: "concurrent-password" } }),
  request(`/api/invites/${concurrentToken}/accept`, { method: "POST", body: { name: "Concurrent B", email: `concurrent-b-${runId}@example.com`, password: "concurrent-password" } }),
]);
assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [201, 409]);

const profile = await request("/api/me/profile", { token: memberSession.token });
const profileVersion = profile.payload.data.version;
const invalidLink = await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: { version: profileVersion, links: [{ label: "unsafe", url: "javascript:alert(1)" }] } });
assert.equal(invalidLink.response.status, 400);
const enrichedProfile = await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: {
  version: profileVersion,
  bio: "owner CAS update",
  contactEmail: `contact-${runId}@example.com`,
  education: "星谱大学 · 计算机科学",
  experience: "参与星尘工具链建设",
  skills: ["TypeScript", "写作"],
  links: [{ label: "作品集", url: "https://example.com/portfolio" }],
} });
assert.equal(enrichedProfile.response.status, 200, JSON.stringify(enrichedProfile.payload));
assert.equal(enrichedProfile.payload.data.contactEmail, `contact-${runId}@example.com`);
assert.deepEqual(enrichedProfile.payload.data.skills, ["TypeScript", "写作"]);
assert.equal(enrichedProfile.payload.data.links[0].url, "https://example.com/portfolio");
const publicTree = await request("/api/tree");
const publicNode = publicTree.payload.data.nodes.find((item) => item.id === childId);
assert.ok(publicNode);
assert.equal(Object.prototype.hasOwnProperty.call(publicNode, "contactEmail"), false);
const publicDetail = await request(`/api/people/${childId}`);
assert.equal(publicDetail.response.status, 200);
assert.equal(publicDetail.payload.data.contactEmail, null);
const ownerDetail = await request(`/api/people/${childId}`, { token: memberSession.token });
assert.equal(ownerDetail.payload.data.contactEmail, `contact-${runId}@example.com`);
const clearedProfile = await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: {
  version: enrichedProfile.payload.data.version,
  contactEmail: null,
  education: null,
  experience: null,
  skills: [],
  links: [],
} });
assert.equal(clearedProfile.response.status, 200, JSON.stringify(clearedProfile.payload));
assert.equal(clearedProfile.payload.data.contactEmail, null);
assert.deepEqual(clearedProfile.payload.data.skills, []);
assert.deepEqual(clearedProfile.payload.data.links, []);
assert.equal((await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: { version: profileVersion, bio: "stale owner update" } })).response.status, 409);

const avatarForm = new FormData();
avatarForm.append("file", new Blob(["avatar"], { type: "image/png" }), "avatar.png");
avatarForm.append("category", "avatar");
avatarForm.append("visibility", "members");
const invalidAvatar = new FormData();
invalidAvatar.append("file", new Blob(["not-an-image"], { type: "application/pdf" }), "avatar.pdf");
invalidAvatar.append("category", "avatar");
invalidAvatar.append("visibility", "members");
assert.equal((await requestMultipart("/api/me/attachments", { token: memberSession.token, method: "POST", form: invalidAvatar })).response.status, 415);
const uploadedAvatar = await requestMultipart("/api/me/attachments", { token: memberSession.token, method: "POST", form: avatarForm });
assert.equal(uploadedAvatar.response.status, 201, JSON.stringify(uploadedAvatar.payload));
const avatarId = uploadedAvatar.payload.data.id;
assert.equal((await request(`/api/people/${childId}`, { token: memberSession.token })).payload.data.avatarUrl, `/api/attachments/${avatarId}`);

const resumeForm = new FormData();
resumeForm.append("file", new Blob(["resume"], { type: "application/pdf" }), "resume.pdf");
resumeForm.append("category", "resume");
resumeForm.append("visibility", "members");
const invalidResume = new FormData();
invalidResume.append("file", new Blob(["not-a-pdf"], { type: "image/png" }), "resume.png");
invalidResume.append("category", "resume");
invalidResume.append("visibility", "members");
assert.equal((await requestMultipart("/api/me/attachments", { token: memberSession.token, method: "POST", form: invalidResume })).response.status, 415);
const uploadedResume = await requestMultipart("/api/me/attachments", { token: memberSession.token, method: "POST", form: resumeForm });
assert.equal(uploadedResume.response.status, 201, JSON.stringify(uploadedResume.payload));
const resumeId = uploadedResume.payload.data.id;
assert.equal((await request(`/api/people/${childId}`, { token: memberSession.token })).payload.data.resume.id, resumeId);
assert.equal((await request(`/api/attachments/${resumeId}`)).response.status, 401);
assert.equal((await request(`/api/attachments/${resumeId}`, { token: memberSession.token })).response.status, 200);
assert.equal((await request(`/api/me/attachments/${avatarId}`, { token: memberSession.token, method: "DELETE" })).response.status, 204);
assert.equal((await request(`/api/me/attachments/${resumeId}`, { token: memberSession.token, method: "DELETE" })).response.status, 204);
const afterAttachmentDelete = await request(`/api/people/${childId}`, { token: memberSession.token });
assert.equal(afterAttachmentDelete.payload.data.avatarUrl, null);
assert.equal(afterAttachmentDelete.payload.data.resume, null);

const revocable = await request("/api/invites", { token: memberSession.token, method: "POST", body: {} });
const inviteRows = await request("/api/admin/invites", { token: admin.token });
const inviteHash = inviteRows.payload.data.find((item) => item.mentor_id === childId && !item.accepted_at && !item.revoked_at)?.id;
assert.ok(inviteHash);
assert.equal((await request(`/api/admin/invites/${encodeURIComponent(inviteHash)}`, { token: admin.token, method: "DELETE" })).response.status, 204);
assert.equal((await request(`/api/invites/${encodeURIComponent(revocable.payload.data.token)}`)).response.status, 410);

const accountId = accountCreated.payload.data.id;
assert.equal((await request(`/api/admin/accounts/${accountId}/status`, { token: admin.token, method: "PATCH", body: { status: "disabled" } })).response.status, 200);
assert.equal((await request("/api/session", { token: memberSession.token })).response.status, 401);
assert.equal((await request(`/api/admin/accounts/${admin.user.id}/status`, { token: admin.token, method: "PATCH", body: { status: "disabled" } })).response.status, 409);
assert.equal((await request(`/api/admin/accounts/${admin.user.id}/role`, { token: admin.token, method: "PATCH", body: { role: "member" } })).response.status, 409);

const audit = await request("/api/admin/audit-logs", { token: admin.token });
assert.ok(audit.payload.data.some((item) => item.action === "invite.revoke"));

console.log("Local D1 integration smoke passed.");
