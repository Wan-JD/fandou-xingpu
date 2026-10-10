export type Id = string;

export type RelationScope = "lineage" | "cohort_guest";
export type PersonStatus = "active" | "archived";
export type Destination = "big_tech" | "postgraduate_985" | "postgraduate_211" | "startup" | "further_study" | "other";
export type DatePrecision = "year" | "month" | "day";
export type AchievementKind = "achievement" | "honor";
export type AttachmentCategory = "avatar" | "resume" | "photo" | "certificate" | "other";
export type AttachmentVisibility = "members" | "private";

export interface CohortSummary {
  id: Id;
  label: string;
  year: number | null;
  sortOrder: number;
}

export interface PersonSummary {
  id: Id;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  cohort: CohortSummary | null;
  relationScope: RelationScope;
  isFeatured: boolean;
  status: PersonStatus;
  destination: Destination | null;
}

export interface PersonNode extends PersonSummary {
  mentorId: Id | null;
  depth: number | null;
  directStudentIds: Id[];
  role: string;
  generation: string;
  joinedAt: string;
  tags: string[];
  bio: string;
  contactEmail?: string | null;
  education?: string | null;
  experience?: string | null;
  skills?: string[];
  links?: ProfileLink[];
}

export interface ProfileLink {
  label: string;
  url: string;
}

export interface TreeEdge {
  id: string;
  mentorId: Id;
  studentId: Id;
}

export interface TreeResponse {
  rootPersonId: Id | null;
  nodes: PersonNode[];
  edges: TreeEdge[];
  generatedAt: string;
}

export interface Achievement {
  id: Id;
  personId: Id;
  kind: AchievementKind;
  title: string;
  content: string;
  occurredOn: string | null;
  datePrecision: DatePrecision | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttachmentSummary {
  id: Id;
  personId: Id;
  achievementId: Id | null;
  originalName: string;
  mimeType: string;
  size: number;
  category: AttachmentCategory;
  visibility: AttachmentVisibility;
  status: "pending" | "ready" | "deleted";
  url: string | null;
}

export interface PersonDetail extends PersonSummary {
  role: string;
  generation: string;
  joinedAt: string;
  tags: string[];
  mentor: PersonSummary | null;
  students: PersonSummary[];
  bio: string;
  contactEmail: string | null;
  education: string | null;
  experience: string | null;
  skills: string[];
  links: ProfileLink[];
  featuredNote: string | null;
  resume: AttachmentSummary | null;
  achievements: Achievement[];
  attachments: AttachmentSummary[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CohortDetail extends CohortSummary {
  description: string | null;
  lineagePeople: PersonSummary[];
  guestPeople: PersonSummary[];
}

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
  meta?: {
    total?: number;
    limit?: number;
    query?: string;
  };
}

export interface ApiErrorResponse {
  error: ApiError;
  requestId?: string;
}

export interface TreeQuery {
  rootPersonId?: Id;
  includeGuests?: boolean;
  maxDepth?: number;
}

export interface PersonUpdateInput {
  bio?: string;
  nickname?: string | null;
  destination?: Destination | null;
  contactEmail?: string | null;
  education?: string | null;
  experience?: string | null;
  skills?: string[];
  links?: ProfileLink[];
  version: number;
}

export interface SessionUser {
  id: Id;
  email: string;
  displayName: string;
  personId: Id;
  role: "member" | "admin";
}

export interface SessionData {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export interface AchievementInput {
  kind: AchievementKind;
  title: string;
  content: string;
  occurredOn?: string | null;
  datePrecision?: DatePrecision | null;
}

export interface PersonSearchQuery {
  q: string;
  limit?: number;
}

export interface PersonSearchResult {
  items: PersonSummary[];
  total: number;
}
