import { Menu } from "lucide-react";
import {
  type MouseEvent,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Brand } from "@/components/Brand";
import { SidebarNav } from "@/components/SidebarNav";
import { Button } from "@/components/ui/button";

import { type DrawerParts, type Phase, hide, release, useDrawerDrag } from "./useDrawerDrag";

/**
 * How long, in ms, to wait for a settling or closing panel's transition before finishing anyway:
 * a panel let go where it already was has no transition to end, and reduced motion makes every
 * transition short enough for its end to be missed.
 */
const EXIT = 300;

/**
 * The side navigation as a drawer over the page: the menu on phones, and on
 * the watch page, which gives the navigation's room to the player as YouTube's does. It renders
 * the top bar's menu button and slides in from the left in 200ms (150ms on phones, `index.css`).
 * With `swipe` (on phones) a finger drags it in from anywhere on the page, or drags it shut. A
 * native `<dialog>` opened with
 * `showModal()`, so the browser supplies the top layer, the focus trap and the inert page; the panel
 * carries its own menu button and brand where the top bar's sit, so it reads as the navigation
 * sliding in. `triggerClassName` limits where the button shows (phones only, where the side
 * navigation is there from `md` up).
 *
 * The dialog's `close` event is the one source of truth for "closed"; the close button, a press on
 * the scrim and Escape slide it out first. Following a link or any other change of `location`
 * takes it away at once, and the focus goes back to the menu button.
 */
export function NavDrawer({
  location,
  isAdmin,
  swipe,
  triggerClassName,
}: {
  /** The current address; the drawer closes when it changes, however it came about. */
  location: string;
  isAdmin: boolean;
  /** Whether a finger can drag it in and out (phones). */
  swipe: boolean;
  triggerClassName?: string | undefined;
}) {
  const [phase, setPhase] = useState<Phase>("closed");
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const width = useRef(0);
  const parts: DrawerParts = useMemo(() => ({ dialog, panel, scrim }), []);
  const dialogId = useId();
  const open = phase === "open";

  useDrawerDrag(swipe, phase, setPhase, parts, width);

  /*
   * What each phase does to the dialog, before paint. Opening clears any inline position (the
   * button can be pressed while the panel settles back); `showModal()` is guarded because
   * StrictMode runs effects twice. Settling and closing send the panel out and finish on its
   * transition's end or after EXIT, whichever is first; a change of phase cancels the wait.
   */
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (phase === "open") {
      release(parts);
      if (el.open) return;
      el.showModal();
      // The panel takes the focus rather than its first control, which would wear a focus ring
      // after a swipe or a tap; Tab goes on to the close button.
      panel.current?.focus({ preventScroll: true });
      return;
    }
    if (phase !== "settling" && phase !== "closing") return;
    const node = panel.current;
    hide(parts, width.current || (node?.offsetWidth ?? 0));
    const done =
      phase === "settling"
        ? () => {
            setPhase("closed");
          }
        : () => {
            el.close();
          };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node) done();
    };
    node?.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(done, EXIT);
    return () => {
      node?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
    };
  }, [phase, parts]);

  // Any change of address takes the drawer away: adjusted during render, React's pattern for state
  // that answers to a prop. The dialog goes without a `close` event, so the focus is handed back
  // once it has gone (`closedByAddress`).
  const [seen, setSeen] = useState(location);
  const [closedByAddress, setClosedByAddress] = useState(0);
  if (seen !== location) {
    setSeen(location);
    if (phase !== "closed") {
      setPhase("closed");
      setClosedByAddress((n) => n + 1);
    }
  }
  useEffect(() => {
    if (closedByAddress > 0) trigger.current?.focus();
  }, [closedByAddress]);

  const dismiss = () => {
    setPhase("closing");
  };
  const onClose = () => {
    setPhase("closed");
    trigger.current?.focus();
  };
  // Escape slides it out like the close button, instead of the browser closing it at once.
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    dismiss();
  };
  // A press outside the panel (the scrim) slides it out; following a link inside closes it.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    const target = event.target as Element;
    if (!panel.current?.contains(target)) dismiss();
    else if (target.closest("a[href]")) event.currentTarget.close();
  };

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        className={triggerClassName}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          setPhase("open");
        }}
      >
        <Menu className="size-5" />
      </Button>
      {phase === "closed"
        ? null
        : createPortal(
            <dialog
              ref={dialog}
              id={dialogId}
              className="drawer"
              data-phase={phase}
              aria-label="Navigation"
              onClose={onClose}
              onCancel={onCancel}
              onClick={onClick}
            >
              {/* The scrim first, so the panel paints above it. */}
              <div ref={scrim} className="drawer-scrim" />
              <div ref={panel} className="drawer-panel" tabIndex={-1}>
                <div className="flex h-12 shrink-0 items-center gap-2 px-3 md:h-14 md:px-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close navigation"
                    onClick={dismiss}
                  >
                    <Menu className="size-5" />
                  </Button>
                  <Brand home />
                </div>
                <div className="min-h-0 flex-1">
                  <SidebarNav isAdmin={isAdmin} />
                </div>
              </div>
            </dialog>,
            document.body,
          )}
    </>
  );
}
