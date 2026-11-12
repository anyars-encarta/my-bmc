import { ChevronsUpDown, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-registry";
import { ageSexLabel } from "@/lib/patient-format";
import { registryRequest, withQuery } from "@/lib/patients-api";
import type { PatientSummary } from "@/types/patients";

/** Popover that searches the registry by name, MRN or phone and returns the chosen patient. */
export function PatientSearchPicker({
  value,
  onChange,
  placeholder = "Search for a patient",
  excludePatientId,
  disabled,
}: {
  value: PatientSummary | null;
  onChange: (patient: PatientSummary | null) => void;
  placeholder?: string;
  excludePatientId?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const query = useDebouncedValue(term.trim(), 300);

  useEffect(() => {
    if (!open || query.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    registryRequest<PatientSummary[]>(withQuery("patients", { q: query, limit: 15 }))
      .then((result) => {
        if (active) setResults(result.data.filter((row) => row.id !== excludePatientId));
      })
      .catch(() => {
        if (active) setResults([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, query, excludePatientId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {value ? `${value.fullName}${value.mrn ? ` · ${value.mrn}` : ""}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={term} onValueChange={setTerm} placeholder="Name, MRN or phone..." />
          <CommandList>
            <CommandEmpty>
              {query.length < 2 ? "Type at least 2 characters." : loading ? "Searching..." : "No patients found."}
            </CommandEmpty>
            {results.map((patient) => (
              <CommandItem
                key={patient.id}
                value={patient.id}
                disabled={patient.masked}
                onSelect={() => {
                  onChange(patient);
                  setOpen(false);
                }}
              >
                {patient.masked ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Lock className="size-4" aria-hidden="true" /> Restricted record
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{patient.fullName}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {[patient.mrn, ageSexLabel(patient), patient.phone].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
