"use client";

import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role } from "@/db/schema";
import { ROLE_LABELS } from "@/lib/permissions";
import { resetUserPasswordAction, setUserActiveAction } from "./actions";
import { TemporaryPasswordDialog } from "./temporary-password-dialog";
import { UserFormDialog, type EditableUser } from "./user-form-dialog";

export type UserListItem = EditableUser & {
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

export function UsersTable({
  users,
  currentUserId,
  manageableRoles,
}: {
  users: UserListItem[];
  currentUserId: string;
  manageableRoles: Role[];
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const canManage = (u: UserListItem) => manageableRoles.includes(u.role);

  function toggleActive(u: UserListItem) {
    startTransition(async () => {
      const result = await setUserActiveAction({ id: u.id, active: !u.active });
      if (!result.ok) toast.error(result.error);
      else toast.success(u.active ? `${u.displayName} deactivated` : `${u.displayName} reactivated`);
    });
  }

  function resetPassword(u: UserListItem) {
    if (!confirm(`Reset the password for ${u.displayName}? They will be signed out.`)) return;
    startTransition(async () => {
      const result = await resetUserPasswordAction({ id: u.id });
      if (!result.ok) toast.error(result.error);
      else setTempPassword({ email: u.email, password: result.data.temporaryPassword });
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New user
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.email}`}>
                <TableCell>
                  <div className="font-medium">{u.displayName}</div>
                  <div className="text-xs text-muted-foreground md:hidden">{u.email}</div>
                  {u.name !== u.displayName ? (
                    <div className="text-xs text-muted-foreground">{u.name}</div>
                  ) : null}
                </TableCell>
                <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "super_admin" ? "default" : "secondary"}>
                    {ROLE_LABELS[u.role]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.active ? (
                    u.mustChangePassword ? (
                      <Badge variant="outline">Temporary password</Badge>
                    ) : (
                      <Badge variant="outline">Active</Badge>
                    )
                  ) : (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {canManage(u) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={pending} aria-label={`Actions for ${u.displayName}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(u)}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => resetPassword(u)}>Reset password</DropdownMenuItem>
                        {u.id !== currentUserId ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant={u.active ? "destructive" : "default"}
                              onSelect={() => toggleActive(u)}
                            >
                              {u.active ? "Deactivate" : "Reactivate"}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <UserFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={manageableRoles}
        onCreated={(email, password) => setTempPassword({ email, password })}
      />
      {editing ? (
        <UserFormDialog
          key={editing.id}
          mode="edit"
          user={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          roles={manageableRoles}
        />
      ) : null}
      <TemporaryPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  );
}
