import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserPlus, Copy, Check, Trash2, Crown, LogOut, Pencil, Link2, KeyRound, ChevronDown, ChevronUp } from "lucide-react";
import { objectUrl } from "@/lib/apiBase";
import { confirmDialog } from "@/lib/confirmDialog";
import { markOnboardingStepDone } from "@/lib/onboardingStatus";

type FamilyMemberInfo = {
  userId: string;
  role: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isYou: boolean;
};

type FamilyInvite = {
  id: string;
  code: string;
  email: string | null;
  expiresAt: string | null;
  createdAt: string | null;
};

type FamilyDetails = {
  family: { id: string; name: string };
  role: string;
  isOwner: boolean;
  members: FamilyMemberInfo[];
};

function memberLabel(m: FamilyMemberInfo): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.displayName;
  return name || m.email || "Family member";
}

/**
 * Family rename + members list + leave-family. The "Invite Someone" UI used
 * to live here too — it's been split out into `FamilyInviteManager` below so
 * it can render in its own "Sharing" settings section instead of alongside
 * the member list, without needing any of this component's state.
 */
export function FamilyManager({ hideMembers = false, nameOnly = false, hideName = false }: {
  hideMembers?: boolean;
  /** Just the Family Name row — used at the top of Settings, where the family's
   *  own name is the most obvious thing to show and edit. */
  nameOnly?: boolean;
  /** Skip the name row (it's shown at the top of Settings instead). */
  hideName?: boolean;
} = {}) {
  const { toast } = useToast();
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const { data: family, isLoading } = useQuery<FamilyDetails>({
    queryKey: ["/api/family"],
    queryFn: async () => (await apiRequest("GET", "/api/family")).json(),
  });

  const renameMutation = useMutation({
    mutationFn: async (name: string) =>
      (await apiRequest("PATCH", "/api/family", { name })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/family"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setNameDraft(null);
      toast({ title: "Family renamed" });
    },
    onError: (e: any) => toast({ title: "Couldn't rename family", description: e?.message, variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => apiRequest("POST", `/api/family/members/${userId}/remove`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/family"] });
      toast({ title: "Member removed" });
    },
    onError: (e: any) => toast({ title: "Couldn't remove member", description: e?.message, variant: "destructive" }),
  });

  const leaveMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/family/leave"),
    onSuccess: () => {
      toast({ title: "You left the family" });
      window.location.href = "/";
    },
    onError: (e: any) => toast({ title: "Couldn't leave family", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !family) {
    return <div className="text-sm text-muted-foreground py-4">Loading family…</div>;
  }

  return (
    <div className={nameOnly ? "" : "space-y-6"}>
      {/* Family name */}
      {!hideName && (
      <div>
        {/* In nameOnly mode this sits in the Settings dialog's fixed header,
            above the search box — three stacked header blocks left barely any
            room to edit anything with a keyboard up. There it collapses to a
            single line (label inline, normal text size) instead of a stacked
            uppercase label + text-lg name. */}
        {!nameOnly && <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Family Name</label>}
        {nameDraft === null ? (
          <div className={`flex items-center gap-2 ${nameOnly ? "" : "mt-1"}`}>
            {nameOnly && <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">Family</span>}
            <span className={`${nameOnly ? "text-sm" : "text-lg"} font-semibold text-foreground truncate`}>{family.family.name}</span>
            {family.isOwner && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Rename this family"
                title="Rename this family"
                onClick={() => setNameDraft(family.family.name)}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <div className={`flex items-center gap-2 ${nameOnly ? "" : "mt-1"}`}>
            <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="max-w-xs" />
            <Button size="sm" onClick={() => renameMutation.mutate(nameDraft)} disabled={!nameDraft.trim()}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNameDraft(null)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      )}

      {nameOnly ? null : (<>

      {/* Members list — hidden when the People list carries the login
          badges instead (Settings merges the two into one "Family Members"
          list; login-only accounts render there via LoginOnlyMembers). */}
      {!hideMembers && (
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Members ({family.members.length})
        </label>
        <div className="space-y-2 mt-1.5">
          {family.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between gap-2 rounded-lg bg-accent/30 p-2">
              <div className="flex items-center gap-2 min-w-0">
                {m.profileImageUrl ? (
                  <img src={objectUrl(m.profileImageUrl)} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
                    {memberLabel(m).charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-foreground truncate">{memberLabel(m)}</span>
                {m.role === "owner" && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                {m.isYou && <span className="text-xs text-muted-foreground shrink-0">(you)</span>}
              </div>
              {family.isOwner && !m.isYou && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" aria-label={`Remove ${memberLabel(m)} from the family`} title={`Remove ${memberLabel(m)} from the family`} onClick={async () => { if (await confirmDialog({ title: `Remove ${memberLabel(m)} from the family?`, description: "They'll lose access to shared family data.", confirmLabel: "Remove" })) removeMemberMutation.mutate(m.userId); }}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Leave family (non-owners) */}
      {!family.isOwner && (
        <div className="pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            // De-emphasised and pushed to the end of the section rather than
            // sitting mid-section as a red link at full weight. Reset Data and
            // Delete Account already hide behind a reveal; this is the third
            // destructive action in the same area and was the loudest of them.
            className="text-muted-foreground hover:text-destructive text-xs"
            onClick={async () => {
              if (await confirmDialog({ title: "Leave this family?", description: "You'll get a fresh empty family of your own. This can't be undone.", confirmLabel: "Leave family" })) {
                leaveMutation.mutate();
              }
            }}
          >
            <LogOut className="w-3.5 h-3.5 mr-1.5" />
            Leave this family
          </Button>
        </div>
      )}

      </>)}
    </div>
  );
}

/**
 * "Invite Someone" — extracted out of `FamilyManager` so it can render in its
 * own "Sharing" settings section. Self-contained: doesn't need the family
 * name/members query, only the separate invites list + its own mutations.
 */
export function FamilyInviteManager() {
  const { toast } = useToast();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"parent" | "child" | "shared_device">("parent");

  const { data: invites, isError: invitesError } = useQuery<FamilyInvite[]>({
    queryKey: ["/api/family/invites"],
    queryFn: async () => (await apiRequest("GET", "/api/family/invites")).json(),
  });

  const createInviteMutation = useMutation({
    mutationFn: async (email?: string) =>
      (await apiRequest("POST", "/api/family/invites", { ...(email ? { email } : {}), role: inviteRole })).json(),
    onSuccess: (_data, email) => {
      queryClient.invalidateQueries({ queryKey: ["/api/family/invites"] });
      setInviteEmail("");
      toast({
        title: "Invite created",
        description: email
          ? `We've emailed an invite to ${email}.`
          : "Share the code with your family member.",
      });
      // This is the same "invite the rest of your family" step onboarding
      // has — creating one here should clear a stale "skipped" onboarding
      // reminder just as generating one inside the wizard would.
      markOnboardingStepDone("invite");
    },
    onError: (e: any) => toast({ title: "Couldn't create invite", description: e?.message, variant: "destructive" }),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/family/invites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/family/invites"] });
      toast({ title: "Invite revoked" });
    },
    onError: (err: any) => toast({ title: "Couldn't revoke the invite", description: err?.message, variant: "destructive" }),
  });

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  const copyLink = (code: string) => {
    const link = `${window.location.origin}/join?code=${code}`;
    navigator.clipboard?.writeText(link).then(() => {
      setCopiedLink(code);
      setTimeout(() => setCopiedLink(null), 2000);
    });
  };

  const formatExpiry = (expiresAt: string | null): string | null => {
    if (!expiresAt) return null;
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) return null;
    const daysLeft = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) return "Expired";
    if (daysLeft === 0) return "Expires today";
    if (daysLeft === 1) return "Expires tomorrow";
    return `Expires in ${daysLeft} days`;
  };

  // Same bordered, collapsible container as "Share with Caretakers" right
  // below it in Settings → Sharing — two sub-features in one section should
  // look like two of the same thing, not one always-open block above a card.
  return (
    <div>
      <button
        type="button"
        onClick={() => setInviteOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50 transition-colors"
        data-testid="toggle-invite-someone"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <UserPlus className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Invite Someone</p>
            <p className="text-xs text-muted-foreground">
              Send an email invite, or generate a code to share yourself — they'll enter it to join your family.
            </p>
          </div>
        </div>
        {inviteOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {!inviteOpen ? null : (
      <div className="mt-3">
      {/* Role first, then email, then the button: the picker configures
          the invite this button creates, so it belongs above it. It used
          to sit below, sandwiching the primary action between two of its
          own inputs and leaving its helper text next to the code card. */}
      <div className="mb-3">
        <div className="flex gap-2 flex-wrap">
          {([["parent", "Grown-up"], ["child", "Kid"], ["shared_device", "Shared device"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setInviteRole(value)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                inviteRole === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
              data-testid={`invite-role-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Who is this invite for? A kid's own profile starts with the Kid role automatically when they join.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
        <Input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="family.member@email.com"
          className="flex-1 min-w-0"
          data-testid="input-invite-email"
        />
        <Button
          size="sm"
          onClick={() => createInviteMutation.mutate(inviteEmail.trim() || undefined)}
          disabled={createInviteMutation.isPending}
          data-testid="button-create-invite"
        >
          {inviteEmail.trim() ? "Send Invite" : "New Code"}
        </Button>
      </div>
      <div className="space-y-2">
        {invitesError ? (
          <p className="text-sm text-destructive">Couldn't load invites. Try again.</p>
        ) : (invites ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No active invites.</p>
        ) : (
          (invites ?? []).map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="flex flex-col min-w-0">
                <code className="text-base font-mono font-semibold tracking-widest text-foreground">{inv.code}</code>
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  {inv.email && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">Sent to {inv.email}</span>
                  )}
                  {inv.email && formatExpiry(inv.expiresAt) && <span className="text-xs text-muted-foreground">·</span>}
                  {formatExpiry(inv.expiresAt) && (
                    <span className="text-xs text-muted-foreground">{formatExpiry(inv.expiresAt)}</span>
                  )}
                </div>
              </div>
              {/* Revoke used to sit flush against the two copy buttons at the
                  same size, told apart only by being red. It's separated by a
                  divider now, and every one of the three has a real accessible
                  name — a title= tooltip never appears on touch, which is
                  where this row is mostly used. */}
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" title="Copy code" aria-label="Copy invite code" onClick={() => copyCode(inv.code)}>
                  {copiedCode === inv.code ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
                <Button variant="ghost" size="sm" title="Copy link" aria-label="Copy invite link" onClick={() => copyLink(inv.code)}>
                  {copiedLink === inv.code ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Link2 className="w-3.5 h-3.5" />}
                </Button>
                <span className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="sm"
                  title="Revoke this invite"
                  aria-label="Revoke this invite"
                  onClick={async () => { if (await confirmDialog({ title: "Revoke this invite code?", description: "It will no longer work.", confirmLabel: "Revoke" })) revokeInviteMutation.mutate(inv.id); }}
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
      )}
    </div>
  );
}

/**
 * Join-a-family flow: enter an invite code. Warns that the current (empty) solo
 * family's data will be discarded. Used in onboarding and settings.
 */
export function JoinFamilyForm({ onJoined }: { onJoined?: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");

  // Same "do they have anything to lose" check the /join page already makes
  // — a brand-new account joining via this form has nothing to lose, so it
  // gets the plain message; an account with real profiles of its own gets
  // the scarier, accurate one before its data is silently replaced.
  const { data: existingProfiles } = useQuery<{ isAllFamilyProfile?: boolean }[]>({
    queryKey: ["/api/profiles"],
  });
  const hasExistingData = (existingProfiles ?? []).some((p) => !p.isAllFamilyProfile);

  const joinMutation = useMutation({
    mutationFn: async (c: string) => (await apiRequest("POST", "/api/family/join", { code: c })).json(),
    onSuccess: () => {
      toast({ title: "Joined family!" });
      // Full reload so all queries refetch under the new family owner.
      if (onJoined) onJoined();
      else window.location.href = "/";
    },
    onError: (e: any) => toast({ title: "Couldn't join", description: e?.message, variant: "destructive" }),
  });

  const handleJoin = async () => {
    const confirmed = await confirmDialog({
      title: "Join this family?",
      description: hasExistingData
        ? "This will replace any data in your current family (chores, calendar, etc.) with the invited family's shared data. This can't be undone."
        : "You'll be added to their family and see their shared chores, calendar, and more.",
      confirmLabel: "Join family",
    });
    if (confirmed) joinMutation.mutate(code.trim());
  };

  return (
    <div className="space-y-3">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Enter invite code"
        className="font-mono tracking-widest text-center text-lg"
        maxLength={8}
      />
      <p className="text-xs text-muted-foreground">
        Your family member can find this code under <strong className="text-foreground">Settings → Sharing → Invite Someone</strong> (tap "New Code" to generate one).
      </p>
      {hasExistingData && (
        <p className="text-xs text-muted-foreground">
          Joining a family replaces your current data with the shared family's data.
        </p>
      )}
      <Button
        className="w-full"
        onClick={handleJoin}
        disabled={!code.trim() || joinMutation.isPending}
      >
        {joinMutation.isPending ? "Joining…" : "Join Family"}
      </Button>
    </div>
  );
}

/**
 * Login accounts that DON'T correspond to any profile (matched by email).
 * Rendered at the bottom of the merged "Family Members" list in Settings so
 * removing someone's access (or seeing an account that hasn't picked a
 * profile yet) doesn't need its own separate Members section. Renders
 * nothing when every account maps to a profile.
 */
export function LoginOnlyMembers({ profileEmails }: { profileEmails: string[] }) {
  const { toast } = useToast();
  const { data: family } = useQuery<FamilyDetails>({
    queryKey: ["/api/family"],
    queryFn: async () => (await apiRequest("GET", "/api/family")).json(),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => apiRequest("POST", `/api/family/members/${userId}/remove`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/family"] });
      toast({ title: "Member removed" });
    },
    onError: (e: any) => toast({ title: "Couldn't remove member", description: e?.message, variant: "destructive" }),
  });

  if (!family) return null;
  const emails = new Set(profileEmails.map((e) => e.toLowerCase()));
  const loginOnly = family.members.filter((m) => !m.email || !emails.has(m.email.toLowerCase()));
  if (loginOnly.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-[11px] text-muted-foreground mb-1.5">
        Logins not linked to a person above:
      </p>
      <div className="space-y-2">
        {loginOnly.map((m) => (
          <div key={m.userId} className="flex items-center justify-between gap-2 rounded-lg bg-accent/30 p-2">
            <div className="flex items-center gap-2 min-w-0">
              {m.profileImageUrl ? (
                <img src={objectUrl(m.profileImageUrl)} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
                  {memberLabel(m).charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-sm font-medium text-foreground truncate">{memberLabel(m)}</span>
              <KeyRound className="w-3 h-3 text-muted-foreground shrink-0" />
              {m.role === "owner" && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
              {m.isYou && <span className="text-xs text-muted-foreground shrink-0">(you)</span>}
            </div>
            {family.isOwner && !m.isYou && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" aria-label="Remove this login from the family" onClick={async () => { if (await confirmDialog({ title: `Remove ${memberLabel(m)} from the family?`, description: "They'll lose access to shared family data.", confirmLabel: "Remove" })) removeMemberMutation.mutate(m.userId); }}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
