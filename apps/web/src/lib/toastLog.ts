import { type ReactNode, useSyncExternalStore } from "react";

/**
 * This tab's toasts, newest first, for the bell's "Earlier in this tab" (docs: the design system's
 * shell reference). Kept in memory only: an action is a closure, so a reload starts it afresh.
 */

export type ToastTone = "success" | "error" | "info";

export interface LoggedToast {
  id: number;
  tone: ToastTone;
  title: ReactNode;
  detail?: ReactNode;
  action?: { label: string; onClick: () => void };
  at: Date;
}

/** How many the log keeps. */
export const TOAST_LOG_SIZE = 30;

let log: readonly LoggedToast[] = [];
let next = 0;
const listeners = new Set<() => void>();

function set(value: readonly LoggedToast[]) {
  log = value;
  for (const listener of listeners) listener();
}

export function recordToast(toast: Omit<LoggedToast, "id" | "at">): void {
  set([{ ...toast, id: ++next, at: new Date() }, ...log].slice(0, TOAST_LOG_SIZE));
}

export function clearToastLog(): void {
  if (log.length > 0) set([]);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToastLog(): readonly LoggedToast[] {
  return useSyncExternalStore(subscribe, () => log);
}
