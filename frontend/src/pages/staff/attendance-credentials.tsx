import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
}: {
  staffId: string;
  name: string;
  employeeId: string;
}) => {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credentialType, setCredentialType] = useState<"CARD_QR" | "CARD_BARCODE">("CARD_QR");
  const [expiresAt, setExpiresAt] = useState("");
  const [enrollmentNote, setEnrollmentNote] = useState("");
  const [issuedCard, setIssuedCard] = useState<IssuedCard | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [barcodeDataUrl, setBarcodeDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const revoke = async (credential: Credential) => {
    const reason = window.prompt("Why is this card being revoked?");
    if (!reason?.trim()) return;
    setSaving(true);
    try {
      await request(`staff/${staffId}/credentials/${credential.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load();
      toast.success("Attendance card revoked.");
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

  const printCard = () => {
    if (
      !issuedCard ||
      (issuedCard.printFormat === "QR" ? !qrDataUrl : !barcodeDataUrl)
    ) return;
    const printWindow = window.open("", "_blank", "width=720,height=520");
    if (!printWindow) {
      toast.error("Allow pop-ups to print or save this ID card as a PDF.");
      return;
    }
    printWindow.opener = null;
    const safeName = escapeHtml(name);
    const safeEmployeeId = escapeHtml(employeeId);
    const barcodeUrl = barcodeDataUrl;
    const cardContent = issuedCard.printFormat === "QR"
      ? `<img class="code" src="${qrDataUrl}" alt="Attendance QR code">`
      : `<img class="code" src="${barcodeUrl}" alt="Attendance barcode">`;
    printWindow.document.write(`<!doctype html><html><head><title>Employee ID card</title><style>
      @page { size: 85.6mm 54mm; margin: 0; }
      * { box-sizing: border-box; } body { margin: 0; font-family: Arial, sans-serif; }
      .card { width: 85.6mm; height: 54mm; padding: 5mm; display: flex; align-items: center;
        gap: 5mm; border: 1px solid #cbd5e1; }
      .code { width: 34mm; height: 34mm; object-fit: contain; }
      .barcode { width: 34mm; height: 34mm; }
      .details { min-width: 0; } h1 { font-size: 14pt; margin: 0 0 4mm; }
      p { font-size: 9pt; margin: 1mm 0; } .caption { color: #475569; font-size: 7pt; }
      @media screen { body { padding: 16px; background: #e2e8f0; } .card { background: white; } }
    </style></head><body><main class="card">${cardContent}<div class="details">
      <h1>${safeName}</h1><p>Employee ID: ${safeEmployeeId}</p>
      <p class="caption">Attendance credential · v${issuedCard.cardVersion}</p>
      </div></main><script>window.onload=()=>window.print();</script></body></html>`);
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
            <div className="flex flex-wrap items-center gap-4 rounded-md border p-3">
              {issuedCard.printFormat === "QR" && qrDataUrl
                ? <img src={qrDataUrl} alt="New attendance QR credential" className="size-28" />
                : barcodeDataUrl ? <img src={barcodeDataUrl} alt="New attendance barcode credential" className="h-28 w-48 object-contain" /> : <div className="h-28 w-48 animate-pulse rounded bg-muted" />}
              <div className="space-y-2">
                <p className="font-medium">New card ready for printing</p>
                <p className="text-sm text-muted-foreground">The token is not displayed and cannot be retrieved again.</p>
                <Button onClick={printCard} disabled={issuedCard.printFormat === "QR" ? !qrDataUrl : !barcodeDataUrl} className="cursor-pointer">
                  Print / Save as PDF
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
                    <Button variant="outline" size="sm" onClick={() => void revoke(credential)} disabled={saving} className="cursor-pointer">
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
    </Card>
  );
};
