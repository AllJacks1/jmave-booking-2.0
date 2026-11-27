import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { UserMenu } from "@/components/app-shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth/session";
import { countNewInquiries } from "@/lib/inquiries/service";
import { navForUser } from "@/lib/nav";
import { can, ROLE_LABELS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const newRequests = can(user, "inquiries.manage") ? await countNewInquiries() : 0;

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar items={navForUser(user)} badges={{ "/inquiries": newRequests }} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu
            displayName={user.displayName}
            email={user.email}
            roleLabel={ROLE_LABELS[user.role]}
          />
        </header>
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
