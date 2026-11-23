import { ConstructionIcon, LockIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

export function NoAccess() {
  return (
    <Card className="mx-auto mt-10 w-full max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <LockIcon className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">No access</h1>
        <p className="text-sm text-muted-foreground">
          Your role does not include this page. Ask an administrator if you need it.
        </p>
      </CardContent>
    </Card>
  );
}

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ConstructionIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">Coming in Phase {phase}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This section is part of a later build phase.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
