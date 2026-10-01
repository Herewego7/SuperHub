import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// One styled confirmation for every destructive action in the app. The app
// previously mixed four patterns — native window.confirm (an OS-looking popup,
// jarring inside the iOS build), one bespoke Radix dialog, inline
// "tap again to confirm", and nothing at all. This gives them a single
// imperative API:
//
//   if (!(await confirmDialog({ title: "Delete this reward?" }))) return;
//
// <ConfirmDialogHost /> must be mounted once near the app root
// (family-hub.tsx). If somehow it isn't (isolated harnesses, tests), we fall
// back to window.confirm so callers still get a real barrier.

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label of the confirming button. Defaults to "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirming button (default true — most confirms guard deletion). */
  destructive?: boolean;
}

/**
 * Some decisions aren't yes/no. Removing a chore from someone is the case this
 * was added for: "just today" and "from now on" are both reasonable, and
 * collapsing them into one confirm button forced the permanent one. Same host,
 * same styling — the caller gets back the chosen value, or null for cancel.
 */
export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
  destructive?: boolean;
}

export interface ChoiceOptions {
  title: string;
  description?: string;
  options: ChoiceOption[];
  cancelLabel?: string;
}

type Handler = (opts: ConfirmOptions) => Promise<boolean>;
type ChoiceHandler = (opts: ChoiceOptions) => Promise<string | null>;
let activeHandler: Handler | null = null;
let activeChoiceHandler: ChoiceHandler | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (activeHandler) return activeHandler(opts);
  const text = opts.description ? `${opts.title}\n\n${opts.description}` : opts.title;
  return Promise.resolve(window.confirm(text));
}

export function chooseDialog(opts: ChoiceOptions): Promise<string | null> {
  if (activeChoiceHandler) return activeChoiceHandler(opts);
  // No host mounted (isolated harnesses): fall back to a plain confirm on the
  // first option rather than silently doing nothing.
  const first = opts.options[0];
  const text = opts.description ? `${opts.title}\n\n${opts.description}` : opts.title;
  return Promise.resolve(window.confirm(`${text}\n\n${first?.label ?? "OK"}?`) ? first?.value ?? null : null);
}

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

interface PendingChoice {
  opts: ChoiceOptions;
  resolve: (value: string | null) => void;
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);

  useEffect(() => {
    activeHandler = (opts) =>
      new Promise<boolean>((resolve) => {
        // If a confirm is somehow already showing, settle it as cancelled
        // rather than dropping its promise.
        setPending((prev) => {
          prev?.resolve(false);
          return { opts, resolve };
        });
      });
    return () => {
      activeHandler = null;
    };
  }, []);

  useEffect(() => {
    activeChoiceHandler = (opts) =>
      new Promise<string | null>((resolve) => {
        setPendingChoice((prev) => {
          prev?.resolve(null);
          return { opts, resolve };
        });
      });
    return () => {
      activeChoiceHandler = null;
    };
  }, []);

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const opts = pending?.opts;
  const choice = pendingChoice?.opts;

  const settleChoice = (value: string | null) => {
    pendingChoice?.resolve(value);
    setPendingChoice(null);
  };

  return (
    <>
      <AlertDialog open={!!pending} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description ? (
              <AlertDialogDescription>{opts.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)} data-testid="confirm-dialog-cancel">
              {opts?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              data-testid="confirm-dialog-confirm"
              className={cn(
                (opts?.destructive ?? true) &&
                  buttonVariants({ variant: "destructive" }),
              )}
            >
              {opts?.confirmLabel ?? "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Choices are stacked full-width buttons, not a footer row: each one
          carries a line of explanation, which a footer can't fit. */}
      <AlertDialog open={!!pendingChoice} onOpenChange={(open) => !open && settleChoice(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{choice?.title}</AlertDialogTitle>
            {choice?.description ? (
              <AlertDialogDescription>{choice.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            {choice?.options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => settleChoice(o.value)}
                data-testid={`choice-dialog-${o.value}`}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                  o.destructive
                    ? "border-destructive/40 hover:bg-destructive/10"
                    : "border-border hover:bg-accent",
                )}
              >
                <span className={cn("block text-sm font-medium", o.destructive && "text-destructive")}>
                  {o.label}
                </span>
                {o.description ? (
                  <span className="block text-xs text-muted-foreground mt-0.5">{o.description}</span>
                ) : null}
              </button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleChoice(null)} data-testid="choice-dialog-cancel">
              {choice?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
