import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import Landing from "@/pages/landing";
import type { Profile } from "@workspace/shared-types";

function getCodeFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("code");
}

// Reached via the link in a family-invite email. If the visitor isn't signed
// in yet, they see the normal sign-up/login screen (with a banner explaining
// why they're here) — once useAuth() reports them as authenticated, this same
// component (still mounted at the same URL, no navigation needed) shows a
// one-tap "Join Family" confirmation. If they were already logged in when
// they clicked the link, they see it immediately.
//
// This is NOT auto-submitted on mount: joining replaces the account's
// current (solo) family data with the invited family's data (see
// joinFamily() in familyService.ts) — the same destructive action the
// existing in-app JoinFamilyForm warns about before submitting. A stale
// invite link opened by an existing user with real data must not silently
// wipe it.
type InviteLookup =
  | { valid: false; reason: string }
  | { valid: true; email: string | null; hasAccount: boolean; familyName: string | null };

export default function JoinFamily() {
  const code = getCodeFromUrl();
  const { isAuthenticated, isLoading } = useAuth();
  const [status, setStatus] = useState<"idle" | "joining" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // A brand-new account (just signed up specifically to accept this invite)
  // has nothing to lose by joining — the scarier "this can't be undone"
  // wording only applies to someone who already has real family data.
  const { data: existingProfiles } = useQuery<Profile[]>({
    queryKey: ["/api/profiles"],
    enabled: isAuthenticated,
  });
  const hasExistingData = (existingProfiles ?? []).some((p) => !p.isAllFamilyProfile);

  // Which family is this? Confirming a join to an unnamed family reads like a
  // phishing prompt — the lookup endpoint returns the family's display name
  // for a valid code.
  const { data: lookup } = useQuery<InviteLookup>({
    queryKey: [`/api/family/invites/lookup/${encodeURIComponent(code ?? "")}`],
    enabled: !!code && isAuthenticated,
  });
  const familyName = lookup && lookup.valid ? lookup.familyName : null;

  function handleJoin() {
    if (!code) return;
    setStatus("joining");
    apiRequest("POST", "/api/family/join", { code })
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/family"] });
        setStatus("done");
        setTimeout(() => {
          window.location.href = "/";
        }, 1200);
      })
      .catch((err: any) => {
        setError(err?.message ?? "This invite link is invalid or has expired.");
        setStatus("error");
      });
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Landing
        banner={
          code
            ? "You've been invited to a family — sign up or log in."
            : "This invite link is missing its code. Please ask for a new invite."
        }
        // Anyone arriving via an invite link is overwhelmingly more likely to
        // need Sign Up than Log In — they usually don't have an account yet.
        // Landing's own invite-code lookup (below) switches this to "login"
        // automatically once it confirms the invited email already has one.
        initialMode={code ? "signup" : "login"}
        initialCode={code}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 px-6">
      <div className="text-center max-w-sm">
        {status === "idle" && code && (
          <>
            <p className="text-gray-800 font-semibold mb-2">
              {familyName ? `Join ${familyName}?` : "Join this family?"}
            </p>
            <p className="text-sm text-gray-600 mb-6">
              {hasExistingData
                ? "This replaces your current family's chores, calendar and data. Can't be undone."
                : "You'll be added to their family and see their shared chores, calendar, and more."}
            </p>
            <Button
              onClick={handleJoin}
              className="w-full bg-orange-600 hover:bg-orange-700"
              data-testid="button-confirm-join"
            >
              {familyName ? `Join ${familyName}` : "Join Family"}
            </Button>
            {/* A misclicked/stale invite link needs a way OUT, not just in —
                previously the only button here was Join. */}
            <a
              href="/"
              className="block mt-3 text-sm text-gray-500 hover:text-gray-700 hover:underline"
              data-testid="link-decline-join"
            >
              No thanks — take me to my own Family Hub+
            </a>
          </>
        )}
        {status === "joining" && (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-orange-600 mx-auto mb-4" />
            <p className="text-gray-700">Joining your family…</p>
          </>
        )}
        {status === "done" && (
          <p className="text-gray-700" data-testid="text-join-success">
            You're in! Taking you to your Family Hub+…
          </p>
        )}
        {status === "error" && (
          <>
            <div
              className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
              data-testid="text-join-error"
            >
              {error}
            </div>
            <a href="/" className="text-orange-600 font-medium hover:underline">
              Continue to Family Hub+
            </a>
          </>
        )}
        {status === "idle" && !code && (
          <div
            className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
            data-testid="text-join-missing-code"
          >
            This invite link is missing its code. Please ask for a new invite.
          </div>
        )}
      </div>
    </div>
  );
}
