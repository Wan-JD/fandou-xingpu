import assert from "node:assert/strict";
import test from "node:test";

const { default: app } = await import("../apps/api/src/index.ts");
const { createPasswordFields, verifyPassword } = await import("../apps/api/src/session.ts");
const { isValidEmail, isValidPhone, normalizeEmail, normalizePhone, parseAccountIdentifier } = await import("../packages/shared/src/account-identifiers.ts");
const { sessionLoginSchema } = await import("../packages/shared/src/schemas.ts");
const { persistence } = await import("../apps/api/src/persistence.ts");

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

test("登录只接受合法邮箱或手机号，并在访问数据库前拒绝姓名", async () => {
  for (const identifier of ["张三", "not-an-email", "123456", "12345678901", "+86 123 4567 8901", "+0123456789"]) {
    assert.equal(sessionLoginSchema.safeParse({ identifier, password: "secret12" }).success, false, identifier);
    const response = await jsonRequest("/api/session/login", "POST", { identifier, password: "secret12" });
    assert.equal(response.status, 400, identifier);
    assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
  }

  for (const identifier of ["Member+tag@Example.COM", "138 0013 8000", "+1 (202) 555-0100", "+44 20 7946 0958"]) {
    assert.equal(sessionLoginSchema.safeParse({ identifier, password: "secret12" }).success, true, identifier);
  }

  let databaseAccesses = 0;
  const fakeDb = { prepare() { databaseAccesses += 1; throw new Error("unexpected database access"); } };
  assert.deepEqual(await persistence(fakeDb).login("同名成员", "secret12"), { status: "invalid" });
  assert.equal(databaseAccesses, 0);
});

test("密码哈希和邮箱规范化保持数据库认证边界", async () => {
  assert.equal(normalizeEmail("  Member@Example.COM "), "member@example.com");
  assert.equal(normalizePhone(" +86 (138) 0013-8000 "), "13800138000");
  assert.equal(normalizePhone(" +1 (202) 555-0100 "), "+12025550100");
  assert.equal(isValidEmail("Member+tag@Example.COM"), true);
  assert.equal(isValidPhone("138 0013 8000"), true);
  assert.equal(isValidPhone("+1 (202) 555-0100"), true);
  assert.equal(isValidPhone("12345678901"), false);
  assert.deepEqual(parseAccountIdentifier(" +44 20 7946 0958 "), { kind: "phone", normalized: "+442079460958" });
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

test("跨域预检允许动态点赞使用 PUT", async () => {
  const response = await app.request("http://localhost/api/posts/post-1/like", {
    method: "OPTIONS",
    headers: {
      Origin: "https://xingpu.example",
      "Access-Control-Request-Method": "PUT",
    },
  }, env);
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Methods") ?? "", /PUT/);
});
