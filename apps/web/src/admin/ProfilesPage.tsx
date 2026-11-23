import type { FormatProfile, Me } from "@uroboros/contract";
import { Plus } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useProfiles } from "@/api/downloads";
import { useCreateProfile, useDeleteProfile, usePatchProfile } from "@/api/library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { ProfileDialog } from "./ProfileForm";

function describe(p: FormatProfile): string {
  const shape = p.audioOnly
    ? `audio as ${p.audioFormat ?? "?"}`
    : (p.mergeFormat ?? "any container");
  return [p.format, shape, ...p.extraArgs].join(" · ");
}

function ProfileRow({
  profile,
  onAskDelete,
}: {
  profile: FormatProfile;
  onAskDelete: (profile: FormatProfile, remove: () => void) => void;
}) {
  const patch = usePatchProfile();
  const remove = useDeleteProfile();
  const [editing, setEditing] = useState(false);
  const fail = (err: unknown) => {
    notify.error(errorText(err));
  };
  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-border px-1 py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {profile.name} {profile.isDefault ? <Badge tone="primary">Default</Badge> : null}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">{describe(profile)}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="compact"
          variant="quiet"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit
        </Button>
        {profile.isDefault ? null : (
          <>
            <Button
              size="compact"
              variant="quiet"
              onClick={() => {
                patch.mutate({ id: profile.id, patch: { isDefault: true } }, { onError: fail });
              }}
            >
              Make default
            </Button>
            <Button
              size="compact"
              variant="destructive"
              onClick={() => {
                onAskDelete(profile, () => {
                  remove.mutate(profile.id, { onError: fail });
                });
              }}
            >
              Delete
            </Button>
          </>
        )}
      </div>
      <ProfileDialog
        open={editing}
        initial={profile}
        onClose={() => {
          setEditing(false);
        }}
        onSave={async (body) => {
          await patch.mutateAsync({ id: profile.id, patch: body });
          setEditing(false);
        }}
      />
    </li>
  );
}

/** Admin › Format profiles: the yt-dlp presets people pick from when downloading. */
export function ProfilesPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return (
      <p className="mx-auto max-w-3xl text-muted-foreground">
        Only admins can manage format profiles.
      </p>
    );
  }
  return <ProfilesAdmin />;
}

function ProfilesAdmin() {
  const profiles = useProfiles();
  const create = useCreateProfile();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6">
      <PageHeader
        title="Format profiles"
        description="The presets people pick from when downloading."
        action={
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden /> Add profile
          </Button>
        }
      />
      <ProfileDialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        onSave={async (body) => {
          await create.mutateAsync(body);
          setAdding(false);
        }}
      />
      {profiles.isError ? <p className="text-destructive">{errorText(profiles.error)}</p> : null}
      <ul className="grid">
        {(profiles.data ?? []).map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            onAskDelete={(profile, remove) => {
              confirm.ask({
                title: `Delete the profile "${profile.name}"?`,
                description: "People can no longer pick it. Files already downloaded stay.",
                confirmLabel: "Delete",
                destructive: true,
                onConfirm: remove,
              });
            }}
          />
        ))}
      </ul>
      {confirm.dialog}
    </section>
  );
}
