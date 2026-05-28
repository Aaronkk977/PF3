import { SettingsClient } from "@/components/settings/settings-client";
import { listAccountsWithComputedCash } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const accounts = await listAccountsWithComputedCash();
  return <SettingsClient initialAccounts={accounts} />;
}
