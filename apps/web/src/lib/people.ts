// Shared client-side shapes and labels for members of the lineage.
export type Status = "active" | "archived";
export type MembershipType = "formal" | "probationary";
export type Destination = "big_tech" | "postgraduate_985" | "postgraduate_211" | "other";
export type GroupRole = "leader" | "vice_leader";
export type CoverTheme = "nebula" | "aurora" | "dawn" | "abyss";
export type Tone = "gold" | "aqua" | "fog";
export type Cohort = { id: string; label: string; year: number | null; sortOrder: number };
export type Achievement = { id: string; kind: "achievement" | "honor"; title: string; content: string; occurredOn: string | null; datePrecision?: string | null; version: number; createdAt?: string };
export type Attachment = { id: string; originalName: string; mimeType: string; size: number; category: string; visibility: string; url: string | null; createdAt?: string };
export type ProfileLink = { label: string; url: string };
export type UploadCategory = "avatar" | "resume" | "photo" | "certificate";
export type PersonSummary = { id: string; name: string; avatarUrl: string | null; cohort: Cohort | null; status: Status; memberType?: MembershipType | null; destination: Destination | null; groupRole: GroupRole | null; isFeatured?: boolean };
export type Person = PersonSummary & {
  relationScope: "lineage" | "cohort_guest"; isFeatured: boolean; mentorId: string | null; depth: number | null; directStudentIds: string[];
  role: string; joinedAt: string; tags: string[]; bio: string; motto?: string | null; coverTheme?: CoverTheme | null;
  contactEmail?: string | null; education?: string | null; experience?: string | null; skills?: string[]; links?: ProfileLink[];
  resume?: Attachment | null; version?: number; mentor?: PersonSummary | null; students?: PersonSummary[]; achievements?: Achievement[];
  attachments?: Attachment[]; featuredNote?: string | null; lineagePath?: PersonSummary[]; descendantCount?: number; cohortPeers?: PersonSummary[]; postCount?: number;
};
export type SessionUser = { id: string; email?: string | null; phone?: string | null; displayName: string; personId: string; role: "member" | "admin"; mustChangePassword?: boolean };
export type PostImage = { id: string; url: string };
export type Post = { id: string; personId: string; title: string | null; content: string; visibility: "public" | "members"; isPinned: boolean; images: PostImage[]; likeCount: number; likedByViewer: boolean; version: number; createdAt: string; updatedAt: string };

export const destinationLabels: Record<Destination, string> = {
  big_tech: "大厂",
  postgraduate_985: "985研",
  postgraduate_211: "211研",
  other: "其他",
};
export const groupRoleLabels: Record<GroupRole, string> = { leader: "组长", vice_leader: "副组长" };
export const membershipLabels: Record<MembershipType, string> = { formal: "正式组员", probationary: "预备组员" };
export const coverThemes: Array<{ id: CoverTheme; label: string }> = [
  { id: "nebula", label: "星云" },
  { id: "aurora", label: "极光" },
  { id: "dawn", label: "晨曦" },
  { id: "abyss", label: "深空" },
];

export const isDestination = (value: unknown): value is Destination => typeof value === "string" && value in destinationLabels;
export const isGroupRole = (value: unknown): value is GroupRole => value === "leader" || value === "vice_leader";
export const isMembershipType = (value: unknown): value is MembershipType => value === "formal" || value === "probationary";
export const formatCohort = (cohort: { year: number | null } | null | undefined) => cohort?.year ? `${cohort.year} 级` : "未分级";
export const relationLabel = (person: { status: Status }) => person.status === "archived" ? "毕业" : "在读";
export const destinationLabel = (person: { destination: Destination | null }) => person.destination ? destinationLabels[person.destination] : "去向待补充";
export const destinationClass = (person: { destination: Destination | null }) => person.destination ? `destination-${person.destination}` : "destination-unset";
export const groupRoleClass = (person: { groupRole?: GroupRole | null }) => person.groupRole ? `group-${person.groupRole}` : "";
export const membershipLabel = (person: { memberType?: MembershipType | null }) => person.memberType ? membershipLabels[person.memberType] : "";

/** Gold marks the root and featured stars, fog marks graduates, everyone else glows aqua. */
export function toneFor(person: { status: Status; isFeatured?: boolean; id: string }, rootId: string | null | undefined): Tone {
  if (person.status === "archived") return "fog";
  return person.isFeatured || person.id === rootId ? "gold" : "aqua";
}

function normaliseCohort(raw: Partial<Cohort> | null | undefined): Cohort | null {
  if (!raw) return null;
  const rawYear = raw.year ?? String(raw.label ?? "").match(/\d{4}/)?.[0];
  const year = rawYear ? Number(rawYear) : null;
  return { id: year ? `cohort-${year}` : String(raw.id ?? "uncategorized"), label: year ? `${year} 级` : "未分级", year, sortOrder: Number(raw.sortOrder ?? 99) };
}

export function normaliseSummary(node: Record<string, unknown>): PersonSummary {
  return {
    id: String(node.id),
    name: String(node.name ?? ""),
    avatarUrl: node.avatarUrl == null ? null : String(node.avatarUrl),
    cohort: normaliseCohort(node.cohort as Partial<Cohort> | null),
    status: node.status === "archived" ? "archived" : "active",
    memberType: isMembershipType(node.memberType) ? node.memberType : null,
    destination: isDestination(node.destination) ? node.destination : null,
    groupRole: isGroupRole(node.groupRole) ? node.groupRole : null,
    isFeatured: Boolean(node.isFeatured),
  };
}

const summaries = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")).map(normaliseSummary)
  : undefined;

export function normaliseNode(node: Record<string, unknown>): Person {
  if (typeof node.id !== "string" || !node.id.trim() || typeof node.name !== "string" || !node.name.trim()) throw new Error("invalid person");
  const rawMemberType = node.memberType;
  const memberType = isMembershipType(rawMemberType) ? rawMemberType : rawMemberType === "正式组员" ? "formal" : rawMemberType === "预备组员" ? "probationary" : null;
  const skills = Array.isArray(node.skills) ? node.skills.filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim())) : [];
  const links = Array.isArray(node.links) ? node.links.filter((link): link is ProfileLink => Boolean(link && typeof link === "object" && typeof (link as ProfileLink).label === "string" && typeof (link as ProfileLink).url === "string")) : [];
  const coverTheme = coverThemes.some((theme) => theme.id === node.coverTheme) ? node.coverTheme as CoverTheme : null;
  return {
    ...(node as object),
    ...normaliseSummary(node),
    memberType,
    relationScope: node.relationScope === "cohort_guest" ? "cohort_guest" : "lineage",
    mentorId: node.mentorId == null ? null : String(node.mentorId),
    depth: typeof node.depth === "number" ? node.depth : null,
    directStudentIds: Array.isArray(node.directStudentIds) ? node.directStudentIds.map(String) : [],
    role: String(node.role ?? "星谱成员"),
    joinedAt: String(node.joinedAt ?? ""),
    tags: Array.isArray(node.tags) ? node.tags.map(String) : [],
    bio: String(node.bio ?? ""),
    motto: node.motto == null || node.motto === "" ? null : String(node.motto),
    coverTheme,
    version: Number(node.version ?? 1),
    contactEmail: node.contactEmail == null ? null : String(node.contactEmail),
    education: node.education == null ? null : String(node.education),
    experience: node.experience == null ? null : String(node.experience),
    skills,
    links,
    mentor: node.mentor && typeof node.mentor === "object" ? normaliseSummary(node.mentor as Record<string, unknown>) : null,
    students: summaries(node.students),
    lineagePath: summaries(node.lineagePath),
    cohortPeers: summaries(node.cohortPeers),
    descendantCount: typeof node.descendantCount === "number" ? node.descendantCount : undefined,
    postCount: typeof node.postCount === "number" ? node.postCount : undefined,
  } as Person;
}
