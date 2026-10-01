import { registerPlugin } from "@capacitor/core";

export interface WebAuthPlugin {
  authenticate(options: {
    url: string;
    callbackScheme: string;
    /**
     * When true, uses an ephemeral (private) browsing session — no shared
     * cookie jar with Safari. Required for the Replit OIDC login flow to
     * retrieve its session cookie on the redirect (kept non-ephemeral, the
     * default), but calendar-connect flows don't need cookie sharing, and
     * ephemeral sessions skip iOS's "'<App>' wants to use '<domain>' to sign
     * in" system dialog — which otherwise shows for any non-ephemeral
     * ASWebAuthenticationSession regardless of what OAuth scopes are
     * requested.
     */
    ephemeral?: boolean;
  }): Promise<{ url: string }>;
}

const WebAuth = registerPlugin<WebAuthPlugin>("WebAuth");

export { WebAuth };
