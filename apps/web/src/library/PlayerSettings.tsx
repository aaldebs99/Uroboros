import { Menu } from "@videojs/react";
import { Activity } from "lucide-react";

import { QualityMenu, type QualityChoice } from "./QualityMenu";

/**
 * What the watch player's settings menu adds, through the skin's settings slot
 * (patches/@videojs__react.patch): the Quality submenu when the video offers more than one, and a
 * Stats row that turns the Stats panel (PlaybackStats) on and off, saying which it is. Both wear the
 * skin's menu classes, so they look like its own rows.
 */
export function PlayerSettings({
  quality,
  stats,
  onStats,
}: {
  quality: {
    value: string;
    options: readonly QualityChoice[];
    onChange: (v: string) => void;
  } | null;
  stats: boolean;
  onStats: () => void;
}) {
  return (
    <>
      {quality === null ? null : <QualityMenu {...quality} />}
      <Menu.Item className="media-menu-trigger-item" onSelect={onStats}>
        <Activity className="media-menu-trigger-item-icon" aria-hidden />
        Stats
        <span className="media-menu-hint">
          <span className="media-menu-hint-label">{stats ? "On" : "Off"}</span>
        </span>
      </Menu.Item>
    </>
  );
}
