import type { NewUploadBody, Upload } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { errorText } from "@/api/client";
import {
  completeUpload,
  createUpload,
  getUpload,
  removeUpload,
  sendPart,
  sendThumbnail,
  uploadsKey,
} from "@/api/uploads";
import { notify } from "@/components/ui/sonner";

import { sendParts } from "./sendParts";

/** What this tab knows about an upload it is sending (docs/uploads.md). */
export interface LocalUpload {
  id: string;
  title: string;
  size: number;
  /** Bytes the server holds or is receiving. */
  sent: number;
  /** `paused`: sending stopped on an error; Try again sends the rest. */
  state: "sending" | "paused" | "processing" | "done" | "failed";
  error: string | null;
  entryId: string | null;
}

export type UploadDetails = Omit<NewUploadBody, "filename" | "size">;

export interface Uploads {
  local: ReadonlyMap<string, LocalUpload>;
  /** Starts an upload; resolves with its id once the server took it (throws if it refused). */
  start(file: File, details: UploadDetails, thumbnail: File | null): Promise<string>;
  /** Sends the rest of an upload, from the same file picked again. */
  resume(upload: Upload, file: File): void;
  /** Sends the rest of a paused upload whose file this tab still has. */
  retry(id: string): void;
  /** Stops sending and cancels the upload on the server. */
  cancel(id: string): Promise<void>;
}

const Context = createContext<Uploads | null>(null);

export function useUploads(): Uploads {
  const uploads = useUploadsIfAny();
  if (uploads === null) throw new Error("useUploads needs an UploadProvider");
  return uploads;
}

/** The app's uploads, or null outside the shell (a page rendered on its own, as in a test). */
export function useUploadsIfAny(): Uploads | null {
  return useContext(Context);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

/** Asks after a processing upload until it is done or failed. */
async function settled(id: string, pollMs: number, signal: AbortSignal): Promise<Upload> {
  for (;;) {
    await sleep(pollMs, signal);
    const upload = await getUpload(id, signal);
    if (upload.state === "done" || upload.state === "failed") return upload;
  }
}

/**
 * The app's uploads in progress: it holds each picked file while its parts go, so closing the
 * dialog (or leaving for another page) keeps the upload going; leaving the app while bytes are
 * sending asks first. Toasts report what each came to.
 */
export function UploadProvider({
  children,
  pollMs = 1500,
}: {
  children: ReactNode;
  pollMs?: number;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [local, setLocal] = useState<ReadonlyMap<string, LocalUpload>>(new Map());
  const runs = useRef(new Map<string, AbortController>());
  const files = useRef(new Map<string, File>());

  const patch = useCallback((id: string, change: Partial<LocalUpload>) => {
    setLocal((prev) => {
      const current = prev.get(id);
      return current === undefined ? prev : new Map(prev).set(id, { ...current, ...change });
    });
  }, []);
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: uploadsKey });
  }, [client]);

  const finish = useCallback(
    (upload: Upload, final: Upload) => {
      if (final.state === "done") {
        patch(upload.id, { state: "done", entryId: final.entryId });
        const entryId = final.entryId;
        notify.success(`Uploaded: ${upload.title}`, {
          ...(entryId === null
            ? {}
            : {
                action: {
                  label: "Open",
                  onClick: () => void navigate({ to: "/library/$entryId", params: { entryId } }),
                },
              }),
        });
        void client.invalidateQueries({ queryKey: ["api", "library"] });
      } else {
        patch(upload.id, { state: "failed", error: final.error });
        notify.error(`${upload.title}: ${final.error ?? "the upload failed"}`);
      }
      files.current.delete(upload.id);
      refresh();
    },
    [client, navigate, patch, refresh],
  );

  const run = useCallback(
    async (upload: Upload, file: File, thumbnail: File | null) => {
      runs.current.get(upload.id)?.abort();
      const stop = new AbortController();
      runs.current.set(upload.id, stop);
      files.current.set(upload.id, file);
      setLocal((prev) =>
        new Map(prev).set(upload.id, {
          id: upload.id,
          title: upload.title,
          size: upload.size,
          sent: 0,
          state: "sending",
          error: null,
          entryId: null,
        }),
      );
      refresh();
      try {
        if (thumbnail !== null) {
          await sendThumbnail(upload.id, thumbnail, stop.signal).catch((err: unknown) => {
            if (stop.signal.aborted) throw err;
            notify.error(`The thumbnail was not sent; a frame stands in. ${errorText(err)}`);
          });
        }
        await sendParts({
          upload,
          file,
          put: (n, part, onProgress, signal) => sendPart(upload.id, n, part, onProgress, signal),
          onProgress: (sent) => {
            patch(upload.id, { sent });
          },
          signal: stop.signal,
        });
        await completeUpload(upload.id);
        patch(upload.id, { state: "processing" });
        refresh();
        finish(upload, await settled(upload.id, pollMs, stop.signal));
      } catch (err) {
        if (stop.signal.aborted) return;
        patch(upload.id, { state: "paused", error: errorText(err) });
        notify.error(`${upload.title} is paused: ${errorText(err)}`);
        refresh();
      } finally {
        if (runs.current.get(upload.id) === stop) runs.current.delete(upload.id);
      }
    },
    [finish, patch, pollMs, refresh],
  );

  const uploads = useMemo<Uploads>(
    () => ({
      local,
      async start(file, details, thumbnail) {
        const upload = await createUpload({ filename: file.name, size: file.size, ...details });
        void run(upload, file, thumbnail);
        return upload.id;
      },
      resume(upload, file) {
        void run(upload, file, null);
      },
      retry(id) {
        const file = files.current.get(id);
        if (file === undefined) return;
        getUpload(id)
          .then((upload) => run(upload, file, null))
          .catch((err: unknown) => {
            notify.error(errorText(err));
          });
      },
      async cancel(id) {
        runs.current.get(id)?.abort();
        runs.current.delete(id);
        files.current.delete(id);
        setLocal((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        try {
          await removeUpload(id);
        } finally {
          refresh();
        }
      },
    }),
    [local, refresh, run],
  );

  const sending = [...local.values()].some((u) => u.state === "sending");
  useEffect(() => {
    if (!sending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [sending]);

  return <Context.Provider value={uploads}>{children}</Context.Provider>;
}
