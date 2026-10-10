import assert from "node:assert/strict";
import test from "node:test";

const { acceptInviteRecord, createInviteRecord, inspectInvite, inviteApi, resetInviteStore } = await import("../apps/api/src/invites.ts");
const { demoTree, findPerson } = await import("../apps/api/src/data.ts");
const { getDemoSession } = await import("../apps/api/src/session.ts");
const { loginDemoAccount } = await import("../apps/api/src/session.ts");

const jsonRequest = (url, method, body, token) => inviteApi.request(url, {
  method,
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}, { API_ENV: "test" });

test.beforeEach(() => resetInviteStore());

test("邀请 API 完成创建、预览和接受师徒关系", async () => {
  const mentorLogin = await loginDemoAccount("demo@fandou.local", "demo1234");
  assert.equal(mentorLogin.status, "success");
  const mentorSession = mentorLogin.status === "success" ? mentorLogin.session : null;
  assert.ok(mentorSession);
  const createdResponse = await jsonRequest("http://localhost/", "POST", {}, mentorSession.token);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.ok(created.data.token);
  assert.equal(created.data.status, "pending");
  assert.equal(created.data.mentor.name, "周予安");

  const previewResponse = await inviteApi.request(`http://localhost/${created.data.token}`, {}, { API_ENV: "test" });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.data.mentor.id, "demo-person-002");

  const acceptedResponse = await jsonRequest(`http://localhost/${created.data.token}/accept`, "POST", { name: "新成员", nickname: "小新", email: "invite-one@example.com", password: "secret12" });
  assert.equal(acceptedResponse.status, 201);
  const accepted = await acceptedResponse.json();
  assert.equal(accepted.data.status, "accepted");
  assert.equal(accepted.data.member.name, "新成员");
  assert.equal(accepted.data.relationship.mentorId, "demo-person-002");
  assert.equal(accepted.data.relationship.studentId, accepted.data.member.id);
  assert.ok(accepted.data.session.token);
  assert.equal(accepted.data.session.user.email, "invite-one@example.com");
  assert.equal(accepted.data.session.user.personId, accepted.data.member.id);
  assert.equal((await getDemoSession(`Bearer ${accepted.data.session.token}`))?.user.personId, accepted.data.member.id);
  assert.equal(findPerson(accepted.data.member.id)?.mentorId, "demo-person-002");
  assert.ok(demoTree.nodes.some((node) => node.id === accepted.data.member.id && node.status === "active" && node.destination === null));
  assert.ok(demoTree.edges.some((edge) => edge.mentorId === "demo-person-002" && edge.studentId === accepted.data.member.id));

  const repeatedResponse = await jsonRequest(`http://localhost/${created.data.token}/accept`, "POST", { name: "另一人", email: "invite-two@example.com", password: "secret12" });
  assert.equal(repeatedResponse.status, 409);
  const repeated = await repeatedResponse.json();
  assert.equal(repeated.error.code, "INVITE_ALREADY_ACCEPTED");

  createInviteRecord("demo-person-003", { token: "duplicate-email-token" });
  const duplicateEmail = await jsonRequest("http://localhost/duplicate-email-token/accept", "POST", { name: "重复邮箱", email: "invite-one@example.com", password: "secret12" });
  assert.equal(duplicateEmail.status, 409);
  assert.equal((await duplicateEmail.json()).error.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(inspectInvite("duplicate-email-token").state, "pending", "email conflict must not consume invite");

  createInviteRecord("demo-person-002", { token: "concurrent-token" });
  const concurrent = await Promise.all([
    jsonRequest("http://localhost/concurrent-token/accept", "POST", { name: "并发甲", email: "concurrent-a@example.com", password: "secret12" }),
    jsonRequest("http://localhost/concurrent-token/accept", "POST", { name: "并发乙", email: "concurrent-b@example.com", password: "secret12" }),
  ]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
  const concurrentNodes = demoTree.nodes.filter((node) => node.id.startsWith("invited-concurrenttoken"));
  assert.equal(concurrentNodes.length, 1, "one-time invite should create exactly one person");
});

test("邀请 API 拒绝未知师傅、未知 token 和无效注册资料", async () => {
  assert.equal((await jsonRequest("http://localhost/", "POST", {})).status, 401);
  assert.equal((await inviteApi.request("http://localhost/missing", {}, { API_ENV: "test" })).status, 404);

  createInviteRecord("demo-person-001", { token: "valid-token" });
  const invalidRegistration = await jsonRequest("http://localhost/valid-token/accept", "POST", { name: "", email: "bad", password: "1" });
  assert.equal(invalidRegistration.status, 400);
});

test("过期邀请无法预览或接受", async () => {
  createInviteRecord("demo-person-001", { token: "expired-token", now: 1_000, ttlMs: 100 });
  assert.equal(inspectInvite("expired-token", 1_101).state, "expired");
  assert.equal(acceptInviteRecord("expired-token", { name: "迟到成员", nickname: null }, 1_101).state, "expired");
});
