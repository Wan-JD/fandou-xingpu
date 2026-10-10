import assert from "node:assert/strict";
import test from "node:test";

const { default: app } = await import("../apps/api/src/index.ts");
const { getDemoSession } = await import("../apps/api/src/session.ts");

const env = { API_ENV: "test", ALLOWED_ORIGIN: "*" };
const jsonRequest = (path, method, body, token) => app.request(`http://localhost${path}`, {
  method,
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}, env);

test("普通注册被拒绝，已绑定账号可完成资料版本控制和退出登录", async () => {
  const registeredResponse = await jsonRequest("/api/session/register", "POST", { displayName: "测试成员", email: "account@example.com", password: "secret12" });
  assert.equal(registeredResponse.status, 403);
  assert.equal((await registeredResponse.json()).error.code, "INVITE_REQUIRED");

  const loginResponse = await jsonRequest("/api/session/login", "POST", { email: "demo@fandou.local", password: "demo1234" });
  assert.equal(loginResponse.status, 200);
  const registered = await loginResponse.json();
  assert.ok(registered.data.token);
  assert.ok(registered.data.expiresAt);

  const sessionResponse = await jsonRequest("/api/session", "GET", undefined, registered.data.token);
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json()).data.user.personId, registered.data.user.personId);

  const initialProfileResponse = await jsonRequest("/api/me/profile", "GET", undefined, registered.data.token);
  assert.equal(initialProfileResponse.status, 200);
  const initialProfile = await initialProfileResponse.json();
  assert.equal(initialProfile.data.version, 1);
  const initialUpdatedAt = initialProfile.data.updatedAt;

  const repeatedProfileResponse = await jsonRequest("/api/me/profile", "GET", undefined, registered.data.token);
  assert.equal((await repeatedProfileResponse.json()).data.updatedAt, initialUpdatedAt);

  const updatedResponse = await jsonRequest("/api/me/profile", "PATCH", {
    nickname: "星测试",
    bio: "用于验证本人资料更新。",
    destination: "postgraduate_985",
    version: 1,
  }, registered.data.token);
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.data.nickname, "星测试");
  assert.equal(updated.data.destination, "postgraduate_985");
  assert.equal(updated.data.version, 2);

  const staleResponse = await jsonRequest("/api/me/profile", "PATCH", { bio: "旧版本覆盖", version: 1 }, registered.data.token);
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).error.code, "VERSION_CONFLICT");

  const logoutResponse = await jsonRequest("/api/session", "DELETE", undefined, registered.data.token);
  assert.equal(logoutResponse.status, 204);
  assert.equal((await jsonRequest("/api/session", "GET", undefined, registered.data.token)).status, 401);
});

test("登录校验凭据、限制连续失败，并让过期会话失效", async () => {
  const badLogin = await jsonRequest("/api/session/login", "POST", { email: "demo@fandou.local", password: "wrong-password" });
  assert.equal(badLogin.status, 401);

  const goodLogin = await jsonRequest("/api/session/login", "POST", { email: "demo@fandou.local", password: "demo1234" });
  assert.equal(goodLogin.status, 200);
  const session = (await goodLogin.json()).data;
  assert.equal(session.user.personId, "demo-person-002");
  assert.equal(getDemoSession(`Bearer ${session.token}`, Date.parse(session.expiresAt) + 1), null);

  const unknownEmail = `limited-${crypto.randomUUID()}@example.com`;
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await jsonRequest("/api/session/login", "POST", { email: unknownEmail, password: "wrong-password" });
  }
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "900");
  assert.equal((await response.json()).error.code, "LOGIN_RATE_LIMITED");
});

test("未登录请求不能读取或修改本人资料", async () => {
  assert.equal((await jsonRequest("/api/me/profile", "GET")).status, 401);
  assert.equal((await jsonRequest("/api/me/profile", "PATCH", { bio: "越权", version: 1 })).status, 401);
});
