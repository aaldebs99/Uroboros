import type { AdminStats, Me, PersonStats, StorageKind } from "@uroboros/contract";
import type { ReactNode } from "react";

import { errorText } from "@/api/client";
import { useAdminStats } from "@/api/stats";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/downloads/format";

const head = "px-2.5 py-2.5 text-xs font-medium text-muted-foreground";
const cell = "px-2.5 py-2 max-md:px-0 max-md:py-0.5";
const num = `${cell} md:text-right tabular-nums`;

const count = (n: number) => n.toLocaleString();
const files = (n: number) => `${count(n)} ${n === 1 ? "file" : "files"}`;

/** What each kind of stored file is called here. */
function kindName(kind: StorageKind): string {
  switch (kind) {
    case "files":
      return "Media files";
    case "thumbnails":
      return "Thumbnails";
    case "info":
      return "Info files";
    case "previews":
      return "Hover previews";
    case "subtitles":
      return "Subtitles";
    case "exports":
      return "Copies to save";
    case "uploads":
      return "Uploads underway";
    case "playback":
      return "Playback cache";
  }
}

/** A part's share of its whole, as a person reads it: "43%", "<1%", "0%". */
function share(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const pct = (part / whole) * 100;
  return pct < 1 ? "<1%" : `${String(Math.round(pct))}%`;
}

/**
 * A part against its whole: an accent bar on a lighter track of the same blue. The figures beside
 * it carry the values, so the bar is decoration to a screen reader.
 */
function Meter({ part, whole }: { part: number; whole: number }) {
  const width = whole > 0 ? Math.min(100, (part / whole) * 100) : 0;
  return (
    <div aria-hidden className="h-2 overflow-hidden rounded-full bg-primary/15">
      <div className="h-full rounded-full bg-primary" style={{ width: `${String(width)}%` }} />
    </div>
  );
}

/** A meter list: each row's name and figures, its bar beneath; largest first. */
function MeterList({
  label,
  rows,
  whole,
}: {
  label: string;
  rows: { key: string; name: ReactNode; figure: string; value: number }[];
  whole: number;
}) {
  return (
    <ul aria-label={label} className="grid gap-3">
      {rows.map((r) => (
        <li key={r.key} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{r.figure}</span>
          </div>
          <Meter part={r.value} whole={whole} />
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="grid content-start gap-4 rounded-2xl bg-card p-5 shadow-card"
    >
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** The headline numbers: the stored media files, videos and audio apart, and all storage. */
function Tiles({ stats }: { stats: AdminStats }) {
  const tiles = [
    { label: "Media files", value: count(stats.files.total) },
    { label: "Videos", value: count(stats.files.videos) },
    { label: "Audio", value: count(stats.files.audio) },
    { label: "Storage used", value: formatBytes(stats.storage.total) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="grid gap-1 rounded-2xl bg-card p-4 shadow-card">
          <dt className="text-sm text-muted-foreground">{t.label}</dt>
          <dd className="text-2xl font-bold">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Storage({ stats }: { stats: AdminStats }) {
  const { total, parts, unmeasured } = stats.storage;
  const rows = [...parts]
    .sort((a, b) => b.bytes - a.bytes)
    .map((p) => ({
      key: p.kind,
      name: kindName(p.kind),
      figure: `${formatBytes(p.bytes)} · ${share(p.bytes, total)}`,
      value: p.bytes,
    }));
  return (
    <Panel title="Storage">
      <MeterList label="Storage by kind" rows={rows} whole={total} />
      <p className="text-xs text-muted-foreground">
        {unmeasured > 0
          ? `Still measuring ${files(unmeasured)}; the total grows as they're counted. `
          : null}
        Files waiting to be deleted aren&apos;t counted.
      </p>
    </Panel>
  );
}

function Containers({ stats }: { stats: AdminStats }) {
  const rows = stats.containers.map((c) => ({
    key: c.container,
    name: <span className="font-mono">{c.container}</span>,
    figure: `${files(c.files)} · ${formatBytes(c.bytes)}`,
    value: c.bytes,
  }));
  return (
    <Panel title="By container">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No media files yet.</p>
      ) : (
        <MeterList label="Media files by container" rows={rows} whole={stats.files.bytes} />
      )}
    </Panel>
  );
}

function PersonRow({ person, total }: { person: PersonStats; total: number }) {
  return (
    <tr className="border-t border-border hover:bg-raised max-md:grid max-md:gap-1 max-md:py-3">
      <td className={`${cell} font-medium`}>
        {person.displayName}
        {person.username === null || person.username === person.displayName.toLowerCase() ? null : (
          <span className="ml-2 font-normal text-muted-foreground">{person.username}</span>
        )}
      </td>
      <td className={num}>
        <span className="text-muted-foreground md:sr-only">Items: </span>
        {count(person.items)}
      </td>
      <td className={num}>
        <span className="text-muted-foreground md:sr-only">Videos: </span>
        {count(person.videos)}
      </td>
      <td className={num}>
        <span className="text-muted-foreground md:sr-only">Audio: </span>
        {count(person.audio)}
      </td>
      <td className={`${cell} md:w-64`}>
        <div className="grid gap-1.5">
          <span className="tabular-nums md:text-right">
            <span className="text-muted-foreground md:sr-only">Storage: </span>
            {formatBytes(person.bytes)}
            <span className="text-muted-foreground"> · {share(person.bytes, total)}</span>
          </span>
          <Meter part={person.bytes} whole={total} />
        </div>
      </td>
    </tr>
  );
}

function People({ stats }: { stats: AdminStats }) {
  const { unclaimed } = stats;
  return (
    <section aria-label="By person" className="grid gap-3">
      <h2 className="text-base font-bold">By person</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="max-md:sr-only">
            <tr>
              <th className={head}>Person</th>
              <th className={`${head} text-right`}>Items</th>
              <th className={`${head} text-right`}>Videos</th>
              <th className={`${head} text-right`}>Audio</th>
              <th className={`${head} text-right`}>Storage</th>
            </tr>
          </thead>
          <tbody className="max-md:grid">
            {stats.people.map((p) => (
              <PersonRow key={p.userId} person={p} total={stats.storage.total} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        A file several people have is stored once, and counts for whoever had it first.
        {unclaimed.files > 0
          ? ` In no one's library: ${files(unclaimed.files)}, ${formatBytes(unclaimed.bytes)}, deleted a day after the last person removed them.`
          : null}
      </p>
    </section>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

function Stats() {
  const stats = useAdminStats();
  if (stats.isPending) return <Loading />;
  if (stats.isError) return <p className="text-destructive">{errorText(stats.error)}</p>;
  return (
    <>
      <Tiles stats={stats.data} />
      <div className="@container">
        <div className="grid gap-6 @3xl:grid-cols-2">
          <Storage stats={stats.data} />
          <Containers stats={stats.data} />
        </div>
      </div>
      <People stats={stats.data} />
    </>
  );
}

/**
 * Admin › Stats (docs/library.md "Stats"): the stored media files, videos and audio apart and by
 * container, everything stored by kind, and each person's library and the storage that counts for
 * them, across the whole page.
 */
export function AdminStatsPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return <p className="text-muted-foreground">Only admins can see stats.</p>;
  }
  return (
    <section className="grid w-full gap-6">
      <PageHeader title="Stats" description="What the library holds, and what it takes up." />
      <Stats />
    </section>
  );
}
