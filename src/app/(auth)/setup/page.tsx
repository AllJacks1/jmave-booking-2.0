import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSetupOpen } from "@/lib/setup/service";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-run setup" };

export default async function SetupPage() {
  // Once any user exists, /setup does not exist (PLAN §6.4).
  if (!(await isSetupOpen())) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle>First-run setup</CardTitle>
        <CardDescription>
          Create the first Super Admin. You need the setup token from the server&apos;s
          environment variables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SetupForm />
      </CardContent>
    </Card>
  );
}
