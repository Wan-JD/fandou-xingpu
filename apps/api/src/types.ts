export interface Env {
  API_ENV?: string;
  ALLOWED_ORIGIN?: string;
  DB?: D1Database;
  FILES?: R2Bucket;
}

export type Destination = "big_tech" | "postgraduate_985" | "postgraduate_211" | "other";
export type GroupRole = "leader" | "vice_leader";

export interface Person {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  cohortYear: number | null;
  role: string;
  generation: string;
  joinedAt: string;
  status: "active" | "archived";
  memberType: "formal" | "probationary";
  destination: Destination | null;
  groupRole: GroupRole | null;
  tags: string[];
  relationScope: "lineage" | "cohort_guest";
  isFeatured: boolean;
  mentorId: string | null;
  bio: string;
  motto?: string | null;
  coverTheme?: string | null;
  contactEmail?: string | null;
  education?: string | null;
  experience?: string | null;
  skills?: string[];
  links?: { label: string; url: string }[];
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
  memberType: "formal" | "probationary";
  destination: Destination | null;
  groupRole: GroupRole | null;
  mentorId: string | null;
  depth: number | null;
  directStudentIds: string[];
  role: string;
  generation: string;
  joinedAt: string;
  tags: string[];
  bio: string;
  contactEmail?: string | null;
  education?: string | null;
  experience?: string | null;
  skills?: string[];
  links?: { label: string; url: string }[];
}
