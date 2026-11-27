"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Copy-paste snippet for the company website (Phase 4 brief §6). */
export function embedSnippet(bookUrl: string): string {
  const u = new URL(bookUrl);
  u.searchParams.set("embed", "1");
  const origin = u.origin;
  return `<iframe id="jmave-book" data-src="${u.toString()}" title="Book a car" style="width:100%;min-height:640px;border:0" loading="lazy"></iframe>
<noscript><a href="${bookUrl}">Book a car</a></noscript>
<script>
(function () {
  var f = document.getElementById("jmave-book");
  var u = new URL(f.getAttribute("data-src"));
  // Pass this page's campaign tags, referrer and _fbp to the booking page.
  new URLSearchParams(location.search).forEach(function (v, k) { if (!u.searchParams.has(k)) u.searchParams.set(k, v); });
  if (document.referrer) u.searchParams.set("ref", document.referrer);
  u.searchParams.set("landing", location.href.split("#")[0]);
  var m = document.cookie.match(/(?:^|;\\s*)_fbp=([^;]+)/);
  if (m) u.searchParams.set("fbp", decodeURIComponent(m[1]));
  f.src = u.toString();
  window.addEventListener("message", function (e) {
    if (e.origin !== "${origin}" || !e.data) return;
    if (e.data.type === "jmave-book:height") f.style.height = e.data.height + "px";
    if (e.data.type === "jmave-book:top") f.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();
</script>`;
}

export function EmbedSnippet({ bookUrl, origins }: { bookUrl: string | null; origins: string[] }) {
  if (!bookUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Booking page embed</CardTitle>
          <CardDescription>Set APP_URL (or PUBLIC_BOOK_HOST) to get the embed snippet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const code = embedSnippet(bookUrl);
  return (
    <Card data-testid="embed-snippet">
      <CardHeader>
        <CardTitle>Booking page embed</CardTitle>
        <CardDescription>
          Public page: <a className="text-primary underline" href={bookUrl} target="_blank" rel="noopener">{bookUrl}</a>. Paste this where the booking form
          should appear on the company website. It resizes itself.{" "}
          {origins.length
            ? `Allowed to embed: ${origins.join(", ")} (PUBLIC_EMBED_ORIGINS).`
            : "No site is allowed to embed it yet: set PUBLIC_EMBED_ORIGINS in Railway Variables."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <pre tabIndex={0} aria-label="Embed code" className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{code}</pre>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(code);
              toast.success("Snippet copied");
            }}
          >
            <CopyIcon />
            Copy snippet
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
