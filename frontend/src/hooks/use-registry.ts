import { useGetIdentity } from "@refinedev/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { loadPatientReferences } from "@/lib/patients-api";
import type { PatientReferences } from "@/types/patients";

/** Role checks for the patient registry screens. The API re-checks every request. */
export const useRegistryAccess = () => {
  const { data: identity, isLoading } = useGetIdentity<{ role?: string; roles?: string[] }>();
  const roles = useMemo(() => {
    const values = new Set(identity?.roles ?? []);
    if (identity?.role) values.add(identity.role);
    return values;
  }, [identity]);
  const can = useCallback((allowed: readonly string[]) => allowed.some((role) => roles.has(role)), [roles]);
  return { can, ready: !isLoading };
};

export const useDebouncedValue = <Value,>(value: Value, delayMs: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};

export const usePatientReferences = () => {
  const [references, setReferences] = useState<PatientReferences | null>(null);
  useEffect(() => {
    let active = true;
    loadPatientReferences()
      .then((data) => {
        if (active) setReferences(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return references;
};

type LoaderState<Data> = { data: Data | null; loading: boolean; error: Error | null };

/** Runs an async loader when `deps` change; `reload()` runs it again and keeps the previous data meanwhile. */
export const useLoader = <Data,>(load: () => Promise<Data>, deps: readonly unknown[]) => {
  const [state, setState] = useState<LoaderState<Data>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    load()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error : new Error("The request could not be completed."),
        });
      });
    return () => {
      active = false;
    };
    // The loader is re-created on every render; `deps` lists what it actually depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
};
