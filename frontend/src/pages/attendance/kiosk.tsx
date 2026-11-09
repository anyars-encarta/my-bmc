import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BACKEND_BASE_URL } from "@/constants";

type CaptureType = "CARD_QR" | "CARD_BARCODE" | "FINGERPRINT";
type Punch = {
  deviceEventId: string;
  credentialType: CaptureType;
  credentialRef: string;
  punchedAt: string;
};
type StoredPunch = Punch & { createdAt: number; deviceCode: string };
type EmployeeFeedback = {
  firstName: string;
  lastName: string;
  employeeId: string;
  imageUrl: string | null;
};

type ResultEnvelope = {
  data?: { results?: Array<{
    deviceEventId: string;
    result: string;
    originalResult?: string;
    employee?: EmployeeFeedback;
  }> };
  message?: string;
  error?: string;
};
type DetectedBarcode = { rawValue: string };
type BrowserBarcodeDetector = {
  detect: (video: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: new (options?: { formats: string[] }) => BrowserBarcodeDetector;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const DEVICE_CODE_KEY = "hams-attendance-kiosk-code";
const DEVICE_API_KEY = "hams-attendance-kiosk-key";
const DATABASE_NAME = "hams-attendance-kiosk";
const STORE_NAME = "offline-punches";

const openQueueDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const opening = indexedDB.open(DATABASE_NAME, 1);
  opening.onupgradeneeded = () => {
    const database = opening.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: "deviceEventId" });
    }
  };
  opening.onsuccess = () => resolve(opening.result);
  opening.onerror = () => reject(opening.error ?? new Error("Unable to open the offline punch queue."));
});

const withQueueStore = async <T,>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const database = await openQueueDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Offline punch queue operation failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("Offline punch queue transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline punch queue transaction was aborted."));
    });
  } finally {
    database.close();
  }
};

const readQueue = () => withQueueStore<StoredPunch[]>("readonly", (store) => store.getAll());
const savePunch = (punch: Punch, deviceCode: string) => withQueueStore<IDBValidKey>("readwrite", (store) =>
  store.put({ ...punch, deviceCode, createdAt: Date.now() }),
);
const removePunch = (eventId: string) => withQueueStore<undefined>("readwrite", (store) =>
  store.delete(eventId),
);

export const AttendanceKioskPage = () => {
  const [deviceCode, setDeviceCode] = useState(() => localStorage.getItem(DEVICE_CODE_KEY) ?? "");
  const [deviceKey, setDeviceKey] = useState(() => localStorage.getItem(DEVICE_API_KEY) ?? "");
  const [credentialType, setCredentialType] = useState<CaptureType>("CARD_QR");
  const [token, setToken] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [feedback, setFeedback] = useState({
    message: "Ready to scan",
    detail: "Scan an employee card or enter the credential token.",
    kind: "ready" as "ready" | "success" | "warning" | "error",
    employee: undefined as EmployeeFeedback | undefined,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BrowserBarcodeDetector | null>(null);
  const detectingRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);

  const refreshQueueCount = useCallback(async () => {
    try {
      const queued = await readQueue();
      setQueueCount(queued.length);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read the offline punch queue.");
    }
  }, []);

  const showFeedback = useCallback((
    message: string,
    detail: string,
    kind: "success" | "warning" | "error",
    employee?: EmployeeFeedback,
  ) => {
    setFeedback({ message, detail, kind, employee });
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback({
        message: "Ready to scan",
        detail: "Scan an employee card or enter the credential token.",
        kind: "ready",
        employee: undefined,
      });
      inputRef.current?.focus();
    }, 3500);
  }, []);

  const uploadQueue = useCallback(async () => {
    if (!deviceCode.trim() || !deviceKey.trim() || !navigator.onLine || syncing) return new Map<string, {
      result: string;
      originalResult?: string;
      employee?: EmployeeFeedback;
    }>();
    setSyncing(true);
    const confirmedResults = new Map<string, {
      result: string;
      originalResult?: string;
      employee?: EmployeeFeedback;
    }>();
    try {
      const queued = (await readQueue()).sort((left, right) =>
        left.punchedAt.localeCompare(right.punchedAt) ||
        left.deviceEventId.localeCompare(right.deviceEventId),
      );
      if (queued.some((punch) => punch.deviceCode !== deviceCode.trim())) {
        throw new Error("Queued punches belong to a different or unconfigured kiosk device. They were kept and not uploaded.");
      }
      for (let offset = 0; offset < queued.length; offset += 500) {
        const batch = queued.slice(offset, offset + 500);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        let response: Response;
        let result: ResultEnvelope;
        try {
          response = await fetch(`${apiBase}/v1/device/punches`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Device-Code": deviceCode.trim(),
              "X-Device-Key": deviceKey.trim(),
            },
            body: JSON.stringify({
              punches: batch.map(({ deviceEventId, credentialType: type, credentialRef, punchedAt }) => ({
                deviceEventId,
                credentialType: type,
                credentialRef,
                punchedAt,
                directionHint: "AUTO",
              })),
            }),
            signal: controller.signal,
          });
          result = await response.json() as ResultEnvelope;
        } finally {
          window.clearTimeout(timeout);
        }
        if (!response.ok) {
          throw new Error(result.message || result.error || "The attendance server rejected the sync request.");
        }
        const acceptedResults = result.data?.results ?? [];
        const confirmedIds = new Set<string>();
        for (const item of acceptedResults) {
          confirmedResults.set(item.deviceEventId, {
            result: item.result,
            originalResult: item.originalResult,
            employee: item.employee,
          });
          if (item.result !== "DUPLICATE" || item.originalResult) {
            confirmedIds.add(item.deviceEventId);
            await removePunch(item.deviceEventId);
          }
          if (!["ACCEPTED", "DUPLICATE"].includes(item.result)) {
            showFeedback("Punch not accepted", item.result.replaceAll("_", " "), "warning");
          }
        }
        if (confirmedIds.size < batch.length) {
          throw new Error("The server did not confirm every punch in this batch; remaining items were kept for retry.");
        }
      }
      await refreshQueueCount();
      if (queued.length > 0) toast.success(`Synced ${queued.length} attendance punch(es).`);
      return confirmedResults;
    } catch (error) {
      await refreshQueueCount();
      if (navigator.onLine) {
        toast.error(error instanceof Error ? error.message : "Unable to sync offline punches.");
      }
      return confirmedResults;
    } finally {
      setSyncing(false);
    }
  }, [deviceCode, deviceKey, refreshQueueCount, showFeedback, syncing]);

  const submitToken = useCallback(async (value: string) => {
    const credentialRef = value.trim();
    if (!credentialRef) return;
    const punch: Punch = {
      deviceEventId: crypto.randomUUID(),
      credentialType,
      credentialRef,
      punchedAt: new Date().toISOString(),
    };
    let queued = false;
    try {
      await savePunch(punch, deviceCode.trim());
      queued = true;
      setToken("");
      await refreshQueueCount();
      if (!navigator.onLine) {
        showFeedback("Saved offline", "Punch is queued securely on this kiosk and will sync when online.", "warning");
        return;
      }
      if (!deviceCode.trim() || !deviceKey.trim()) {
        showFeedback("Kiosk setup required", "Configure the registered kiosk device code and key to sync punches.", "error");
        return;
      }
      const results = await uploadQueue();
      const outcome = results.get(punch.deviceEventId);
      const confirmedDuplicateResult = outcome?.result === "DUPLICATE"
        ? outcome.originalResult
        : undefined;
      if (
        outcome?.result === "ACCEPTED" ||
        ["RECEIVED", "CLOCK_IN", "CLOCK_OUT"].includes(confirmedDuplicateResult ?? "")
      ) {
        const employee = outcome?.employee;
        const detail = employee
          ? `${employee.firstName} ${employee.lastName} · Employee ID ${employee.employeeId}`
          : confirmedDuplicateResult
            ? `The original punch was ${confirmedDuplicateResult.replaceAll("_", " ").toLowerCase()}.`
            : "Attendance was accepted for server-side processing.";
        showFeedback("Punch received", detail, "success", employee);
      } else if (outcome) {
        const result = outcome.result === "DUPLICATE"
          ? outcome.originalResult ?? "duplicate not confirmed"
          : outcome.result;
        showFeedback("Punch not accepted", result.replaceAll("_", " "), "warning");
      } else if (navigator.onLine) {
        showFeedback("Punch saved for retry", "The kiosk could not confirm this punch. It remains queued.", "warning");
      }
    } catch (error) {
      showFeedback(
        queued ? "Punch saved for retry" : "Punch could not be queued",
        error instanceof Error
          ? error.message
          : queued
            ? "The punch remains in the offline queue."
            : "Unable to save the punch on this kiosk.",
        queued ? "warning" : "error",
      );
    } finally {
      inputRef.current?.focus();
    }
  }, [credentialType, deviceCode, deviceKey, refreshQueueCount, showFeedback, uploadQueue]);

  const submitScanner = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitToken(token);
  };

  const saveDeviceSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      localStorage.setItem(DEVICE_CODE_KEY, deviceCode.trim());
      localStorage.setItem(DEVICE_API_KEY, deviceKey.trim());
      showFeedback("Kiosk configured", "Device credentials are stored in this browser for syncing.", "success");
      void uploadQueue();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save kiosk settings in this browser.");
    }
  };

  const startCamera = async () => {
    const BarcodeDetectorConstructor = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (!BarcodeDetectorConstructor) {
      toast.error("This browser does not support built-in QR scanning. Use the scanner input or a supported browser.");
      return;
    }
    let acquiredStream: MediaStream | null = null;
    try {
      detectorRef.current = new BarcodeDetectorConstructor({ formats: ["qr_code"] });
      acquiredStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = acquiredStream;
      setCameraStarting(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Camera access was denied or unavailable.");
      acquiredStream?.getTracks().forEach((track) => track.stop());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      detectorRef.current = null;
    }
  };

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  useEffect(() => {
    if (!cameraStarting) return;
    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) {
      toast.error("The camera preview could not be started.");
      stopCamera();
      return;
    }

    let active = true;
    video.srcObject = stream;
    void video.play().then(() => {
      if (active && streamRef.current === stream) {
        setCameraActive(true);
        setCameraStarting(false);
      }
    }).catch((error: unknown) => {
      if (!active || streamRef.current !== stream) return;
      toast.error(error instanceof Error ? error.message : "The camera preview could not be started.");
      stopCamera();
    });
    return () => {
      active = false;
    };
  }, [cameraStarting, stopCamera]);

  useEffect(() => {
    void refreshQueueCount();
    inputRef.current?.focus();
    const markOnline = () => {
      setOnline(true);
      void uploadQueue();
    };
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    const syncTimer = window.setInterval(() => void uploadQueue(), 15_000);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      window.clearInterval(syncTimer);
    };
  }, [refreshQueueCount, uploadQueue]);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!cameraActive || !videoRef.current || !detectorRef.current) return;
    let active = true;
    const scan = async () => {
      if (!active || !videoRef.current || !detectorRef.current || detectingRef.current) return;
      try {
        const detections = await detectorRef.current.detect(videoRef.current);
        const detected = detections[0]?.rawValue?.trim();
        if (detected) {
          detectingRef.current = true;
          await submitToken(detected);
          detectingRef.current = false;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to read a QR code from the camera.");
        stopCamera();
        return;
      }
      if (active) window.setTimeout(() => void scan(), 350);
    };
    void scan();
    return () => {
      active = false;
    };
  }, [cameraActive, stopCamera, submitToken]);

  const feedbackStyle = {
    ready: "border-slate-300 bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100",
    success: "border-green-600 bg-green-50 text-green-950 dark:bg-green-950 dark:text-green-50",
    warning: "border-amber-500 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50",
    error: "border-red-600 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-50",
  }[feedback.kind];

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Attendance kiosk</h1>
          <p className="text-muted-foreground">Scan an employee card to record a punch.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`size-3 rounded-full ${online ? "bg-green-600" : "bg-amber-500"}`} />
          {online ? "Online" : "Offline"}
          <span className="ml-2 rounded-full bg-muted px-3 py-1">{queueCount} queued</span>
        </div>
      </header>

      <section className={`rounded-xl border-2 p-6 text-center sm:p-10 ${feedbackStyle}`} aria-live="polite">
        <h2 className="text-4xl font-extrabold sm:text-6xl">{feedback.message}</h2>
          {feedback.employee?.imageUrl ? (
            <img
              src={feedback.employee.imageUrl}
              alt=""
              className="mx-auto mt-4 size-28 rounded-full object-cover"
            />
          ) : null}
          <p className="mt-3 text-xl sm:text-2xl">{feedback.detail}</p>
      </section>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <Label>Credential format</Label>
              <Select value={credentialType} onValueChange={(value) => setCredentialType(value as CaptureType)}>
                <SelectTrigger className="h-12 text-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CARD_QR">QR card</SelectItem>
                  <SelectItem value="CARD_BARCODE">Barcode card</SelectItem>
                  <SelectItem value="FINGERPRINT">Fingerprint terminal PIN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <form className="space-y-2" onSubmit={submitScanner}>
              <Label htmlFor="kiosk-token">Scan or enter credential</Label>
              <div className="flex gap-2">
                <Input
                  id="kiosk-token"
                  ref={inputRef}
                  autoFocus
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Ready for scanner..."
                  className="h-12 text-lg"
                  aria-label="Attendance credential token"
                />
                <Button type="submit" className="h-12 px-6 text-lg">Record punch</Button>
              </div>
            </form>
          </div>
          <div className="flex flex-wrap gap-2">
            {cameraActive || cameraStarting
              ? <Button variant="outline" onClick={stopCamera}>Stop camera</Button>
              : <Button variant="outline" onClick={() => void startCamera()}>Scan QR with camera</Button>}
            <Button variant="outline" onClick={() => void uploadQueue()} disabled={syncing || !online}>
              {syncing ? "Syncing..." : "Sync queued punches"}
            </Button>
          </div>
          {cameraActive || cameraStarting ? <video ref={videoRef} className="max-h-80 w-full rounded-lg bg-black object-cover" muted playsInline aria-label="Camera QR scanner" /> : null}
        </CardContent>
      </Card>

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">Kiosk device setup</summary>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveDeviceSettings}>
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-device-code">Registered device code</Label>
            <Input id="kiosk-device-code" value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kiosk-device-key">Device key</Label>
            <Input id="kiosk-device-key" type="password" value={deviceKey} onChange={(event) => setDeviceKey(event.target.value)} autoComplete="new-password" />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit">Save kiosk settings</Button>
            <Button type="button" variant="outline" onClick={() => {
              localStorage.removeItem(DEVICE_CODE_KEY);
              localStorage.removeItem(DEVICE_API_KEY);
              setDeviceCode("");
              setDeviceKey("");
              toast.success("Kiosk device settings cleared.");
            }}>Clear settings</Button>
          </div>
          <p className="text-sm text-muted-foreground sm:col-span-2">The device key stays in this browser and is only sent to the attendance device API over HTTPS.</p>
        </form>
      </details>
    </main>
  );
};
