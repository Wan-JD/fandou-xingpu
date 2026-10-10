import assert from "node:assert/strict";
import test from "node:test";

const { acceptInviteRecord, createInviteRecord, inspectInvite, inviteApi, resetInviteStore } = await import("../apps/api/src/invites.ts");

const jsonRequest = (url, method, body, token) => inviteApi.request(url, {
  method,
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}, { API_ENV: "test" });

test.beforeEach(() => resetInviteStore());

test("邀请令牌只能被接受一次", () => {
  const record = createInviteRecord("mentor-001", { token: "single-use-token", now: 1_000, ttlMs: 10_000 });
  assert.equal(inspectInvite(record.token, 1_001).state, "pending");
  const accepted = acceptInviteRecord(record.token, { id: "student-001", name: "新成员", nickname: null }, 1_002);
  assert.equal(accepted.state, "accepted-now");
  assert.equal(accepted.record.acceptedBy?.id, "student-001");
  assert.equal(inspectInvite(record.token, 1_003).state, "accepted");
  assert.equal(acceptInviteRecord(record.token, { name: "另一人", nickname: null }, 1_004).state, "accepted");
});

test("邀请接受会拒绝过期令牌，HTTP 路由没有数据库时拒绝写入", async () => {
  createInviteRecord("mentor-001", { token: "expired-token", now: 1_000, ttlMs: 100 });
  assert.equal(inspectInvite("expired-token", 1_101).state, "expired");
  assert.equal(acceptInviteRecord("expired-token", { name: "迟到成员", nickname: null }, 1_101).state, "expired");
  const response = await jsonRequest("http://localhost/", "POST", {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "DATABASE_UNAVAILABLE");
  assert.equal((await inviteApi.request("http://localhost/missing", {}, { API_ENV: "test" })).status, 503);
});

test("注册资料在持久化前经过基本校验", async () => {
  const response = await jsonRequest("http://localhost/any-token/accept", "POST", { name: "", email: "invalid", password: "1" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REGISTRATION");
});
