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

import { ApiError, errorText } from "@/api/client";
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

import { retrying, sendParts } from "./sendParts";

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
  /**
   * Picks a paused upload up from what the server has: the rest of its parts (from the file this
   * tab still has), or the wait for a video it is processing or has filed.
   */
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

/** Asks after a processing upload until it is done or failed, riding out a deploy's errors. */
async function settled(
  id: string,
  pollMs: number,
  retryMs: number,
  signal: AbortSignal,
): Promise<Upload> {
  for (;;) {
    await sleep(pollMs, signal);
    const upload = await retrying(() => getUpload(id, signal), signal, { baseMs: retryMs });
    if (upload.state === "done" || upload.state === "failed") return upload;
  }
}

/**
 * Completes an upload, again after a deploy's error. A 409 can mean an earlier complete landed but
 * its answer was lost: the upload is processing then (or done), and that is fine.
 */
async function complete(id: string, retryMs: number, signal: AbortSignal): Promise<void> {
  try {
    await retrying(() => completeUpload(id), signal, { baseMs: retryMs });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 409)) throw err;
    if ((await getUpload(id, signal)).state === "receiving") throw err;
  }
}

/** What to tell the person about why sending stopped. */
const whyPaused = (err: unknown) =>
  err instanceof ApiError || err instanceof TypeError || !(err instanceof Error)
    ? errorText(err)
    : err.message;

/**
 * The app's uploads in progress: it holds each picked file while its parts go, so closing the
 * dialog (or leaving for another page) keeps the upload going; leaving the app while bytes are
 * sending asks first. Toasts report what each came to.
 */
export function UploadProvider({
  children,
  pollMs = 1500,
  retryMs = 1000,
}: {
  children: ReactNode;
  pollMs?: number;
  /** The first retry's wait after a network or server error (tests shorten it). */
  retryMs?: number;
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

  /** Sends what the server lacks of `upload` (from `file`) and completes it. */
  const send = useCallback(
    async (upload: Upload, file: File, thumbnail: File | null, signal: AbortSignal) => {
      if (thumbnail !== null) {
        await sendThumbnail(upload.id, thumbnail, signal).catch((err: unknown) => {
          if (signal.aborted) throw err;
          notify.error(`The thumbnail was not sent; a frame stands in. ${errorText(err)}`);
        });
      }
      await sendParts({
        upload,
        file,
        put: (n, part, onProgress, s) => sendPart(upload.id, n, part, onProgress, s),
        onProgress: (sent) => {
          patch(upload.id, { sent });
        },
        signal,
        baseMs: retryMs,
      });
      await complete(upload.id, retryMs, signal);
    },
    [patch, retryMs],
  );

  /**
   * Takes an upload on from where the server has it: sends the rest while it is receiving (that
   * needs its file), waits while it is processing, then reports what it came to.
   */
  const run = useCallback(
    async (upload: Upload, file: File | null, thumbnail: File | null) => {
      runs.current.get(upload.id)?.abort();
      const stop = new AbortController();
      runs.current.set(upload.id, stop);
      if (file !== null) files.current.set(upload.id, file);
      const receiving = upload.state === "receiving";
      setLocal((prev) =>
        new Map(prev).set(upload.id, {
          id: upload.id,
          title: upload.title,
          size: upload.size,
          sent: receiving ? 0 : upload.size,
          state: receiving ? "sending" : "processing",
          error: null,
          entryId: null,
        }),
      );
      refresh();
      try {
        if (upload.state === "done" || upload.state === "failed") {
          finish(upload, upload);
          return;
        }
        if (receiving) {
          if (file === null) throw new Error("Choose the file again to finish.");
          await send(upload, file, thumbnail, stop.signal);
        }
        patch(upload.id, { state: "processing" });
        refresh();
        finish(upload, await settled(upload.id, pollMs, retryMs, stop.signal));
      } catch (err) {
        if (stop.signal.aborted) return;
        patch(upload.id, { state: "paused", error: whyPaused(err) });
        notify.error(`${upload.title} is paused: ${whyPaused(err)}`);
        refresh();
      } finally {
        if (runs.current.get(upload.id) === stop) runs.current.delete(upload.id);
      }
    },
    [finish, patch, pollMs, refresh, retryMs, send],
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
        getUpload(id)
          .then((upload) => run(upload, files.current.get(id) ?? null, null))
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

  // Leaving the shell (signing out) stops every run: nothing is sent, or reported, after it.
  useEffect(() => {
    const live = runs.current;
    return () => {
      for (const stop of live.values()) stop.abort();
      live.clear();
    };
  }, []);

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
