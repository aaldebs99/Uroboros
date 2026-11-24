import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { notify } from "@/components/ui/sonner";

import { clearToastLog, TOAST_LOG_SIZE, useToastLog } from "./toastLog";

afterEach(() => {
  toast.dismiss();
});

describe("the toast log", () => {
  it("records each toast, newest first, its action still to hand", () => {
    const { result } = renderHook(() => useToastLog());
    const onClick = vi.fn();
    act(() => {
      notify.success("Saved.");
      notify({ tone: "error", title: "Failed", detail: "why", action: { label: "View", onClick } });
    });
    expect(result.current.map((t) => [t.tone, t.title, t.detail])).toEqual([
      ["error", "Failed", "why"],
      ["success", "Saved.", undefined],
    ]);
    result.current[0]?.action?.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps the newest few, and leaves out a toast passed log: false", () => {
    const { result } = renderHook(() => useToastLog());
    act(() => {
      for (let i = 0; i < TOAST_LOG_SIZE + 5; i++) notify.info(`n${String(i)}`);
      notify.info("passing", { log: false });
    });
    expect(result.current).toHaveLength(TOAST_LOG_SIZE);
    expect(result.current[0]?.title).toBe(`n${String(TOAST_LOG_SIZE + 4)}`);
  });

  it("clears", () => {
    const { result } = renderHook(() => useToastLog());
    act(() => {
      notify.success("Saved.");
      clearToastLog();
    });
    expect(result.current).toEqual([]);
  });
});
