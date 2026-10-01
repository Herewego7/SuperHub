import { apiRequest } from "@/lib/queryClient";
import { setToken } from "@/lib/authToken";
import { queryClient } from "@/lib/queryClient";

/**
 * Email/password and Sign in with Apple authentication.
 *
 * Unlike the Replit OIDC flow (see nativeAuth.ts), these don't need a browser
 * round-trip: the client posts credentials/identity token directly and the
 * server responds with `{ ok: true, token }` in one request. `token` is a
 * mobile bearer JWT (same format nativeAuth.ts stores) — web ignores it and
 * relies on the session cookie apiRequest already sends via
 * credentials:"include"; native has no usable cookie storage inside its
 * WebView, so it persists the token instead. setToken() is a no-op on web
 * (see authToken.ts), so this file doesn't need to branch on platform itself.
 */

interface AuthResponse {
  ok: true;
  token?: string;
}

async function completeAuth(res: Response): Promise<void> {
  const body: AuthResponse = await res.json();
  if (body.token) {
    await setToken(body.token);
  }
  await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<void> {
  const res = await apiRequest("POST", "/api/auth/signup", {
    email,
    password,
    displayName,
  });
  await completeAuth(res);
}

export async function logInWithEmail(email: string, password: string): Promise<void> {
  const res = await apiRequest("POST", "/api/auth/login", { email, password });
  await completeAuth(res);
}

export async function signInWithAppleIdentity(params: {
  identityToken: string;
  firstName?: string;
  lastName?: string;
}): Promise<void> {
  const res = await apiRequest("POST", "/api/auth/apple", params);
  await completeAuth(res);
}

// Always resolves — the server intentionally returns the same generic
// message whether or not the email has an account (see
// localAuthRoutes.ts), so there's nothing meaningful to branch on here.
export async function requestPasswordReset(email: string): Promise<string> {
  const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
  const body: { message: string } = await res.json();
  return body.message;
}

// Unlike signup/login, this doesn't always log the user in — apiRequest
// throws on non-2xx (invalid/expired token, weak password), which the
// caller should catch and display.
export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await apiRequest("POST", "/api/auth/reset-password", { token, password });
  await completeAuth(res);
}
