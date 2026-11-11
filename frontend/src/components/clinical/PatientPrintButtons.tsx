import { IdCard, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, openPatientDocument } from "@/lib/patients-api";

/** Opens the wristband or patient card PDF (Code 128 MRN) for printing. */
export function PatientPrintButtons({ patientId }: { patientId: string }) {
  const [printing, setPrinting] = useState<"wristband" | "card" | null>(null);

  const print = async (kind: "wristband" | "card") => {
    setPrinting(kind);
    try {
      await openPatientDocument(patientId, kind);
    } catch (error) {
      toast.error(errorMessage(error, "The document could not be prepared."));
    } finally {
      setPrinting(null);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => void print("wristband")} disabled={printing !== null}>
        <Printer aria-hidden="true" /> {printing === "wristband" ? "Preparing..." : "Print wristband"}
      </Button>
      <Button variant="outline" onClick={() => void print("card")} disabled={printing !== null}>
        <IdCard aria-hidden="true" /> {printing === "card" ? "Preparing..." : "Print card"}
      </Button>
    </>
  );
}
