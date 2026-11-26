import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { clearToastLog } from "@/lib/toastLog";

// How long findBy* and waitFor retry before failing: testing-library's 1 s, which a CI runner
// shared with other jobs missed, is too tight; 5 s as the server's tests wait (test/eventually.ts).
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  clearToastLog();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// jsdom does not implement scrolling; the router calls it on navigation.
window.scrollTo = () => undefined;

// jsdom has no ResizeObserver; radix measures a Switch's hidden form input with one.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom lists a media element's audio tracks in a plain array, which Video.js's player store
// listens on as it would on a browser's AudioTrackList (an EventTarget) and fails to, once per
// player. Chrome and Firefox have no list at all, which the store leaves alone: so here neither.
Object.defineProperty(HTMLMediaElement.prototype, "audioTracks", {
  configurable: true,
  get: () => undefined,
});

// jsdom's <dialog> neither opens modally nor fires `close`; the navigation drawer needs both.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
