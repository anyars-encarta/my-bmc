import { AlertTriangle, Lock, ShieldAlert, UserRoundX } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ageSexLabel, formatDate, formatDateTime, initialsOf } from "@/lib/patient-format";
import type { PatientChart } from "@/types/patients";

const SEVERE = new Set(["SEVERE", "LIFE_THREATENING"]);

/**
 * Persistent patient identity strip: name plus MRN and date of birth (two identifiers), with the
 * allergy, confidentiality and deceased markers. It stays pinned below the app header.
 */
export function PatientBanner({ patient }: { patient: PatientChart }) {
  const allergies = patient.allergies;
  const hasSevere = allergies.some((allergy) => allergy.severity && SEVERE.has(allergy.severity));
  const allergyText = allergies.map((allergy) => allergy.substance).join(", ");

  return (
    <section
      aria-label="Patient identity"
      className="sticky top-16 z-20 flex flex-wrap items-center gap-4 rounded-lg border bg-background/95 p-4 shadow-sm backdrop-blur"
    >
      <Avatar className="size-14 border">
        <AvatarImage src={patient.photoUrl ?? ""} alt="" />
        <AvatarFallback>{initialsOf(patient.fullName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold">{patient.fullName}</h1>
          {patient.preferredName ? (
            <span className="text-sm text-muted-foreground">“{patient.preferredName}”</span>
          ) : null}
          {patient.isUnidentified ? (
            <Badge variant="secondary">
              <UserRoundX aria-hidden="true" /> Unidentified
            </Badge>
          ) : null}
          {patient.confidentiality !== "NORMAL" ? (
            <Badge variant="destructive">
              <Lock aria-hidden="true" /> {patient.confidentiality === "VIP" ? "VIP" : "Restricted"}
            </Badge>
          ) : null}
          {patient.restriction === "SELF" ? (
            <Badge variant="destructive">
              <ShieldAlert aria-hidden="true" /> Own record
            </Badge>
          ) : null}
          {patient.status === "DECEASED" ? (
            <Badge className="bg-neutral-900 text-white">
              Deceased{patient.deceasedAt ? ` · ${formatDateTime(patient.deceasedAt)}` : ""}
            </Badge>
          ) : null}
          {patient.status === "INACTIVE" ? <Badge variant="outline">Inactive</Badge> : null}
        </div>
        <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">MRN</dt>
            <dd className="font-mono font-semibold">{patient.mrn}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Age / sex</dt>
            <dd className="font-medium">{ageSexLabel(patient)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Date of birth</dt>
            <dd className="font-medium">
              {patient.dateOfBirth
                ? `${formatDate(patient.dateOfBirth)}${patient.dobEstimated ? " (approx.)" : ""}`
                : "Not known"}
            </dd>
          </div>
          {patient.isMinor ? (
            <div>
              <dd className="font-medium text-amber-700 dark:text-amber-400">Minor</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="flex max-w-xs flex-col items-end gap-1">
        {allergies.length > 0 ? (
          <Badge variant={hasSevere ? "destructive" : "secondary"} className="max-w-full" title={allergyText}>
            <AlertTriangle aria-hidden="true" />
            <span className="truncate">
              {hasSevere ? "Severe allergy" : "Allergy"}: {allergyText}
            </span>
          </Badge>
        ) : (
          <Badge variant="outline">No allergies recorded</Badge>
        )}
      </div>
    </section>
  );
}
