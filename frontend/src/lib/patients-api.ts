import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { PatientReferences, RegistryPagination } from "@/types/patients";

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

type Problem = {
  message?: string;
  error?: string;
  code?: string;
  details?: unknown;
};

export class RegistryError extends Error {
  status: number;
  code: string | undefined;
  details: unknown;

  constructor(status: number, problem: Problem, fallback: string) {
    super(problem.message || problem.error || fallback);
    this.name = "RegistryError";
    this.status = status;
    this.code = problem.code;
    this.details = problem.details;
  }

  get fieldErrors(): Record<string, string[]> {
    const details = this.details as { fieldErrors?: Record<string, string[]> } | null | undefined;
    return details?.fieldErrors ?? {};
  }
}

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export type RegistryResponse<Data, Meta = undefined> = {
  data: Data;
  pagination?: RegistryPagination;
  meta?: Meta;
};

type QueryValue = string | number | boolean | null | undefined;

export const withQuery = (path: string, query: Record<string, QueryValue>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
};

/** Calls a `/api/v1` registry endpoint and keeps the problem `code`/`details` on failure. */
export async function registryRequest<Data, Meta = undefined>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<RegistryResponse<Data, Meta>> {
  const { body, ...rest } = init ?? {};
  const response = await fetch(`${apiBase}/v1/${path}`, {
    ...rest,
    credentials: "include",
    headers: createAuthHeaders(rest.headers),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) {
    throw new RegistryError(response.status, payload as Problem, "The request could not be completed.");
  }
  return payload as RegistryResponse<Data, Meta>;
}

let referencesPromise: Promise<PatientReferences> | null = null;

/** Units, consent witnesses and registry settings; loaded once per session. */
export const loadPatientReferences = () => {
  referencesPromise ??= registryRequest<PatientReferences>("patients/references")
    .then((result) => result.data)
    .catch((error: unknown) => {
      referencesPromise = null;
      throw error;
    });
  return referencesPromise;
};

/** Opens the wristband or card PDF in a new tab, from where it can be printed. */
export const openPatientDocument = async (patientId: string, kind: "wristband" | "card") => {
  // The tab is opened before the download so that pop-up blockers treat it as user-initiated.
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("Allow pop-ups for this site to print patient documents.");
  tab.opener = null;
  tab.document.title = "Preparing document";
  tab.document.body.textContent = "Preparing the document for printing...";

  try {
    const response = await fetch(`${apiBase}/v1/patients/${patientId}/${kind}`, {
      credentials: "include",
      headers: createAuthHeaders({ Accept: "application/pdf" }),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as Problem;
      throw new RegistryError(response.status, problem, "The document could not be prepared.");
    }
    const url = URL.createObjectURL(await response.blob());
    tab.location.replace(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (error) {
    tab.close();
    throw error;
  }
};
