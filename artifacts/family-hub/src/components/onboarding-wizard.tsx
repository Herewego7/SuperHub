import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ObjectUploader } from "@/components/ObjectUploader";
import { objectUrl } from "@/lib/apiBase";
import { JoinFamilyForm } from "@/components/family-manager";
import { RewardsSettingsSection, ParentPinSettingsSection, CalendarConnectionsSection } from "@/components/settings-modal";
import type { Profile } from "@workspace/shared-types";
import { OnboardingTour } from "@/components/onboarding-tour";
import { confirmDialog, ConfirmDialogHost } from "@/lib/confirmDialog";
import { regionToTimezone, deviceTimezone, guessCountry, countryFromName, regionLabel, COUNTRIES, type CountryCode } from "@/lib/regions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocationWeatherChip } from "@/components/location-weather-chip";
import {
  Users, UserPlus, ArrowLeft, Plus, Check, LogOut, Home,
  Camera, MapPin, Gift, Copy, Mail, X, Link2, Pencil, Calendar, CheckSquare,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const PROFILE_COLORS = [
  "#5E8FAD", "#E07B6A", "#6DB98A", "#A67BB9",
  "#D4A843", "#5BA9A9", "#D97DB5", "#7B9E6B",
];

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Steps a fresh signup walks through in order. Steps after "setup" are each
// individually skippable — see OnboardingStatus / the reminder banner in
// announcements-banner.tsx for what happens when someone skips one.
type Step = "welcome" | "setup" | "join" | "you" | "location" | "calendar" | "rewards" | "invite" | "tour" | "done";
const SKIPPABLE_STEPS = ["you", "location", "calendar", "rewards", "invite"] as const;
export type SkippableStep = (typeof SKIPPABLE_STEPS)[number];

const STEP_TO_ONBOARDING_KEY: Record<SkippableStep, "profile" | "location" | "calendar" | "rewards" | "invite"> = {
  you: "profile",
  location: "location",
  calendar: "calendar",
  rewards: "rewards",
  invite: "invite",
};

interface AddedProfile {
  id: string;
  name: string;
  color: string;
  /** Set the moment a photo is added — either right here while creating the
   * profile (ProfileForm's own photo picker), or later on the "you" step.
   * Optional/undefined for a profile with no photo yet. */
  photoUrl?: string | null;
}

/** Small round avatar used throughout onboarding — a real photo when one's
 * set, initials-on-color otherwise. One place so every list (Add family
 * members, the "which one is you" picker, etc.) renders a just-added photo
 * identically. */
function ProfileAvatarCircle({
  profile,
  size = "w-7 h-7 text-xs",
}: {
  profile: { name: string; color: string; photoUrl?: string | null };
  size?: string;
}) {
  if (profile.photoUrl) {
    return (
      <img
        src={objectUrl(profile.photoUrl)}
        alt=""
        className={`${size} rounded-full object-cover shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${size} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
      style={{ backgroundColor: profile.color }}
    >
      {initials(profile.name)}
    </div>
  );
}

function ProfileForm({
  onAdded,
  usedNames,
  defaultName = "",
  defaultRole = "adult",
}: {
  onAdded: (p: AddedProfile) => void;
  usedNames: string[];
  /** Prefills the name field (still fully editable) — used to carry the name
   * already collected at signup into the very first profile, since that
   * first profile is usually the signer-upper themselves. */
  defaultName?: string;
  /** Preselects Grown-up/Kid — a joiner invited as a kid gets "child" here
   * so their role is right from the start, no Settings trip needed. */
  defaultRole?: "adult" | "child";
}) {
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState(PROFILE_COLORS[0]);
  const [role, setRole] = useState<"adult" | "child">(defaultRole);
  // Lets a parent add everyone's photo right while adding family members,
  // instead of only being able to set their own photo (on the "you" step)
  // during onboarding — everyone else's photo previously had to wait until
  // a separate trip to Settings → People after the whole walkthrough.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/profiles", {
          name: name.trim(),
          color,
          initials: initials(name),
          role,
          photoUrl: photoUrl || undefined,
        })
      ).json(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      onAdded({ id: data.id, name: name.trim(), color, photoUrl });
      setName("");
      setColor(PROFILE_COLORS[0]);
      setRole(defaultRole);
      setPhotoUrl(null);
    },
    onError: () => toast({ title: "Couldn't add profile", variant: "destructive" }),
  });

  const trimmed = name.trim();
  const duplicate = usedNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <div className="relative">
          <ObjectUploader
            onComplete={(result) => setPhotoUrl(result.objectPath)}
            buttonClassName="h-16 w-16 p-0 rounded-full bg-transparent hover:bg-transparent shadow-none"
            withCrop
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white font-semibold text-xl shadow-sm"
              style={{ backgroundColor: `${color}20`, border: `2px solid ${color}` }}
            >
              {photoUrl ? (
                <img src={objectUrl(photoUrl)} alt="Preview" className="w-full h-full rounded-full object-cover" />
              ) : (
                initials(name) || <Camera className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </ObjectUploader>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center shadow-sm pointer-events-none">
            <Camera className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-center text-muted-foreground -mt-1.5">
        Optional — tap to add a photo.
      </p>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">Name</label>
        <Input
          autoFocus
          placeholder="e.g. Mom, Dad, Alex…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !duplicate) createMutation.mutate();
          }}
          maxLength={40}
        />
        {duplicate && (
          <p className="text-xs text-destructive mt-1">That name is already added.</p>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">Color</label>
        <div className="flex gap-2 flex-wrap">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none"
              style={{ backgroundColor: c }}
              title={c}
            >
              {color === c && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">This person is a…</label>
        <div className="flex gap-2">
          {([["adult", "🧑 Grown-up"], ["child", "🧒 Kid"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                role === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
              data-testid={`onboarding-role-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Kids can do their own chores and redeem stars; grown-up actions can be locked behind the Parent PIN.
        </p>
      </div>

      {trimmed && (
        <div className="flex items-center gap-2 p-2 bg-accent/40 rounded-lg">
          <ProfileAvatarCircle profile={{ name, color, photoUrl }} size="w-9 h-9 text-sm" />
          <span className="text-sm font-medium text-foreground">{trimmed}</span>
        </div>
      )}

      <Button
        className="w-full"
        disabled={!trimmed || duplicate || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        <Plus className="w-4 h-4 mr-2" />
        {createMutation.isPending ? "Adding…" : "Add person"}
      </Button>
    </div>
  );
}

// One row in the "Added"/"Already in your family" list on the "Add family
// members" step. Previously plain, read-only text — a mistyped or
// placeholder name (e.g. "Kid 2") had no way to be fixed until the whole
// walkthrough finished and Settings → People was reached. The profile row
// itself already exists as a real DB row the instant it's added (ProfileForm
// posts to /api/profiles immediately, in both fresh-signup and
// replay/joiner mode), so editing it here is just the same
// PATCH /api/profiles/:id Settings' own Edit Profile form uses — click the
// pencil, edit inline, Save/Cancel.
function EditableProfileRow({
  profile,
  usedNames,
  onRenamed,
}: {
  profile: AddedProfile;
  /** Every OTHER already-added name, for the duplicate-name check. */
  usedNames: string[];
  /** Called with the trimmed new name once the rename actually saves —
   * updates the session-only `added` list in fresh-signup mode; a no-op
   * (real-profiles mode already gets its update via the /api/profiles
   * query invalidation below) is fine too, so this is safe to always call. */
  onRenamed: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const { toast } = useToast();

  const renameMutation = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", `/api/profiles/${profile.id}`, {
        name: name.trim(),
        initials: initials(name),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      onRenamed(profile.id, name.trim());
      setEditing(false);
    },
    onError: () => toast({ title: "Couldn't rename", variant: "destructive" }),
  });

  const trimmed = name.trim();
  const duplicate =
    trimmed.toLowerCase() !== profile.name.toLowerCase() &&
    usedNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  if (!editing) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-accent/40">
        <ProfileAvatarCircle profile={profile} />
        <span className="text-sm font-medium text-foreground">{profile.name}</span>
        <button
          type="button"
          onClick={() => {
            setName(profile.name);
            setEditing(true);
          }}
          className="ml-auto p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={`Edit ${profile.name}'s name`}
          data-testid={`onboarding-edit-profile-${profile.id}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <Check className="w-4 h-4 text-green-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg bg-accent/40">
      <div className="flex items-center gap-2.5">
        <ProfileAvatarCircle profile={{ ...profile, name: name || profile.name }} />
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !duplicate) renameMutation.mutate();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={40}
          className="h-8 text-sm"
          data-testid={`onboarding-rename-input-${profile.id}`}
        />
      </div>
      {duplicate && <p className="text-xs text-destructive">That name is already added.</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 px-2"
          disabled={!trimmed || duplicate || renameMutation.isPending}
          onClick={() => renameMutation.mutate()}
          data-testid={`onboarding-rename-save-${profile.id}`}
        >
          {renameMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Step: "Which one is you?" — pick a profile, add photo + email ──────────
function YouStep({
  profiles,
  onDone,
  onNoneOfThese,
  onProfileAdded,
}: {
  profiles: AddedProfile[];
  onDone: () => void;
  onNoneOfThese?: () => void;
  /** Called whenever a profile is added right here, inline — lets the parent
   * keep its own session-only `added` list (fresh-signup mode) in sync. When
   * real profiles are in play (replay/joiner), ProfileForm's own mutation
   * already invalidates `/api/profiles`, so this is a no-op there. */
  onProfileAdded?: (p: AddedProfile) => void;
}) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(profiles[0]?.id ?? null);
  const [email, setEmail] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Whether the inline "add a person" form is showing. People can land on
  // this step as the very first person in their family (nobody to pick from
  // yet) or with family members already added — both cases are handled
  // right here now, without leaving this screen.
  const [showAddForm, setShowAddForm] = useState(false);
  const effectiveShowAddForm = showAddForm || profiles.length === 0;

  // Once profiles load in (e.g. the real-profiles query resolving after
  // mount) and nothing's selected yet, default to the first one.
  useEffect(() => {
    if (!selectedId && profiles.length > 0) setSelectedId(profiles[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  // Real bug (2026-08-27): this step's email/photo local state used to
  // start blank on every mount, with nothing re-reading what was already
  // saved — so pressing Back after Continue (this step conditionally
  // unmounts on every step change) showed an empty form even though the
  // PATCH had already succeeded. The profile row is a real DB record the
  // instant it's created (in both fresh-signup and replay/joiner mode), so
  // fetching it fresh and prefilling from it fixes this regardless of mode
  // — no need to thread email/photo through the session-only `added` list.
  const { data: realProfiles } = useQuery<Array<{ id: string; email?: string | null; photoUrl?: string | null }>>({
    queryKey: ["/api/profiles"],
  });
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId || !realProfiles || prefilledFor === selectedId) return;
    const real = realProfiles.find((p) => p.id === selectedId);
    setEmail(real?.email ?? "");
    setPhotoUrl(real?.photoUrl ?? null);
    setPrefilledFor(selectedId);
  }, [selectedId, realProfiles, prefilledFor]);

  const handleProfileAdded = (p: AddedProfile) => {
    onProfileAdded?.(p);
    setSelectedId(p.id);
    setShowAddForm(false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) return;
      return (await apiRequest("PATCH", `/api/profiles/${selectedId}`, {
        email: email.trim() || undefined,
        photoUrl: photoUrl || undefined,
      })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      toast({ title: "Profile updated" });
      onDone();
    },
    onError: () => toast({ title: "Couldn't save profile", variant: "destructive" }),
  });

  const selected = profiles.find((p) => p.id === selectedId);
  // Both fields are optional — if the user hasn't typed an email or picked a
  // photo, there's nothing to PATCH. Sending {} anyway used to throw a server
  // "No values to set" error and strand the wizard on this step forever,
  // since Continue was the only way past it besides the destructive-feeling
  // "None of these are me" escape hatch.
  const hasChanges = email.trim().length > 0 || photoUrl !== null;
  const handleContinue = async () => {
    if (!photoUrl) {
      const proceed = await confirmDialog({
        title: "Add a photo?",
        description: "No photo yet — people will see your initials. You can add one later.",
        confirmLabel: "Continue without a photo",
        cancelLabel: "Add a photo",
        destructive: false,
      });
      if (!proceed) return;
    }
    if (hasChanges) saveMutation.mutate();
    else onDone();
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-medium mb-1.5 block">
          {profiles.length === 0 ? "Add your family — starting with you" : "Which one is you?"}
        </Label>
        {profiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 transition-colors ${
                  selectedId === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"
                }`}
              >
                <ProfileAvatarCircle profile={p} size="w-6 h-6 text-[10px]" />
                <span className="text-sm font-medium">{p.name}</span>
              </button>
            ))}
            {!showAddForm && (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 border-dashed border-border hover:bg-accent/40 transition-colors text-muted-foreground"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="text-sm font-medium">Add someone</span>
              </button>
            )}
            {onNoneOfThese && (
              <button
                type="button"
                onClick={onNoneOfThese}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border-2 border-dashed border-border hover:bg-accent/40 transition-colors text-muted-foreground"
              >
                <span className="text-sm font-medium">None of these are me</span>
              </button>
            )}
          </div>
        )}
      </div>

      {effectiveShowAddForm && (
        <div className="p-3 bg-accent/30 rounded-xl space-y-2">
          <p className="text-xs text-muted-foreground">
            {profiles.length === 0
              ? "Add yourself first — you can add the rest of your family in a moment."
              : "Add another family member."}
          </p>
          <ProfileForm onAdded={handleProfileAdded} usedNames={profiles.map((p) => p.name)} />
          {profiles.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-muted-foreground hover:underline"
            >
              ← Back to picking who you are
            </button>
          )}
        </div>
      )}

      {selected && !effectiveShowAddForm && (
        <>
          <div className="flex justify-center">
            <div className="relative">
              <ObjectUploader
                onComplete={(result) => setPhotoUrl(result.objectPath)}
                buttonClassName="h-20 w-20 p-0 rounded-full bg-transparent hover:bg-transparent shadow-none"
                withCrop
              >
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white font-semibold text-2xl shadow-sm"
                  style={{ backgroundColor: `${selected.color}20`, border: `3px solid ${selected.color}` }}
                >
                  {photoUrl ? (
                    <img src={objectUrl(photoUrl)} alt="Preview" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    initials(selected.name)
                  )}
                </div>
              </ObjectUploader>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center shadow-sm pointer-events-none">
                <Camera className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
          </div>
          <p className="text-xs text-center text-muted-foreground -mt-2">
            {photoUrl ? "Tap to change the photo" : "Tap the circle to add a photo"}
          </p>

          <div>
            <Label htmlFor="onboarding-email" className="text-xs">Email (optional)</Label>
            <Input
              id="onboarding-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1"
            />
          </div>

          <Button className="w-full" onClick={handleContinue} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Continue →"}
          </Button>
        </>
      )}
    </div>
  );
}

// ── Step: Location ───────────────────────────────────────────────────────────
function LocationStep({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  // Pre-selected from the device's own timezone (America/Toronto -> Canada),
  // then freely changeable — detect-and-confirm rather than making everyone
  // pick from a list whose answer we already know.
  const [country, setCountry] = useState<CountryCode>(() => guessCountry());
  const [prefilled, setPrefilled] = useState(false);

  // Prefill from any location the family already has saved — this step is
  // reachable both fresh (nothing saved yet) and via "Finish Now" from the
  // Announcements reminder or a joiner's flow, where the family may well
  // already have real city/state on file; it previously always started blank.
  const { data: existingLocation } = useQuery<{ city?: string | null; state?: string | null; country?: string | null }>({
    queryKey: ["/api/location-settings"],
  });
  useEffect(() => {
    if (!prefilled && existingLocation) {
      if (existingLocation.city) setCity(existingLocation.city);
      if (existingLocation.state) setState(existingLocation.state);
      // A saved country always wins over the device guess.
      if (existingLocation.country) setCountry(countryFromName(existingLocation.country));
      setPrefilled(true);
    }
  }, [existingLocation, prefilled]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", "/api/location-settings", {
        city: city.trim(),
        state: state.trim(),
        country: COUNTRIES.find((c) => c.code === country)!.name,
        // ⚠️ These used to be hardcoded to 44.6402/-93.1468 — Farmington,
        // Minnesota — for EVERY family, and the weather endpoint reads
        // coordinates, so everyone saw Minnesota's weather whatever city they
        // typed. The server now geocodes city/state/country on save; sending
        // 0/0 just means "no better guess", and the server overwrites it.
        latitude: 0,
        longitude: 0,
        // Every timed push (daily brief, bedtime, weekly recap, health
        // reminders) reads this. The device's own timezone is correct by
        // construction; the region map is the fallback for when Intl is
        // unavailable, and several regions legitimately span two zones.
        timezone: deviceTimezone() ?? regionToTimezone(state.trim(), country),
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/location-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weather"] });
      toast({ title: "Location saved" });
      onDone();
    },
    onError: () => toast({ title: "Couldn't save location", variant: "destructive" }),
  });

  const canSave = city.trim() && state.trim();

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="onboarding-city" className="text-xs">City</Label>
          <Input id="onboarding-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="mt-1" />
        </div>
        <div className="w-24">
          <Label htmlFor="onboarding-state" className="text-xs">{regionLabel(country)}</Label>
          <Input
            id="onboarding-state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder={country === "CA" ? "ON" : "MN"}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="onboarding-country" className="text-xs">Country</Label>
        <Select value={country} onValueChange={(v) => setCountry(v as CountryCode)}>
          <SelectTrigger id="onboarding-country" className="mt-1" data-testid="onboarding-country">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Powers the weather widget and makes reminder times accurate for your family's timezone.
      </p>
      <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}>
        {saveMutation.isPending ? "Saving…" : "Continue →"}
      </Button>
    </div>
  );
}

// ── Step: Connect your calendars ────────────────────────────────────────────
// Reuses the exact same CalendarConnectionsSection component Settings itself
// uses (2026-08-27) — a real family member's row already exists in the DB by
// this point in the wizard (both fresh-signup and joiner mode, since
// ProfileForm posts each profile immediately as it's added), so this fetches
// the real profiles fresh rather than depending on onboarding's own
// session-only `added` list, which doesn't carry connection status anyway.
function CalendarConnectStep() {
  const { data: profiles, isLoading } = useQuery<Profile[]>({
    queryKey: ["/api/profiles"],
  });
  const realProfiles = (profiles ?? []).filter((p) => !p.isAllFamilyProfile);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground text-center py-6">Loading your family…</p>;
  }

  return (
    <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
      <CalendarConnectionsSection profiles={realProfiles} />
    </div>
  );
}

// ── Step: Invite ──────────────────────────────────────────────────────────────
type InviteeRole = "parent" | "child" | "shared_device";
const INVITEE_ROLE_OPTIONS: { value: InviteeRole; label: string }[] = [
  { value: "parent", label: "Grown-up" },
  { value: "child", label: "Kid" },
  { value: "shared_device", label: "Shared device (used by both)" },
];

type InviteEntry = { id: string; email: string; role: InviteeRole };
type CreatedInvite = { code: string; email: string | null; role: InviteeRole | null };

let inviteEntrySeq = 0;
function newInviteEntry(): InviteEntry {
  inviteEntrySeq += 1;
  return { id: `invite-${inviteEntrySeq}`, email: "", role: "parent" };
}

function InviteStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<InviteEntry[]>([newInviteEntry()]);
  const [created, setCreated] = useState<CreatedInvite[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const updateEntry = (id: string, updates: Partial<InviteEntry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  const removeEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const addEntry = () => setEntries((prev) => [...prev, newInviteEntry()]);

  const submitInvites = async () => {
    setSubmitting(true);
    try {
      const withEmail = entries.filter((e) => e.email.trim());
      // Nobody typed an email at all: fall back to the original single
      // "just generate a shareable code" behavior (no role to attach either,
      // since there's no named recipient yet).
      const toSubmit = withEmail.length > 0 ? withEmail : [entries[0]];
      const results: CreatedInvite[] = [];
      for (const entry of toSubmit) {
        const email = entry.email.trim();
        const res = await apiRequest("POST", "/api/family/invites", {
          ...(email ? { email } : {}),
          ...(email ? { role: entry.role } : {}),
        });
        const data = await res.json();
        results.push({ code: data.code, email: email || null, role: email ? entry.role : null });
      }
      setCreated(results);
      toast({ title: results.length > 1 ? "Invites sent!" : (results[0]?.email ? "Invite sent!" : "Invite code created") });
    } catch {
      toast({ title: "Couldn't create invite", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Invites are for other adults who need their own login — not the profiles you just added.
      </p>

      {!created ? (
        <>
          <div className="space-y-4">
            {entries.map((entry, idx) => (
              <div key={entry.id} className="space-y-2 p-3 rounded-lg border border-border">
                <div className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    <Label htmlFor={`onboarding-invite-email-${entry.id}`} className="text-xs">
                      {idx === 0 ? "Their email (optional)" : "Another email"}
                    </Label>
                    <Input
                      id={`onboarding-invite-email-${entry.id}`}
                      type="email"
                      value={entry.email}
                      onChange={(e) => updateEntry(entry.id, { email: e.target.value })}
                      placeholder="Leave blank to just generate a code"
                      className="mt-1"
                    />
                  </div>
                  {entries.length > 1 && (
                    <Button variant="ghost" size="icon" className="mb-0.5 shrink-0" onClick={() => removeEntry(entry.id)} aria-label="Remove email">
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Who's this for?</Label>
                  {/* Button group instead of a dropdown — stacks full-width
                      below the email field (no fixed-width column squeezing
                      it on narrow phones), and every option is always fully
                      visible without needing to open a popover. */}
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {INVITEE_ROLE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateEntry(entry.id, { role: opt.value })}
                        className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                          entry.role === opt.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:bg-accent/40"
                        }`}
                        data-testid={`invite-role-${opt.value}-${entry.id}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Grown-ups can approve reward cash-outs; kids and shared devices can't.
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={addEntry}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add another email
          </Button>
          <Button className="w-full" onClick={submitInvites} disabled={submitting}>
            <Mail className="w-4 h-4 mr-2" />
            {submitting ? "Creating…" : entries.filter((e) => e.email.trim()).length > 1 ? "Send Invites" : "Create Invite"}
          </Button>
        </>
      ) : (
        <div className="space-y-2">
          {created.map((invite, idx) => (
            <div key={`${invite.code}-${idx}`} className="p-4 bg-accent/40 rounded-xl text-center space-y-2">
              {invite.email && (
                <p className="text-xs text-muted-foreground">
                  {invite.email} · {INVITEE_ROLE_OPTIONS.find((o) => o.value === invite.role)?.label}
                </p>
              )}
              <p className="text-xs text-muted-foreground">Invite code</p>
              <p className="text-2xl font-bold tracking-widest text-foreground">{invite.code}</p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(`code-${idx}`, invite.code)}>
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  {copiedKey === `code-${idx}` ? "Copied!" : "Copy code"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => copy(`link-${idx}`, `${window.location.origin}/join?code=${invite.code}`)}>
                  <Link2 className="w-3.5 h-3.5 mr-1.5" />
                  {copiedKey === `link-${idx}` ? "Copied!" : "Copy link"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button className="w-full" variant={created ? "default" : "outline"} onClick={created ? onDone : onSkip}>
        {created ? "Continue →" : "I'll do this later"}
      </Button>
    </div>
  );
}

interface OnboardingWizardProps {
  onSignOut: () => void;
  /** Replay mode: skip welcome/setup (family already exists), jump straight to
   * a specific step, and call onClose instead of relying on the "no profiles
   * yet" gate to dismiss. Used by the Settings "Replay setup walkthrough"
   * button and the Announcements "Finish now" reminder links. */
  initialStep?: SkippableStep;
  onClose?: () => void;
  /** Someone who just joined an EXISTING family via an invite code — they
   * already inherited that family's profiles, so the usual "zero profiles"
   * gate never fires for them and they'd otherwise skip onboarding
   * entirely. Like replay, this starts at "you" and shows the family's real
   * (already-created) profiles instead of an empty "add family members"
   * list, so they pick themselves rather than re-creating anyone. Unlike
   * replay: no Close button (there's nothing to close back to — this
   * occupies the whole screen same as a fresh signup), and it skips the
   * family-wide Rewards/Invite steps (already configured by whoever set the
   * family up) rather than walking through every step in order. */
  forJoiner?: boolean;
}

export function OnboardingWizard({ onSignOut, initialStep, onClose, forJoiner = false }: OnboardingWizardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isReplay = !!initialStep;
  // The role this account was invited as (parent/child) — preselects
  // Grown-up/Kid on the profile a joiner creates for themselves, so the
  // right role is set from the start without a Settings trip.
  const { data: inviteRoleData } = useQuery<{ role: string | null }>({
    queryKey: ["/api/family/my-invite-role"],
    enabled: forJoiner,
  });
  const myInviteRole = inviteRoleData?.role ?? null;
  // Real, already-created profiles are shown (instead of an empty
  // this-session-only list) whenever the family already exists — both for
  // an explicit replay and for a first-time joiner.
  const usesRealProfiles = isReplay || forJoiner;
  const [step, setStep] = useState<Step>(initialStep ?? (forJoiner ? "you" : "welcome"));
  const [added, setAdded] = useState<AddedProfile[]>([]);
  // The Rewards & Approvals step walks two mini-wizards in sequence — how
  // stars are earned/redeemed, then the Parent PIN — showing only one card
  // at a time instead of both stacked together.
  const [rewardsPhase, setRewardsPhase] = useState<"earning" | "pin">("earning");
  // "I don't need a PIN right now" — explicitly turns PIN-gating off (same
  // as the master toggle in Settings → Rewards & Approvals, an empty
  // pinGatedFeatures array) rather than just navigating past the step with
  // no PIN set, so a family that deliberately doesn't want this never runs
  // into the "Parent PIN required" gate dialog later. Uses goNext (not
  // skip) since earning/redemption were already answered and saved in the
  // earlier phase — only the PIN itself is being opted out of.
  const skipPinMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/reward-settings", { pinGatedFeatures: [] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reward-settings"] });
      goNext("rewards", "invite");
    },
    onError: () => toast({ title: "Couldn't save that — try again", variant: "destructive" }),
  });
  // A real back-stack, so "Back" returns to whichever step you actually came
  // from — previously it always jumped straight to Welcome regardless of
  // how many steps deep you were.
  const [history, setHistory] = useState<Step[]>([]);
  const navigateTo = (to: Step) => {
    setHistory((h) => [...h, step]);
    setStep(to);
  };
  const goBack = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const next = [...h];
      const prev = next.pop()!;
      setStep(prev);
      return next;
    });
  };

  const { data: profiles } = useQuery<AddedProfile[]>({
    queryKey: ["/api/profiles"],
    enabled: usesRealProfiles,
  });

  const handleAdded = (p: AddedProfile) => {
    setAdded((prev) => [...prev, p]);
  };

  // Fresh-signup mode's `added` list is session-only local state, so a
  // rename needs its own update here — the real DB row already got renamed
  // by EditableProfileRow's own mutation; this just keeps this screen's
  // displayed name in sync with it. In replay/joiner mode `profiles` comes
  // straight from the query (already invalidated by the rename mutation),
  // so this is a harmless no-op there.
  const handleRenamed = (id: string, name: string) => {
    setAdded((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const markStep = (step: SkippableStep, action: "skip" | "done") => {
    apiRequest("PATCH", "/api/onboarding-status", { step: STEP_TO_ONBOARDING_KEY[step], action })
      .catch(() => {})
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/onboarding-status"] });
      });
  };

  const goNext = (from: Step, to: Step) => {
    if (SKIPPABLE_STEPS.includes(from as SkippableStep)) markStep(from as SkippableStep, "done");
    navigateTo(to);
  };

  const skip = (from: SkippableStep, to: Step) => {
    // Replay mode: navigation only. Marking "skipped" here resurrected every
    // "Finish setting up" reminder for anyone who replayed the walkthrough
    // and skipped past steps they'd long since completed — replay must never
    // downgrade a step's status ("done" marks from goNext stay, those only
    // help).
    if (!isReplay) {
      markStep(from, "skip");
      toast({
        title: "Skipped for now",
        description: "Pick this up later in Settings → Replay setup walkthrough.",
        duration: 8000,
      });
    }
    navigateTo(to);
  };

  const completeOnboardingMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/complete-onboarding"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] }),
    // If this fails the wizard would re-show next launch — retry silently
    // once, then let the user know rather than looping them forever.
    retry: 1,
    onError: () => {
      toast({ title: "Couldn't save your setup progress", description: "The walkthrough may show again next time.", variant: "destructive" });
    },
  });

  const finish = () => {
    if (isReplay) {
      onClose?.();
    } else {
      // Marks this account (fresh signup OR first-time joiner) as having
      // seen onboarding, so the parent's gate doesn't show it again — then
      // the already-invalidated profiles/user queries let the parent
      // re-render into the main app.
      completeOnboardingMutation.mutate();
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
    }
  };

  // Both the "you" step and the "add family members" step (reachable via
  // its "Add another family member" link) use this same list — real
  // profiles when the family already exists, so a joiner sees who's
  // already there instead of an empty list inviting them to re-create
  // people who already exist.
  const profilesForYouStep = usesRealProfiles ? (profiles ?? []) : added;

  // Every entry mode now gets a chance to connect their own calendar right
  // after location — a joiner has their own separate calendar account just
  // like anyone else, even though they skip the family-wide Rewards/Invite
  // steps below (those were already configured by whoever set the family up,
  // so re-showing them risks a joiner overwriting shared settings for no
  // reason).
  const afterLocationStep: Step = "calendar";
  const afterCalendarStep: Step = forJoiner ? "tour" : "rewards";

  // If location is already saved — a joiner's family almost certainly has
  // one already, but a fresh signup can too (e.g. filled in directly in
  // Settings, or re-entering the wizard after already completing this step)
  // — skip straight past this step (rather than showing it pre-filled)
  // instead of asking them to re-confirm data they didn't just enter.
  const { data: existingLocation } = useQuery<{ city?: string | null; state?: string | null }>({
    queryKey: ["/api/location-settings"],
    enabled: step === "location",
  });
  useEffect(() => {
    if (step === "location" && existingLocation?.city && existingLocation?.state) {
      goNext("location", afterLocationStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, existingLocation]);

  // Step-progress indicator. Each entry mode walks a different sequence of
  // steps, so each gets its own list — replay/joiner previously showed no
  // progress bar at all, which is the mode most people re-testing onboarding
  // actually go through (Settings → Replay setup walkthrough), so "the
  // progress bar isn't there" kept being reported even after it was added
  // for the fresh-signup flow.
  const MAIN_STEPS: Step[] = ["welcome", "setup", "you", "location", "calendar", "rewards", "invite", "tour", "done"];
  const REPLAY_STEPS: Step[] = ["you", "location", "calendar", "rewards", "invite", "tour", "done"];
  const JOINER_STEPS: Step[] = ["you", "location", "calendar", "tour", "done"];
  const activeStepList = forJoiner ? JOINER_STEPS : isReplay ? REPLAY_STEPS : MAIN_STEPS;
  const activeStepIndex = activeStepList.indexOf(step);
  const showStepProgress = activeStepIndex !== -1;

  return (
    <div className="hearth-theme opaque-vars min-h-screen bg-background text-foreground">
      {/* No safe-area padding here at all meant Close/Sign Out rendered right
          up against the status bar / Dynamic Island on notched phones — same
          "add env(safe-area-inset-top)" fix already applied to dialogs and
          sheets elsewhere in this app. py-8 kept as the baseline; the extra
          inset is added on top of it, so this is a no-op on devices with no
          inset (e.g. most desktop/web views). */}
      <div className="container mx-auto px-6 pb-8 max-w-lg" style={{ paddingTop: "calc(2rem + env(safe-area-inset-top, 0px))" }}>
        {/* Top bar */}
        <div className="flex justify-between items-center mb-8">
          {step !== "welcome" && !isReplay && !forJoiner ? (
            <button
              onClick={goBack}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}
          {isReplay ? (
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4 mr-1.5" />
              Close
            </Button>
          ) : (
            // De-emphasised: on step 1 of a brand-new account this is the
            // only header control, so at full weight the most prominent
            // action on someone's very first screen was leaving.
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              className="text-xs text-muted-foreground/70 hover:text-foreground"
            >
              <LogOut className="w-3.5 h-3.5 mr-1" />
              Sign out
            </Button>
          )}
        </div>

        {showStepProgress && (
          <div className="mb-6 -mt-4">
            <div className="h-1.5 rounded-full bg-accent overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${((activeStepIndex + 1) / activeStepList.length) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Step {activeStepIndex + 1} of {activeStepList.length}
            </p>
          </div>
        )}

        {/* Step: Welcome */}
        {step === "welcome" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-5">
                <Home className="w-10 h-10 text-primary" />
              </div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Welcome to Family Hub+!
              </h1>
              <p className="text-muted-foreground text-base">
                {user?.firstName ? `Hi ${user.firstName}! ` : ""}
                Let's get your family set up in just a few steps.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => navigateTo("setup")}
                className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-primary bg-accent hover:bg-accent/80 transition-all text-left"
              >
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center shrink-0">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Create my family</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Add profiles for each family member and start fresh.
                  </p>
                </div>
              </button>

              <button
                onClick={() => navigateTo("join")}
                className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-border bg-card hover:bg-accent/40 hover:border-primary/30 transition-all text-left"
              >
                <div className="w-12 h-12 bg-accent rounded-full flex items-center justify-center shrink-0">
                  <Users className="w-6 h-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Join a family</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Have an invite code? Enter it to join an existing family.
                  </p>
                </div>
              </button>
            </div>

            {/* Feature preview */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { Icon: Calendar, label: "Calendar", sub: "Sync family events" },
                { Icon: CheckSquare, label: "Chores", sub: "Track tasks & stars" },
                { Icon: Gift, label: "Rewards", sub: "Motivate everyone" },
              ].map(({ Icon, label, sub }) => (
                <div key={label} className="flex flex-col items-center p-3 bg-accent/40 rounded-xl text-center">
                  {/* Line icons, matching the choice cards above — this row
                      used emoji, so one screen carried two icon vocabularies. */}
                  <Icon className="w-6 h-6 mb-1 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">{sub}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step: Setup (add profiles) */}
        {step === "setup" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1">
                {usesRealProfiles ? "Your family's members" : "Add family members"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {usesRealProfiles
                  ? "Here's everyone already in your family — add anyone who's missing."
                  : "Add a profile for everyone in your family."}
              </p>
            </div>

            {/* Already-added profiles — real ones when the family already exists,
                so a joiner sees who's there instead of an empty list. */}
            {profilesForYouStep.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {usesRealProfiles ? "Already in your family" : "Added"}
                </p>
                <div className="space-y-1.5">
                  {profilesForYouStep.map((p, i) => (
                    <EditableProfileRow
                      key={p.id ?? i}
                      profile={p}
                      usedNames={profilesForYouStep.filter((o) => o.id !== p.id).map((o) => o.name)}
                      onRenamed={handleRenamed}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Profile creation form */}
            <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
              <p className="text-sm font-semibold text-foreground mb-3">
                {profilesForYouStep.length === 0 ? "Add your first family member" : "Add another person"}
              </p>
              <ProfileForm
                onAdded={handleAdded}
                usedNames={profilesForYouStep.map((p) => p.name)}
                defaultName={
                  !usesRealProfiles && profilesForYouStep.length === 0
                    ? ((user as any)?.displayName || user?.firstName || "")
                    : ""
                }
                defaultRole={forJoiner && myInviteRole === "child" ? "child" : "adult"}
              />
            </div>

            {/* Continue button — only shown once at least 1 profile exists */}
            {profilesForYouStep.length > 0 && (
              <Button size="lg" className="w-full" onClick={() => navigateTo("you")}>
                {usesRealProfiles
                  ? "Continue →"
                  : `Continue with ${profilesForYouStep.length} member${profilesForYouStep.length === 1 ? "" : "s"} →`}
              </Button>
            )}
          </div>
        )}

        {/* Step: Join */}
        {step === "join" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1">Join a family</h2>
              <p className="text-muted-foreground text-sm">
                Enter the 8-character code shared with you.
              </p>
              <p className="text-muted-foreground text-xs mt-2">
                No code? Ask whoever set up your family to send one from
                <strong className="text-foreground"> Settings → Sharing → Invite Someone</strong>.
              </p>
            </div>
            <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
              <JoinFamilyForm />
            </div>
          </div>
        )}

        {/* Step: Which one is you? */}
        {step === "you" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-1">Which one is you?</h2>
                <p className="text-muted-foreground text-sm">
                  Add a photo and email to your profile.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => skip("you", "location")} className="shrink-0 text-muted-foreground">
                Skip
              </Button>
            </div>
            <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
              <YouStep
                profiles={profilesForYouStep}
                onDone={() => goNext("you", "location")}
                onProfileAdded={handleAdded}
              />
            </div>
          </div>
        )}

        {/* Step: Location */}
        {step === "location" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" /> Your location
                </h2>
                <p className="text-muted-foreground text-sm">Optional. Sets your time zone.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => skip("location", afterLocationStep)} className="shrink-0 text-muted-foreground">
                Skip
              </Button>
            </div>
            <div className="p-4 bg-card border border-border rounded-2xl shadow-sm space-y-3">
              <LocationStep onDone={() => goNext("location", afterLocationStep)} />
              {/* Appears the moment a saved city resolves — the weather half
                  of "what is this for", shown instead of said. */}
              <LocationWeatherChip />
            </div>
          </div>
        )}

        {/* Step: Connect your calendars — added 2026-08-27 so a family
            actually gets a chance to connect Google/Outlook (and assign each
            calendar to the right person) during onboarding, instead of only
            discovering this is possible via Settings afterward. */}
        {step === "calendar" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" /> Connect your calendars
                </h2>
                <p className="text-muted-foreground text-sm">
                  Optional. Connect each person's Google or Outlook calendar — you can add more later.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => skip("calendar", afterCalendarStep)} className="shrink-0 text-muted-foreground">
                Skip
              </Button>
            </div>
            <CalendarConnectStep />
            <Button className="w-full" onClick={() => goNext("calendar", afterCalendarStep)} data-testid="onboarding-calendar-continue">
              Continue →
            </Button>
          </div>
        )}

        {/* Step: Rewards & Approvals */}
        {step === "rewards" && (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
                  <Gift className="w-5 h-5 text-primary" /> Rewards &amp; Approvals
                </h2>
                <p className="text-muted-foreground text-sm">
                  {rewardsPhase === "earning"
                    ? "A few quick questions about how stars work for your family. Nothing here is permanent — you can change any of it later in Settings."
                    : "Last one: set a Parent PIN so approving cash-out requests always needs you."}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => skip("rewards", "invite")}
                className="shrink-0 text-muted-foreground"
              >
                Skip
              </Button>
            </div>
            <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
              {rewardsPhase === "earning" ? (
                <RewardsSettingsSection wizard onWizardComplete={() => setRewardsPhase("pin")} />
              ) : (
                <ParentPinSettingsSection
                  lockPinIfSet
                  wizard
                  onWizardComplete={() => goNext("rewards", "invite")}
                />
              )}
            </div>
            {rewardsPhase === "pin" && (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => skipPinMutation.mutate()}
                  disabled={skipPinMutation.isPending}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                  data-testid="onboarding-skip-pin"
                >
                  {skipPinMutation.isPending ? "One sec…" : "I don't need a PIN right now →"}
                </button>
                <p className="text-xs text-muted-foreground text-center max-w-xs">
                  Plenty of families don't. You can add one later in Settings.
                </p>
                <button
                  type="button"
                  onClick={() => setRewardsPhase("earning")}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  ← Back to earning &amp; redemption
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step: Invite */}
        {step === "invite" && (
          <div className="space-y-6">
            {/* No separate header "Skip" here — InviteStep's own bottom button
                already reads "I'll do this later" before a code exists (the
                same skip action), and becomes "Continue →" once one's
                created. A second skip control up here would just duplicate
                it in the one state where both are visible. */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" /> Invite the rest of your family
              </h2>
            </div>
            <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
              <InviteStep onDone={() => goNext("invite", "tour")} onSkip={() => skip("invite", "tour")} />
            </div>
          </div>
        )}

        {/* Step: Quick Tour (animated feature tips) */}
        {step === "tour" && (
          <OnboardingTour onDone={() => goNext("tour", "done")} />
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="space-y-6 text-center">
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-10 h-10 text-green-500" strokeWidth={2.5} />
            </div>
            <div className="text-left">
              <h2 className="text-2xl font-bold text-foreground mb-1 text-center">You're all set!</h2>
              {/* Three of the four bullets described things the Quick Tour,
                  one step earlier, has just animated: switching person from
                  the family bar, checking off a chore, and where the gear
                  is. What's left is the one thing nothing demonstrates. */}
              <p className="text-muted-foreground text-sm text-center">
                Browse Settings when you have a minute — there's a lot there.
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={finish}>
              Get Started
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
