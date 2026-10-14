import { useEffect, useMemo, useState } from "react";
import { useNotification } from "@refinedev/core";

import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BACKEND_BASE_URL } from "@/constants";
import { orgUnitTypeOptions } from "@/constants/options";
import type { OrgUnitRecord } from "@/types/domain";
import { createAuthHeaders } from "@/providers/me";
import PageLoader from "@/components/PageLoader";

type OrgUnitPayload = {
  parentId?: string | null;
  code: string;
  name: string;
  unitType: OrgUnitRecord["unitType"];
  isClinical: boolean;
  operates24h: boolean;
  active?: boolean;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

const flattenTree = (tree: OrgUnitRecord[], depth = 0): Array<OrgUnitRecord & { depth: number }> => {
  const rows: Array<OrgUnitRecord & { depth: number }> = [];
  for (const node of tree) {
    rows.push({ ...node, depth });
    if (node.children?.length) {
      rows.push(...flattenTree(node.children, depth + 1));
    }
  }
  return rows;
};

const TreeNode = ({ node }: { node: OrgUnitRecord }) => {
  return (
    <li className="space-y-2">
      <div className="rounded-md border border-border px-3 py-2 text-sm">
        <span className="font-medium">{node.name}</span>
        <span className="ml-2 text-muted-foreground">({node.code})</span>
        <span className="ml-2 text-xs text-muted-foreground">{node.unitType}</span>
      </div>
      {node.children?.length ? (
        <ul className="ml-5 space-y-2 border-l border-border pl-3">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
};

export const OrgUnitList = () => {
  const { open: notify } = useNotification();
  const [tree, setTree] = useState<OrgUnitRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<OrgUnitPayload>({
    parentId: null,
    code: "",
    name: "",
    unitType: "DEPARTMENT",
    isClinical: false,
    operates24h: false,
    active: true,
  });

  const flatUnits = useMemo(() => flattenTree(tree), [tree]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      parentId: null,
      code: "",
      name: "",
      unitType: "DEPARTMENT",
      isClinical: false,
      operates24h: false,
      active: true,
    });
  };

  const loadTree = async () => {
    const response = await fetch(`${apiBase}/v1/org-units/tree`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as { data?: OrgUnitRecord[]; message?: string };
    if (!response.ok) {
      throw new Error(payload.message || "Failed to load org units.");
    }
    setTree(payload.data ?? []);
  };

  useEffect(() => {
    loadTree().catch((error) => {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to load org units." });
    });
  }, [notify]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      notify?.({ type: "error", message: "Code and name are required." });
      return;
    }

    try {
      setIsSubmitting(true);
      const url = editingId ? `${apiBase}/v1/org-units/${editingId}` : `${apiBase}/v1/org-units`;
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: createAuthHeaders(),
        body: JSON.stringify({
          ...form,
          code: form.code.trim(),
          name: form.name.trim(),
          parentId: form.parentId || null,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "Failed to save org unit.");
      }
      notify?.({
        type: "success",
        message: editingId ? "Org unit updated." : "Org unit created.",
      });
      resetForm();
      await loadTree();
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to save org unit." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (unit: OrgUnitRecord) => {
    setEditingId(unit.id);
    setForm({
      parentId: unit.parentId ?? null,
      code: unit.code,
      name: unit.name,
      unitType: unit.unitType,
      isClinical: unit.isClinical,
      operates24h: unit.operates24h,
      active: unit.active,
    });
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Organisation Units" />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Org Unit Tree</CardTitle>
          </CardHeader>
          <CardContent>
            {tree.length === 0 ? (
              <p className="text-sm text-muted-foreground">No org units yet.</p>
            ) : (
              <ul className="space-y-2">
                {tree.map((node) => (
                  <TreeNode key={node.id} node={node} />
                ))}
              </ul>
            )}
            {flatUnits.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {flatUnits.map((unit) => (
                  <Button key={unit.id} variant="outline" size="sm" className="cursor-pointer" onClick={() => startEdit(unit)}>
                    Edit {unit.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingId ? "Edit Org Unit" : "Create Org Unit"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-code">Code</Label>
              <Input
                id="org-code"
                value={form.code}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Parent Unit</Label>
              <Select
                value={form.parentId ?? "none"}
                onValueChange={(value) => setForm((current) => ({ ...current, parentId: value === "none" ? null : value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No parent</SelectItem>
                  {flatUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {"—".repeat(unit.depth)} {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unit Type</Label>
              <Select
                value={form.unitType}
                onValueChange={(value) => setForm((current) => ({ ...current, unitType: value as OrgUnitPayload["unitType"] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orgUnitTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isClinical}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, isClinical: Boolean(checked) }))
                }
              />
              Clinical unit
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.operates24h}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, operates24h: Boolean(checked) }))
                }
              />
              Operates 24 hours
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={Boolean(form.active)}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, active: Boolean(checked) }))
                }
              />
              Active
            </label>
            <div className="flex gap-2 pt-2">
              <Button className="cursor-pointer" onClick={submit} disabled={isSubmitting}>
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <PageLoader inline />
                      Saving...
                  </span>
                ) : editingId ? "Update Unit" : "Create Unit"}
              </Button>
              {editingId ? (
                <Button variant="outline" className="cursor-pointer" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </ListView>
  );
};
