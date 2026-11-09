import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { toast } from "sonner";
import { useList } from "@refinedev/core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { SetupRecord } from "@/types/domain";

type CredentialType = "CARD_QR" | "CARD_BARCODE" | "FINGERPRINT";
type Credential = {
  id: string;
  credentialType: CredentialType;
  cardVersion: number;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
};
type ApiResponse<T> = { data?: T; message?: string; error?: string };
type IssuedCard = {
  token: string;
  printFormat: "QR" | "BARCODE";
  cardVersion: number;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);

export const StaffAttendanceCredentials = ({
  staffId,
  name,
  employeeId,
  position,
  imageUrl,
}: {
  staffId: string;
  name: string;
  employeeId: string;
  position?: string;
  imageUrl?: string;
}) => {
  const { result: facilityResult } = useList<SetupRecord>({
    resource: "setup",
    pagination: { pageSize: 1 },
  });
  const facility = facilityResult?.data?.[0];
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credentialType, setCredentialType] = useState<"CARD_QR" | "CARD_BARCODE">("CARD_QR");
  const [expiresAt, setExpiresAt] = useState("");
  const [enrollmentNote, setEnrollmentNote] = useState("");
  const [issuedCard, setIssuedCard] = useState<IssuedCard | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [barcodeDataUrl, setBarcodeDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialToRevoke, setCredentialToRevoke] = useState<Credential | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const result = await response.json() as ApiResponse<T>;
    if (!response.ok) {
      throw new Error(result.message || result.error || "The attendance credential request failed.");
    }
    return result;
  }, []);

  const load = useCallback(async () => {
    const result = await request<Credential[]>(`staff/${staffId}/credentials`);
    setCredentials(result.data ?? []);
  }, [request, staffId]);

  useEffect(() => {
    void load()
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to load credentials."))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    let active = true;
    if (!issuedCard) {
      setQrDataUrl("");
      setBarcodeDataUrl("");
      return;
    }
    void QRCode.toDataURL(issuedCard.token, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    }).then((image) => {
      if (active) setQrDataUrl(image);
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the printable card.");
    });
    try {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, issuedCard.token, {
        format: "CODE128",
        displayValue: false,
        margin: 4,
        width: 2,
        height: 80,
      });
      const encodedSvg = btoa(new XMLSerializer().serializeToString(svg));
      if (active) setBarcodeDataUrl(`data:image/svg+xml;base64,${encodedSvg}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the printable barcode.");
    }
    return () => {
      active = false;
    };
  }, [issuedCard]);

  const issueCard = async () => {
    setSaving(true);
    try {
      const result = await request<IssuedCard>(`staff/${staffId}/credentials`, {
        method: "POST",
        body: JSON.stringify({
          credentialType,
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        }),
      });
      if (!result.data?.token) throw new Error("The new card token was not returned.");
      setIssuedCard(result.data);
      await load();
      toast.success("Attendance card issued. Print it now; its token is shown only once.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to issue the attendance card.");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (!credentialToRevoke || revokeReason.trim().length < 3) return;
    const reason = revokeReason.trim();
    setSaving(true);
    try {
      await request(`staff/${staffId}/credentials/${credentialToRevoke.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
      toast.success("Attendance card revoked.");
      setCredentialToRevoke(null);
      setRevokeReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to revoke the card.");
    } finally {
      setSaving(false);
    }
  };

  const enrollFingerprint = async () => {
    setSaving(true);
    try {
      await request(`staff/${staffId}/fingerprint-enrolment`, {
        method: "POST",
        body: JSON.stringify({ note: enrollmentNote.trim() || null }),
      });
      setEnrollmentNote("");
      await load();
      toast.success("Fingerprint enrollment recorded. Biometric templates stay on the terminal.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record fingerprint enrollment.");
    } finally {
      setSaving(false);
    }
  };

  const printCard = (side: "both" | "front" | "back" = "both") => {
    if (
      !issuedCard ||
      (side !== "front" && (issuedCard.printFormat === "QR" ? !qrDataUrl : !barcodeDataUrl))
    ) return;
    const printWindow = window.open("", "_blank", "width=560,height=900");
    if (!printWindow) {
      toast.error("Allow pop-ups to print or save this ID card as a PDF.");
      return;
    }
    printWindow.opener = null;
    const safeName = escapeHtml(name);
    const safeEmployeeId = escapeHtml(employeeId);
    const safePosition = escapeHtml(position?.trim() || "Staff");
    const safeFacilityName = escapeHtml(facility?.facilityName?.trim() || "Facility");
    const safeLogoUrl = facility?.logoUrl ? escapeHtml(facility.logoUrl) : "";
    const safeImageUrl = imageUrl ? escapeHtml(imageUrl) : "";
    const safeAddress = facility?.address?.trim() ? escapeHtml(facility.address.trim()) : "";
    const safeTelephone = facility?.telephone?.trim() ? escapeHtml(facility.telephone.trim()) : "";
    const safeEmail = facility?.email?.trim() ? escapeHtml(facility.email.trim()) : "";
    const initials = safeFacilityName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
    const logo = safeLogoUrl
      ? `<img class="logo" src="${safeLogoUrl}" alt="">`
      : `<div class="logo logo-fallback">${escapeHtml(initials || "F")}</div>`;
    const portrait = safeImageUrl
      ? `<img class="portrait" src="${safeImageUrl}" alt="${safeName}">`
      : `<div class="portrait portrait-fallback">${escapeHtml(name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "S")}</div>`;
    const code = issuedCard.printFormat === "QR"
      ? `<img class="code qr" src="${qrDataUrl}" alt="Attendance QR code">`
      : `<img class="code barcode" src="${barcodeDataUrl}" alt="Attendance barcode">`;
    const returnAddress = safeAddress
      ? `<p class="address">${safeAddress}</p>`
      : `<p class="address">If found, please return to facility administration.</p>`;
    const contactDetails = [safeTelephone, safeEmail].filter(Boolean).join(" · ");
    const front = `<main class="card front">
      <header class="brand">${logo}<div class="facility-name">${safeFacilityName}</div></header>
      ${portrait}
      <div class="staff-name">${safeName}</div>
      <div class="position">${safePosition}</div>
      <div class="employee"><span>EMPLOYEE ID</span><strong>${safeEmployeeId}</strong></div>
      <div class="front-footer">OFFICIAL STAFF IDENTIFICATION</div>
    </main>`;
    const back = `<main class="card back">
      <header class="back-brand">${safeFacilityName}</header>
      <div class="code-wrap">${code}</div>
      <p class="scan-label">Scan or present this code for attendance</p>
      <div class="return">
        <strong>FOUND THIS CARD?</strong>
        <p>Please return it to:</p>
        ${returnAddress}
        ${contactDetails ? `<p class="contact">${escapeHtml(contactDetails)}</p>` : ""}
      </div>
      <div class="card-version">Attendance credential · v${issuedCard.cardVersion}</div>
    </main>`;
    const pages = side === "front" ? front : side === "back" ? back : `${front}${back}`;
    printWindow.document.write(`<!doctype html><html><head><title>Employee ID card</title><style>
      @page { size: 54mm 85.6mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
      .card { position: relative; width: 54mm; height: 85.6mm; overflow: hidden;
        page-break-after: always; break-after: page; }
      .card:last-child { page-break-after: auto; break-after: auto; }
      .front { display: flex; flex-direction: column; align-items: center; padding: 4mm 4mm 3mm;
        color: #f8fafc; background: linear-gradient(155deg, #0b2545 0%, #124e78 60%, #18a0a6 150%); }
      .brand { display: flex; width: 100%; align-items: center; gap: 2.5mm; min-height: 12mm; }
      .logo { display: flex; width: 11mm; height: 11mm; flex: 0 0 11mm; align-items: center;
        justify-content: center; border-radius: 3mm; object-fit: contain; background: #fff; padding: 1mm; }
      .logo-fallback { color: #0b2545; font-size: 12pt; font-weight: 800; }
      .facility-name { font-size: 9pt; font-weight: 700; line-height: 1.15; }
      .portrait { width: 27mm; height: 27mm; margin: 3mm 0 2mm; border: 1mm solid rgba(255,255,255,.8);
        border-radius: 50%; object-fit: cover; background: #dbeafe; }
      .portrait-fallback { display: flex; align-items: center; justify-content: center; color: #0b2545;
        font-size: 20pt; font-weight: 700; }
      .staff-name { max-width: 100%; font-size: 12pt; font-weight: 800; line-height: 1.12;
        text-align: center; overflow-wrap: anywhere; }
      .position { margin-top: 1mm; color: #d9f4f4; font-size: 8pt; text-align: center; }
      .employee { display: flex; width: 100%; flex-direction: column; align-items: center;
        margin-top: 3mm; padding: 2mm; border: 1px solid rgba(255,255,255,.3);
        border-radius: 2mm; background: rgba(3, 18, 38, .25); }
      .employee span { font-size: 6pt; letter-spacing: 1.2px; opacity: .8; }
      .employee strong { margin-top: .5mm; font-size: 10pt; letter-spacing: .5px; }
      .front-footer { margin-top: auto; font-size: 5pt; letter-spacing: 1px; opacity: .75; }
      .back { display: flex; flex-direction: column; align-items: center; padding: 5mm 4mm 4mm;
        color: #102a43; background: linear-gradient(180deg, #f8fbff 0%, #fff 50%, #edf7f8 100%);
        border: .5mm solid #d5e4ec; }
      .back-brand { width: 100%; padding-bottom: 2mm; border-bottom: .4mm solid #18a0a6;
        color: #0b2545; font-size: 9pt; font-weight: 800; text-align: center; }
      .code-wrap { display: flex; height: 41mm; align-items: center; justify-content: center; }
      .code { object-fit: contain; }
      .qr { width: 34mm; height: 34mm; }
      .barcode { width: 45mm; height: 23mm; }
      .scan-label { margin: 0; color: #526579; font-size: 6.5pt; text-align: center; }
      .return { width: 100%; margin-top: 4mm; padding-top: 2.5mm; border-top: .3mm solid #cbd5e1;
        font-size: 7pt; line-height: 1.3; }
      .return strong { color: #0b7285; font-size: 6pt; letter-spacing: 1px; }
      .return p { margin: 1mm 0 0; }
      .address { white-space: pre-line; font-weight: 700; }
      .contact { color: #526579; font-size: 6pt; overflow-wrap: anywhere; }
      .card-version { margin-top: auto; color: #718096; font-size: 5.5pt; }
      @media screen { body { padding: 16px; background: #e2e8f0; }
        .card { margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(15,23,42,.18); } }
    </style></head><body>${pages}<script>window.onload=()=>window.print();</script></body></html>`);
    printWindow.document.close();
  };

  const fingerprint = credentials.find((credential) => credential.credentialType === "FINGERPRINT" &&
    credential.status === "ACTIVE");
  const cards = credentials.filter((credential) => credential.credentialType !== "FINGERPRINT");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance credentials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="cards" className="space-y-4">
          <TabsList>
            <TabsTrigger value="cards">ID cards</TabsTrigger>
            <TabsTrigger value="fingerprint">Fingerprint</TabsTrigger>
          </TabsList>
          <TabsContent value="cards" className="space-y-3">
          <h3 className="font-medium">ID card</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Card format</Label>
              <Select
                value={credentialType}
                onValueChange={(value) => setCredentialType(value as typeof credentialType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CARD_QR">QR code</SelectItem>
                  <SelectItem value="CARD_BARCODE">Barcode</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expires on (optional)</Label>
              <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </div>
            <Button onClick={issueCard} disabled={saving} className="cursor-pointer">
              {saving ? "Issuing..." : "Issue card"}
            </Button>
          </div>
          {issuedCard ? (
            <div className="space-y-4 rounded-md border p-4">
              <p className="font-medium">Portrait card preview</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="mx-auto flex aspect-[54/85.6] w-full max-w-56 flex-col items-center overflow-hidden rounded-xl bg-linear-to-br from-[#0b2545] via-[#124e78] to-[#18a0a6] p-3 text-center text-white shadow-lg">
                  <div className="flex w-full items-center gap-2 text-left">
                    {facility?.logoUrl ? (
                      <img src={facility.logoUrl} alt="" className="size-9 rounded-md bg-white object-contain p-1" />
                    ) : (
                      <div className="flex size-9 items-center justify-center rounded-md bg-white font-bold text-slate-900">
                        {(facility?.facilityName ?? "F").split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}
                      </div>
                    )}
                    <span className="text-xs font-bold leading-tight">{facility?.facilityName || "Facility"}</span>
                  </div>
                  {imageUrl ? (
                    <img src={imageUrl} alt={name} className="mt-4 size-24 rounded-full border-4 border-white/80 object-cover" />
                  ) : (
                    <div className="mt-4 flex size-24 items-center justify-center rounded-full border-4 border-white/80 bg-blue-100 text-2xl font-bold text-slate-900">
                      {name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "S"}
                    </div>
                  )}
                  <p className="mt-3 max-w-full wrap-break-word text-base font-extrabold">{name}</p>
                  <p className="text-xs text-cyan-100">{position || "Staff"}</p>
                  <div className="mt-3 w-full rounded-md border border-white/30 bg-slate-950/20 px-2 py-1.5">
                    <p className="text-[9px] tracking-widest text-white/80">EMPLOYEE ID</p>
                    <p className="text-sm font-bold">{employeeId}</p>
                  </div>
                  <p className="mt-auto text-[8px] tracking-widest text-white/70">OFFICIAL STAFF IDENTIFICATION</p>
                </div>
                <div className="mx-auto flex aspect-[54/85.6] w-full max-w-56 flex-col items-center overflow-hidden rounded-xl border border-slate-200 bg-linear-to-b from-slate-50 via-white to-cyan-50 p-3 text-center text-slate-900 shadow-lg">
                  <p className="w-full border-b-2 border-cyan-600 pb-2 text-xs font-extrabold text-[#0b2545]">
                    {facility?.facilityName || "Facility"}
                  </p>
                  <div className="flex h-40 items-center justify-center">
                    {issuedCard.printFormat === "QR" && qrDataUrl
                      ? <img src={qrDataUrl} alt="Attendance QR code" className="size-32 object-contain" />
                      : barcodeDataUrl
                        ? <img src={barcodeDataUrl} alt="Attendance barcode" className="w-44 object-contain" />
                        : <div className="h-32 w-32 animate-pulse rounded bg-muted" />}
                  </div>
                  <p className="text-[10px] text-slate-500">Scan or present this code for attendance</p>
                  <div className="mt-3 w-full border-t pt-2 text-left text-[10px]">
                    <p className="font-bold tracking-wider text-cyan-800">FOUND THIS CARD?</p>
                    <p className="mt-1">Please return it to:</p>
                    <p className="mt-1 whitespace-pre-line font-semibold">
                      {facility?.address || "Facility administration"}
                    </p>
                    {facility?.telephone || facility?.email ? (
                      <p className="mt-1 wrap-break-word text-slate-500">
                        {[facility.telephone, facility.email].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <p className="mt-auto text-[9px] text-slate-500">Attendance credential · v{issuedCard.cardVersion}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">The token is encoded in the printed code and cannot be retrieved again.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => printCard("both")} disabled={issuedCard.printFormat === "QR" ? !qrDataUrl : !barcodeDataUrl} className="cursor-pointer">
                  Print front &amp; back
                </Button>
                <Button variant="outline" onClick={() => printCard("front")} className="cursor-pointer">
                  Print front only
                </Button>
                <Button variant="outline" onClick={() => printCard("back")} disabled={issuedCard.printFormat === "QR" ? !qrDataUrl : !barcodeDataUrl} className="cursor-pointer">
                  Print back only
                </Button>
              </div>
            </div>
          ) : null}
          {loading ? <p className="text-sm text-muted-foreground">Loading cards...</p> : cards.length === 0
            ? <p className="text-sm text-muted-foreground">No attendance cards issued.</p>
            : <div className="space-y-2">{cards.map((credential) => (
              <div key={credential.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <p className="font-medium">{credential.credentialType === "CARD_QR" ? "QR card" : "Barcode card"} · v{credential.cardVersion}</p>
                  <p className="text-sm text-muted-foreground">
                    Issued {new Date(credential.issuedAt).toLocaleDateString()}
                    {credential.expiresAt ? ` · Expires ${new Date(credential.expiresAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={credential.status === "ACTIVE" ? "default" : "secondary"}>{credential.status}</Badge>
                  {credential.status === "ACTIVE" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCredentialToRevoke(credential);
                        setRevokeReason("");
                      }}
                      disabled={saving}
                      className="cursor-pointer"
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}</div>}
          </TabsContent>

          <TabsContent value="fingerprint" className="space-y-3">
          <h3 className="font-medium">Fingerprint enrollment</h3>
          <p className="text-sm text-muted-foreground">
            Enrollment requires active BIOMETRIC_ATTENDANCE consent. Fingerprint templates remain on the terminal; only enrollment status and badge PIN are stored here.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={fingerprint ? "default" : "secondary"}>
              {fingerprint ? "Enrolled" : "Not enrolled"}
            </Badge>
            {fingerprint ? <span className="text-sm text-muted-foreground">
              Last enrolled {new Date(fingerprint.issuedAt).toLocaleDateString()}
            </span> : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={enrollmentNote}
              onChange={(event) => setEnrollmentNote(event.target.value)}
              placeholder="Optional enrollment note"
              maxLength={500}
            />
            <Button onClick={enrollFingerprint} disabled={saving} className="cursor-pointer">
              {fingerprint ? "Record re-enrollment" : "Record enrollment"}
            </Button>
          </div>
          </TabsContent>
        </Tabs>
      </CardContent>
      <Dialog
        open={Boolean(credentialToRevoke)}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setCredentialToRevoke(null);
            setRevokeReason("");
          }
        }}
      >
        <DialogContent showCloseButton={!saving}>
          <DialogHeader>
            <DialogTitle>Revoke attendance card?</DialogTitle>
            <DialogDescription>
              Enter a reason for revoking this card. The card will no longer be accepted for attendance.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Revocation reason</Label>
            <Textarea
              id="revoke-reason"
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Explain why this card is being revoked"
              minLength={3}
              maxLength={500}
              rows={4}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCredentialToRevoke(null);
                setRevokeReason("");
              }}
              className="cursor-pointer"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void revoke()}
              className="cursor-pointer"
              disabled={saving || revokeReason.trim().length < 3}
            >
              {saving ? "Revoking..." : "Revoke card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
