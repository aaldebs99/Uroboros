import type { FormatProfile } from "@uroboros/contract";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfileForm } from "./ProfileForm";

/**
 * A format profile in plain choices (docs/downloads.md#format-profiles): quality, video codec and
 * container as dropdowns, the yt-dlp selector and extra arguments under Advanced.
 */

const profile = (over: Partial<FormatProfile>): FormatProfile => ({
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  name: "Mine",
  format: "bv*+ba/b",
  mergeFormat: null,
  videoCodec: null,
  audioOnly: false,
  audioFormat: null,
  extraArgs: [],
  builtIn: false,
  isDefault: false,
  revision: "r",
  ...over,
});

function setup(initial?: FormatProfile) {
  const onSave = vi.fn(() => Promise.resolve());
  render(
    <ProfileForm
      {...(initial === undefined ? {} : { initial })}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );
  const saved = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    return (onSave.mock.calls[0] as unknown[])[0];
  };
  return { saved };
}

const select = (name: string) => screen.getByRole("combobox", { name });
const option = (select: HTMLElement, name: string) =>
  [...select.querySelectorAll("option")].find((o) => o.textContent === name);

describe("ProfileForm", () => {
  it("makes a profile from the quality, codec and container picked", async () => {
    const { saved } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "Phone");
    expect(select("Quality")).toHaveValue("best");
    expect(select("Video codec")).toHaveValue("");
    expect(select("Container")).toHaveValue("");
    await userEvent.selectOptions(select("Quality"), "1080");
    await userEvent.selectOptions(select("Video codec"), "av1");
    await userEvent.selectOptions(select("Container"), "mp4");
    expect(await saved()).toEqual({
      name: "Phone",
      format: "bv*[height<=1080]+ba/b[height<=1080]",
      mergeFormat: "mp4",
      videoCodec: "av1",
      audioOnly: false,
      audioFormat: null,
      extraArgs: [],
    });
  });

  it("shows a profile's choices, with Advanced closed while its selector is one of them", () => {
    setup(
      profile({
        format: "bv*[height<=720]+ba/b[height<=720]",
        videoCodec: "av1",
        mergeFormat: "mp4",
      }),
    );
    expect(select("Quality")).toHaveValue("720");
    expect(select("Video codec")).toHaveValue("av1");
    expect(select("Container")).toHaveValue("mp4");
    expect(screen.getByText("Advanced").closest("details")).not.toHaveAttribute("open");
  });

  it("keeps a hand-written selector under Advanced, in place of the quality", async () => {
    const { saved } = setup(profile({ format: "b[height<=720]" }));
    expect(screen.getByText("Advanced").closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText("Format selector")).toHaveValue("b[height<=720]");
    expect(select("Quality")).toBeDisabled();
    expect(select("Quality")).toHaveValue("custom");
    expect(await saved()).toMatchObject({ format: "b[height<=720]" });
  });

  it("goes back to the quality once the hand-written selector is cleared", async () => {
    const { saved } = setup(profile({ format: "b[height<=720]" }));
    await userEvent.clear(screen.getByLabelText("Format selector"));
    expect(select("Quality")).toBeEnabled();
    await userEvent.selectOptions(select("Quality"), "480");
    expect(await saved()).toMatchObject({ format: "bv*[height<=480]+ba/b[height<=480]" });
  });

  it("asks only for the audio format of an audio-only profile", async () => {
    const { saved } = setup();
    await userEvent.type(screen.getByLabelText("Name"), "Pods");
    await userEvent.selectOptions(select("Video codec"), "av1");
    await userEvent.click(screen.getByRole("checkbox", { name: "Audio only" }));
    expect(screen.queryByRole("combobox", { name: "Quality" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Video codec" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Container" })).toBeNull();
    await userEvent.selectOptions(select("Audio format"), "m4a");
    expect(await saved()).toEqual({
      name: "Pods",
      format: "ba[ext=m4a]/ba/b",
      mergeFormat: null,
      videoCodec: null,
      audioOnly: true,
      audioFormat: "m4a",
      extraArgs: [],
    });
  });

  it("offers no codec WebM can't hold, and no WebM for such a codec", async () => {
    setup();
    await userEvent.selectOptions(select("Container"), "webm");
    expect(option(select("Video codec"), "H.264 (AVC)")).toBeDisabled();
    expect(option(select("Video codec"), "H.265 (HEVC)")).toBeDisabled();
    expect(option(select("Video codec"), "VP9")).toBeEnabled();
    await userEvent.selectOptions(select("Container"), "");
    await userEvent.selectOptions(select("Video codec"), "h264");
    expect(option(select("Container"), "WebM")).toBeDisabled();
  });

  it("keeps an audio selector that isn't the one its format would write, saving it as it was", async () => {
    // Possible from the old free-text form: the best audio for M4A, not M4A as served.
    const { saved } = setup(profile({ format: "ba/b", audioOnly: true, audioFormat: "m4a" }));
    expect(screen.getByLabelText("Format selector")).toHaveValue("ba/b");
    await userEvent.type(screen.getByLabelText("Name"), " 2");
    expect(await saved()).toMatchObject({ format: "ba/b", audioFormat: "m4a" });
  });

  it("keeps a container or audio format the lists don't name", async () => {
    const { saved } = setup(profile({ mergeFormat: "mov" }));
    expect(select("Container")).toHaveValue("mov");
    expect(await saved()).toMatchObject({ mergeFormat: "mov" });
  });
});
