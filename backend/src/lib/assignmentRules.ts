export type EffectiveAssignment = {
  assignmentType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export const isRetroactiveAssignmentDate = (effectiveFrom: string, today: string) =>
  effectiveFrom < today;

export const resolveEffectiveAssignment = <T extends EffectiveAssignment>(assignments: T[]) =>
  [...assignments].sort((left, right) => {
    const priority = (type: string) => type === "TEMPORARY" || type === "COVER" ? 0 : 1;
    return priority(left.assignmentType) - priority(right.assignmentType) ||
      right.effectiveFrom.localeCompare(left.effectiveFrom);
  })[0] ?? null;
