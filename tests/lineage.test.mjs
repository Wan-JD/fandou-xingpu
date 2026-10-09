import assert from "node:assert/strict";
import test from "node:test";

const { analyzeLineage, LineageValidationError } = await import("../apps/api/src/lib/lineage.ts");

test("computes depths and direct students from relationships instead of array positions", () => {
  const people = [
    { id: "student-b", mentorId: "mentor", cohort: "2024届" },
    { id: "grandchild", mentorId: "student-a", cohort: "2026届" },
    { id: "other-root", mentorId: null, cohort: "2021届" },
    { id: "mentor", mentorId: null, cohort: "2019届" },
    { id: "student-a", mentorId: "mentor", cohort: "2023届" },
    { id: "other-child", mentorId: "other-root", cohort: "2025届" },
  ];

  const analysis = analyzeLineage(people);

  assert.deepEqual([...analysis.rootIds], ["other-root", "mentor"]);
  assert.deepEqual(
    Object.fromEntries(analysis.depthById),
    {
      "student-b": 1,
      grandchild: 2,
      "other-root": 0,
      mentor: 0,
      "student-a": 1,
      "other-child": 1,
    },
  );
  assert.deepEqual([...analysis.directStudentIdsByMentorId.get("mentor")], ["student-b", "student-a"]);
  assert.deepEqual([...analysis.directStudentIdsByMentorId.get("student-a")], ["grandchild"]);
  assert.deepEqual([...analysis.directStudentIdsByMentorId.get("student-b")], []);
});

test("allows same-cohort and cross-cohort mentor links", () => {
  const analysis = analyzeLineage([
    { id: "a", mentorId: null, cohort: "2020届" },
    { id: "b", mentorId: "a", cohort: "2020届" },
    { id: "c", mentorId: "b", cohort: "2025届" },
  ]);

  assert.equal(analysis.depthById.get("a"), 0);
  assert.equal(analysis.depthById.get("b"), 1);
  assert.equal(analysis.depthById.get("c"), 2);
});

test("handles a deep lineage iteratively without overflowing the call stack", () => {
  const generationCount = 20_000;
  const people = Array.from({ length: generationCount }, (_, index) => ({
    id: `person-${index}`,
    mentorId: index === 0 ? null : `person-${index - 1}`,
  })).reverse();

  const analysis = analyzeLineage(people);

  assert.equal(analysis.depthById.get("person-0"), 0);
  assert.equal(analysis.depthById.get(`person-${generationCount - 1}`), generationCount - 1);
  assert.deepEqual(analysis.directStudentIdsByMentorId.get("person-9999"), ["person-10000"]);
});

test("reports a missing mentor with the affected ids", () => {
  assert.throws(
    () => analyzeLineage([{ id: "student", mentorId: "missing" }]),
    (error) => {
      assert.ok(error instanceof LineageValidationError);
      assert.equal(error.code, "MISSING_MENTOR");
      assert.deepEqual([...error.personIds], ["student", "missing"]);
      assert.match(error.message, /missing mentor/i);
      return true;
    },
  );
});

test("reports an entire mentor cycle instead of recursing indefinitely", () => {
  assert.throws(
    () => analyzeLineage([
      { id: "a", mentorId: "c" },
      { id: "b", mentorId: "a" },
      { id: "c", mentorId: "b" },
    ]),
    (error) => {
      assert.ok(error instanceof LineageValidationError);
      assert.equal(error.code, "CYCLE");
      assert.deepEqual([...error.personIds], ["a", "c", "b", "a"]);
      assert.match(error.message, /a -> c -> b -> a/);
      return true;
    },
  );
});

test("reports self-mentoring and duplicate ids explicitly", () => {
  assert.throws(
    () => analyzeLineage([{ id: "a", mentorId: "a" }]),
    (error) => error instanceof LineageValidationError && error.code === "SELF_MENTOR",
  );
  assert.throws(
    () => analyzeLineage([{ id: "a", mentorId: null }, { id: "a", mentorId: null }]),
    (error) => error instanceof LineageValidationError && error.code === "DUPLICATE_ID",
  );
});
