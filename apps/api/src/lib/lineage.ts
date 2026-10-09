export interface LineageMember {
  id: string;
  mentorId: string | null;
}

export type LineageValidationCode =
  | "DUPLICATE_ID"
  | "MISSING_MENTOR"
  | "SELF_MENTOR"
  | "CYCLE";

export class LineageValidationError extends Error {
  readonly code: LineageValidationCode;
  readonly personIds: readonly string[];

  constructor(code: LineageValidationCode, message: string, personIds: readonly string[]) {
    super(message);
    this.name = "LineageValidationError";
    this.code = code;
    this.personIds = Object.freeze([...personIds]);
  }
}

export interface LineageAnalysis {
  depthById: ReadonlyMap<string, number>;
  directStudentIdsByMentorId: ReadonlyMap<string, readonly string[]>;
  rootIds: readonly string[];
}

/**
 * Builds lineage-derived fields without relying on input order or cohort order.
 * Every person has at most one mentor, while any number of independent roots are allowed.
 */
export function analyzeLineage(members: readonly LineageMember[]): LineageAnalysis {
  const peopleById = new Map<string, LineageMember>();

  for (const member of members) {
    if (peopleById.has(member.id)) {
      throw new LineageValidationError(
        "DUPLICATE_ID",
        `Duplicate person id: ${member.id}`,
        [member.id],
      );
    }
    peopleById.set(member.id, member);
  }

  const studentIds = new Map<string, string[]>();
  const roots: string[] = [];
  for (const member of members) studentIds.set(member.id, []);

  for (const member of members) {
    const mentorId = member.mentorId;
    if (mentorId == null) {
      roots.push(member.id);
      continue;
    }
    if (mentorId === member.id) {
      throw new LineageValidationError(
        "SELF_MENTOR",
        `Person ${member.id} cannot mentor themself`,
        [member.id],
      );
    }
    if (!peopleById.has(mentorId)) {
      throw new LineageValidationError(
        "MISSING_MENTOR",
        `Person ${member.id} references missing mentor ${mentorId}`,
        [member.id, mentorId],
      );
    }
    studentIds.get(mentorId)!.push(member.id);
  }

  const depthById = new Map<string, number>();

  for (const member of members) {
    if (depthById.has(member.id)) continue;

    const path: LineageMember[] = [];
    const pathIndexById = new Map<string, number>();
    let cursor = member;
    let baseDepth = -1;

    while (true) {
      const knownDepth = depthById.get(cursor.id);
      if (knownDepth !== undefined) {
        baseDepth = knownDepth;
        break;
      }

      const cycleStart = pathIndexById.get(cursor.id);
      if (cycleStart !== undefined) {
        const cycleIds = path.slice(cycleStart).map((person) => person.id);
        cycleIds.push(cursor.id);
        throw new LineageValidationError(
          "CYCLE",
          `Mentor cycle detected: ${cycleIds.join(" -> ")}`,
          cycleIds,
        );
      }

      pathIndexById.set(cursor.id, path.length);
      path.push(cursor);

      if (cursor.mentorId == null) break;
      cursor = peopleById.get(cursor.mentorId)!;
    }

    while (path.length > 0) {
      const resolved = path.pop()!;
      baseDepth += 1;
      depthById.set(resolved.id, baseDepth);
    }
  }

  const directStudentIdsByMentorId = new Map<string, readonly string[]>();
  for (const [mentorId, ids] of studentIds) {
    directStudentIdsByMentorId.set(mentorId, Object.freeze([...ids]));
  }

  return {
    depthById,
    directStudentIdsByMentorId,
    rootIds: Object.freeze([...roots]),
  };
}
