import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InfoIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { countUsers } from "@/lib/users/service";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const [userCount, current, params] = await Promise.all([
    countUsers(),
    getCurrentUser(),
    searchParams,
  ]);
  if (current) redirect("/");
  const notSetUp = userCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Staff access for J-MaVe Cars.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notSetUp ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>System not set up</AlertTitle>
            <AlertDescription>
              No accounts exist yet. The owner must open <code>/setup</code> with the setup
              token to create the first Super Admin.
            </AlertDescription>
          </Alert>
        ) : null}
        {params.setup === "done" ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>Setup complete</AlertTitle>
            <AlertDescription>Sign in with the Super Admin account you created.</AlertDescription>
          </Alert>
        ) : null}
        <LoginForm disabled={notSetUp} />
      </CardContent>
    </Card>
  );
}
