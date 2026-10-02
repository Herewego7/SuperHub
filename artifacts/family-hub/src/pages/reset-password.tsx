import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Home } from "lucide-react";
import { resetPassword } from "@/lib/emailAuth";

function getTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

export default function ResetPassword() {
  const token = getTokenFromUrl();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token. Please request a new one.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      // Now signed in (see localAuthRoutes.ts's reset-password handler); send
      // them into the app after a moment so they see the success message.
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex flex-col">
      <header className="p-6">
        <div className="max-w-6xl mx-auto flex justify-center items-center">
          <div className="flex items-center gap-2">
            <Home className="h-8 w-8 text-orange-600" />
            <h1 className="text-2xl font-bold text-gray-800">SuperHub</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <Card className="w-full max-w-sm border-2 border-orange-100">
          <CardHeader>
            <CardTitle className="text-center">Set a New Password</CardTitle>
          </CardHeader>
          <CardContent>
            {!token && (
              <div
                className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center"
                data-testid="text-missing-token"
              >
                This link is missing its reset token. Please request a new password reset from the login screen.
              </div>
            )}

            {done ? (
              <div
                className="px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm text-center"
                data-testid="text-reset-success"
              >
                Password updated! Taking you to your SuperHub…
              </div>
            ) : (
              <>
                {error && (
                  <div
                    className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center"
                    data-testid="text-reset-error"
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-password">New Password</Label>
                    <PasswordInput
                      id="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      disabled={!token}
                      data-testid="input-new-password"
                    />
                    <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <PasswordInput
                      id="confirm-password"
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      disabled={!token}
                      data-testid="input-confirm-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={submitting || !token}
                    className="w-full bg-orange-600 hover:bg-orange-700"
                    data-testid="button-submit-reset"
                  >
                    {submitting ? "Updating…" : "Update Password"}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
