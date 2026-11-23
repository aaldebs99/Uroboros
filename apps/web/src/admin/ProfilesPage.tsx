import type { FormatProfile, Me } from "@uroboros/contract";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { errorText } from "@/api/client";
import { useProfiles } from "@/api/downloads";
import { useCreateProfile, useDeleteProfile, usePatchProfile } from "@/api/library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ProfileForm } from "./ProfileForm";

function describe(p: FormatProfile): string {
  const shape = p.audioOnly
    ? `audio as ${p.audioFormat ?? "?"}`
    : (p.mergeFormat ?? "any container");
  return [p.format, shape, ...p.extraArgs].join(" · ");
}

function ProfileRow({ profile }: { profile: FormatProfile }) {
  const patch = usePatchProfile();
  const remove = useDeleteProfile();
  const [editing, setEditing] = useState(false);
  const fail = (err: unknown) => toast.error(errorText(err));
  if (editing) {
    return (
      <li>
        <ProfileForm
          initial={profile}
          onCancel={() => {
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
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {profile.name} {profile.isDefault ? <Badge variant="secondary">Default</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{describe(profile)}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setEditing(true);
        }}
      >
        Edit
      </Button>
      {profile.isDefault ? null : (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              patch.mutate({ id: profile.id, patch: { isDefault: true } }, { onError: fail });
            }}
          >
            Make default
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Delete the profile "${profile.name}"?`))
                remove.mutate(profile.id, { onError: fail });
            }}
          >
            Delete
          </Button>
        </>
      )}
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
  const [adding, setAdding] = useState(false);
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Format profiles</h1>
          <p className="mt-1 text-muted-foreground">
            The presets people pick from when downloading.
          </p>
        </div>
        <Button
          onClick={() => {
            setAdding(true);
          }}
        >
          <Plus aria-hidden /> Add profile
        </Button>
      </div>
      {adding ? (
        <ProfileForm
          onCancel={() => {
            setAdding(false);
          }}
          onSave={async (body) => {
            await create.mutateAsync(body);
            setAdding(false);
          }}
        />
      ) : null}
      {profiles.isError ? (
        <p className="text-sm text-destructive">{errorText(profiles.error)}</p>
      ) : null}
      <ul className="grid gap-2">
        {(profiles.data ?? []).map((p) => (
          <ProfileRow key={p.id} profile={p} />
        ))}
      </ul>
    </section>
  );
}
