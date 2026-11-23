import { type ReactNode, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./dialog";

type ConfirmRequest = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
};

/**
 * A confirmation dialog in place of `window.confirm`: `ask({...})` opens it, and the returned
 * `dialog` element must be rendered once by the caller.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const dialog = (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) setRequest(null);
      }}
    >
      {request === null ? null : (
        <AlertDialogContent>
          <AlertDialogTitle>{request.title}</AlertDialogTitle>
          {request.description === undefined ? (
            <AlertDialogDescription className="sr-only">{request.title}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive={request.destructive ?? false}
              onClick={() => {
                request.onConfirm();
              }}
            >
              {request.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
  return { ask: setRequest, dialog };
}
