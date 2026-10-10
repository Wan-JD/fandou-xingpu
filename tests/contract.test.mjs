import assert from "node:assert/strict";
import test from "node:test";

const { fixturePeople, fixtureCohorts, fixtureTree } = await import("./lineage-fixtures.ts");
const { destinationSchema } = await import("../packages/shared/src/schemas.ts");

const yearFromLabel = (label) => Number(String(label).match(/\d{4}/)?.[0] ?? NaN);
const personStatuses = new Set(["active", "archived"]);
const destinationKinds = new Set([
  "big_tech",
  "postgraduate_985",
  "postgraduate_211",
  "startup",
  "further_study",
  "other",
]);

test("测试树的每条师徒边都连接到存在的人物", () => {
  const peopleById = new Map(fixturePeople.map((person) => [person.id, person]));

  for (const edge of fixtureTree.edges) {
    assert.ok(peopleById.has(edge.mentorId), `missing mentor ${edge.mentorId}`);
    assert.ok(peopleById.has(edge.studentId), `missing student ${edge.studentId}`);
    assert.notEqual(edge.mentorId, edge.studentId, "a person cannot mentor themself");

    assert.ok(peopleById.get(edge.studentId));
  }
});

test("测试师徒链从唯一根节点连续到每个成员", () => {
  const incoming = new Map(fixturePeople.map((person) => [person.id, 0]));
  for (const edge of fixtureTree.edges) incoming.set(edge.studentId, (incoming.get(edge.studentId) ?? 0) + 1);

  const roots = fixturePeople.filter((person) => (incoming.get(person.id) ?? 0) === 0);
  assert.equal(roots.length, 1, "fixture tree should have one root");
  assert.equal(fixtureTree.rootPersonId, roots[0].id);

  for (const person of fixturePeople) {
    if (person.id === fixtureTree.rootPersonId) {
      assert.equal(person.mentorId ?? null, null);
      continue;
    }
    assert.equal(incoming.get(person.id), 1, `${person.id} should have one incoming lineage edge`);
  }
});

test("届次按年份归一化，不携带春秋季信息", () => {
  const cohortYears = new Map();
  for (const cohort of fixtureCohorts) {
    assert.match(cohort.name, /^\d{4}届$/, `cohort label must be year-only: ${cohort.name}`);
    assert.equal(cohort.year, yearFromLabel(cohort.name));
    assert.doesNotMatch(`${cohort.id} ${cohort.name}`, /spring|autumn|秋|春/i);
    assert.equal(cohortYears.has(cohort.year), false, `duplicate cohort year ${cohort.year}`);
    cohortYears.set(cohort.year, cohort.id);
  }

  const nodeById = new Map(fixtureTree.nodes.map((node) => [node.id, node]));
  for (const person of fixturePeople) {
    assert.match(person.generation, /^\d{4}届$/, `person generation must be year-only: ${person.generation}`);
    const node = nodeById.get(person.id);
    assert.ok(node?.cohort, `${person.id} should have a normalized cohort`);
    assert.equal(node.cohort.year, yearFromLabel(person.generation));
  }
});

test("树节点、边和人物的 id 集合保持一致", () => {
  assert.deepEqual(new Set(fixtureTree.nodes.map((node) => node.id)), new Set(fixturePeople.map((person) => person.id)));
  for (const edge of fixtureTree.edges) {
    assert.ok(fixtureTree.nodes.some((node) => node.id === edge.mentorId));
    assert.ok(fixtureTree.nodes.some((node) => node.id === edge.studentId));
  }
});

test("成员状态保持存储兼容，去向值属于公开契约", () => {
  for (const person of fixturePeople) {
    assert.ok(personStatuses.has(person.status), `${person.id} has unsupported status ${person.status}`);
    assert.ok(
      person.destination === null || destinationKinds.has(person.destination),
      `${person.id} has unsupported destination ${person.destination}`,
    );
  }

  assert.ok(fixturePeople.some((person) => person.status === "active"), "fixture data should cover active status");
  assert.ok(fixturePeople.some((person) => person.status === "archived"), "fixture data should cover archived status");
  for (const required of ["big_tech", "postgraduate_985", "postgraduate_211"]) {
    assert.ok(fixturePeople.some((person) => person.destination === required), `fixture data should cover ${required}`);
  }
});

test("树节点完整透传人物状态与去向", () => {
  const nodesById = new Map(fixtureTree.nodes.map((node) => [node.id, node]));

  for (const person of fixturePeople) {
    const node = nodesById.get(person.id);
    assert.ok(node, `${person.id} should exist in fixture tree`);
    assert.equal(node.status, person.status);
    assert.equal(node.destination, person.destination);
  }
});

test("共享去向 Schema 接受约定枚举与空值并拒绝未知值", () => {
  for (const destination of destinationKinds) {
    assert.equal(destinationSchema.safeParse(destination).success, true, `${destination} should be valid`);
  }
  assert.equal(destinationSchema.nullable().safeParse(null).success, true);
  assert.equal(destinationSchema.safeParse("unknown").success, false);
});

test("测试树中每位学生的深度比师傅大一层", () => {
  const nodesById = new Map(fixtureTree.nodes.map((node) => [node.id, node]));

  for (const edge of fixtureTree.edges) {
    const mentor = nodesById.get(edge.mentorId);
    const student = nodesById.get(edge.studentId);
    assert.ok(mentor && student);
    assert.equal(student.depth, mentor.depth + 1, `${student.id} should be one level below ${mentor.id}`);
  }
});

