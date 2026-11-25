import { Preferences, type PreferencesPatch, type SponsorBlockColors } from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getJson, patchJson } from "./client";

const preferencesKey = ["api", "me", "preferences"] as const;

/** How the caller likes the app, kept on their account (`GET /api/me/preferences`). */
export function usePreferences() {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: ({ signal }) => getJson("/api/me/preferences", Preferences, { signal }),
  });
}

/** The caller's SponsorBlock colors for their player; undefined (SponsorBlock's own) until loaded. */
export function useSponsorColors(): SponsorBlockColors | undefined {
  return usePreferences().data?.sponsorBlockColors;
}

/** Changes some preferences. The change shows at once; one the server refuses is put back. */
export function useUpdatePreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: PreferencesPatch) => patchJson("/api/me/preferences", Preferences, patch),
    // One at a time: each patch carries a whole field (SponsorBlock's choices), so two in flight
    // could land out of order and the older one win.
    scope: { id: "preferences" },
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: preferencesKey });
      const before = client.getQueryData<Preferences>(preferencesKey);
      if (before !== undefined) client.setQueryData(preferencesKey, { ...before, ...patch });
      return { before };
    },
    onError: (_err, _patch, context) => {
      if (context?.before !== undefined) client.setQueryData(preferencesKey, context.before);
    },
    onSuccess: (prefs, patch) => {
      client.setQueryData(preferencesKey, prefs);
      // The server resolves each item's SponsorBlock segments by this setting: open players fetch
      // their item again (a public link goes by its owner's, so the owner's open links too).
      if (patch.sponsorBlock !== undefined) {
        void client.invalidateQueries({ queryKey: ["api", "library", "item"] });
        void client.invalidateQueries({ queryKey: ["api", "public"] });
      }
    },
  });
}
