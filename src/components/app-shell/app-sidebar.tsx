"use client";

import {
  BadgePercentIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  CarFrontIcon,
  ClipboardListIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GaugeIcon,
  HistoryIcon,
  IdCardIcon,
  InboxIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  SettingsIcon,
  ShieldUserIcon,
  TagsIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_GROUP_LABELS, type NavIcon, type NavItem } from "@/lib/nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  quotes: FileTextIcon,
  inquiries: InboxIcon,
  bookings: ClipboardListIcon,
  calendar: CalendarDaysIcon,
  board: GaugeIcon,
  clients: UsersIcon,
  rewards: BadgePercentIcon,
  drivers: IdCardIcon,
  roster: CalendarClockIcon,
  fleet: CarFrontIcon,
  rates: TagsIcon,
  import: FileSpreadsheetIcon,
  users: ShieldUserIcon,
  audit: HistoryIcon,
  settings: SettingsIcon,
};

/** `badges`: count shown next to a menu item (e.g. new booking requests), by href. */
export function AppSidebar({ items, badges = {} }: { items: NavItem[]; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const groups = (["work", "operations", "admin"] as const)
    .map((g) => ({ key: g, items: items.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <CarFrontIcon className="size-4" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="font-semibold">J-MaVe Cars</span>
                  <span className="text-xs text-muted-foreground">Booking</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel>{NAV_GROUP_LABELS[group.key]}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu aria-label={NAV_GROUP_LABELS[group.key]}>
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href} onClick={() => setOpenMobile(false)}>
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badges[item.href] ? (
                        <SidebarMenuBadge data-testid={`nav-badge-${item.href.slice(1)}`} aria-label={`${badges[item.href]} new`}>
                          {badges[item.href]}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
