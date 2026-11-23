import type { Me } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { ALargeSmall, LogOut, Moon, Settings } from "lucide-react";

import { signOut } from "@/api/auth";
import { errorText } from "@/api/client";
import { Avatar } from "@/components/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { notify } from "@/components/ui/sonner";
import { type ThemeChoice, useThemeChoice } from "@/lib/theme";
import { isUiScale, UI_SCALE_STEPS, type UiScale, useUiScale } from "@/lib/uiScale";
import { forgetThisDevice } from "@/push/leave";

const ROLE_LABEL = { admin: "Admin", member: "Member" } as const satisfies Record<
  Me["role"],
  string
>;

const THEME_LABEL = {
  system: "Device theme",
  light: "Light",
  dark: "Dark",
} as const satisfies Record<ThemeChoice, string>;

function isThemeChoice(value: string): value is ThemeChoice {
  return value in THEME_LABEL;
}

/** "110%" for 1.1. */
function percent(scale: UiScale): string {
  return `${String(Math.round(scale * 100))}%`;
}

/** The avatar's account menu: who is signed in, Settings, Appearance, Size and Sign out. */
export function UserMenu({
  me,
  onOpenSettings = () => undefined,
  navigate = (url: string) => {
    window.location.assign(url);
  },
}: {
  me: Me;
  /** Opens the Settings page (the shell passes the router's navigate). */
  onOpenSettings?: () => void;
  /** Where sign-out sends the browser; injectable for tests. */
  navigate?: (url: string) => void;
}) {
  const { choice, choose } = useThemeChoice();
  const size = useUiScale();
  const leave = async () => {
    try {
      await forgetThisDevice();
      const { endSessionUrl } = await signOut();
      navigate(endSessionUrl ?? "/");
    } catch (error) {
      notify.error(`Could not sign out: ${errorText(error)}`);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${me.displayName}`}
          className="grid size-10 place-items-center rounded-full outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
        >
          <Avatar name={me.displayName} className="size-8 md:size-8" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex gap-3 px-4 pt-2 pb-3">
          <Avatar name={me.displayName} className="size-10" />
          <div className="grid min-w-0 gap-0.5">
            <p className="truncate font-medium">{me.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[me.email, ROLE_LABEL[me.role]].filter(Boolean).join(" · ")}
            </p>
            <Link
              to="/account"
              className="mt-1 text-[0.8125rem] text-primary no-underline outline-none hover:underline focus-visible:underline"
            >
              Manage your account
            </Link>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings aria-hidden />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Moon aria-hidden />
            Appearance: {THEME_LABEL[choice]}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={choice}
              onValueChange={(value) => {
                if (isThemeChoice(value)) choose(value);
              }}
            >
              <DropdownMenuRadioItem value="system">Device theme</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ALargeSmall aria-hidden />
            Size: {percent(size.scale)}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={String(size.scale)}
              onValueChange={(value) => {
                const next = Number(value);
                if (isUiScale(next)) size.choose(next);
              }}
            >
              {UI_SCALE_STEPS.map((step) => (
                <DropdownMenuRadioItem key={step} value={String(step)}>
                  {percent(step)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void leave();
          }}
        >
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
