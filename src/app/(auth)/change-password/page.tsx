import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowMustChangePassword: true });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          {user.mustChangePassword
            ? "You signed in with a temporary password. Choose a new one to continue."
            : `Signed in as ${user.email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ChangePasswordForm />
        {!user.mustChangePassword ? (
          <Link href="/" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back to the app
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
