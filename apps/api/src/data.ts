import type { Cohort, Person, TreeNode } from "./types";

// Deliberately fictional records for local development and UI integration.
export const demoPeople: Person[] = [
  {
    id: "demo-person-001",
    name: "演示成员甲",
    role: "产品与社区",
    generation: "2019 · 初始谱系",
    joinedAt: "2019-06-18",
    status: "active",
    tags: ["产品", "社区"]
  },
  {
    id: "demo-person-002",
    name: "演示成员乙",
    role: "全栈开发",
    generation: "2021 · 春季届",
    joinedAt: "2021-03-22",
    status: "active",
    tags: ["工程", "开源"]
  },
  {
    id: "demo-person-003",
    name: "演示成员丙",
    role: "研究与内容",
    generation: "2023 · 秋季届",
    joinedAt: "2023-09-01",
    status: "archived",
    tags: ["研究", "写作"]
  }
];

export const demoCohorts: Cohort[] = [
  {
    id: "demo-cohort-2021-spring",
    name: "2021 · 春季届",
    year: 2021,
    memberCount: 2,
    description: "用于演示初版接口的虚构届次。"
  },
  {
    id: "demo-cohort-2023-autumn",
    name: "2023 · 秋季届",
    year: 2023,
    memberCount: 1,
    description: "用于演示归档记录的虚构届次。"
  }
];

const cohortByGeneration = new Map(
  demoCohorts.map((cohort) => [cohort.name, cohort])
);

export const demoTree: {
  rootPersonId: string | null;
  nodes: TreeNode[];
  edges: { id: string; mentorId: string; studentId: string }[];
  generatedAt: string;
  demo: true;
} = {
  rootPersonId: demoPeople[0]?.id ?? null,
  nodes: demoPeople.map((person, index) => {
    const cohort = cohortByGeneration.get(person.generation);
    return {
      id: person.id,
      name: person.name,
      nickname: null,
      avatarUrl: null,
      cohort: cohort
        ? { id: cohort.id, label: cohort.name, year: cohort.year, sortOrder: index }
        : null,
      relationScope: "lineage",
      isFeatured: index === 0,
      status: person.status,
      mentorId: index === 0 ? null : demoPeople[0]?.id ?? null,
      depth: index === 0 ? 0 : 1,
      directStudentIds: index === 0 ? demoPeople.slice(1).map((item) => item.id) : [],
      role: person.role,
      generation: person.generation,
      joinedAt: person.joinedAt,
      tags: person.tags
    };
  }),
  edges: demoPeople.slice(1).map((person) => ({
    id: `demo-edge-${person.id}`,
    mentorId: demoPeople[0]?.id ?? "",
    studentId: person.id
  })),
  generatedAt: new Date().toISOString(),
  demo: true
};
