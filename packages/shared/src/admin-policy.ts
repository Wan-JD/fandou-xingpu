import { academicYearAt } from "./domain.ts";

export const PERMANENT_ADMIN_EMAIL = "wanjundi0512@163.com";

export type AdminReason = "permanent_owner" | "active_group_leader" | null;

export function effectiveAdminPolicy(account: {
  email: string | null | undefined;
  personStatus: "active" | "archived" | null | undefined;
  cohortYear: number | null | undefined;
  groupRole: "leader" | "vice_leader" | null | undefined;
}, at: Date = new Date()): { role: "member" | "admin"; permanentAdmin: boolean; adminReason: AdminReason } {
  const permanentAdmin = account.email?.trim().toLocaleLowerCase() === PERMANENT_ADMIN_EMAIL;
  if (permanentAdmin) return { role: "admin", permanentAdmin: true, adminReason: "permanent_owner" };
  const academicYear = academicYearAt(at);
  const isCurrentStudent = Number.isInteger(account.cohortYear)
    && Number(account.cohortYear) >= academicYear - 3
    && Number(account.cohortYear) <= academicYear;
  const isLeader = account.groupRole === "leader" || account.groupRole === "vice_leader";
  if (account.personStatus === "active" && isCurrentStudent && isLeader) {
    return { role: "admin", permanentAdmin: false, adminReason: "active_group_leader" };
  }
  return { role: "member", permanentAdmin: false, adminReason: null };
}

