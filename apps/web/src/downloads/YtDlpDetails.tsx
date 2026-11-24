/**
 * yt-dlp's own last lines under a failure, collapsed: the line above says what went wrong in
 * people's words, this says exactly what yt-dlp printed (redacted on the server), for whoever has to
 * fix it. Nothing when there are no lines.
 */
export function YtDlpDetails({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">yt-dlp output</summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded-[0.5rem] bg-raised p-2 font-mono text-xs whitespace-pre-wrap">
        {lines.join("\n")}
      </pre>
    </details>
  );
}
