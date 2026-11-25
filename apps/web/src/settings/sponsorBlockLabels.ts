import type { SponsorBlockCategory } from "@uroboros/contract";

/** SponsorBlock's categories as Settings › SponsorBlock names them, in SponsorBlock's order. */
export const SPONSORBLOCK_LABELS: Record<SponsorBlockCategory, string> = {
  sponsor: "Sponsor",
  intro: "Intro",
  outro: "Outro",
  selfpromo: "Self-promotion",
  preview: "Preview",
  filler: "Filler",
  interaction: "Interaction reminder",
  music_offtopic: "Non-music section",
};
