import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** The one dialog panel, shared by form dialogs and confirmations. */
const panelClasses =
  "fixed top-1/2 left-1/2 z-50 grid w-[min(26rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 gap-3.5 rounded-[12px] bg-popover p-6 text-popover-foreground shadow-menu outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95";
const overlayClasses =
  "fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0";
const titleClasses = "text-lg font-bold";
const descriptionClasses = "text-sm text-muted-foreground";
/** A dialog footer's text-only pill. */
const pillClasses =
  "inline-flex h-10 items-center rounded-full px-3.5 text-sm font-medium text-primary outline-none hover:bg-raised focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:opacity-45";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClasses} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(panelClasses, className)}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn(titleClasses, className)} {...props} />;
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn(descriptionClasses, className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 flex justify-end gap-2", className)} {...props} />;
}

const AlertDialog = AlertPrimitive.Root;
const AlertDialogTrigger = AlertPrimitive.Trigger;

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Content>) {
  return (
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={overlayClasses} />
      <AlertPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(panelClasses, className)}
        {...props}
      />
    </AlertPrimitive.Portal>
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Title>) {
  return <AlertPrimitive.Title className={cn(titleClasses, className)} {...props} />;
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Description>) {
  return <AlertPrimitive.Description className={cn(descriptionClasses, className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex justify-end gap-1", className)} {...props} />;
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Cancel>) {
  return <AlertPrimitive.Cancel className={cn(pillClasses, className)} {...props} />;
}

/** The confirming pill; `destructive` makes it danger text. */
function AlertDialogAction({
  className,
  destructive = false,
  ...props
}: React.ComponentProps<typeof AlertPrimitive.Action> & { destructive?: boolean }) {
  return (
    <AlertPrimitive.Action
      className={cn(
        pillClasses,
        destructive && "text-destructive hover:bg-destructive/13",
        className,
      )}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
};
