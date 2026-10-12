import type { JoinSeason } from "./domain.ts";

export type Id = string;

export type RelationScope = "lineage" | "cohort_guest";
export type PersonStatus = "active" | "archived";
export type MemberType = "formal" | "probationary";
export type Destination = "big_tech" | "postgraduate_985" | "postgraduate_211" | "other";
export type GroupRole = "leader" | "vice_leader";
export type CoverTheme = "nebula" | "aurora" | "dawn" | "abyss";
export type PostVisibility = "public" | "members";
export type PostKind = "note" | "experience";
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
  avatarUrl: string | null;
  cohortYear: number | null;
  cohort: CohortSummary | null;
  relationScope: RelationScope;
  isFeatured: boolean;
  status: PersonStatus;
  memberType: MemberType;
  destination: Destination | null;
  groupRole: GroupRole | null;
  birthday: string | null;
}

export interface PersonNode extends PersonSummary {
  mentorId: Id | null;
  depth: number | null;
  directStudentIds: Id[];
  role: string;
  generation: string;
  joinedAt: string;
  joinedYear: number;
  joinedSeason: JoinSeason;
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

export interface PostImage {
  id: Id;
  url: string;
}

export interface Post {
  id: Id;
  personId: Id;
  title: string | null;
  content: string;
  visibility: PostVisibility;
  kind: PostKind;
  isPinned: boolean;
  images: PostImage[];
  likeCount: number;
  likedByViewer: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonDetail extends PersonSummary {
  role: string;
  motto: string | null;
  coverTheme: CoverTheme | null;
  lineagePath: PersonSummary[];
  descendantCount: number;
  cohortPeers: PersonSummary[];
  postCount: number;
  generation: string;
  joinedAt: string;
  joinedYear: number;
  joinedSeason: JoinSeason;
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
  permissions: {
    canEditMemberType: boolean;
    canEditGroupRole: boolean;
  };
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
  destination?: Destination | null;
  birthday?: string | null;
  joinedYear?: number;
  joinedSeason?: JoinSeason;
  motto?: string | null;
  coverTheme?: CoverTheme | null;
  contactEmail?: string | null;
  education?: string | null;
  experience?: string | null;
  skills?: string[];
  links?: ProfileLink[];
  version: number;
}

export interface SessionUser {
  id: Id;
  email: string | null;
  phone: string | null;
  displayName: string;
  personId: Id;
  role: "member" | "admin";
  mustChangePassword: boolean;
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
