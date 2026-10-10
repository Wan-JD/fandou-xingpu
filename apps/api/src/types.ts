export interface Env {
  API_ENV?: string;
  ALLOWED_ORIGIN?: string;
  DB?: D1Database;
  FILES?: R2Bucket;
}

export interface Person {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  role: string;
  generation: string;
  joinedAt: string;
  status: "active" | "archived";
  destination: "big_tech" | "postgraduate_985" | "postgraduate_211" | "startup" | "further_study" | "other" | null;
  tags: string[];
  relationScope: "lineage" | "cohort_guest";
  isFeatured: boolean;
  mentorId: string | null;
  bio: string;
}

export interface Cohort {
  id: string;
  name: string;
  year: number;
  sortOrder?: number;
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
  destination: "big_tech" | "postgraduate_985" | "postgraduate_211" | "startup" | "further_study" | "other" | null;
  mentorId: string | null;
  depth: number | null;
  directStudentIds: string[];
  role: string;
  generation: string;
  joinedAt: string;
  tags: string[];
  bio: string;
}
