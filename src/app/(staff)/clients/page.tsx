import { PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/page";
import { clientSearchSchema } from "@/lib/clients/schema";
import { CLIENTS_PAGE_SIZE, isRepeatClient, searchClients } from "@/lib/clients/service";
import { can } from "@/lib/permissions";
import { formatPhPhone } from "@/lib/phone";
import { BlacklistBadge, RepeatBadge } from "./client-badges";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, allowed } = await requirePage("clients.view");
  if (!allowed) return <NoAccess />;
  const parsed = clientSearchSchema.safeParse(await searchParams);
  const params = parsed.success ? parsed.data : { q: "", page: 1, blacklisted: "all" as const };
  const { rows, total } = await searchClients(params);
  const pages = Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));
  const qs = (page: number) =>
    `/clients?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.blacklisted === "only" ? { blacklisted: "only" } : {}), page: String(page) })}`;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Search by name, FB name, phone or email."
        actions={
          can(user, "clients.edit") ? (
            <Button asChild>
              <Link href="/clients/new">
                <PlusIcon />
                New client
              </Link>
            </Button>
          ) : null
        }
      />
      <form className="flex flex-wrap items-center gap-2" method="get" role="search">
        <div className="relative min-w-64 flex-1">
          <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={params.q} placeholder="Name, FB name, 0917…, email" className="pl-8" aria-label="Search clients" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="blacklisted" value="only" defaultChecked={params.blacklisted === "only"} className="size-4" />
          Blacklisted only
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {total.toLocaleString("en-PH")} client{total === 1 ? "" : "s"}
        {params.q ? ` matching “${params.q}”` : ""}
      </p>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No clients found.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((c) => (
              <TableRow key={c.id} data-testid="client-row">
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/clients/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                      {c.fullName}
                    </Link>
                    {c.isBlacklisted ? <BlacklistBadge /> : null}
                  </div>
                  {c.fbName ? <div className="text-xs text-muted-foreground">FB: {c.fbName}</div> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">{c.phone ? formatPhPhone(c.phone) : "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{c.email ?? "—"}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <RepeatBadge repeat={isRepeatClient(c)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {params.page} of {pages}
          </span>
          {params.page > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(params.page - 1)}>Previous</Link>
            </Button>
          ) : null}
          {params.page < pages ? (
            <Button asChild size="sm" variant="outline">
              <Link href={qs(params.page + 1)}>Next</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
