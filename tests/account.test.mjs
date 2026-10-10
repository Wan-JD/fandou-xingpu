import assert from "node:assert/strict";
import test from "node:test";

const { default: app } = await import("../apps/api/src/index.ts");
const { normalizeEmail, createPasswordFields, verifyPassword } = await import("../apps/api/src/session.ts");

const env = { API_ENV: "test", ALLOWED_ORIGIN: "*" };
const jsonRequest = (path, method, body, token) => app.request(`http://localhost${path}`, {
  method,
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, env);

test("账号创建必须通过邀请，未配置数据库时认证接口安全失败", async () => {
  const registeredResponse = await jsonRequest("/api/session/register", "POST", { displayName: "测试成员", email: "account@example.com", password: "secret12" });
  assert.equal(registeredResponse.status, 403);
  assert.equal((await registeredResponse.json()).error.code, "INVITE_REQUIRED");

  const loginResponse = await jsonRequest("/api/session/login", "POST", { email: "member@example.com", password: "secret12" });
  assert.equal(loginResponse.status, 503);
  assert.equal((await loginResponse.json()).error.code, "DATABASE_UNAVAILABLE");
  assert.equal((await jsonRequest("/api/session", "GET")).status, 503);
  assert.equal((await jsonRequest("/api/me/profile", "GET")).status, 503);
});

test("密码哈希和邮箱规范化保持数据库认证边界", async () => {
  assert.equal(normalizeEmail("  Member@Example.COM "), "member@example.com");
  const fields = await createPasswordFields("secure-password");
  assert.notEqual(fields.passwordSalt, fields.passwordHash);
  assert.equal(await verifyPassword("secure-password", fields.passwordSalt, fields.passwordHash), true);
  assert.equal(await verifyPassword("wrong-password", fields.passwordSalt, fields.passwordHash), false);
});
test("未配置数据库时个人资料修改不会绕过持久化层", async () => {
  const response = await jsonRequest("/api/me/profile", "PATCH", { bio: "越权", version: 1 }, "opaque-token");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "DATABASE_UNAVAILABLE");
});
