export interface Env {
  API_ENV?: string;
  ALLOWED_ORIGIN?: string;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  generation: string;
  joinedAt: string;
  status: "active" | "archived";
  tags: string[];
}

export interface Cohort {
  id: string;
  name: string;
  year: number;
  memberCount: number;
  description: string;
}

export interface TreeNode {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  cohort: { id: string; label: string; year: number | null; sortOrder: number } | null;
  relationScope: "lineage" | "cohort_guest";
  isFeatured: boolean;
  status: "active" | "archived";
  mentorId: string | null;
  depth: number;
  directStudentIds: string[];
  role: string;
  generation: string;
  joinedAt: string;
  tags: string[];
}
