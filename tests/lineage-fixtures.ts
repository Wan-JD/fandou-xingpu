import type { Person, Cohort, TreeNode } from "../apps/api/src/types.ts";
import { analyzeLineage } from "../apps/api/src/lib/lineage.ts";

// Records used only by contract tests.
export const fixturePeople: Person[] = [
  { id: "fixture-person-001", name: "林砚", nickname: "砚叔", avatarUrl: null, role: "发起人 / 产品顾问", generation: "2019届", joinedAt: "2019-06-18", status: "archived", destination: "startup", tags: ["产品", "社区"], relationScope: "lineage", isFeatured: true, mentorId: null, bio: "从一张白纸开始，记录每一次认真连接。" },
  { id: "fixture-person-002", name: "周予安", nickname: null, avatarUrl: null, role: "全栈开发者", generation: "2021届", joinedAt: "2021-03-22", status: "archived", destination: "big_tech", tags: ["工程", "开源"], relationScope: "lineage", isFeatured: false, mentorId: "fixture-person-001", bio: "喜欢把复杂的问题拆成可以一起走的路。" },
  { id: "fixture-person-003", name: "许棠", nickname: null, avatarUrl: null, role: "研究与内容", generation: "2021届", joinedAt: "2021-04-08", status: "archived", destination: "postgraduate_985", tags: ["研究", "写作"], relationScope: "lineage", isFeatured: false, mentorId: "fixture-person-001", bio: "在资料、田野和人之间，寻找能被传下去的东西。" },
  { id: "fixture-person-004", name: "苏禾", nickname: null, avatarUrl: null, role: "交互设计师", generation: "2023届", joinedAt: "2023-09-01", status: "archived", destination: "postgraduate_211", tags: ["设计", "体验"], relationScope: "lineage", isFeatured: false, mentorId: "fixture-person-002", bio: "让每一个重要的瞬间都被好好看见。" },
  { id: "fixture-person-005", name: "陈放", nickname: null, avatarUrl: null, role: "数据工程师", generation: "2023届", joinedAt: "2023-10-12", status: "archived", destination: "other", tags: ["数据", "工具"], relationScope: "lineage", isFeatured: false, mentorId: "fixture-person-002", bio: "把看不见的结构，整理成可被理解的秩序。" },
  { id: "fixture-person-006", name: "唐宁", nickname: null, avatarUrl: null, role: "社会创新实践者", generation: "2024届", joinedAt: "2024-03-16", status: "active", destination: "further_study", tags: ["公益", "组织"], relationScope: "lineage", isFeatured: false, mentorId: "fixture-person-003", bio: "在真实世界里验证每一个好想法。" },
];

export const fixtureCohorts: Cohort[] = [
  { id: "cohort-2019", name: "2019届", year: 2019, memberCount: 1, description: "谱系起点的测试届次。" },
  { id: "cohort-2021", name: "2021届", year: 2021, memberCount: 2, description: "承接第一段师徒关系的测试届次。" },
  { id: "cohort-2023", name: "2023届", year: 2023, memberCount: 2, description: "在同一届中继续分化的测试届次。" },
  { id: "cohort-2024", name: "2024届", year: 2024, memberCount: 1, description: "当前测试谱系的最新届次。" },
];

const cohortByGeneration = new Map(fixtureCohorts.map((cohort) => [cohort.name, cohort]));
const peopleById = new Map(fixturePeople.map((person) => [person.id, person]));
const lineage = analyzeLineage(fixturePeople);

export function toSummary(person: Person) {
  const cohort = cohortByGeneration.get(person.generation);
  return {
    id: person.id,
    name: person.name,
    nickname: person.nickname,
    avatarUrl: person.avatarUrl,
    cohort: cohort ? { id: cohort.id, label: cohort.name, year: cohort.year, sortOrder: cohort.year - 2019 } : null,
    relationScope: person.relationScope,
    isFeatured: person.isFeatured,
    status: person.status,
    destination: person.destination,
  };
}

export function toTreeNode(person: Person): TreeNode {
  const cohort = cohortByGeneration.get(person.generation);
  return {
    ...toSummary(person),
    mentorId: person.mentorId,
    depth: lineage.depthById.get(person.id) ?? null,
    directStudentIds: [...(lineage.directStudentIdsByMentorId.get(person.id) ?? [])],
    role: person.role,
    generation: person.generation,
    joinedAt: person.joinedAt,
    tags: person.tags,
    bio: person.bio,
    cohort: cohort ? { id: cohort.id, label: cohort.name, year: cohort.year, sortOrder: cohort.year - 2019 } : null,
  };
}

export const fixtureTree = {
  rootPersonId: lineage.rootIds[0] ?? null,
  nodes: fixturePeople.map(toTreeNode),
  edges: fixturePeople.flatMap((person) => person.mentorId ? [{ id: `edge-${person.id}`, mentorId: person.mentorId, studentId: person.id }] : []),
  generatedAt: new Date().toISOString(),
};

export function findPerson(id: string) {
  return fixturePeople.find((person) => person.id === id);
}

export function findCohort(id: string) {
  return fixtureCohorts.find((cohort) => cohort.id === id);
}

export function getChildren(id: string) {
  return fixturePeople.filter((person) => person.mentorId === id);
}

export function addRegisteredPerson(input: { id: string; name: string; nickname: string | null; mentorId: string | null; relationScope?: "lineage" | "cohort_guest"; now?: number }) {
  const existing = peopleById.get(input.id);
  if (existing) return existing;
  const now = input.now ?? Date.now();
  const year = new Date(now).getUTCFullYear();
  const generation = `${year}届`;
  let cohort = cohortByGeneration.get(generation);
  if (!cohort) {
    cohort = { id: `cohort-${year}`, name: generation, year, memberCount: 0, description: `${year} 届成员。` };
    fixtureCohorts.push(cohort);
    cohortByGeneration.set(generation, cohort);
  }
  const person: Person = {
    id: input.id,
    name: input.name,
    nickname: input.nickname,
    avatarUrl: null,
    role: "星谱成员",
    generation,
    joinedAt: new Date(now).toISOString().slice(0, 10),
    status: "active",
    destination: null,
    tags: [],
    relationScope: input.relationScope ?? (input.mentorId ? "lineage" : "cohort_guest"),
    isFeatured: false,
    mentorId: input.mentorId,
    bio: "刚刚加入星谱，个人简介等待补充。",
  };
  fixturePeople.push(person);
  peopleById.set(person.id, person);
  cohort.memberCount += 1;

  const mentorNode = input.mentorId ? fixtureTree.nodes.find((node) => node.id === input.mentorId) : undefined;
  const node = toTreeNode(person);
  node.depth = mentorNode ? (mentorNode.depth ?? 0) + 1 : 0;
  fixtureTree.nodes.push(node);
  if (input.mentorId) fixtureTree.edges.push({ id: `edge-${person.id}`, mentorId: input.mentorId, studentId: person.id });
  if (mentorNode && !mentorNode.directStudentIds.includes(person.id)) mentorNode.directStudentIds.push(person.id);
  fixtureTree.generatedAt = new Date(now).toISOString();
  return person;
}

