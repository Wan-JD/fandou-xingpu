import assert from "node:assert/strict";
import test from "node:test";

const { layoutConstellation, descendantsOf, ancestorsOf, fitView, zoomAt } = await import("../apps/web/src/lib/constellation.ts");

/** A deterministic lineage: each mentor takes up to `fan` students per later row, `rows` cohorts deep. */
function forest({ rows = 5, fan = 3, roots = 1 } = {}) {
  const nodes = [];
  let seq = 0;
  const grow = (mentorId, row) => {
    const id = `p${String(seq += 1).padStart(4, "0")}`;
    nodes.push({ id, mentorId, row, order: id });
    if (row + 1 < rows) for (let index = 0; index < (seq % fan) + 1; index += 1) grow(id, row + 1);
    return id;
  };
  for (let index = 0; index < roots; index += 1) grow(null, 0);
  return nodes;
}

function assertNoOverlap(nodes, slots) {
  const byRow = new Map();
  nodes.forEach((node) => { if (slots.has(node.id)) byRow.set(node.row, [...(byRow.get(node.row) ?? []), slots.get(node.id)]); });
  byRow.forEach((xs, row) => {
    xs.sort((a, b) => a - b);
    for (let index = 1; index < xs.length; index += 1) assert.ok(xs[index] - xs[index - 1] >= 0.999, `row ${row} has stars ${xs[index - 1]} and ${xs[index]} closer than one slot`);
  });
}

test("同一级轨道中的星星至少相隔一个槽位", () => {
  const nodes = forest({ rows: 6, fan: 4, roots: 3 });
  const { slots } = layoutConstellation(nodes);
  assert.equal(slots.size, nodes.length);
  assertNoOverlap(nodes, slots);
});

test("师傅位于首尾徒弟正上方中点", () => {
  const nodes = forest({ rows: 4, fan: 3 });
  const { slots, children } = layoutConstellation(nodes);
  children.forEach((kids, mentor) => {
    const xs = kids.map((kid) => slots.get(kid));
    assert.ok(Math.abs(slots.get(mentor) - (xs[0] + xs[xs.length - 1]) / 2) < 1e-9, `${mentor} should be centred over its students`);
  });
});

test("紧凑布局的宽度接近人数最多的一级，而不是叶子总数", () => {
  // A chain-heavy lineage like the beta data: one wide early cohort whose members each continue down a single line.
  const nodes = [{ id: "root", mentorId: null, row: 0, order: "0" }];
  for (let index = 0; index < 9; index += 1) {
    let mentor = "root";
    for (let row = 1; row <= 4; row += 1) {
      const id = `c${index}-${row}`;
      nodes.push({ id, mentorId: mentor, row, order: id });
      mentor = id;
    }
  }
  const { span } = layoutConstellation(nodes);
  assert.ok(span <= 9 * 1.2, `span ${span} should stay close to the 9 stars of the widest row`);
});

test("折叠分支只隐藏其后辈，并保留后辈计数", () => {
  const nodes = forest({ rows: 4, fan: 3 });
  const full = layoutConstellation(nodes);
  const rootId = nodes[0].id;
  const firstChild = full.children.get(rootId)[0];
  const hidden = descendantsOf([firstChild], full.children);
  const folded = layoutConstellation(nodes, { hidden });
  assert.equal(folded.slots.size, nodes.length - hidden.size);
  assert.ok(folded.slots.has(firstChild));
  assert.equal(folded.descendants.get(firstChild), hidden.size);
  assertNoOverlap(nodes, folded.slots);
});

test("师徒环与缺失的师傅不会让布局崩溃", () => {
  const nodes = [
    { id: "a", mentorId: "b", row: 0, order: "a" },
    { id: "b", mentorId: "a", row: 1, order: "b" },
    { id: "c", mentorId: "missing", row: 1, order: "c" },
    { id: "d", mentorId: "c", row: 2, order: "d" },
  ];
  const { slots } = layoutConstellation(nodes);
  assert.equal(slots.size, 4);
  assertNoOverlap(nodes, slots);
});

test("同级徒弟与师傅同一行时不会与师傅重叠", () => {
  const nodes = [
    { id: "m", mentorId: null, row: 0, order: "m" },
    { id: "s1", mentorId: "m", row: 0, order: "s1" },
    { id: "s2", mentorId: "m", row: 1, order: "s2" },
  ];
  const { slots } = layoutConstellation(nodes);
  assertNoOverlap(nodes, slots);
});

test("祖先链与后辈集合沿师傅关系展开且能处理环", () => {
  const mentorOf = new Map([["c", "b"], ["b", "a"], ["a", null], ["x", "y"], ["y", "x"]]);
  assert.deepEqual(ancestorsOf("c", mentorOf), ["c", "b", "a"]);
  assert.deepEqual(ancestorsOf("x", mentorOf), ["x", "y"]);
  const children = new Map([["a", ["b"]], ["b", ["c", "d"]]]);
  assert.deepEqual([...descendantsOf(["a"], children)].sort(), ["b", "c", "d"]);
});

test("适应全图与定点缩放保持内容位置", () => {
  const view = fitView({ width: 2000, height: 1000 }, { width: 1000, height: 600 }, { min: 0.1, max: 1, padding: 0 });
  assert.equal(view.scale, 0.5);
  assert.equal(view.x, 0);
  const zoomed = zoomAt(view, 1, { x: 500, y: 300 });
  // The content point under the cursor before zooming is still under it afterwards.
  assert.equal((500 - view.x) / view.scale, (500 - zoomed.x) / zoomed.scale);
  assert.equal((300 - view.y) / view.scale, (300 - zoomed.y) / zoomed.scale);
});
