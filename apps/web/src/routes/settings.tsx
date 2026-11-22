import { Bell } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/nav";
import { MyNotifications } from "@/settings/MyNotifications";

const settings = NAV_ITEMS.find((item) => item.to === "/settings");

/** Settings: for now the Notifications section; later steps add theirs beside it. */
export function SettingsPage() {
  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="text-3xl font-semibold">{settings?.label ?? "Settings"}</h1>
      <p className="mt-1 text-muted-foreground">{settings?.blurb}</p>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-2 font-display text-xl font-medium">
              <Bell className="size-5 text-primary" aria-hidden />
              Notifications
            </h2>
          </CardTitle>
          <CardDescription>
            Downloads that finish or fail, and what your subscriptions find, as notifications on
            your phone or desktop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MyNotifications />
        </CardContent>
      </Card>
    </section>
  );
}
