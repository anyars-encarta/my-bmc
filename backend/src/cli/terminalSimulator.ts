import { TerminalSimulatorAdapter, type RawPunch } from "../lib/deviceAdapter.js";

const apiBase = (process.env.ATTENDANCE_API_URL ?? "http://localhost:3000/api/v1")
  .replace(/\/+$/, "");
const deviceCode = process.env.ATTENDANCE_DEVICE_CODE;
const deviceKey = process.env.ATTENDANCE_DEVICE_KEY;
const shiftCredentials = [
  { shift: "morning", env: "ATTENDANCE_SIMULATOR_MORNING_CREDENTIAL", in: "06:55:00Z", out: "14:03:00Z" },
  { shift: "afternoon", env: "ATTENDANCE_SIMULATOR_AFTERNOON_CREDENTIAL", in: "13:55:00Z", out: "20:03:00Z" },
  { shift: "night", env: "ATTENDANCE_SIMULATOR_NIGHT_CREDENTIAL", in: "19:50:00Z", out: "07:04:00Z" },
];

const missing = [
  !deviceCode ? "ATTENDANCE_DEVICE_CODE" : "",
  !deviceKey ? "ATTENDANCE_DEVICE_KEY" : "",
  ...shiftCredentials.filter(({ env }) => !process.env[env]).map(({ env }) => env),
].filter(Boolean);

const resolveDate = async () => {
  const configuredDate = process.env.ATTENDANCE_SIMULATOR_DATE;
  if (configuredDate) return configuredDate;

  let response: Response;
  try {
    response = await fetch(
      `${apiBase}/device/ping?deviceTime=${encodeURIComponent(new Date().toISOString())}`,
      {
        headers: {
          "X-Device-Code": deviceCode ?? "",
          "X-Device-Key": deviceKey ?? "",
        },
      },
    );
  } catch (error) {
    throw new Error(
      "The facility date could not be resolved. Set ATTENDANCE_SIMULATOR_DATE explicitly.",
      { cause: error },
    );
  }
  let ping: {
    data?: { timezone?: string; timezoneResolved?: boolean };
    message?: string;
  };
  try {
    ping = await response.json() as {
      data?: { timezone?: string; timezoneResolved?: boolean };
      message?: string;
    };
  } catch (error) {
    throw new Error(
      "The facility timezone could not be resolved. Set ATTENDANCE_SIMULATOR_DATE explicitly.",
      { cause: error },
    );
  }
  const timezone = ping.data?.timezone;
  if (!response.ok || !timezone || ping.data?.timezoneResolved !== true) {
    throw new Error(
      ping.message ??
        "The facility timezone could not be resolved. Set ATTENDANCE_SIMULATOR_DATE explicitly.",
    );
  }

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    if (!year || !month || !day) throw new Error("Facility date parts are incomplete.");
    return `${year}-${month}-${day}`;
  } catch (error) {
    throw new Error(
      "The facility timezone is invalid. Set ATTENDANCE_SIMULATOR_DATE explicitly.",
      { cause: error },
    );
  }
};

const date = missing.length === 0
  ? await resolveDate()
  : process.env.ATTENDANCE_SIMULATOR_DATE ?? "";
const parsedDate = new Date(`${date}T00:00:00.000Z`);
const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(parsedDate.getTime()) &&
  parsedDate.toISOString().slice(0, 10) === date;

if (missing.length > 0 || !isValidDate) {
  if (missing.length > 0) console.error(`Missing simulator configuration: ${missing.join(", ")}`);
  if (!isValidDate) console.error("ATTENDANCE_SIMULATOR_DATE must use YYYY-MM-DD.");
  process.exitCode = 1;
} else {
  const punches: RawPunch[] = shiftCredentials.flatMap(({ shift, env, in: clockIn, out: clockOut }) => {
    const credentialRef = process.env[env];
    if (!credentialRef) return [];
    const nextDay = shift === "night"
      ? new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 24 * 60 * 60_000)
        .toISOString()
        .slice(0, 10)
      : date;
    return [
      {
        deviceEventId: `sim-${date}-${shift}-in`,
        credentialType: "FINGERPRINT",
        credentialRef,
        punchedAt: `${date}T${clockIn}`,
        directionHint: "IN",
        verifyMode: "SIMULATED",
      },
      {
        deviceEventId: `sim-${date}-${shift}-out`,
        credentialType: "FINGERPRINT",
        credentialRef,
        punchedAt: `${nextDay}T${clockOut}`,
        directionHint: "OUT",
        verifyMode: "SIMULATED",
      },
    ];
  });
  const adapter = new TerminalSimulatorAdapter(punches);
  const device = {
    deviceType: "FINGERPRINT_TERMINAL",
    vendor: "HAMS simulator",
  } as const;
  const batch = await adapter.pull({
    id: "simulator",
    code: deviceCode ?? "",
    name: "Terminal simulator",
    status: "ACTIVE",
    apiKeyHash: "",
    createdAt: new Date(0),
    lastSeenAt: null,
    healthAlertedAt: null,
    lastClockSkewSeconds: null,
    rateLimitWindowStart: null,
    rateLimitCount: 0,
    deviceType: "FINGERPRINT_TERMINAL",
    vendor: "HAMS simulator",
    model: null,
    serialNumber: null,
    orgUnitId: null,
  }, new Date(0));
  if (!adapter.supports(device)) {
    throw new Error("The terminal simulator adapter rejected its configured device type.");
  }

  const response = await fetch(`${apiBase}/device/punches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Code": deviceCode ?? "",
      "X-Device-Key": deviceKey ?? "",
    },
    body: JSON.stringify({ punches: batch }),
  });
  const result = await response.json() as {
    data?: { results?: Array<{ deviceEventId: string; result: string }> };
    message?: string;
  };
  if (!response.ok) {
    throw new Error(result.message ?? `Simulator upload failed with HTTP ${response.status}.`);
  }
  console.log(JSON.stringify(result.data?.results ?? [], null, 2));
}
