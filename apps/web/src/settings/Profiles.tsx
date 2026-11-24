import type { FormatProfile } from "@uroboros/contract";
import { Plus } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useProfiles } from "@/api/downloads";
import {
  useCreateProfile,
  useDeleteProfile,
  usePatchProfile,
  useSetDefaultProfile,
} from "@/api/library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Notice } from "@/components/ui/notice";
import { notify } from "@/components/ui/sonner";

import { ProfileDialog } from "./ProfileForm";

/** A profile's arguments in one line: the format, the container or audio, and the extras. */
function describe(p: FormatProfile): string {
  const shape = p.audioOnly
    ? `audio as ${p.audioFormat ?? "?"}`
    : (p.mergeFormat ?? "any container");
  return [p.format, shape, ...p.extraArgs].join(" · ");
}

/** What the open dialog is doing: adding a profile, editing one, or copying one under a new name. */
type Editing =
  | { kind: "add" }
  | { kind: "edit"; profile: FormatProfile }
  | { kind: "copy"; profile: FormatProfile };

const fail = (what: string) => (err: unknown) => {
  notify.error(`${what}: ${errorText(err)}`);
};

function ProfileRow({
  profile,
  onEdit,
  onCopy,
  onDelete,
}: {
  profile: FormatProfile;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const setDefault = useSetDefaultProfile();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {profile.name}
          {profile.isDefault ? <Badge tone="primary">Default</Badge> : null}
          {profile.builtIn ? (
            <span className="text-xs font-normal text-muted-foreground">Built-in</span>
          ) : null}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">{describe(profile)}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {profile.isDefault ? null : (
          <Button
            variant="quiet"
            size="compact"
            aria-label={`Make ${profile.name} your default`}
            onClick={() => {
              setDefault.mutate(profile.id, { onError: fail("Could not change your default") });
            }}
          >
            Make default
          </Button>
        )}
        <Button variant="quiet" size="compact" aria-label={`Copy ${profile.name}`} onClick={onCopy}>
          Copy
        </Button>
        <Button
          variant="secondary"
          size="compact"
          aria-label={`Edit ${profile.name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          variant="destructive"
          size="compact"
          aria-label={`Delete ${profile.name}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

const listClasses = "divide-y divide-border border-y border-border";

/** The open dialog for `editing`: what it is titled, starts from and saves with. */
function EditDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const create = useCreateProfile();
  const patch = usePatchProfile();
  if (editing.kind === "edit") {
    return (
      <ProfileDialog
        open
        title={`Edit ${editing.profile.name}`}
        initial={editing.profile}
        onClose={onClose}
        onSave={async (body) => {
          await patch.mutateAsync({ id: editing.profile.id, patch: body });
          onClose();
        }}
      />
    );
  }
  const copied = editing.kind === "copy" ? editing.profile : undefined;
  return (
    <ProfileDialog
      open
      title={copied === undefined ? "Add profile" : `Copy ${copied.name}`}
      {...(copied === undefined ? {} : { initial: { ...copied, name: `${copied.name} (copy)` } })}
      onClose={onClose}
      onSave={async (body) => {
        await create.mutateAsync(body);
        onClose();
      }}
    />
  );
}

/** What deleting `p` does: a profile of one's own goes; a built-in goes for this person only. */
function deleteWords(p: FormatProfile) {
  return p.builtIn
    ? "Only you stop seeing it; everyone else keeps it. Files downloaded with it stay."
    : "Files already downloaded with it stay.";
}

/**
 * Settings › Profiles: every profile the person downloads with, the built-in ones they kept first,
 * then their own. Any of them can be made their default, copied, edited or deleted; a change to a
 * built-in is theirs alone (editing makes it their own copy, deleting hides it from them). The
 * default is what a download uses when no profile is picked.
 */
export function FormatProfiles() {
  const profiles = useProfiles();
  const remove = useDeleteProfile();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);
  if (profiles.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (profiles.isError) {
    return (
      <Notice tone="destructive" title="Couldn't load the profiles">
        {errorText(profiles.error)}
      </Notice>
    );
  }
  const askDelete = (p: FormatProfile) => {
    confirm.ask({
      title: `Delete the profile "${p.name}"?`,
      description: deleteWords(p),
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => {
        remove.mutate(p.id, { onError: fail("Could not delete the profile") });
      },
    });
  };
  return (
    <div className="grid grid-cols-1 gap-4">
      <Button
        className="w-fit"
        onClick={() => {
          setEditing({ kind: "add" });
        }}
      >
        <Plus aria-hidden /> Add profile
      </Button>
      <ul aria-label="Your profiles" className={listClasses}>
        {profiles.data.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            onCopy={() => {
              setEditing({ kind: "copy", profile: p });
            }}
            onEdit={() => {
              setEditing({ kind: "edit", profile: p });
            }}
            onDelete={() => {
              askDelete(p);
            }}
          />
        ))}
      </ul>
      {editing === null ? null : (
        <EditDialog
          editing={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {confirm.dialog}
    </div>
  );
}
