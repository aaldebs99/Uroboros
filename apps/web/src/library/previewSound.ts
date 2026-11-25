/**
 * Whether hover previews play with sound (docs/library.md "Hover previews"). Unmuting one carries
 * over to the next previews in this tab; a reload starts silent again. Never stored, and apart
 * from the watch player's remembered volume (`lib/playerPrefs.ts`).
 */
let sound = false;

export function previewSound(): boolean {
  return sound;
}

export function setPreviewSound(on: boolean): void {
  sound = on;
}
