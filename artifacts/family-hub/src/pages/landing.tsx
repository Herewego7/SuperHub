import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, Calendar, CheckSquare, Star, Loader2, Ticket } from "lucide-react";
import { signUpWithEmail, logInWithEmail, requestPasswordReset } from "@/lib/emailAuth";
import { isAppleSignInAvailable, nativeAppleSignIn } from "@/lib/appleSignIn";
import { apiRequest } from "@/lib/queryClient";

type Mode = "login" | "signup" | "forgot";
type InviteLookup = { valid: false; reason: string } | { valid: true; email: string | null; hasAccount: boolean; familyName: string | null };

export default function Landing({
  banner,
  initialMode = "login",
  initialCode = null,
}: {
  banner?: string;
  initialMode?: Mode;
  initialCode?: string | null;
}) {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [appleSubmitting, setAppleSubmitting] = useState(false);

  // "Have an invite code?" — lets someone who was only given a raw code (not
  // an emailed link) type it in right here, instead of needing a separate
  // in-app place to redeem it. Looking the code up tells us whether the
  // invited email already has an account, so this can route straight to
  // Log In (prefilled) instead of always assuming Sign Up.
  const [showCodeField, setShowCodeField] = useState(!!initialCode);
  const [inviteCode, setInviteCode] = useState(initialCode ?? "");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [inviteFamilyName, setInviteFamilyName] = useState<string | null>(null);

  useEffect(() => {
    if (initialCode) checkInviteCode(initialCode);
    // Only auto-checks the code the page was opened with (via /join?code=...)
    // — a manually-typed code is checked on its own "Continue" click below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function checkInviteCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setCodeChecking(true);
    setCodeError(null);
    try {
      const res = await apiRequest("GET", `/api/family/invites/lookup/${encodeURIComponent(trimmed)}`);
      const result: InviteLookup = await res.json();
      if (result.valid) {
        setCodeConfirmed(true);
        setInviteFamilyName(result.familyName ?? null);
        if (result.email) setEmail(result.email);
        switchMode(result.hasAccount ? "login" : "signup");
        // /join owns the actual post-auth "confirm & join" step (it stays
        // mounted through the auth transition regardless of route changes,
        // which a plain "/" visit doesn't) — route there once the code
        // checks out, rather than re-implementing that step here.
        if (!initialCode) setLocation(`/join?code=${encodeURIComponent(trimmed)}`);
      } else {
        setCodeConfirmed(false);
        setCodeError(result.reason);
      }
    } catch (err: any) {
      setCodeConfirmed(false);
      setCodeError(err?.message ?? "Couldn't check that code. Please try again.");
    } finally {
      setCodeChecking(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setForgotMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email, password, displayName);
      } else if (mode === "forgot") {
        const message = await requestPasswordReset(email);
        setForgotMessage(message);
      } else {
        await logInWithEmail(email, password);
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAppleSignIn() {
    setError(null);
    setAppleSubmitting(true);
    try {
      await nativeAppleSignIn();
    } catch (err: any) {
      // The system cancel button on Apple's sheet throws a plugin-specific
      // error — don't show that to the user as if it were a real failure.
      if (!/cancel/i.test(err?.message ?? "")) {
        setError(err?.message ?? "Sign in with Apple failed. Please try again.");
      }
    } finally {
      setAppleSubmitting(false);
    }
  }

  return (
    // Safe-area padding: the viewport is `viewport-fit=cover`, so on an iPhone
    // the page runs under the status bar and Dynamic Island, and without this
    // the "Family Hub+" wordmark sat on top of the clock (2026-09-30). The app
    // shell has always done this in family-hub.tsx; the sign-in screen never
    // did. Bottom inset too, so the last of the page clears the home bar.
    <div
      className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <header className="p-6">
        <div className="max-w-6xl mx-auto flex justify-center items-center">
          <div className="flex items-center gap-2">
            <Home className="h-8 w-8 text-orange-600" />
            <h1 className="text-2xl font-bold text-gray-800">Family Hub+</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {banner && (
          <div
            className="mb-6 px-4 py-3 bg-orange-100 border border-orange-200 rounded-lg text-orange-800 text-sm text-center max-w-sm"
            data-testid="text-landing-banner"
          >
            {banner}
          </div>
        )}

        <div className="text-center mb-10 max-w-2xl">
          <h2 className="text-4xl font-bold text-gray-800 mb-4">
            Organize Your Family Life
          </h2>
          <p className="text-xl text-gray-600">
            One place for your family's calendar, chores, and rewards.
          </p>
        </div>

        <Card className="w-full max-w-sm border-2 border-orange-100 mb-6">
          <CardHeader>
            <CardTitle className="text-center">
              {mode === "login" ? "Log In" : mode === "signup" ? "Create Your Account" : "Reset Password"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {codeConfirmed && (
              <div
                className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm text-center"
                data-testid="text-invite-code-valid"
              >
                Invite code accepted — {mode === "login" ? "log in" : "sign up"} below to join{inviteFamilyName ? ` ${inviteFamilyName}` : ""}.
              </div>
            )}
            {error && (
              <div
                className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center"
                data-testid="text-auth-error"
              >
                {error}
              </div>
            )}

            {mode === "forgot" && forgotMessage ? (
              <div className="space-y-4">
                <div
                  className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm text-center"
                  data-testid="text-forgot-success"
                >
                  {forgotMessage}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => switchMode("login")}
                  data-testid="link-back-to-login"
                >
                  Back to Log In
                </Button>
              </div>
            ) : (
              <>
            {mode !== "forgot" && isAppleSignInAvailable() && (
              <>
                <Button
                  type="button"
                  onClick={handleAppleSignIn}
                  disabled={appleSubmitting || submitting}
                  variant="outline"
                  className="w-full mb-4 bg-black text-white hover:bg-gray-800 hover:text-white border-black"
                  data-testid="button-apple-signin"
                >
                  {appleSubmitting ? "Signing in…" : " Sign in with Apple"}
                </Button>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="displayName">Name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name"
                    data-testid="input-display-name"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  data-testid="input-email"
                />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => switchMode("forgot")}
                        className="text-xs text-orange-600 hover:underline"
                        data-testid="link-forgot-password"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <PasswordInput
                    id="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    data-testid="input-password"
                  />
                  {mode === "signup" && (
                    <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                  )}
                </div>
              )}
              <Button
                type="submit"
                disabled={submitting || appleSubmitting}
                className="w-full bg-orange-600 hover:bg-orange-700"
                data-testid="button-submit-auth"
              >
                {mode === "forgot"
                  ? submitting
                    ? "Sending…"
                    : "Send Reset Link"
                  : submitting
                  ? mode === "signup"
                    ? "Creating account…"
                    : "Logging in…"
                  : mode === "signup"
                  ? "Sign Up"
                  : "Log In"}
              </Button>
            </form>

            <p className="text-sm text-center text-gray-500 mt-4">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("signup")}
                    className="text-orange-600 font-medium hover:underline"
                    data-testid="link-switch-to-signup"
                  >
                    Sign up
                  </button>
                </>
              ) : mode === "forgot" ? (
                <>
                  Remembered your password?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="text-orange-600 font-medium hover:underline"
                    data-testid="link-switch-to-login"
                  >
                    Log in
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("login")}
                    className="text-orange-600 font-medium hover:underline"
                    data-testid="link-switch-to-login"
                  >
                    Log in
                  </button>
                </>
              )}
            </p>
              </>
            )}
          </CardContent>
        </Card>

        {!codeConfirmed && (
          <div className="w-full max-w-sm mb-12">
            {!showCodeField ? (
              <button
                type="button"
                onClick={() => setShowCodeField(true)}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-orange-700 hover:underline"
                data-testid="link-have-invite-code"
              >
                <Ticket className="w-4 h-4" />
                Have an invite code?
              </button>
            ) : (
              <div className="border-2 border-dashed border-orange-200 rounded-xl p-4 bg-white/50">
                <Label htmlFor="inviteCode" className="text-sm">Family invite code</Label>
                <div className="flex gap-2 mt-1.5">
                  <Input
                    id="inviteCode"
                    value={inviteCode}
                    onChange={(e) => { setInviteCode(e.target.value.toUpperCase()); setCodeError(null); }}
                    placeholder="e.g. AB3D9KXQ"
                    className="uppercase tracking-wider"
                    data-testid="input-invite-code"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={codeChecking || !inviteCode.trim()}
                    onClick={() => checkInviteCode(inviteCode)}
                    data-testid="button-check-invite-code"
                  >
                    {codeChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                  </Button>
                </div>
                {codeError && (
                  <p className="text-xs text-red-600 mt-1.5" data-testid="text-invite-code-error">{codeError}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  Enter the code a family member sent you.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6 max-w-4xl w-full">
          <Card className="border-2 border-orange-100">
            <CardHeader className="text-center">
              <Calendar className="h-12 w-12 text-orange-500 mx-auto mb-2" />
              <CardTitle>Shared Calendar</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                See everyone's schedules in one place. Connect Google or Outlook.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-2 border-orange-100">
            <CardHeader className="text-center">
              <CheckSquare className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <CardTitle>Chore Tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Assign and track household chores. Earn stars and unlock rewards!
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-2 border-orange-100">
            <CardHeader className="text-center">
              <Star className="h-12 w-12 text-yellow-500 mx-auto mb-2" />
              <CardTitle>Gamification</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Make chores fun with stars, streaks, and rewards that motivate the whole family.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="p-6 text-center text-gray-500 text-sm">
        <p>Family Hub+ - Bringing families together, one task at a time.</p>
      </footer>
    </div>
  );
}
