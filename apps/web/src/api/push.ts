import {
  NotificationPrefs,
  PushDevice,
  PushEndpointStatus,
  PushTestResult,
  PushView,
  type PushSubscriptionBody,
} from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteJson, getJson, postJson, putJson, queryKeys } from "./client";

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

/** Whether `endpoint` is one of the caller's devices, or was turned off from another device. */
export function endpointStatus(endpoint: string): Promise<PushEndpointStatus> {
  return getJson(
    `/api/me/push/devices/status?endpoint=${encodeURIComponent(endpoint)}`,
    PushEndpointStatus,
  );
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

const notificationKey = ["api", "me", "notifications"] as const;

/** Which kinds of notification the caller gets (docs/sharing.md). */
export function useNotificationPrefs() {
  return useQuery({
    queryKey: notificationKey,
    queryFn: ({ signal }) => getJson("/api/me/notifications", NotificationPrefs, { signal }),
  });
}

export function useSetNotificationPrefs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) =>
      putJson("/api/me/notifications", NotificationPrefs, prefs),
    onSuccess: (prefs) => {
      client.setQueryData(notificationKey, prefs);
    },
  });
}
