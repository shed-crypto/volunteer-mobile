/**
 * src/db/helpers/assignments.ts
 *
 * Centralised helpers for computing active-assignment counts from
 * task_assignment rows (or server-side assignment objects).
 *
 * These pure functions are used wherever the UI needs an reliable
 * assignedCount — load the assignments once and pass the array in,
 * so the count is always consistent with the local DB.
 */

export type AssignmentLike = {
  status: string;
};

/** Count assignments that are NOT withdrawn or completed */
export function countActiveAssignments(assignments?: AssignmentLike[]): number {
  if (!Array.isArray(assignments)) return 0;
  return assignments.filter((a) => a.status !== 'withdrawn' && a.status !== 'completed').length;
}

/** Same as above, but for a full list that's already filtered */
export function computeAssignedCount(assignments?: AssignmentLike[]): number {
  return countActiveAssignments(assignments);
}
