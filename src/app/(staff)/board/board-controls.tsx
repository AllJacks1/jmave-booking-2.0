"use client";

import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const REFRESH_MS = 60_000;

/** Date picker + live refresh (every 60 s and when the tab regains focus). */
export function BoardControls({ date, prev, next, today }: { date: string; prev: string; next: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => startTransition(() => router.refresh());
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    const onFocus = () => refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const go = (d: string) => router.push(`/board?date=${d}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => go(prev)}>
        <ChevronLeftIcon />
      </Button>
      <Input
        type="date"
        aria-label="Board date"
        className="w-40"
        key={date}
        defaultValue={date}
        onChange={(e) => {
          if (e.target.value) go(e.target.value);
        }}
      />
      <Button variant="outline" size="icon" aria-label="Next day" onClick={() => go(next)}>
        <ChevronRightIcon />
      </Button>
      {date !== today ? (
        <Button variant="secondary" onClick={() => go(today)}>
          Today
        </Button>
      ) : null}
      <Button variant="ghost" size="icon" aria-label="Refresh" onClick={() => startTransition(() => router.refresh())}>
        <RefreshCwIcon className={pending ? "animate-spin" : undefined} />
      </Button>
    </div>
  );
}
