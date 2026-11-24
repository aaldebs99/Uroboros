import { InstanceSettings, type InstanceSettingsPatch } from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJson, patchJson } from "./client";

const key = ["api", "admin", "settings"] as const;

/** The instance's settings (admins only). */
export const useInstanceSettings = () =>
  useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getJson("/api/admin/settings", InstanceSettings, { signal }),
  });

/** Changes them; the answer is the settings after the change. */
export function useSetInstanceSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: InstanceSettingsPatch) =>
      patchJson("/api/admin/settings", InstanceSettings, patch),
    onSuccess: (settings) => {
      client.setQueryData(key, settings);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
