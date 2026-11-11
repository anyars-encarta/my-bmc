const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-12` → `12 Oct 2026` (en-GH display format). */
export const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[3]} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
};

export const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const formatTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** `LIFE_THREATENING` → `Life threatening`. */
export const humanize = (value: string | null | undefined) => {
  if (!value) return "—";
  const text = value.replace(/_/g, " ").toLowerCase();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

type AgeSource = {
  ageYears: number | null;
  dateOfBirth: string | null;
  dobEstimated: boolean;
  sex: string | null;
};

export const ageLabel = (patient: AgeSource) => {
  if (patient.ageYears === null) return "Age unknown";
  const estimated = !patient.dateOfBirth || patient.dobEstimated;
  return `${patient.ageYears} y${estimated ? " (est.)" : ""}`;
};

export const ageSexLabel = (patient: AgeSource) =>
  [patient.ageYears === null ? null : ageLabel(patient), patient.sex ? humanize(patient.sex) : null]
    .filter(Boolean)
    .join(" · ") || "—";

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";

/** Whole years between two `YYYY-MM-DD` dates. */
export const yearsBetween = (fromIso: string, toIso: string) => {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
};
