import type { AttendanceDevice } from "../db/schema/sprintReady.js";

export type RawPunch = {
  deviceEventId: string;
  credentialType: "FINGERPRINT" | "CARD_QR" | "CARD_BARCODE";
  credentialRef: string;
  punchedAt: string;
  directionHint?: "IN" | "OUT" | "AUTO";
  verifyMode?: string;
};

export interface DeviceAdapter {
  supports(device: Pick<AttendanceDevice, "deviceType" | "vendor">): boolean;
  pull(device: AttendanceDevice, since: Date): Promise<RawPunch[]>;
}

export class TerminalSimulatorAdapter implements DeviceAdapter {
  constructor(private readonly punches: RawPunch[]) {}

  supports(device: Pick<AttendanceDevice, "deviceType" | "vendor">) {
    return device.deviceType === "FINGERPRINT_TERMINAL" ||
      device.deviceType === "QR_SCANNER" ||
      device.deviceType === "BARCODE_SCANNER" ||
      device.deviceType === "KIOSK";
  }

  async pull(_device: AttendanceDevice, since: Date) {
    return this.punches.filter((punch) => new Date(punch.punchedAt) >= since);
  }
}
