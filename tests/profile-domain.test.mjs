import assert from "node:assert/strict";
import test from "node:test";

const { birthdaySchema, postInputSchema, POST_IMAGE_LIMITS } = await import("../packages/shared/src/schemas.ts");
const { zodiacForBirthday } = await import("../packages/shared/src/domain.ts");
const { D1Persistence, membershipPermissionsFor } = await import("../apps/api/src/persistence.ts");
const { PostStore } = await import("../apps/api/src/posts.ts");

test("生日只接受真实公历日期并映射星座边界", () => {
  assert.equal(birthdaySchema.safeParse("2000-02-29").success, true);
  assert.equal(birthdaySchema.safeParse("2001-02-29").success, false);
  assert.equal(birthdaySchema.safeParse("2026-04-31").success, false);
  assert.equal(zodiacForBirthday("2000-03-20")?.key, "pisces");
  assert.equal(zodiacForBirthday("2000-03-21")?.key, "aries");
  assert.equal(zodiacForBirthday("2000-12-22")?.name, "摩羯座");
});

test("随手记与经验分享使用各自正文契约", () => {
  assert.equal(postInputSchema.safeParse({ kind: "note", content: "x".repeat(10_001) }).success, false);
  assert.equal(postInputSchema.safeParse({ kind: "experience", content: "x".repeat(10_001) }).success, true);
  assert.equal(postInputSchema.safeParse({ kind: "experience", content: "x".repeat(100_001) }).success, false);
  assert.equal(postInputSchema.parse({ content: "默认随手记" }).kind, "note");
  assert.deepEqual(POST_IMAGE_LIMITS, { note: 6, experience: 24 });
});

test("身份和职务权限只取决于师徒关系与相邻届职务，管理员没有豁免", () => {
  const target = { mentorId: "mentor", cohortYear: 2026 };
  assert.deepEqual(membershipPermissionsFor({ id: "mentor", cohortYear: 2025, groupRole: null }, target), {
    canEditMemberType: true, canEditGroupRole: true,
  });
  assert.deepEqual(membershipPermissionsFor({ id: "deputy", cohortYear: 2025, groupRole: "vice_leader" }, target), {
    canEditMemberType: false, canEditGroupRole: true,
  });
  assert.deepEqual(membershipPermissionsFor({ id: "same-year-leader", cohortYear: 2026, groupRole: "leader" }, target), {
    canEditMemberType: false, canEditGroupRole: false,
  });
  assert.deepEqual(membershipPermissionsFor({ id: "admin", cohortYear: 2020, groupRole: null }, target), {
    canEditMemberType: false, canEditGroupRole: false,
  });
});

test("受控字段更新保留版本冲突保护", async () => {
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          assert.match(sql, /target\.mentor_id/);
          return { mentorId: "mentor", targetCohortYear: 2026, actorCohortYear: 2025, actorGroupRole: null };
        },
        async run() {
          assert.match(sql, /version = \?/);
          return { meta: { changes: 0 } };
        },
      };
    },
  };
  const result = await new D1Persistence(db).updateMembership("mentor", "student", { version: 99, memberType: "formal" });
  assert.equal(result.state, "version-conflict");
});

test("过期的置顶请求不会先清除当前置顶", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; } };
      statements.push(statement);
      return statement;
    },
    async batch(batch) {
      assert.equal(batch.length, 2);
      assert.match(batch[0].sql, /EXISTS/);
      assert.deepEqual(batch[0].args, ["person-1", "post-2", "post-2", "person-1", 7]);
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    },
  };
  const result = await new PostStore(db).update("person-1", "post-2", { version: 7, isPinned: true });
  assert.equal(result, null);
});
