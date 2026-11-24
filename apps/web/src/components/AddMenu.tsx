import { Download, Upload } from "lucide-react";
import type { ReactElement } from "react";

import { ResponsiveMenu } from "@/components/ui/responsive-menu";

/**
 * Add: the top bar's pill and the phone's "+" open the same menu (a dropdown from `md` up, a
 * bottom sheet below): Download (a link) or Upload (a video of the person's own, docs/uploads.md).
 */
export function AddMenu({
  trigger,
  onDownload,
  onUpload,
}: {
  /** A single element that takes a ref (a `Button`). */
  trigger: ReactElement;
  onDownload: () => void;
  onUpload: () => void;
}) {
  return (
    <ResponsiveMenu
      title="Add"
      trigger={trigger}
      actions={[
        { label: "Download", icon: Download, onSelect: onDownload },
        { label: "Upload", icon: Upload, onSelect: onUpload },
      ]}
    />
  );
}
