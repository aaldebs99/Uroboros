import {
  PushDevice,
  PushTestResult,
  PushView,
  type PushSubscriptionBody,
} from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteJson, getJson, postJson, queryKeys } from "./client";

/** Whether this server pushes, its key, and the caller's devices. */
export function usePush() {
  return useQuery({
    queryKey: queryKeys.myPush,
    queryFn: ({ signal }) => getJson("/api/me/push", PushView, { signal }),
  });
}

/** Keeps a browser's subscription as one of the caller's devices. */
export function registerDevice(body: PushSubscriptionBody): Promise<PushDevice> {
  return postJson("/api/me/push/devices", PushDevice, body);
}

const devicePath = (id: string) => `/api/me/push/devices/${encodeURIComponent(id)}`;

function useInvalidatePush() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.myPush });
}

export function useDeleteDevice() {
  const invalidate = useInvalidatePush();
  return useMutation({
    mutationFn: (id: string) => deleteJson(devicePath(id)),
    onSuccess: invalidate,
  });
}

export function useTestPush() {
  const invalidate = useInvalidatePush();
  return useMutation({
    mutationFn: (id: string) => postJson(`${devicePath(id)}/test`, PushTestResult),
    onSettled: invalidate,
  });
}
