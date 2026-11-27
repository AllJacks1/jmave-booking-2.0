"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { VehicleRow } from "@/db/schema";
import { FUEL_TYPE_LABELS, OWNERSHIP_LABELS } from "@/lib/fleet/schema";
import { BODY_TYPE_LABELS, CATEGORY_LABELS, type Category } from "@/lib/pricing/types";
import { publicCategory } from "@/lib/public/quote-form";
import { VehicleFormDialog } from "./vehicle-form-dialog";

export type VehicleItem = Omit<VehicleRow, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export function FleetTable({ vehicles, canEdit }: { vehicles: VehicleItem[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<VehicleItem | null>(null);
  const [creating, setCreating] = useState(false);
  const activeCount = vehicles.filter((v) => v.active).length;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {activeCount} active of {vehicles.length}
        </p>
        {canEdit ? (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            Add vehicle
          </Button>
        ) : null}
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Plate</TableHead>
              <TableHead>Body</TableHead>
              <TableHead className="hidden md:table-cell">Fuel</TableHead>
              <TableHead className="hidden md:table-cell">Tank</TableHead>
              <TableHead>Ownership</TableHead>
              <TableHead>Status</TableHead>
              {canEdit ? <TableHead className="w-12" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No vehicles yet. Import the booking workbook or add one.
                </TableCell>
              </TableRow>
            ) : null}
            {vehicles.map((v) => (
              <TableRow key={v.id} className={v.active ? undefined : "text-muted-foreground"}>
                <TableCell className="tabular-nums">{v.sortOrder}</TableCell>
                <TableCell>
                  <div className="font-medium">{v.displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[v.make, v.model, v.year, v.color, v.transmission].filter(Boolean).join(" · ")}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{v.plate ?? "—"}</TableCell>
                <TableCell>
                  {v.bodyType ? BODY_TYPE_LABELS[v.bodyType] : <Badge variant="destructive">Missing</Badge>}
                  {v.category ? <span className="text-xs text-muted-foreground"> · {CATEGORY_LABELS[v.category as Category] ?? v.category}</span> : null}
                  {v.active && !publicCategory(v).ok && v.listedPublicly ? (
                    <div className="text-xs text-destructive">Not on booking page: set the rate category</div>
                  ) : null}
                  {!v.listedPublicly ? <div className="text-xs text-muted-foreground">Hidden from booking page</div> : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">{v.fuelType ? FUEL_TYPE_LABELS[v.fuelType] : "—"}</TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">{v.tankCapacityL ? `${v.tankCapacityL} L` : "—"}</TableCell>
                <TableCell>
                  {OWNERSHIP_LABELS[v.ownership]}
                  {v.operatorName ? <div className="text-xs text-muted-foreground">{v.operatorName}</div> : null}
                </TableCell>
                <TableCell>{v.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                {canEdit ? (
                  <TableCell>
                    <Button variant="ghost" size="icon" aria-label={`Edit ${v.displayName}`} onClick={() => setEditing(v)}>
                      <PencilIcon />
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {canEdit && creating ? (
        <VehicleFormDialog open onOpenChange={setCreating} nextSortOrder={Math.max(0, ...vehicles.map((v) => v.sortOrder)) + 10} />
      ) : null}
      {canEdit && editing ? <VehicleFormDialog open onOpenChange={(o) => !o && setEditing(null)} vehicle={editing} /> : null}
    </>
  );
}
