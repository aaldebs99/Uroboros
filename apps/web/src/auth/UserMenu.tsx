import type { Me } from "@uroboros/contract";
import { LogOut, Settings2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { signOut } from "@/api/auth";
import { errorText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { forgetThisDevice } from "@/push/leave";

const ROLE_LABEL = { admin: "Admin", member: "Member" } as const satisfies Record<
  Me["role"],
  string
>;

/** The header's account menu: who is signed in, and Sign out. */
export function UserMenu({
  me,
  onOpenAccount = () => undefined,
  navigate = (url: string) => {
    window.location.assign(url);
  },
}: {
  me: Me;
  /** Opens the Account page (the shell passes the router's navigate). */
  onOpenAccount?: () => void;
  /** Where sign-out sends the browser; injectable for tests. */
  navigate?: (url: string) => void;
}) {
  const leave = async () => {
    try {
      await forgetThisDevice();
      const { endSessionUrl } = await signOut();
      navigate(endSessionUrl ?? "/");
    } catch (error) {
      toast.error(`Could not sign out: ${errorText(error)}`);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Account menu for ${me.displayName}`}>
          <UserRound aria-hidden />
          <span className="hidden max-w-32 truncate sm:inline">{me.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span className="truncate">{me.displayName}</span>
          <Badge variant="secondary">{ROLE_LABEL[me.role]}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenAccount}>
          <Settings2 aria-hidden />
          Account
        </DropdownMenuItem>
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
