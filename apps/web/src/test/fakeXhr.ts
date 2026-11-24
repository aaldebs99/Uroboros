import { vi } from "vitest";

export type XhrAnswer = { status: number; body?: string };
export type XhrHandler = (
  method: string,
  path: string,
  body: Blob,
) => XhrAnswer | Promise<XhrAnswer>;

/**
 * Stubs XMLHttpRequest (uploads send their bytes with it, for progress) with `handler`, which
 * answers each request; records every one. A handler that never settles leaves it hanging.
 */
export function fakeXhr(handler: XhrHandler = () => ({ status: 204 })) {
  const calls: { method: string; path: string; size: number; headers: Record<string, string> }[] =
    [];
  class FakeXhr {
    upload: { onprogress: ((e: { loaded: number; lengthComputable: boolean }) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = "";
    private method = "";
    private path = "";
    private headers: Record<string, string> = {};
    private aborted = false;
    open(method: string, url: string) {
      this.method = method;
      this.path = new URL(url, "http://app.test").pathname;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: Blob) {
      calls.push({ method: this.method, path: this.path, size: body.size, headers: this.headers });
      void Promise.resolve(handler(this.method, this.path, body)).then((answer) => {
        if (this.aborted) return;
        this.upload.onprogress?.({ loaded: body.size, lengthComputable: true });
        this.status = answer.status;
        this.responseText = answer.body ?? "";
        this.onload?.();
      });
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return calls;
}
