"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function TemporaryPasswordDialog({
  value,
  onClose,
}: {
  value: { email: string; password: string } | null;
  onClose: () => void;
}) {
  async function copy() {
    if (!value) return;
    await navigator.clipboard.writeText(value.password);
    toast.success("Copied");
  }

  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Give this to {value?.email} in person or by a private message. It is shown only
            once. They must choose a new password when they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
          <code data-testid="temporary-password" className="flex-1 font-mono text-base tracking-wide">
            {value?.password}
          </code>
          <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy password">
            <CopyIcon />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
