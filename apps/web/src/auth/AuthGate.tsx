import type { Me } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Loader } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useMe } from "@/api/auth";
import { errorText, queryKeys, setUnauthorizedHandler } from "@/api/client";

import { currentPath, saveReturnTo, takeReturnTo } from "./returnTo";
import { SignIn } from "./SignIn";

/**
 * Renders the app for a signed-in user, else the sign-in page. Any 401 from the API (an expired
 * session, a revoked account) brings the sign-in page back, remembering where the person was.
 */
export function AuthGate({ children }: { children: (me: Me) => ReactNode }) {
  const me = useMe();
  const client = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      saveReturnTo(currentPath());
      client.setQueryData(queryKeys.me, null);
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [client]);

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader className="animate-spin" aria-label="Loading" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-sm text-destructive">{errorText(me.error)}</p>
      </div>
    );
  }
  if (me.data === null) {
    return (
      <SignIn
        onSignedIn={() => {
          const back = takeReturnTo();
          if (back !== currentPath()) window.history.replaceState(null, "", back);
          void client.invalidateQueries();
        }}
      />
    );
  }
  return <>{children(me.data)}</>;
}
