// In-app navigation guard: a page with unsaved work registers a check that runs before route changes.
type LeaveGuard = () => boolean;
let guard: LeaveGuard | null = null;

export function setLeaveGuard(next: LeaveGuard | null) {
  guard = next;
}

/** Returns false when the current page asked to stay. */
export function canLeave() {
  return guard ? guard() : true;
}
