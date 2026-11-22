/** How the installed app shows itself: a window of its own, opened from its icon. */
export const STANDALONE = "(display-mode: standalone)";

/**
 * Whether this page runs as the installed app rather than in a browser tab. Safari on iOS says so
 * through `navigator.standalone`; every browser through the display mode.
 */
export function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || window.matchMedia(STANDALONE).matches;
}

/**
 * Whether this is an iPhone or iPad, where only the installed app (iOS 16.4 and later) may turn
 * notifications on. An iPad asks for the desktop site, so it is told apart by its touch screen.
 */
export function isIos(): boolean {
  const { userAgent, maxTouchPoints } = navigator;
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
