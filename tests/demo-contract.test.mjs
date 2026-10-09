import assert from "node:assert/strict";
import test from "node:test";

const { demoPeople, demoCohorts, demoTree } = await import("../apps/api/src/data.ts");

const yearFromLabel = (label) => Number(String(label).match(/\d{4}/)?.[0] ?? NaN);

test("演示树的每条师徒边都连接到存在的人物", () => {
  const peopleById = new Map(demoPeople.map((person) => [person.id, person]));

  for (const edge of demoTree.edges) {
    assert.ok(peopleById.has(edge.mentorId), `missing mentor ${edge.mentorId}`);
    assert.ok(peopleById.has(edge.studentId), `missing student ${edge.studentId}`);
    assert.notEqual(edge.mentorId, edge.studentId, "a person cannot mentor themself");

    assert.ok(peopleById.get(edge.studentId));
  }
});

test("演示师徒链从唯一根节点连续到每个成员", () => {
  const incoming = new Map(demoPeople.map((person) => [person.id, 0]));
  for (const edge of demoTree.edges) incoming.set(edge.studentId, (incoming.get(edge.studentId) ?? 0) + 1);

  const roots = demoPeople.filter((person) => (incoming.get(person.id) ?? 0) === 0);
  assert.equal(roots.length, 1, "demo tree should have one root");
  assert.equal(demoTree.rootPersonId, roots[0].id);

  for (const person of demoPeople) {
    if (person.id === demoTree.rootPersonId) {
      assert.equal(person.mentorId ?? null, null);
      continue;
    }
    assert.equal(incoming.get(person.id), 1, `${person.id} should have one incoming lineage edge`);
  }
});

test("届次按年份归一化，不携带春秋季信息", () => {
  const cohortYears = new Map();
  for (const cohort of demoCohorts) {
    assert.match(cohort.name, /^\d{4}届$/, `cohort label must be year-only: ${cohort.name}`);
    assert.equal(cohort.year, yearFromLabel(cohort.name));
    assert.doesNotMatch(`${cohort.id} ${cohort.name}`, /spring|autumn|秋|春/i);
    assert.equal(cohortYears.has(cohort.year), false, `duplicate cohort year ${cohort.year}`);
    cohortYears.set(cohort.year, cohort.id);
  }

  const nodeById = new Map(demoTree.nodes.map((node) => [node.id, node]));
  for (const person of demoPeople) {
    assert.match(person.generation, /^\d{4}届$/, `person generation must be year-only: ${person.generation}`);
    const node = nodeById.get(person.id);
    assert.ok(node?.cohort, `${person.id} should have a normalized cohort`);
    assert.equal(node.cohort.year, yearFromLabel(person.generation));
  }
});

test("树节点、边和人物的 id 集合保持一致", () => {
  assert.deepEqual(new Set(demoTree.nodes.map((node) => node.id)), new Set(demoPeople.map((person) => person.id)));
  for (const edge of demoTree.edges) {
    assert.ok(demoTree.nodes.some((node) => node.id === edge.mentorId));
    assert.ok(demoTree.nodes.some((node) => node.id === edge.studentId));
  }
});
