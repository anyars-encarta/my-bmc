import { Lock, Pencil, ShieldAlert, UserRoundSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { BreakGlassDialog } from "@/components/clinical/BreakGlassDialog";
import { PatientBanner } from "@/components/clinical/PatientBanner";
import { PatientPrintButtons } from "@/components/clinical/PatientPrintButtons";
import { CreateView, CreateViewHeader } from "@/components/refine-ui/views/create-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PATIENT_ALLERGY_WRITE_ROLES,
  PATIENT_AUDIT_ROLES,
  PATIENT_CONDITION_WRITE_ROLES,
  PATIENT_CONSENT_WRITE_ROLES,
  PATIENT_DEMOGRAPHIC_ITEM_ROLES,
  PATIENT_EDIT_ROLES,
  PATIENT_IDENTIFY_ROLES,
  PATIENT_PHOTO_ROLES,
  PATIENT_PRINT_ROLES,
  PATIENT_TIMELINE_ROLES,
} from "@/constants/patients";
import { usePatientReferences, useRegistryAccess } from "@/hooks/use-registry";
import { formatTime } from "@/lib/patient-format";
import { RegistryError, errorMessage, registryRequest } from "@/lib/patients-api";
import type { PatientChart, PatientMergedPointer } from "@/types/patients";

import {
  AllergiesTab,
  AuditTab,
  ConditionsTab,
  ConsentsTab,
  ContactsTab,
  IdentifiersTab,
  SummaryTab,
  TimelineTab,
} from "./chart-tabs";

type ChartState =
  | { kind: "loading" }
  | { kind: "ready"; patient: PatientChart }
  | { kind: "restricted"; restriction: string | null }
  | { kind: "error"; message: string };

const isMergedPointer = (data: PatientChart | PatientMergedPointer): data is PatientMergedPointer =>
  data.status === "MERGED" && !("fullName" in data);

export const PatientShow = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRegistryAccess();
  const references = usePatientReferences();
  const [state, setState] = useState<ChartState>({ kind: "loading" });
  const [breakGlassOpen, setBreakGlassOpen] = useState(false);
  const [tab, setTab] = useState("summary");
  const mergedFromMrn = (location.state as { mergedFromMrn?: string } | null)?.mergedFromMrn;

  const load = useCallback(async () => {
    try {
      const result = await registryRequest<PatientChart | PatientMergedPointer>(`patients/${id}`);
      if (isMergedPointer(result.data)) {
        if (result.data.mergedIntoId) {
          navigate(`/patients/show/${result.data.mergedIntoId}`, {
            replace: true,
            state: { mergedFromMrn: result.data.mrn },
          });
        } else {
          setState({ kind: "error", message: "This record was merged and its surviving record could not be found." });
        }
        return;
      }
      setState({ kind: "ready", patient: result.data });
    } catch (error) {
      if (error instanceof RegistryError && error.code === "BREAK_GLASS_REQUIRED") {
        const details = error.details as { restriction?: string } | undefined;
        setState({ kind: "restricted", restriction: details?.restriction ?? null });
      } else {
        setState({ kind: "error", message: errorMessage(error, "The patient could not be loaded.") });
      }
    }
  }, [id, navigate]);

  useEffect(() => {
    setState({ kind: "loading" });
    setTab("summary");
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <CreateView>
        <CreateViewHeader title="Patient chart" />
        <p className="text-sm text-muted-foreground">Loading the chart...</p>
      </CreateView>
    );
  }

  if (state.kind === "error") {
    return (
      <CreateView>
        <CreateViewHeader title="Patient chart" />
        <Alert variant="destructive">
          <AlertTitle>Chart unavailable</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button variant="outline" className="w-fit" asChild>
          <Link to="/patients">Back to patient search</Link>
        </Button>
      </CreateView>
    );
  }

  if (state.kind === "restricted") {
    return (
      <CreateView>
        <CreateViewHeader title="Patient chart" />
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-5 text-destructive" aria-hidden="true" /> Restricted record
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {state.restriction === "SELF"
                ? "This is your own patient record. Staff cannot open their own record without break-glass access."
                : "This patient's record is restricted. You can open it only with break-glass access, by giving the reason you need it."}{" "}
              Every break-glass access is audited and reviewed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="destructive" onClick={() => setBreakGlassOpen(true)}>
                <ShieldAlert aria-hidden="true" /> Break glass
              </Button>
              <Button variant="outline" asChild>
                <Link to="/patients">Back to patient search</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <BreakGlassDialog
          open={breakGlassOpen}
          onOpenChange={setBreakGlassOpen}
          patientId={id}
          restriction={state.restriction}
          minReasonLength={references?.breakGlassReasonMinChars ?? 15}
          onGranted={() => {
            setState({ kind: "loading" });
            void load();
          }}
        />
      </CreateView>
    );
  }

  const { patient } = state;
  const fullAccess = patient.redacted.length === 0;
  const merged = patient.status === "MERGED";
  const writable = (roles: string[]) => !merged && can(roles);

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title="Patient chart" />
      <PatientBanner patient={patient} />

      {patient.breakGlass ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Break-glass access until {formatTime(patient.breakGlass.expiresAt)}</AlertTitle>
          <AlertDescription>
            You opened this restricted record with the reason “{patient.breakGlass.reason}”. This access
            is audited and will be reviewed.
          </AlertDescription>
        </Alert>
      ) : null}
      {mergedFromMrn ? (
        <Alert>
          <AlertTitle>Record merged</AlertTitle>
          <AlertDescription>{mergedFromMrn} was merged into this record.</AlertDescription>
        </Alert>
      ) : null}
      {patient.isUnidentified ? (
        <Alert>
          <AlertTitle>Unidentified patient</AlertTitle>
          <AlertDescription>
            This record uses a placeholder name. Identify the patient as soon as their details are known.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {patient.isUnidentified && writable(PATIENT_IDENTIFY_ROLES) ? (
          <Button asChild>
            <Link to={`/patients/identify/${patient.id}`}>
              <UserRoundSearch aria-hidden="true" /> Identify patient
            </Link>
          </Button>
        ) : null}
        {writable(PATIENT_EDIT_ROLES) ? (
          <Button variant="outline" asChild>
            <Link to={`/patients/edit/${patient.id}`}>
              <Pencil aria-hidden="true" /> Edit details
            </Link>
          </Button>
        ) : null}
        {can(PATIENT_PRINT_ROLES) ? <PatientPrintButtons patientId={patient.id} /> : null}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          {can(PATIENT_TIMELINE_ROLES) ? <TabsTrigger value="timeline">Visits & timeline</TabsTrigger> : null}
          <TabsTrigger value="allergies">Allergies</TabsTrigger>
          {fullAccess ? <TabsTrigger value="conditions">Conditions</TabsTrigger> : null}
          {fullAccess ? <TabsTrigger value="documents">Identity documents</TabsTrigger> : null}
          {fullAccess ? <TabsTrigger value="contacts">Contacts</TabsTrigger> : null}
          {fullAccess ? <TabsTrigger value="consents">Consents</TabsTrigger> : null}
          {can(PATIENT_AUDIT_ROLES) ? <TabsTrigger value="audit">Audit</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab
            patient={patient}
            canPhoto={writable(PATIENT_PHOTO_ROLES)}
            onPhotoSaved={(result) =>
              setState({
                kind: "ready",
                patient: { ...patient, photoUrl: result.photoUrl, photoPublicId: result.photoPublicId, version: result.version },
              })
            }
          />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineTab patientId={patient.id} />
        </TabsContent>
        <TabsContent value="allergies">
          <AllergiesTab
            patientId={patient.id}
            canWrite={writable(PATIENT_ALLERGY_WRITE_ROLES)}
            today={references?.today}
            onChanged={() => void load()}
          />
        </TabsContent>
        <TabsContent value="conditions">
          <ConditionsTab patientId={patient.id} canWrite={writable(PATIENT_CONDITION_WRITE_ROLES)} today={references?.today} />
        </TabsContent>
        <TabsContent value="documents">
          <IdentifiersTab patientId={patient.id} canWrite={writable(PATIENT_DEMOGRAPHIC_ITEM_ROLES)} />
        </TabsContent>
        <TabsContent value="contacts">
          <ContactsTab patientId={patient.id} canWrite={writable(PATIENT_DEMOGRAPHIC_ITEM_ROLES)} />
        </TabsContent>
        <TabsContent value="consents">
          <ConsentsTab
            patientId={patient.id}
            canWrite={writable(PATIENT_CONSENT_WRITE_ROLES)}
            isMinor={patient.isMinor}
            onChanged={() => void load()}
          />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab patientId={patient.id} />
        </TabsContent>
      </Tabs>
    </CreateView>
  );
};
