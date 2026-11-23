import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { MANAGEABLE_ROLES } from "@/lib/permissions";
import { listUsers } from "@/lib/users/service";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { user, allowed } = await requirePage("users.view");
  if (!allowed) return <NoAccess />;
  const users = await listUsers();

  return (
    <>
      <PageHeader
        title="Users"
        description={
          user.role === "super_admin"
            ? "Create staff accounts, change roles, deactivate and reset passwords."
            : "You can manage Sales and Operations accounts."
        }
      />
      <UsersTable
        currentUserId={user.id}
        manageableRoles={[...MANAGEABLE_ROLES[user.role]]}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      />
    </>
  );
}
