import { ExternalLink, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { duplicateReasonLabels } from "@/constants/patients";
import { ageSexLabel, formatDate } from "@/lib/patient-format";
import type { DuplicateCandidate } from "@/types/patients";

/** One possible-duplicate candidate: who it is, how strong the match is and why it matched. */
export function DuplicateCandidateCard({ candidate }: { candidate: DuplicateCandidate }) {
  const { patient } = candidate;
  return (
    <li className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {patient.masked ? (
            <p className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Lock className="size-4" aria-hidden="true" /> Restricted record
            </p>
          ) : (
            <>
              <p className="truncate font-medium">{patient.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {[
                  patient.mrn,
                  ageSexLabel(patient),
                  patient.dateOfBirth ? formatDate(patient.dateOfBirth) : null,
                  patient.phone,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          )}
        </div>
        <Badge variant={candidate.level === "BLOCK" ? "destructive" : "secondary"}>
          {candidate.level === "BLOCK" ? "Probable match" : "Possible match"} · {Math.round(candidate.score * 100)}%
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {candidate.reasons.map((reason) => (
          <Badge key={reason} variant="outline">
            {duplicateReasonLabels[reason] ?? reason}
          </Badge>
        ))}
        <a
          href={`/patients/show/${patient.id}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Open record <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

/** Live duplicate check shown beside the registration wizard. */
export function DuplicatePanel({
  candidates,
  checking,
  ready,
}: {
  candidates: DuplicateCandidate[];
  checking: boolean;
  ready: boolean;
}) {
  return (
    <aside aria-label="Possible duplicates" aria-live="polite" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Possible duplicates</h2>
        {checking ? <span className="text-xs text-muted-foreground">Checking...</span> : null}
      </div>
      {!ready ? (
        <p className="text-sm text-muted-foreground">
          Enter the patient's first and last name to check for existing records.
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {checking ? "Looking for similar patients..." : "No similar patients found."}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Check these records before registering. Open the existing record if it is the same person.
          </p>
          <ul className="space-y-2">
            {candidates.map((candidate) => (
              <DuplicateCandidateCard key={candidate.patient.id} candidate={candidate} />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
