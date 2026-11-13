import { Download, Pencil, Upload } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { appointmentRequest } from "@/lib/appointments-api";
import { errorMessage } from "@/lib/patients-api";

type ServiceItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  defaultOrgUnitId: string | null;
  defaultOrgUnitName: string | null;
  nhisTariffCode: string | null;
  gdrgCode: string | null;
  isBillable: boolean;
  allowDiscount: boolean;
  active: boolean;
};
type PriceList = {
  id: string;
  code: string;
  name: string;
  payerType: string;
  currency: string;
  isDefault: boolean;
  active: boolean;
};
type PriceItem = {
  id: string;
  price: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  service: { code: string; name: string; category: string };
};
type Unit = { id: string; name: string; code: string };
type ImportResult = { dryRun: boolean; imported: number; validRows: number; errors: Array<{ row: number; message: string }> };
type ApiData<T> = { data: T };

const categories = [
  "REGISTRATION", "CONSULTATION", "PROCEDURE", "LAB", "IMAGING",
  "DRUG", "CONSUMABLE", "BED_DAY", "NURSING", "OTHER",
];
const payerTypes = ["CASH", "NHIS", "PRIVATE", "CORPORATE", "STAFF", "EXEMPT"];
const today = () => new Date().toISOString().slice(0, 10);
const emptyService = {
  editingId: "",
  code: "",
  name: "",
  category: "CONSULTATION",
  defaultOrgUnitId: "",
  nhisTariffCode: "",
  gdrgCode: "",
  isBillable: true,
  allowDiscount: true,
  active: true,
};
const emptyPriceList = {
  editingId: "",
  code: "",
  name: "",
  payerType: "CASH",
  currency: "GHS",
  isDefault: false,
  active: true,
};

const downloadCsvTemplate = () => {
  const blob = new Blob(["service_code,price,effective_from,effective_to\r\nCONS-001,100.00,2026-01-01,\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "price-list-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
};

export function ChargeMasterPage() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [selectedPriceListId, setSelectedPriceListId] = useState("");
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [serviceForm, setServiceForm] = useState(emptyService);
  const [priceListForm, setPriceListForm] = useState(emptyPriceList);
  const [priceForm, setPriceForm] = useState({ serviceItemId: "", price: "", effectiveFrom: today(), effectiveTo: "" });
  const [csv, setCsv] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const unitOptions = useMemo<SearchableSelectOption[]>(() =>
    units.map((unit) => ({ value: unit.id, label: `${unit.name} · ${unit.code}` })), [units]);
  const serviceOptions = useMemo<SearchableSelectOption[]>(() =>
    services.filter((service) => service.active).map((service) => ({
      value: service.id,
      label: `${service.name} · ${service.code}`,
      keywords: service.category,
    })), [services]);
  const priceListOptions = useMemo<SearchableSelectOption[]>(() =>
    priceLists.filter((list) => list.active).map((list) => ({
      value: list.id,
      label: `${list.name} · ${list.code} · ${list.payerType}${list.isDefault ? " · Default" : ""}`,
    })), [priceLists]);

  const loadData = async () => {
    const [activeServices, inactiveServices, lists, refs] = await Promise.all([
      appointmentRequest<ServiceItem[]>("service-items"),
      appointmentRequest<ServiceItem[]>("service-items?active=false"),
      appointmentRequest<PriceList[]>("price-lists"),
      appointmentRequest<{ units: Unit[] }>("appointment-references"),
    ]);
    setServices([...activeServices.data, ...inactiveServices.data]);
    setPriceLists(lists.data);
    setUnits(refs.data.units);
    setSelectedPriceListId((current) => current || lists.data.find((item) => item.active)?.id || "");
  };
  const loadPriceItems = async () => {
    if (!selectedPriceListId) {
      setPriceItems([]);
      return;
    }
    const result = await appointmentRequest<PriceItem[]>(`price-lists/${selectedPriceListId}/items`);
    setPriceItems(result.data);
  };

  useEffect(() => {
    loadData().catch((error: unknown) => toast.error(errorMessage(error, "Charge master data could not be loaded.")));
  }, []);
  useEffect(() => {
    loadPriceItems().catch((error: unknown) => toast.error(errorMessage(error, "Dated prices could not be loaded.")));
  }, [selectedPriceListId]);

  const saveService = async () => {
    if (!serviceForm.code.trim() || !serviceForm.name.trim()) {
      toast.error("Enter a service code and name.");
      return;
    }
    const { editingId, ...body } = serviceForm;
    setBusy(true);
    try {
      await appointmentRequest(editingId ? `service-items/${editingId}` : "service-items", {
        method: editingId ? "PATCH" : "POST",
        body: { ...body, defaultOrgUnitId: body.defaultOrgUnitId || null },
      });
      toast.success(editingId ? "Service item updated." : "Service item created.");
      setServiceForm(emptyService);
      await loadData();
    } catch (error) {
      toast.error(errorMessage(error, "Service item could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  const savePriceList = async () => {
    if (!priceListForm.code.trim() || !priceListForm.name.trim()) {
      toast.error("Enter a price-list code and name.");
      return;
    }
    const { editingId, ...body } = priceListForm;
    setBusy(true);
    try {
      const { data } = await appointmentRequest<PriceList>(editingId ? `price-lists/${editingId}` : "price-lists", {
        method: editingId ? "PATCH" : "POST",
        body,
      });
      toast.success(editingId ? "Price list updated." : "Price list created.");
      setPriceListForm(emptyPriceList);
      setSelectedPriceListId(data.id);
      await loadData();
    } catch (error) {
      toast.error(errorMessage(error, "Price list could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  const savePrice = async () => {
    if (!selectedPriceListId || !priceForm.serviceItemId || priceForm.price === "") {
      toast.error("Select a price list, service and amount.");
      return;
    }
    setBusy(true);
    try {
      await appointmentRequest(`price-lists/${selectedPriceListId}/items`, {
        method: "POST",
        body: {
          serviceItemId: priceForm.serviceItemId,
          price: Number(priceForm.price),
          effectiveFrom: priceForm.effectiveFrom,
          effectiveTo: priceForm.effectiveTo || null,
        },
      });
      toast.success("Dated price added.");
      setPriceForm({ serviceItemId: "", price: "", effectiveFrom: today(), effectiveTo: "" });
      await loadPriceItems();
    } catch (error) {
      toast.error(errorMessage(error, "Dated price could not be added."));
    } finally {
      setBusy(false);
    }
  };

  const fileChanged = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setImportResult(null);
  };
  const importCsv = async (dryRun: boolean) => {
    if (!selectedPriceListId || !csv.trim()) {
      toast.error("Choose a price list and select or paste a CSV file.");
      return;
    }
    setBusy(true);
    setImportResult(null);
    try {
      const { data } = await appointmentRequest<ImportResult>(`price-lists/${selectedPriceListId}/import`, {
        method: "POST",
        body: { csv, dryRun },
      });
      setImportResult(data);
      if (dryRun) {
        toast.success(`${data.validRows} valid row(s) found. No prices were changed.`);
      } else {
        toast.success(`${data.imported} price row(s) imported.`);
        await loadPriceItems();
      }
    } catch (error) {
      toast.error(errorMessage(error, "CSV import could not be completed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Services & price lists</h1>
        <p className="text-sm text-muted-foreground">Maintain billable services and effective-dated payer tariffs. Price periods cannot overlap.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Service catalogue</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label htmlFor="service-code">Service code</Label><Input id="service-code" maxLength={30} value={serviceForm.code} onChange={(event) => setServiceForm({ ...serviceForm, code: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="service-name">Service name</Label><Input id="service-name" maxLength={200} value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} /></div>
            <div className="space-y-2"><Label>Category</Label><Select value={serviceForm.category} onValueChange={(category) => setServiceForm({ ...serviceForm, category })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category} value={category}>{category.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Default clinic (optional)</Label><SearchableSelect options={unitOptions} value={serviceForm.defaultOrgUnitId} onValueChange={(defaultOrgUnitId) => setServiceForm({ ...serviceForm, defaultOrgUnitId })} placeholder="Any clinic" searchPlaceholder="Search clinics…" /></div>
            <div className="space-y-2"><Label htmlFor="nhis-code">NHIS tariff code</Label><Input id="nhis-code" maxLength={30} value={serviceForm.nhisTariffCode} onChange={(event) => setServiceForm({ ...serviceForm, nhisTariffCode: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="gdrg-code">G-DRG code</Label><Input id="gdrg-code" maxLength={15} value={serviceForm.gdrgCode} onChange={(event) => setServiceForm({ ...serviceForm, gdrgCode: event.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceForm.isBillable} onChange={(event) => setServiceForm({ ...serviceForm, isBillable: event.target.checked })} /> Billable</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceForm.allowDiscount} onChange={(event) => setServiceForm({ ...serviceForm, allowDiscount: event.target.checked })} /> Allow discount</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={serviceForm.active} onChange={(event) => setServiceForm({ ...serviceForm, active: event.target.checked })} /> Active</label>
          </div>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void saveService()}>{serviceForm.editingId ? "Save service" : "Add service"}</Button>
            {serviceForm.editingId ? <Button variant="outline" onClick={() => setServiceForm(emptyService)}>Cancel edit</Button> : null}
          </div>
          <div className="space-y-2">
            {services.map((service) => (
              <div key={service.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div><p className="font-medium">{service.name} <span className="text-muted-foreground">· {service.code}</span></p><p className="text-sm text-muted-foreground">{service.category.replaceAll("_", " ")}{service.defaultOrgUnitName ? ` · ${service.defaultOrgUnitName}` : ""}</p></div>
                <div className="flex items-center gap-2"><Badge variant={service.active ? "secondary" : "outline"}>{service.active ? "Active" : "Inactive"}</Badge><Button size="sm" variant="outline" onClick={() => setServiceForm({ ...service, editingId: service.id, defaultOrgUnitId: service.defaultOrgUnitId ?? "", nhisTariffCode: service.nhisTariffCode ?? "", gdrgCode: service.gdrgCode ?? "" })}><Pencil aria-hidden="true" className="mr-1 size-4" />Edit</Button></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Price lists</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label htmlFor="price-list-code">Price-list code</Label><Input id="price-list-code" maxLength={20} value={priceListForm.code} onChange={(event) => setPriceListForm({ ...priceListForm, code: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="price-list-name">Name</Label><Input id="price-list-name" maxLength={100} value={priceListForm.name} onChange={(event) => setPriceListForm({ ...priceListForm, name: event.target.value })} /></div>
            <div className="space-y-2"><Label>Payer</Label><Select value={priceListForm.payerType} onValueChange={(payerType) => setPriceListForm({ ...priceListForm, payerType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{payerTypes.map((payer) => <SelectItem key={payer} value={payer}>{payer}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="currency">Currency</Label><Input id="currency" maxLength={3} value={priceListForm.currency} onChange={(event) => setPriceListForm({ ...priceListForm, currency: event.target.value.toUpperCase() })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={priceListForm.isDefault} onChange={(event) => setPriceListForm({ ...priceListForm, isDefault: event.target.checked })} /> Default for payer</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={priceListForm.active} onChange={(event) => setPriceListForm({ ...priceListForm, active: event.target.checked })} /> Active</label>
          </div>
          <div className="flex gap-2"><Button disabled={busy} onClick={() => void savePriceList()}>{priceListForm.editingId ? "Save price list" : "Add price list"}</Button>{priceListForm.editingId ? <Button variant="outline" onClick={() => setPriceListForm(emptyPriceList)}>Cancel edit</Button> : null}</div>
          <div className="space-y-2">
            {priceLists.map((list) => (
              <div key={list.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div><p className="font-medium">{list.name} · {list.code}</p><p className="text-sm text-muted-foreground">{list.payerType} · {list.currency}</p></div>
                <div className="flex gap-2"><Badge variant={list.isDefault ? "default" : "outline"}>{list.isDefault ? "Default" : list.active ? "Active" : "Inactive"}</Badge><Button size="sm" variant="outline" onClick={() => { setPriceListForm({ editingId: list.id, code: list.code, name: list.name, payerType: list.payerType, currency: list.currency, isDefault: list.isDefault, active: list.active }); setSelectedPriceListId(list.id); }}>Edit</Button></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Effective-dated prices & CSV import</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Label>Price list</Label><SearchableSelect options={priceListOptions} value={selectedPriceListId} onValueChange={setSelectedPriceListId} placeholder="Choose price list" searchPlaceholder="Search price lists…" /></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label>Service</Label><SearchableSelect options={serviceOptions} value={priceForm.serviceItemId} onValueChange={(serviceItemId) => setPriceForm({ ...priceForm, serviceItemId })} placeholder="Choose service" searchPlaceholder="Search services…" /></div>
            <div className="space-y-2"><Label htmlFor="price-amount">Price</Label><Input id="price-amount" type="number" min="0" step="0.01" value={priceForm.price} onChange={(event) => setPriceForm({ ...priceForm, price: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="effective-from">Effective from</Label><Input id="effective-from" type="date" value={priceForm.effectiveFrom} onChange={(event) => setPriceForm({ ...priceForm, effectiveFrom: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="effective-to">Effective to (optional)</Label><Input id="effective-to" type="date" value={priceForm.effectiveTo} onChange={(event) => setPriceForm({ ...priceForm, effectiveTo: event.target.value })} /></div>
          </div>
          <Button disabled={busy} onClick={() => void savePrice()}>Add dated price</Button>
          <div className="space-y-2">
            {priceItems.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3 text-sm"><span>{item.service.name} · {item.service.code}</span><span>{item.price} · {item.effectiveFrom} – {item.effectiveTo || "No end date"}</span></div>)}
            {selectedPriceListId && priceItems.length === 0 ? <p className="text-sm text-muted-foreground">No dated prices in this list yet.</p> : null}
          </div>
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">Import price CSV</h3><p className="text-sm text-muted-foreground">Required columns: service_code, price, effective_from, effective_to.</p></div><Button type="button" variant="outline" onClick={downloadCsvTemplate}><Download aria-hidden="true" className="mr-2 size-4" />Download template</Button></div>
            <Input type="file" accept=".csv,text/csv" onChange={(event) => void fileChanged(event)} />
            <textarea className="min-h-28 w-full rounded-md border bg-transparent p-3 text-sm" aria-label="CSV contents" placeholder="Or paste CSV contents here…" value={csv} onChange={(event) => { setCsv(event.target.value); setImportResult(null); }} />
            <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void importCsv(true)}><Upload aria-hidden="true" className="mr-2 size-4" />Dry run</Button><Button disabled={busy || !importResult || importResult.errors.length > 0} onClick={() => void importCsv(false)}>Import validated rows</Button></div>
            {importResult ? <div className="space-y-2 rounded-md bg-muted p-3 text-sm"><p>{importResult.dryRun ? `Dry run: ${importResult.validRows} valid row(s).` : `Imported ${importResult.imported} row(s).`}</p>{importResult.errors.map((error, index) => <p key={`${error.row}-${index}`} className="text-destructive">Row {error.row}: {error.message}</p>)}</div> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
