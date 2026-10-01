import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAccountSwitchGate } from "@/hooks/use-account-switch-gate";
import { useAuth } from "@/hooks/use-auth";
import FamilyHub from "@/pages/family-hub";
import Landing from "@/pages/landing";
import ShareView from "@/pages/share-view";
import PrivacyPolicy from "@/pages/privacy";
import TermsOfService from "@/pages/terms";
import Support from "@/pages/support";
import ResetPassword from "@/pages/reset-password";
import JoinFamily from "@/pages/join";
import Help from "@/pages/help";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

export function AuthenticatedRouter() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const switchReady = useAccountSwitchGate(user?.id ?? null);

  if (isLoading || (isAuthenticated && !switchReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
          <p className="text-gray-600">Loading your page...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Landing />;
  }

  return (
    <Switch>
      <Route path="/" component={FamilyHub} />
      {/* The marketing site takes "/" on the web (docs/website), so the app
          needs a path of its own to sign in at. Native is unaffected — it
          loads from capacitor://localhost/ and never sees either. */}
      <Route path="/app" component={FamilyHub} />
      <Route path="/family-hub" component={FamilyHub} />
    </Switch>
  );
}

function RootRouter() {
  const [location] = useLocation();
  if (location.startsWith("/share/")) {
    return (
      <Switch>
        <Route path="/share/:token" component={ShareView} />
      </Switch>
    );
  }
  if (location === "/privacy") return <PrivacyPolicy />;
  if (location === "/terms") return <TermsOfService />;
  if (location === "/support") return <Support />;
  if (location === "/help") return <Help />;
  if (location === "/reset-password") return <ResetPassword />;
  if (location === "/join") return <JoinFamily />;
  return <AuthenticatedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Toaster />
          <RootRouter />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
