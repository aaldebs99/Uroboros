import { useQueryClient } from "@tanstack/react-query";

import { errorText } from "@/api/client";
import { removeUpload, uploadsKey, useUploadList } from "@/api/uploads";
import { notify } from "@/components/ui/sonner";

import { UploadRow } from "./UploadRow";
import { useUploadsIfAny, type Uploads } from "./UploadProvider";

/**
 * The Downloads page's uploads: the person's unfinished and failed ones (docs/uploads.md). The
 * shell always provides the uploads; a page rendered without it shows none.
 */
export function UploadsSection() {
  const uploads = useUploadsIfAny();
  return uploads === null ? null : <UploadList uploads={uploads} />;
}

function UploadList({ uploads }: { uploads: Uploads }) {
  const list = useUploadList();
  const client = useQueryClient();
  const rows = list.data ?? [];
  if (rows.length === 0) return null;
  const fail = (err: unknown) => {
    notify.error(errorText(err));
  };
  return (
    <section aria-labelledby="uploads-heading" className="grid gap-1">
      <h2 id="uploads-heading" className="text-base font-bold">
        Uploads
      </h2>
      <ul className="grid">
        {rows.map((upload) => (
          <UploadRow
            key={upload.id}
            upload={upload}
            local={uploads.local.get(upload.id)}
            onCancel={() => {
              uploads.cancel(upload.id).catch(fail);
            }}
            onDismiss={() => {
              removeUpload(upload.id)
                .then(() => client.invalidateQueries({ queryKey: uploadsKey }))
                .catch(fail);
            }}
            onResume={(file) => {
              uploads.resume(upload, file);
            }}
            onRetry={() => {
              uploads.retry(upload.id);
            }}
          />
        ))}
      </ul>
    </section>
  );
}
