# App Store Connect — Listing Copy (Family Hub)

Ready-to-paste metadata for the App Store Connect listing. Character limits are
from Apple's 2026 fields (see `/CLAUDE.md`). Counts below are approximate —
**re-verify the count in App Store Connect**, which is the source of truth, before
saving. Fields marked *(search-indexed)* affect discoverability; front-load the
most important words.

---

## App Name — *(search-indexed, ≤ 30 chars — the HIGHEST-weighted field)*

```
Shared Calendar - Family Hub+
```
*(29 chars)*

**Keyword first, brand second.** This is the single most valuable field Apple
indexes, so it must not be spent on brand alone — `family hub` measures 5 (38),
i.e. *below Apple's measurable range*, so a name of just "Family Hub+" points
the app's strongest real estate at a term nobody searches and leaves 19
characters unused.

This wording captures `shared calendar` (pop 46 / diff 66) **and** `calendar`
(pop 70 — the highest-volume term available), while keeping the brand intact.

> Rejected: `Family Calendar - Family Hub+` (also 29 chars). "Family" appears
> twice; Apple indexes it once, so the repeat wastes ~7 characters.

⚠️ Changing this is a **product decision, not just an ASO tweak** — it changes
how the app presents everywhere. If `Family Hub+` is already registered in App
Store Connect this is an edit (fine pre-release, or with a version update).
("Family Hub" alone was already taken on the App Store, hence the `+`.)

## Subtitle — *(search-indexed, ≤ 30 chars)*

```
Chores, Meal Planner & To Do
```
*(28 chars)*

Secondary keywords only — Apple treats **App Name + Subtitle as one combined
indexed string**, so nothing here may repeat a word from the name. Carries
`meal planner` (54/62) and, combined with `list` from the keyword field,
`to do list` (65). `chores` stays for human clarity (see the strategy note
below — it earns its place by explaining the app, not by search volume).

## Keywords — *(search-indexed, ≤ 100 chars total, comma-separated, no spaces)*

```
list,tasks,habit,tracker,wishlist,pill,reminder,grocery,countdown,home,stars,kids,motivation,praise
```
*(99 chars — verify the count in App Store Connect before saving)*

⚠️ **`agenda` + `schedule` were swapped for `motivation` on 2026-08-06.** A
full re-pull of the Sonar data (all ~135 terms) showed `motivation` at
55/67/−12 — the best gap of any *unused* term in the whole set, beating both
`agenda` (45/71/−26) and `schedule` (50/73/−23) on every axis at once (higher
popularity, lower difficulty, better gap than either individually). Dropping
both of them for the one stronger word also freed 5 characters (97→92).
Before that, `routine` was swapped for `stars` on 2026-08-03 — its popularity
had collapsed from a measured 44 down to floored (~5). See
`ASO_RESEARCH.md`'s "2026-08-06 re-pull" section for the full before/after.

⚠️ **`praise` added 2026-08-06 as a deliberate low-volume, low-risk pick.**
Its popularity is *floored* (Apple can't measure meaningful query volume for
it) — its bracketed estimate `5 (17)` is only comparable to other floored
terms, not to the real-volume terms above it. It was added anyway because it
has the best estimate-to-difficulty ratio of any floored term measured
(17/17), it matches a real shipped feature ("Give praise"), and it fit
entirely inside the 8 characters that were otherwise sitting unused — it
displaces nothing. Treat it as a free bonus pick, not a strategy: floored
terms in general can't reliably deliver the "rank easy, build momentum, then
compete for harder terms" effect, because the App Store's ranking algorithm
rewards recent install/rating velocity, not accumulated keyword history the
way SEO content compounds — and a term with ~0 measurable search volume can't
generate the traffic needed to build that velocity in the first place. The
one term in this dataset that *actually* fits the "real momentum, low
difficulty" pattern is `single parent` (32 popularity — confirmed, not a
floored estimate — at 45 difficulty, gap −13): not currently used, held back
so far only because it's a narrower demographic fit than the app's core
positioning, not because the numbers are weak. See `ASO_RESEARCH.md` if a
future revision wants to reconsider it.

Rules applied here (all of them cost you characters if broken):
- **No repeats** of any word in the App Name or Subtitle — Apple already
  indexes those and combines across all three fields. Already covered for
  free: `shared`, `calendar`, `family`, `hub`, `chores`, `meal`, `planner`,
  `to`, `do`.
- **No spaces** after commas.
- **No plurals of a singular you already used** (Apple stems them) — pick one
  form and let the indexer match both.
- **No competitor app names** — risks rejection.
- **Use the full 100 characters where it's earned.** 99 here — 1 unused since
  nothing left worth adding fit in that budget; don't force-fill with filler.

Cross-field combinations this unlocks: *to do list* (65), *grocery list*
(53/69), *habit tracker* (59/67), *pill reminder* (45/56), *meal planner*
(55/62), *shared calendar* (46/66), *family planner*, *kids chores*,
*home screen/homework*-adjacent traffic, *countdown*.

### ⚠️ Keyword strategy — read before changing any of the above

Full data and methodology: **`ASO_RESEARCH.md`** in this folder.

Two things drive every choice above, and both are counterintuitive:

**1. The app's own core vocabulary has no measurable search volume.**
`chores` (5), `chore` (5), `chore chart` (5), `kids chores` (5) and every
related phrase sit *below Apple's reporting threshold*. Parents do not search
the App Store for "chores" — they search **calendar, planner, to do list,
home, tasks**. So: **rank on the organizing vocabulary, convert on the chores
and rewards story.** Chores/stars/rewards win the download once someone is on
the page, which makes them a screenshots-and-description job, not a
keyword-field job.

**2. Chase hard, high-value keywords — not easy, low-volume ones.**
Ranking #40 for a term with real volume beats ranking #1 for a term with none.
Dominating `gift ideas` (in-band estimate 16) or `allowance` (32) delivers
essentially zero installs, which is why both were **removed** from an earlier
draft of this file. The way you *compete* for a hard term like `calendar`
(diff 73) is by putting it in the **App Name**, the highest-weighted field —
not by burying it in the keyword field.

## Promotional Text — *(NOT indexed, ≤ 170 chars, editable anytime without review)*

```
One shared calendar, meal planner, and chore tracker for the whole family — so everyone finally stays on the same page.
```
*(~118 chars)*

## Description — *(NOT indexed, ≤ 4,000 chars)*

```
Family Hub+ is the calm, all-in-one home base for busy households. One shared calendar, one meal plan, one grocery list, and a chore system that finally gets everyone helping — without the nagging.

ONE CALENDAR EVERYONE CAN SEE
• Shared family calendar with two-way Google Calendar and Outlook sync
• Subscribe to school, sports, and church calendars by iCal link
• Colour-coded by person, so you can see whose day is packed at a glance
• Choose exactly which calendars sync — keep work off the family view
• Pop-up reminders 15 minutes before anything starts

MEALS AND GROCERIES, SORTED
• Plan the week's meals on a simple drag-and-drop board
• Browse a built-in library of meal ideas, or save your own
• Ingredients flow straight into a grocery list grouped by aisle
• Keep a list of the staples you buy every week

CHORES AND REWARDS THAT ACTUALLY WORK
• Assign chores, to-dos, and routines to each person
• Kids earn stars for finishing tasks — with satisfying haptics and streaks
• Bonus chores for extra help on busy days
• A reward store you control: kids spend stars on rewards you set, or cash out real money with your approval
• Trophies and milestones for the long haul

NOTHING SLIPS THROUGH
• Medication, appointment, and bedtime reminders
• Birthday and anniversary countdowns, with gift ideas and photos
• A family notes board for announcements everyone should see
• Daily affirmations, Bible verses, and memory verses

BUILT FOR FAMILIES, PRIVATE BY DESIGN
• Separate grown-up and kid profiles, with a Parent PIN on the settings that matter
• Child profiles include a parental-consent step before any data is recorded
• Manage, edit, and delete profiles — and your whole account — right in Settings
• Clear in-app privacy policy; we collect only what the app needs to work
• No ads. No third-party tracking. Ever.

Whether you're coordinating five schedules or teaching your first-grader the value of finishing what they started, Family Hub+ turns daily chaos into a simple, shared routine the whole family can rely on.

Questions or feedback? We'd love to hear from you — reach us any time from Settings → Support.
```
*(~2,100 chars — under the 4,000 limit; expand with testimonials/FAQ later)*

> The description is **not** search-indexed, so it is written purely for
> conversion. It deliberately leads with calendar/meals/groceries (what people
> searched for to get here) and then sells chores/stars/rewards (what makes
> them tap Get). Keep it in sync with shipped features — see `/CLAUDE.md`.

## What's New — *(NOT indexed, ≤ 4,000 chars; per-version)*

```
• Snooze the announcements banner for 60 minutes, 2 hours, or a day
• Affirmations, Bible verses, and memory verses now open in a tap-to-read card before you mark them complete — the same on Home and Tasks
• Haptic feedback when you finish a chore or earn a reward
• Reminders now arrive as native notifications
• Performance and reliability improvements
```

---

## App Review Notes (Review Information → Notes)

```
Family Hub is a household management app (calendar, chores, rewards, reminders).

TEST ACCOUNT
  Email:    <create a demo account and paste credentials here>
  Password: <…>
The account is pre-populated with two parent profiles and two child profiles so
all features are visible immediately.

HOW TO REVIEW
1. Sign in with the test account above (Sign in button on the landing screen).
2. Home tab: view the family calendar, daily affirmation/Bible verse (tap a card
   to read it, then mark complete), and the announcements banner (tap the bell to
   snooze).
3. Tasks tab: complete a chore for a child profile to see points awarded and
   haptic feedback; open the reward store and redeem points.
4. Settings: create a child profile — note the parental-consent gate that appears
   before the profile is saved (COPPA compliance). Account and profile deletion
   are both available here (Guideline 5.1.1).
5. Notifications: Settings → Notifications enables push/local reminders.

NOTES FOR REVIEW
• Child profiles require explicit parental consent before any data is recorded;
  consent is stamped server-side, not by the client.
• Account deletion (DELETE) and individual profile deletion are both in Settings.
• Calendar sync uses the user's own Google account via OAuth (optional).
```

## Required URLs

| Field | Value |
|---|---|
| Privacy Policy URL | `https://<your-domain>/privacy` (also in-app at `/privacy`) |
| Support URL | `https://<your-domain>/support` *(must be public, no login)* |
| Marketing URL (optional) | `https://<your-domain>` |

> The in-app privacy policy already lives at `/privacy` (route `src/pages/privacy.tsx`).
> Make sure the same content is reachable at a public web URL for the listing.

## Privacy Nutrition Labels (App Privacy section)

Declare every data type the app collects. For Family Hub, based on current
features (see `/CLAUDE.md` for the authoritative list):

| Data type | Collected? | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact Info (profile names, emails) | Yes | Yes | No | App Functionality |
| Health & Fitness (med/appointment reminders) | Yes | Yes | No | App Functionality |
| User Content (tasks, notes, announcements) | Yes | Yes | No | App Functionality |
| Identifiers (user/profile IDs) | Yes | Yes | No | App Functionality |
| Usage Data (chore completions, calendar events) | Yes | Yes | No | App Functionality |

> **No third-party tracking or advertising.** If the Kids Category is chosen,
> third-party analytics must be removed entirely (see `/CLAUDE.md`).

## Age Rating Questionnaire — guidance

Answer truthfully. Family Hub has **no** mature content, gambling, or unrestricted
web access, so it should land at **4+**. The reward "store" spends in-app points
(not real money) and is **not** gambling. If StoreKit subscriptions are added
later, re-answer the in-app-purchase questions.

## Screenshots (upload separately — not text)

Required sizes (2026): iPhone **1320 × 2868** (6.9" Pro Max, mandatory), iPad
**2064 × 2752** (13", if iPad supported). First 3 captions are OCR-indexed —
so they carry the *measurable* search terms; later captions carry the
conversion story (chores, stars, rewards), which is where that message
actually belongs (see the strategy note under Keywords).

1. "One shared calendar for the whole family"
2. "Meal planner and grocery list in one place"
3. "Habit tracker, streaks & daily routines"
4. "Chores, stars & rewards kids actually finish"
5. "Pill, appointment & bedtime reminders"
6. "Private by design — parental consent built in"
