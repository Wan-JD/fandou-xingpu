import assert from "node:assert/strict";
import test from "node:test";

const { academicGrade, destinationEligible, gradeLabel, treeGroupRole } = await import("../apps/web/src/lib/people.ts");
const { joinedSeasonLabel } = await import("../apps/web/src/lib/format.ts");
const { effectiveAdminPolicy, PERMANENT_ADMIN_EMAIL } = await import("../packages/shared/src/admin-policy.ts");

test("年级在上海时区每年九月更新", () => {
  assert.equal(academicGrade(2026, new Date("2026-10-12T00:00:00Z")), 1);
  assert.equal(academicGrade(2026, new Date("2027-03-01T00:00:00Z")), 1);
  assert.equal(academicGrade(2026, new Date("2027-08-31T15:59:59Z")), 1);
  assert.equal(academicGrade(2026, new Date("2027-08-31T16:00:00Z")), 2);
  assert.equal(gradeLabel(2023, new Date("2027-03-01T00:00:00Z")), "大四");
  assert.equal(gradeLabel(2027, new Date("2026-10-12T00:00:00Z")), "待入学");
});

test("星谱只标记大二正副组长和大三正组长", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const person = (year, groupRole) => ({ cohort: { year }, groupRole });
  assert.equal(treeGroupRole(person(2025, "leader"), now), "leader");
  assert.equal(treeGroupRole(person(2025, "vice_leader"), now), "vice_leader");
  assert.equal(treeGroupRole(person(2024, "leader"), now), "leader");
  assert.equal(treeGroupRole(person(2024, "vice_leader"), now), null);
  assert.equal(treeGroupRole(person(2026, "leader"), now), null);
  assert.equal(treeGroupRole(person(2023, "leader"), now), null);
});

test("去向统计只包含毕业成员或大四成员", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  assert.equal(destinationEligible({ cohort: { year: 2023 }, status: "active" }, now), true);
  assert.equal(destinationEligible({ cohort: { year: 2024 }, status: "active" }, now), false);
  assert.equal(destinationEligible({ cohort: { year: 2099 }, status: "archived" }, now), false, "future test cohorts never enter destination statistics");
});

test("进组日期只展示年份和春秋季", () => {
  assert.equal(joinedSeasonLabel("2024-03-01"), "2024年春季");
  assert.equal(joinedSeasonLabel("2024-09-01"), "2024年秋季");
});

test("在读正副组长按上海学年自动获得管理员权限", () => {
  const beforeRollover = new Date("2027-08-31T15:59:59Z");
  const afterRollover = new Date("2027-08-31T16:00:00Z");
  const account = (cohortYear, groupRole = "leader", personStatus = "active") => ({
    email: "student@example.com", cohortYear, groupRole, personStatus,
  });

  assert.equal(effectiveAdminPolicy(account(2023), beforeRollover).role, "admin", "四年级仍在自动管理范围内");
  assert.equal(effectiveAdminPolicy(account(2023), afterRollover).role, "member", "九月学年切换后毕业届失去权限");
  assert.equal(effectiveAdminPolicy(account(2024, "vice_leader"), afterRollover).role, "admin", "副组长也自动获得权限");
  assert.equal(effectiveAdminPolicy(account(2028), afterRollover).role, "member", "尚未入学的届次不获得权限");
  assert.equal(effectiveAdminPolicy(account(2027, null), afterRollover).role, "member", "无组内职务不获得权限");
  assert.equal(effectiveAdminPolicy(account(2027, "leader", "archived"), afterRollover).role, "member", "已归档组长失去权限");
});

test("永久管理员由规范化邮箱识别且不受成员状态影响", () => {
  const result = effectiveAdminPolicy({
    email: `  ${PERMANENT_ADMIN_EMAIL.toUpperCase()}  `,
    cohortYear: null,
    groupRole: null,
    personStatus: "archived",
  }, new Date("2027-09-01T00:00:00Z"));

  assert.deepEqual(result, { role: "admin", permanentAdmin: true, adminReason: "permanent_owner" });
});
