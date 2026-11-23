import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/permissions";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const rows: [string, React.ReactNode][] = [
    ["Name", user.name],
    ["Display name", user.displayName],
    ["Email", user.email],
    ["Role", <Badge key="role" variant="secondary">{ROLE_LABELS[user.role]}</Badge>],
  ];
  return (
    <>
      <PageHeader
        title="Profile"
        description="Your name and role are managed by an administrator."
        actions={
          <Button asChild variant="outline">
            <Link href="/change-password">Change password</Link>
          </Button>
        }
      />
      <Card className="max-w-xl">
        <CardContent>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
