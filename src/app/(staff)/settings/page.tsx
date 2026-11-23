import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { NoAccess } from "@/components/placeholders";
import { requirePage } from "@/lib/auth/page";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings/service";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, allowed } = await requirePage("settings.view");
  if (!allowed) return <NoAccess />;
  const settings = await getSettings();
  const readOnly = !can(user, "settings.edit");

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          readOnly
            ? "Read-only. Only a Super Admin can change system settings."
            : "Business details, default fuel prices and booking rules."
        }
      />
      <SettingsForm initial={settings} readOnly={readOnly} />
    </>
  );
}
