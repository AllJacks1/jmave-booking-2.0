import { LockIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 403 page for `forbidden()` (quotation pages for Operations, etc.). */
export default function Forbidden() {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <LockIcon className="size-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">No access</h1>
          <p className="text-sm text-muted-foreground">Your role does not include this page. Ask an administrator if you need it.</p>
          <Button asChild variant="secondary">
            <Link href="/">Back to the app</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
