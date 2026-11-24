import { Menu } from "@videojs/react";
import { CheckIcon, ChevronIcon, QualityIcon } from "@videojs/react/icons/neutral";

export interface QualityChoice {
  value: string;
  label: string;
}

/**
 * The Quality submenu of the player's settings menu (docs/transcoding.md): Original, then the
 * rungs the source offers. It takes the place of the skin's own Quality submenu, which lists only
 * an HLS stream's renditions, through the slot patches/@videojs__react.patch adds, and wears the
 * skin's menu classes so it looks like the skin's other submenus.
 */
export function QualityMenu({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly QualityChoice[];
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <Menu.Root>
      <Menu.Trigger className="media-menu-trigger-item">
        <QualityIcon className="media-menu-trigger-item-icon" />
        Quality
        <span className="media-menu-hint">
          <span className="media-menu-hint-label">{current}</span>
          <ChevronIcon className="media-menu-forward-chevron" />
        </span>
      </Menu.Trigger>
      <Menu.Content className="media-menu-content">
        <Menu.Item className="media-menu-back-item">
          <ChevronIcon className="media-menu-back-chevron" />
          Quality
        </Menu.Item>
        <Menu.Separator className="media-menu-separator" />
        <Menu.RadioGroup className="media-menu-radio-group" value={value} onValueChange={onChange}>
          {options.map((o) => (
            <Menu.RadioItem key={o.value} value={o.value} className="media-menu-radio-item">
              <span>{o.label}</span>
              <Menu.ItemIndicator forceMount className="media-menu-item-indicator">
                <CheckIcon className="media-menu-radio-item-icon" />
              </Menu.ItemIndicator>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
