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
// The super administrator is intentionally stored outside the lineage, but
// still manages invitations and delegated student accounts.
const adminInvite = await request("/api/invites", { token: admin.token, method: "POST", body: {} });
assert.equal(adminInvite.response.status, 201, JSON.stringify(adminInvite.payload));
const adminPlaceholder = await request("/api/me/placeholder-students", { token: admin.token, method: "POST", body: {
  name: `Admin student ${runId}`, cohortYear: 2099, memberType: "probationary",
} });
assert.equal(adminPlaceholder.response.status, 201, JSON.stringify(adminPlaceholder.payload));
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

async function createPerson(name, mentorId = null, cohortYear = undefined) {
  const result = await request("/api/admin/members", { token: admin.token, method: "POST", body: {
    name, ...(cohortYear ? { cohortYear } : { cohortId }), status: "active", destination: null, mentorId, relationScope: "lineage",
  } });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.data.id;
}
// Students always join a later cohort than their mentor.
const parentId = await createPerson(`Smoke parent ${runId}`, null, 2096);
const childId = await createPerson(`Smoke child ${runId}`, parentId, 2097);
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
const mentorEmail = `mentor-${runId}@example.com`;
const mentorPassword = "mentor-password-2026";
const mentorAccount = await request("/api/admin/accounts", { token: admin.token, method: "POST", body: {
  personId: parentId, email: mentorEmail, password: mentorPassword, role: "member",
} });
assert.equal(mentorAccount.response.status, 201, JSON.stringify(mentorAccount.payload));
const mentorSession = await login(mentorEmail, mentorPassword);
const membershipVersion = (await request(`/api/people/${childId}`, { token: mentorSession.token })).payload.data.version;
assert.equal((await request(`/api/admin/members/${childId}`, { token: admin.token, method: "PATCH", body: { version: membershipVersion, memberType: "probationary" } })).response.status, 403, "admin cannot bypass mentor-only member type edits");
assert.equal((await request(`/api/people/${childId}/membership`, { token: memberSession.token, method: "PATCH", body: { version: membershipVersion, groupRole: "leader" } })).response.status, 403, "members cannot set their own group role");
const mentorMembership = await request(`/api/people/${childId}/membership`, { token: mentorSession.token, method: "PATCH", body: { version: membershipVersion, memberType: "probationary", groupRole: "vice_leader" } });
assert.equal(mentorMembership.response.status, 200, JSON.stringify(mentorMembership.payload));
assert.equal(mentorMembership.payload.data.memberType, "probationary");
assert.equal(mentorMembership.payload.data.groupRole, "vice_leader");

const placeholder = await request("/api/me/placeholder-students", { token: memberSession.token, method: "POST", body: {
  name: `待认领 ${runId}`, nickname: "挂名节点", memberType: "probationary", cohortId,
} });
assert.equal(placeholder.response.status, 201, JSON.stringify(placeholder.payload));
assert.match(placeholder.payload.data.claimPath, /^\/claim\?token=claim_/);
const originalClaimToken = encodeURIComponent(placeholder.payload.data.claimToken);
const rotatedClaim = await request(`/api/me/placeholder-students/${encodeURIComponent(placeholder.payload.data.person.id)}/claim`, { token: memberSession.token, method: "POST" });
assert.equal(rotatedClaim.response.status, 200, JSON.stringify(rotatedClaim.payload));
assert.equal((await request(`/api/claims/${originalClaimToken}`)).response.status, 404);
const claimToken = encodeURIComponent(rotatedClaim.payload.data.claimToken);
assert.equal((await request(`/api/claims/${claimToken}`)).response.status, 200);
const claimedEmail = `claimed-${runId}@example.com`;
const claimBody = { name: `认领成员 ${runId}`, email: claimedEmail, password: "claimed-password" };
const concurrentClaims = await Promise.all([
  request(`/api/claims/${claimToken}/accept`, { method: "POST", body: claimBody }),
  request(`/api/claims/${claimToken}/accept`, { method: "POST", body: { ...claimBody, email: `claimed-race-${runId}@example.com` } }),
]);
assert.deepEqual(concurrentClaims.map(({ response }) => response.status).sort(), [201, 409]);
assert.equal((await request(`/api/claims/${claimToken}/accept`, { method: "POST", body: { ...claimBody, email: `claimed-again-${runId}@example.com` } })).response.status, 409);

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
  birthday: "2002-10-24",
  joinedYear: 2026,
  joinedSeason: "spring",
  skills: ["TypeScript", "写作"],
  links: [{ label: "作品集", url: "https://example.com/portfolio" }],
} });
assert.equal(enrichedProfile.response.status, 200, JSON.stringify(enrichedProfile.payload));
assert.equal(enrichedProfile.payload.data.contactEmail, `contact-${runId}@example.com`);
assert.deepEqual(enrichedProfile.payload.data.skills, ["TypeScript", "写作"]);
assert.equal(enrichedProfile.payload.data.links[0].url, "https://example.com/portfolio");
assert.equal(enrichedProfile.payload.data.birthday, "2002-10-24");
assert.equal(enrichedProfile.payload.data.joinedAt, "2026-03-01");
const publicTree = await request("/api/tree");
const publicNode = publicTree.payload.data.nodes.find((item) => item.id === childId);
assert.ok(publicNode);
assert.equal(Object.prototype.hasOwnProperty.call(publicNode, "contactEmail"), false);
const publicDetail = await request(`/api/people/${childId}`);
assert.equal(publicDetail.response.status, 200);
assert.equal(publicDetail.payload.data.contactEmail, `contact-${runId}@example.com`);
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
const ownerAfterAvatar = await request(`/api/people/${childId}`, { token: memberSession.token });
assert.equal(ownerAfterAvatar.payload.data.avatarUrl, `/api/attachments/${avatarId}`);
assert.equal(ownerAfterAvatar.payload.data.attachments.some((item) => item.category === "avatar"), false, "avatar is a profile setting, not a listed attachment");
const anonymousAfterAvatar = await request(`/api/people/${childId}`);
assert.equal(anonymousAfterAvatar.payload.data.attachments.some((item) => item.category === "avatar"), false, "avatar is never exposed in attachment listings");

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
assert.match(uploadedResume.payload.data.originalName, /简历\.pdf$/);
assert.equal((await request(`/api/people/${childId}`, { token: memberSession.token })).payload.data.resume.id, resumeId);
assert.equal((await request(`/api/attachments/${resumeId}`)).response.status, 401);
assert.equal((await request(`/api/attachments/${resumeId}`, { token: memberSession.token })).response.status, 200);
const replacementResumeForm = new FormData();
replacementResumeForm.append("file", new Blob(["replacement resume"], { type: "application/pdf" }), "updated-resume.pdf");
replacementResumeForm.append("category", "resume");
replacementResumeForm.append("visibility", "members");
const replacementResume = await requestMultipart("/api/me/attachments", { token: memberSession.token, method: "POST", form: replacementResumeForm });
assert.equal(replacementResume.response.status, 201, JSON.stringify(replacementResume.payload));
const replacementResumeId = replacementResume.payload.data.id;
assert.notEqual(replacementResumeId, resumeId);
const ownerAfterResumeReplacement = await request(`/api/people/${childId}`, { token: memberSession.token });
assert.equal(ownerAfterResumeReplacement.payload.data.resume.id, replacementResumeId);
assert.equal(ownerAfterResumeReplacement.payload.data.attachments.filter((item) => item.category === "resume").length, 1);
assert.equal((await request(`/api/attachments/${resumeId}`, { token: memberSession.token })).response.status, 404, "old resume object is no longer readable");
assert.equal((await request(`/api/attachments/${replacementResumeId}`, { token: memberSession.token })).response.status, 200);
assert.equal((await request(`/api/attachments/${replacementResumeId}`)).response.status, 401, "member attachments remain protected for anonymous visitors");
assert.equal((await request(`/api/me/attachments/${avatarId}`, { token: memberSession.token, method: "DELETE" })).response.status, 204);
assert.equal((await request(`/api/me/attachments/${replacementResumeId}`, { token: memberSession.token, method: "DELETE" })).response.status, 204);
const afterAttachmentDelete = await request(`/api/people/${childId}`, { token: memberSession.token });
assert.equal(afterAttachmentDelete.payload.data.avatarUrl, null);
assert.equal(afterAttachmentDelete.payload.data.resume, null);

// ---- Personal blog: group role, motto, posts and likes ----
assert.equal((await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: { version: clearedProfile.payload.data.version, destination: "startup" } })).response.status, 400, "retired destinations are rejected");
assert.equal((await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: { version: clearedProfile.payload.data.version, groupRole: "leader" } })).response.status, 400, "self profile cannot edit group role");
const blogProfile = await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: {
  version: clearedProfile.payload.data.version, motto: "向光而行", coverTheme: "aurora",
} });
assert.equal(blogProfile.response.status, 200, JSON.stringify(blogProfile.payload));
assert.equal(blogProfile.payload.data.groupRole, "vice_leader");
assert.equal(blogProfile.payload.data.motto, "向光而行");
assert.equal(blogProfile.payload.data.coverTheme, "aurora");
assert.equal((await request("/api/tree")).payload.data.nodes.find((item) => item.id === childId).groupRole, "vice_leader");
assert.ok(Array.isArray(blogProfile.payload.data.lineagePath) && blogProfile.payload.data.lineagePath.some((item) => item.id === parentId));
assert.ok(blogProfile.payload.data.descendantCount >= 1);

const achievement = await request("/api/me/achievements", { token: memberSession.token, method: "POST", body: { kind: "honor", title: `荣誉 ${runId}`, content: "星光奖", occurredOn: "2026-05" } });
assert.equal(achievement.response.status, 201, JSON.stringify(achievement.payload));
assert.ok((await request(`/api/people/${childId}`, { token: admin.token })).payload.data.achievements.some((item) => item.id === achievement.payload.data.id), "members can read achievements");
assert.equal((await request(`/api/people/${childId}`)).payload.data.achievements.length, 0, "anonymous visitors do not read achievements");

const publicPostForm = new FormData();
publicPostForm.append("title", "第一条动态");
publicPostForm.append("kind", "note");
publicPostForm.append("content", `公开动态 ${runId}`);
publicPostForm.append("visibility", "public");
publicPostForm.append("images", new Blob(["post-image"], { type: "image/png" }), "post.png");
const publicPost = await requestMultipart("/api/me/posts", { token: memberSession.token, method: "POST", form: publicPostForm });
assert.equal(publicPost.response.status, 201, JSON.stringify(publicPost.payload));
assert.equal(publicPost.payload.data.images.length, 1);
const publicImageId = publicPost.payload.data.images[0].id;
const membersPostForm = new FormData();
membersPostForm.append("kind", "experience");
membersPostForm.append("title", "经验分享");
membersPostForm.append("content", `# 成员经验 ${runId}\n\n- 观察\n- 复盘`);
membersPostForm.append("visibility", "members");
for (let index = 0; index < 7; index += 1) membersPostForm.append("images", new Blob([`members-image-${index}`], { type: "image/webp" }), `members-${index}.webp`);
const membersPost = await requestMultipart("/api/me/posts", { token: memberSession.token, method: "POST", form: membersPostForm });
assert.equal(membersPost.response.status, 201, JSON.stringify(membersPost.payload));
assert.equal(membersPost.payload.data.kind, "experience");
assert.equal(membersPost.payload.data.images.length, 7, "experience posts accept more than the six-image note limit");
const membersImageId = membersPost.payload.data.images[0].id;
const badPostForm = new FormData();
badPostForm.append("content", "bad image");
badPostForm.append("images", new Blob(["pdf"], { type: "application/pdf" }), "x.pdf");
assert.equal((await requestMultipart("/api/me/posts", { token: memberSession.token, method: "POST", form: badPostForm })).response.status, 415);
assert.equal((await requestMultipart("/api/me/posts", { method: "POST", form: publicPostForm })).response.status, 401);

const anonymousPosts = await request(`/api/people/${childId}/posts`);
assert.deepEqual(anonymousPosts.payload.data.map((item) => item.id), [publicPost.payload.data.id], "anonymous visitors only see public posts");
const memberPosts = await request(`/api/people/${childId}/posts`, { token: admin.token });
assert.equal(memberPosts.payload.data.length, 2);
assert.equal((await request(`/api/people/${childId}`)).payload.data.postCount, 1);
assert.equal((await request(`/api/attachments/${publicImageId}`)).response.status, 200, "public post images are public");
assert.equal((await request(`/api/attachments/${membersImageId}`)).response.status, 401, "members post images need a session");
assert.equal((await request(`/api/attachments/${membersImageId}`, { token: admin.token })).response.status, 200);
assert.equal((await request(`/api/people/${childId}`, { token: memberSession.token })).payload.data.attachments.some((item) => item.id === publicImageId), false, "post images stay out of the file list");
assert.equal((await request(`/api/me/attachments/${publicImageId}`, { token: memberSession.token, method: "DELETE" })).response.status, 404, "post images are managed through their post");

const liked = await request(`/api/posts/${publicPost.payload.data.id}/like`, { token: admin.token, method: "PUT" });
assert.equal(liked.response.status, 200, JSON.stringify(liked.payload));
assert.equal(liked.payload.data.likeCount, 1);
assert.equal((await request(`/api/posts/${publicPost.payload.data.id}/like`, { token: admin.token, method: "PUT" })).payload.data.likeCount, 1, "likes are idempotent");
assert.equal((await request(`/api/posts/${publicPost.payload.data.id}/like`, { method: "PUT" })).response.status, 401);

const pinned = await request(`/api/me/posts/${membersPost.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: { version: membersPost.payload.data.version, isPinned: true } });
assert.equal(pinned.response.status, 200, JSON.stringify(pinned.payload));
assert.equal((await request(`/api/people/${childId}/posts`, { token: memberSession.token })).payload.data[0].id, membersPost.payload.data.id, "pinned posts lead the feed");
const editedPublic = await request(`/api/me/posts/${publicPost.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: { version: publicPost.payload.data.version, content: `公开动态已更新 ${runId}` } });
assert.equal(editedPublic.response.status, 200, JSON.stringify(editedPublic.payload));
assert.equal((await request(`/api/me/posts/${publicPost.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: { version: publicPost.payload.data.version, isPinned: true } })).response.status, 409, "a stale pin request is rejected");
assert.equal((await request(`/api/people/${childId}/posts`, { token: memberSession.token })).payload.data[0].id, membersPost.payload.data.id, "a stale pin request does not clear the existing pin");
assert.equal((await request(`/api/me/posts/${membersPost.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: { version: membersPost.payload.data.version, content: "stale" } })).response.status, 409);
assert.equal((await request(`/api/me/posts/${membersPost.payload.data.id}`, { token: admin.token, method: "PATCH", body: { version: pinned.payload.data.version, content: "not mine" } })).response.status, 404, "only the author edits a post");
const removedImage = await request(`/api/me/posts/${publicPost.payload.data.id}/images/${publicImageId}`, { token: memberSession.token, method: "DELETE" });
assert.equal(removedImage.response.status, 200, JSON.stringify(removedImage.payload));
assert.equal(removedImage.payload.data.images.length, 0);
assert.equal((await request(`/api/attachments/${publicImageId}`)).response.status, 404);
assert.equal((await request(`/api/me/posts/${membersPost.payload.data.id}`, { token: admin.token, method: "DELETE" })).response.status, 404);
assert.equal((await request(`/api/me/posts/${membersPost.payload.data.id}`, { token: memberSession.token, method: "DELETE" })).response.status, 204);
assert.equal((await request(`/api/attachments/${membersImageId}`, { token: admin.token })).response.status, 404, "deleted posts take their images with them");

// ---- Student studio ----
const studio = await request("/api/me/students", { token: memberSession.token });
assert.equal(studio.response.status, 200, JSON.stringify(studio.payload));
const claimedStudent = studio.payload.data.students.find((item) => item.personId === placeholder.payload.data.person.id);
assert.ok(claimedStudent?.account?.activated, "claimed students are activated");
assert.equal((await request(`/api/me/students/${claimedStudent.personId}/reset-password`, { token: memberSession.token, method: "POST" })).response.status, 409, "activated accounts cannot be reset by the mentor");
assert.ok(studio.payload.data.invites.some((item) => item.state === "accepted"));
const freshEmail = `fresh-${runId}@example.com`;
const freshStudent = await request("/api/me/placeholder-students", { token: memberSession.token, method: "POST", body: { name: `Fresh ${runId}`, loginIdentifier: freshEmail, memberType: "formal", cohortYear: 2099 } });
assert.equal(freshStudent.response.status, 201, JSON.stringify(freshStudent.payload));
const freshRow = (await request("/api/me/students", { token: memberSession.token })).payload.data.students.find((item) => item.personId === freshStudent.payload.data.person.id);
assert.equal(freshRow.account.canResetPassword, true);
assert.equal((await request(`/api/me/students/${freshRow.personId}/reset-password`, { token: admin.token, method: "POST" })).response.status, 409, "only the direct mentor can reset");
const reissued = await request(`/api/me/students/${freshRow.personId}/reset-password`, { token: memberSession.token, method: "POST" });
assert.equal(reissued.response.status, 200, JSON.stringify(reissued.payload));
assert.equal((await request("/api/session/login", { method: "POST", body: { identifier: freshEmail, password: freshStudent.payload.data.temporaryPassword } })).response.status, 401, "the previous initial password stops working");
const freshSession = await login(freshEmail, reissued.payload.data.temporaryPassword);
assert.equal(freshSession.user.mustChangePassword, true);
const roleUpdate = await request(`/api/me/placeholder-students/${freshRow.personId}`, { token: memberSession.token, method: "PATCH", body: { version: freshRow.version, groupRole: "leader", status: "archived" } });
assert.equal(roleUpdate.response.status, 200, JSON.stringify(roleUpdate.payload));
assert.equal(roleUpdate.payload.data.groupRole, "leader");
const pendingInvite = await request("/api/invites", { token: memberSession.token, method: "POST", body: {} });
const pendingInviteId = (await request("/api/me/students", { token: memberSession.token })).payload.data.invites.find((item) => item.state === "pending")?.id;
assert.ok(pendingInviteId);
assert.equal((await request(`/api/me/invites/${encodeURIComponent(pendingInviteId)}`, { token: admin.token, method: "DELETE" })).response.status, 409, "mentors only revoke their own invites");
assert.equal((await request(`/api/me/invites/${encodeURIComponent(pendingInviteId)}`, { token: memberSession.token, method: "DELETE" })).response.status, 204);
assert.equal((await request(`/api/invites/${encodeURIComponent(pendingInvite.payload.data.token)}`)).response.status, 410);

// ---- Cohort order, destination eligibility and article drafts ----
const sameCohort = await request("/api/admin/members", { token: admin.token, method: "POST", body: { name: `Same cohort ${runId}`, cohortYear: 2096, mentorId: parentId, status: "active", destination: null } });
assert.equal(sameCohort.response.status, 409, "a mentor cannot take a student from the same cohort");
assert.equal(sameCohort.payload.error.code, "COHORT_ORDER");
const sameCohortPlaceholder = await request("/api/me/placeholder-students", { token: memberSession.token, method: "POST", body: { name: `Same cohort placeholder ${runId}`, cohortYear: 2097, memberType: "formal" } });
assert.equal(sameCohortPlaceholder.response.status, 409);
const parentNow = (await request("/api/admin/members", { token: admin.token })).payload.data.find((item) => item.id === parentId);
assert.equal((await request(`/api/admin/members/${parentId}`, { token: admin.token, method: "PATCH", body: { version: parentNow.version, cohortYear: 2097 } })).response.status, 409, "a mentor cannot move into their student's cohort");

const ineligibleProfile = await request("/api/me/profile", { token: memberSession.token });
const ineligibleDestination = await request("/api/me/profile", { token: memberSession.token, method: "PATCH", body: { version: ineligibleProfile.payload.data.version, destination: "big_tech" } });
assert.equal(ineligibleDestination.response.status, 403, "only graduates and fourth-year members record a destination");
assert.equal(ineligibleDestination.payload.error.code, "DESTINATION_NOT_ELIGIBLE");
const childRow = (await request("/api/admin/members", { token: admin.token })).payload.data.find((item) => item.id === childId);
assert.equal((await request(`/api/admin/members/${childId}`, { token: admin.token, method: "PATCH", body: { version: childRow.version, destination: "big_tech" } })).response.status, 409, "administrators follow the same destination rule");
const graduated = await request(`/api/admin/members/${childId}`, { token: admin.token, method: "PATCH", body: { version: childRow.version, status: "archived", destination: "big_tech" } });
assert.equal(graduated.response.status, 200, JSON.stringify(graduated.payload));

const draftForm = new FormData();
draftForm.append("kind", "experience");
draftForm.append("status", "draft");
draftForm.append("title", `草稿 ${runId}`);
draftForm.append("content", "");
const draft = await requestMultipart("/api/me/posts", { token: memberSession.token, method: "POST", form: draftForm });
assert.equal(draft.response.status, 201, JSON.stringify(draft.payload));
assert.equal(draft.payload.data.status, "draft");
const draftImageForm = new FormData();
draftImageForm.append("images", new Blob(["draft-image"], { type: "image/png" }), "draft.png");
const draftWithImage = await requestMultipart(`/api/me/posts/${draft.payload.data.id}/images`, { token: memberSession.token, method: "POST", form: draftImageForm });
assert.equal(draftWithImage.response.status, 201, JSON.stringify(draftWithImage.payload));
const draftImageId = draftWithImage.payload.data.images[0].id;
assert.equal((await request(`/api/attachments/${draftImageId}`, { token: admin.token })).response.status, 404, "draft images stay with their author");
assert.equal((await request(`/api/attachments/${draftImageId}`, { token: memberSession.token })).response.status, 200);
assert.ok((await request("/api/me/posts/drafts", { token: memberSession.token })).payload.data.some((item) => item.id === draft.payload.data.id));
assert.equal((await request(`/api/people/${childId}/posts`, { token: admin.token })).payload.data.some((item) => item.id === draft.payload.data.id), false, "drafts are not in the feed");
assert.equal((await request(`/api/posts/${draft.payload.data.id}`, { token: admin.token })).response.status, 404, "drafts are not readable by others");
assert.equal((await request(`/api/posts/${draft.payload.data.id}`, { token: memberSession.token })).response.status, 200);
assert.equal((await request(`/api/posts/${draft.payload.data.id}/like`, { token: admin.token, method: "PUT" })).response.status, 404, "drafts cannot be liked");
assert.equal((await request(`/api/me/posts/${draft.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: { version: draftWithImage.payload.data.version, status: "published" } })).response.status, 400, "an empty draft cannot be published");
const published = await request(`/api/me/posts/${draft.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: {
  version: draftWithImage.payload.data.version, status: "published", content: `# 经验\n\n![图](/api/attachments/${draftImageId})`, visibility: "public",
} });
assert.equal(published.response.status, 200, JSON.stringify(published.payload));
assert.equal(published.payload.data.status, "published");
assert.ok(published.payload.data.publishedAt);
assert.equal((await request(`/api/attachments/${draftImageId}`)).response.status, 200, "published public article images become public");
assert.equal((await request(`/api/posts/${draft.payload.data.id}`)).response.status, 200);
assert.equal((await request(`/api/people/${childId}/posts`)).payload.data.find((item) => !item.isPinned)?.id, draft.payload.data.id, "publishing dates the post from now");
assert.equal((await request(`/api/me/posts/${draft.payload.data.id}`, { token: memberSession.token, method: "PATCH", body: { version: published.payload.data.version, status: "draft" } })).response.status, 409, "published posts do not go back to drafts");

const revocable = await request("/api/invites", { token: memberSession.token, method: "POST", body: {} });
const inviteRows = await request("/api/admin/invites", { token: admin.token });
const inviteHash = inviteRows.payload.data.find((item) => item.mentor_id === childId && !item.accepted_at && !item.revoked_at)?.id;
assert.ok(inviteHash);
assert.equal((await request(`/api/admin/invites/${encodeURIComponent(inviteHash)}`, { token: admin.token, method: "DELETE" })).response.status, 204);
assert.equal((await request(`/api/invites/${encodeURIComponent(revocable.payload.data.token)}`)).response.status, 410);

const accountId = accountCreated.payload.data.id;
assert.equal((await request(`/api/admin/accounts/${accountId}/status`, { token: admin.token, method: "PATCH", body: { status: "disabled" } })).response.status, 200);
assert.equal((await request("/api/session", { token: memberSession.token })).response.status, 401);
assert.equal((await request(`/api/admin/accounts/${accountId}`, { token: admin.token, method: "DELETE" })).response.status, 409, "accounts with students must be blocked from destructive deletion");
assert.equal((await request(`/api/admin/members/${parentId}`, { token: admin.token, method: "DELETE" })).response.status, 409, "people with students must be blocked from destructive deletion");

const accountlessPersonId = await createPerson(`Smoke accountless deletion target ${runId}`);
const deletedAccountlessPerson = await request(`/api/admin/members/${accountlessPersonId}`, { token: admin.token, method: "DELETE" });
assert.equal(deletedAccountlessPerson.response.status, 200, JSON.stringify(deletedAccountlessPerson.payload));
assert.equal(deletedAccountlessPerson.payload.data.accountDeleted, false);
assert.equal(deletedAccountlessPerson.payload.data.personDeleted, true);
assert.equal((await request(`/api/people/${accountlessPersonId}`)).response.status, 404);

const deletablePersonId = await createPerson(`Smoke deletion target ${runId}`);
const deletableAccount = await request("/api/admin/accounts", { token: admin.token, method: "POST", body: {
  personId: deletablePersonId, email: `delete-${runId}@example.com`, password: "delete-password-2026", role: "member",
} });
assert.equal(deletableAccount.response.status, 201, JSON.stringify(deletableAccount.payload));
const deletedAccount = await request(`/api/admin/accounts/${deletableAccount.payload.data.id}`, { token: admin.token, method: "DELETE" });
assert.equal(deletedAccount.response.status, 200, JSON.stringify(deletedAccount.payload));
assert.equal(deletedAccount.payload.data.personDeleted, true);
assert.equal((await request(`/api/people/${deletablePersonId}`)).response.status, 404);

const memberDeletePersonId = await createPerson(`Smoke member endpoint deletion target ${runId}`);
const memberDeleteAccount = await request("/api/admin/accounts", { token: admin.token, method: "POST", body: {
  personId: memberDeletePersonId, email: `member-delete-${runId}@example.com`, password: "delete-password-2026", role: "member",
} });
assert.equal(memberDeleteAccount.response.status, 201, JSON.stringify(memberDeleteAccount.payload));
const memberDeleteSession = await login(`member-delete-${runId}@example.com`, "delete-password-2026");
const deletedMemberWithAccount = await request(`/api/admin/members/${memberDeletePersonId}`, { token: admin.token, method: "DELETE" });
assert.equal(deletedMemberWithAccount.response.status, 200, JSON.stringify(deletedMemberWithAccount.payload));
assert.equal(deletedMemberWithAccount.payload.data.accountDeleted, true);
assert.equal((await request("/api/session", { token: memberDeleteSession.token })).response.status, 401);
assert.equal((await request(`/api/people/${memberDeletePersonId}`)).response.status, 404);
assert.equal((await request(`/api/admin/accounts/${admin.user.id}/status`, { token: admin.token, method: "PATCH", body: { status: "disabled" } })).response.status, 409);
assert.equal((await request(`/api/admin/accounts/${admin.user.id}/role`, { token: admin.token, method: "PATCH", body: { role: "member" } })).response.status, 409);

const audit = await request("/api/admin/audit-logs", { token: admin.token });
assert.ok(audit.payload.data.some((item) => item.action === "invite.revoke"));

console.log("Local D1 integration smoke passed.");
