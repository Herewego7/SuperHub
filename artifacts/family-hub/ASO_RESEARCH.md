# ASO Keyword Research — Family Hub+ (US App Store)

Measured **2026-07-31** with the **Sonar** ASO tool, US storefront.
Source of the live listing copy this feeds: `APP_STORE_LISTING.md` (same folder).

> ## ⏭️ Open actions
>
> **1. ~~Re-pull the ~35 unmeasured terms~~ — done 2026-08-03.** See
> "2026-08-03 re-pull" below for the full results. One actionable change came
> out of it (`routine` → `stars` in the live keyword field, already applied to
> `APP_STORE_LISTING.md`); everything else held steady or resolved a prior
> open question with a negative answer (not worth chasing).
>
> **2. ~~Refresh the full dataset~~ — done 2026-08-06.** See "2026-08-06
> re-pull" below. One actionable change applied: `agenda` + `schedule` →
> `motivation` (both replaced by one stronger term, freeing 5 characters in
> the process). Everything else in the live listing held essentially flat —
> no other swap clears the bar.
>
> **3. ~~App Name change~~ — this was applied at some point between 08-03 and
> 08-06** (the live-config section below already showed it as current as of
> the 08-03 re-pull entry). No longer an open action.
>
> **4. Still optional, still low-priority: `single parent`.** Real volume (32)
> at low difficulty (45, gap -13) — unchanged since 07-31. Still not applied —
> narrower demographic fit than the app's core positioning. `motivation`
> (added 08-06) captures a similar-sized gap with almost double the raw
> popularity and no demographic-narrowing tradeoff, which is why it was
> chosen over this instead. This is the term to reach for if you ever want to
> deliberately trade positioning breadth for an early, low-difficulty win —
> see "Niche/low-volume terms — 2026-08-06" below for the full reasoning.
>
> **5. ~~Evaluate a "niche terms first" strategy~~ — answered 2026-08-06.**
> See "Niche/low-volume terms — 2026-08-06" below. Short version: floored
> terms mostly can't deliver the "build momentum, then compete for harder
> terms" effect, since App Store ranking rewards install/rating velocity, not
> accumulated keyword history. Added `praise` (best ratio + real feature
> match) into previously-unused budget as a free bonus pick; didn't chase
> more than that.

Re-run this research when: the app gains meaningful ratings/downloads (difficulty
scores are relative to your app's current strength), a major new feature ships,
or roughly every 6 months.

---

## How to read the numbers

| Column | Meaning |
|---|---|
| **Popularity** | Apple's search-volume index, **5–100**. Higher = more searches. |
| **Difficulty** | How hard it is to rank, 0–100. Higher = more/stronger competitors. |
| **Gap** | Popularity − Difficulty. Closer to 0 (or positive) = better opportunity. |

### ⚠️ `5 (48)` — the single most important thing to understand

A popularity of **`5` is Apple's floor value**, meaning *Apple reports this
keyword below its measurable range* — i.e. effectively **no search volume**.

The bracketed number is **Sonar's own estimate**, and per Sonar's own tooltip it
is only valid for **comparing keywords within that below-threshold band**. It is
**NOT on the same scale as a real popularity score.**

> `list 5 (62)` has **less** search volume than `tasks 58`.
> The 62 and the 58 are different scales. Do not compare them.

This is easy to get wrong and it inverted an entire round of recommendations
before the tooltip was found. **When in doubt: if it says 5, treat it as low
volume, no matter how big the bracket is.**

### ⚠️ Difficulty — chase hard terms, but chase them in the right field

An earlier version of this doc said *"a new app can't rank above difficulty
50–55, so weight difficulty heavily at launch and defer the head terms."*
**That was wrong and has been corrected.**

The better rule (per Sebastian of Habit Kit, ~$50K/mo across 4 apps):
**compete for a hard, high-value keyword over dominating an easy, low-volume
one.** Ranking #40 for something with real search volume beats ranking #1 for
something with none. Dominating `gift ideas` (in-band estimate 16) or
`allowance` (32) delivers approximately zero installs — both were removed from
the live keyword field for exactly this reason.

The nuance that makes this work: **the way you compete for a hard term is by
putting it in the App Name**, which is the highest-weighted indexed field — not
by burying it in the 100-character keyword field and hoping. That's why
`calendar` (pop 70, diff 73) belongs in the name, not the keyword list.

So: still *notice* difficulty, but let it break ties between terms of similar
volume rather than veto high-volume terms outright.

---

## 🔑 Headline finding: the app's own vocabulary is unsearchable

**Every core "chore" term is below Apple's measurable range:**

| Keyword | Popularity | Difficulty |
|---|---|---|
| `chores` | 5 (43) | 67 |
| `chore` | 5 (44) | 66 |
| `chores tracker` | 5 (25) | 71 |
| `chores list` | 5 (17) | 65 |
| `chore chart` | 5 (10) | 49 |
| `kids chores` | 5 (7) | 52 |
| `chores for kids` | 5 (7) | 47 |

Note the *phrases* score far lower even within the floored band (7–10) than the
bare word (43–44) — so "chore chart" is weak even relative to its own peers.

**Parents do not search the App Store for "chores."** They search for
**calendar, planner, to do list, home, tasks**.

### → The resulting strategy

**Rank on the organizing vocabulary. Convert on the chores-and-rewards story.**

Chores, stars, and rewards are the differentiator that wins the download *once
someone is on the page* — which makes them a **screenshots + description** job,
not a keyword-field job. Do not spend indexed characters (App Name, Subtitle,
Keywords) on chore terminology beyond what's needed for a human to understand
what the app is.

---

## Terms with real, measurable volume

**29** of the ~135 terms tested (across the original pull and both re-pulls)
cleared Apple's reporting threshold — the entire pool worth competing for.
⭐ = best value (real volume + beatable difficulty). Figures are the latest
(2026-08-06) reading; where a term moved meaningfully since the last check,
both are shown.

| Keyword | Pop | Diff | Gap | Notes |
|---|---|---|---|---|
| `countdown` | 69 (was 71) | 75 | −6 | ⭐ Highest volume found. Celebrations feature. **Used** (keywords). |
| `calendar` | 71 | 73 (was 75) | −2 | ⭐ Best head term, gap improved. **Used — in the App Name.** |
| `to do list` | 65 | 76 | −11 | **Used** — `to`+`do` from subtitle, `list` from keywords. |
| `home` | 62 | 81 | −19 | **Used** (keywords). Holding steady. |
| `habit tracker` | 59 | 67 | −8 | ⭐ Streaks feature. |
| `planner` | 59 | 72 | −13 | Used — combines to *meal planner* / *family planner* (via subtitle). |
| `tasks` | 58 | 71 | −13 | Used. Plural beats singular here. |
| `task` | 58 | 77 | −19 | Plural `tasks` is strictly better (lower difficulty). |
| `kids` | 56 | 81 (was 82) | −25 | Used — unlocks *kids chores* (52). Hard on its own. |
| `meal planner` | 55 | 62 (was 64) | −7 | ⭐ Note: `meal plan` is floored — the "-ner" matters. Gap improved. |
| `stars` | 55 | 78 | −23 | App's actual currency name. **Used (replaced `routine`)**. |
| `motivation` | **55** | **67** | **−12** | ⭐ **New 08-06.** Best unused gap in the set — pop actually *rose* since 07-31 (54→55) while diff held. **Now used — replaces `agenda`+`schedule`.** |
| `wishlist` | 54 | 60 | −6 | ⭐ Real shipped feature. Excellent value. |
| `earn money` | 54 | 81 | −27 | Too competitive; fintech apps own this. |
| `family` | 54 | 77 (was 74) | −23 | Already in App Name. |
| `to do` | 53 | 77 | −24 | `to do list` is better. |
| `grocery list` | 53 | 69 | −16 | Used. Bare `grocery` is floored. |
| `outlook calendar` | 51 | 84 | −33 | ⭐➡️⚠️ Unchanged since 08-03 — real volume, but tied for worst difficulty in the set. Still deferred. |
| `rewards` | 50 | 83 | −33 | Highest difficulty tier. Not winnable. |
| `schedule` | 50 | 73 (was 75) | −23 | **Dropped 08-06** — `motivation` beats it on every axis (higher pop, lower diff, better gap). |
| `clean` | 50 | 75 (was 79) | −25 | Poor topical fit. Skip. |
| `shared calendar` | 46 | 66 | −20 | ⭐ **Used — both words in the App Name.** |
| `pill reminder` | 45 | 56 | −11 | ⭐ **Best pop-to-difficulty ratio in the whole set.** |
| `agenda` | 45 | 71 (was 70) | −26 | **Dropped 08-06** — weakest gap of any keyword in active use; `motivation` replaces it. |
| `reward` | 42 | 78 (was 82) | −36 | Diff eased but still not competitive with what's used. |
| `single parent` | 32 | 45 | −13 | Unchanged since 07-31. Real volume, low difficulty. Still not applied — see "Open actions." |
| `shared calendar family planner` | 22 | 72 | −50 | Long-tail, poor ROI. |
| ~~`meal prep`~~ | ~~40~~ → floored | 73 → 74 | ~~−33~~ → −69 | **Collapsed 08-06**, same pattern as `routine`'s 08-03 collapse. Never used (the app indexes `meal planner`, the stronger form) — no action needed, logged for the record. |
| ~~`routine`~~ | ~~44~~ → floored | 67 | ~~−23~~ → −62 | Collapsed 08-03, still floored 08-06 — confirmed not a blip. |

### Phrase form matters enormously

The strongest single lesson from this dataset — small wording changes swing
volume by an order of magnitude:

| Weak form | Strong form |
|---|---|
| `meal plan` — 5 (49), diff 69 | **`meal planner` — 54, diff 62** |
| `grocery` — 5 (59), diff 76 | **`grocery list` — 52, diff 70** |
| `medication reminder` — 5 (18), diff 64 | **`pill reminder` — 45, diff 56** |
| `daily habit` — 5 (29), diff 74 | **`habit tracker` — 59, diff 67** |
| `to do` — 53, diff 77 | **`to do list` — 65, diff 76** |
| `kid` — 5 (71), diff 84 | **`kids` — 56, diff 82** |
| `task` — 55, diff 77 | **`tasks` — 58, diff 71** |

---

## Below-threshold terms (popularity 5), sorted by difficulty

Low volume, but cheap. Useful for long-tail combinations that ride on words you
are already indexing for free. Bracketed = Sonar's within-band estimate (only
comparable to each other).

⚠️ **Do not build the keyword field out of this table.** Low difficulty here is
seductive, but these terms sit below Apple's measurable range — winning them
returns almost nothing. See the difficulty note near the top.

| Keyword | Est. | Diff | | Keyword | Est. | Diff |
|---|---|---|---|---|---|---|
| `gift ideas` | (16) | **22** | | `chores and allowance` | (14) | 56 |
| `allowance tracker` | (21) | **27** | | `bedtime` | (37) | 56 |
| `kids chores & earnings tracker` | (5) | **27** | | `discipline` | (35) | 56 |
| `chores and allowance bot` | (5) | 29 | | `family hub` | (38) | 57 |
| `piggy bank` | (24) | 32 | | `family meals` | (13) | 58 |
| `positive reinforcement` | (5) | 34 | | `birthday tracker` | (16) | 58 |
| `sticker chart` | (5) | 36 | | `consistency` | (16) | 58 |
| `family hub - family organizer` | (6) | 36 | | `kids chores - chore tracker` | (12) | 59 |
| `behavior chart` | (5) | 37 | | `parenting app` | (15) | 60 |
| `household` | (26) | 39 | | `medication reminder` | (18) | 64 |
| `custody schedule` | (5) | 40 | | `chores list` | (17) | 65 |
| `birthday reminder` | (33) | 41 | | `chore` | (44) | 66 |
| `dashboard` | (41) | 43 | | `affirmations` | (51) | 66 |
| `co-parenting` | (14) | 44 | | `chores` | (43) | 67 |
| `checklist` | (36) | 45 | | `devotional` | (47) | 67 |
| `streak` | (34) | 46 | | `chart` | (48) | 68 |
| `allowance` | (32) | 47 | | `gift list` | (23) | 68 |
| `chores for kids` | (7) | 47 | | `meal plan` | (49) | 69 |
| `custody calendar` | (14) | 48 | | `chores tracker` | (25) | 71 |
| `chore chart` | (10) | 49 | | `day planner` | (22) | 72 |
| `chores and allowance tracker app` | (6) | 51 | | `savings` | (31) | 72 |
| `anniversary` | (29) | 51 | | `kids money` | (28) | 73 |
| `kids chores` | (7) | 52 | | `health tracker` | (30) | 73 |
| `appointment reminder` | (13) | 55 | | `organizer` | (29) | 73 |
| `daily habit` | (29) | 74 | | `recipes` | (51) | 75 |
| `star chart` | (31) | 77 | | `grocery` | (59) | 76 |
| `list` | (62) | 77 | | `kid` | (71) | 84 |

**Competitor-sourced:** `shared calendars for families` — 5 (23), diff 74. A
rival is actively targeting this. Per the data it's poor ROI (high difficulty,
no measurable volume) — let them spend the effort.

---

## 2026-08-03 re-pull — the ~35 unmeasured terms, resolved

Every term that returned no data on 2026-07-31 has now been measured. Results
below, organized by what changed.

### The one actionable change: `routine` collapsed, `stars` filled the gap

| Keyword | 07-31 | 08-03 | Verdict |
|---|---|---|---|
| `routine` | 44 / 67 / **−23** | floored (5, est. 50) / 67 / **−62** | Cratered — dropped from a keeper to one of the weakest words in the live string. |
| `stars` | not yet measured | **55 / 78 / −23** | New — real volume, and it's the app's actual in-app currency name. |

`stars` landed at almost exactly the gap `routine` used to have. **Swapped in
`APP_STORE_LISTING.md`** (routine out, stars in) — see "Current live
configuration" below for the resulting string. This is a good reminder that
Sonar's numbers move over time; the "re-run every ~6 months" cadence at the
top of this file exists for exactly this kind of drift.

### Resolved negative: calendar-sync terms have no real volume

`sync calendar`, `google calendar sync`, `ical` are all floored. The one
exception is `outlook calendar` — genuinely real volume (**51**) — but its
difficulty (**84**) is among the worst in the entire dataset, so it stays
deferred alongside `calendar`/`countdown`/`home` until the app has ratings.
Not worth building keyword strategy around calendar-sync vocabulary.

### Resolved negative: none of the "differentiator" terms have real volume

Every term hypothesized as a possible differentiator advantage (nothing else
in the category targets these) came back floored: `celebrations`, `family
notes`, `family announcements`, `family board`, `family messages`, `shoutout`,
`praise`, `behavior tracker`, `behavior chart`, `consequences`, `discipline`,
`time out`, `gamify`, `incentive`, `kid profile`, `parenting app`, `family
tablet app`, `kitchen tablet`, `fridge calendar`, `bible verse app`, `family
devotional`, `coordinator`, `money app for kids`, `weekly menu`, `chart for
kids`, `fridge chart`, `multiple kids`, `parent app`, `family scheduling app`.
This confirms the core finding harder than the first pass did: **being unique
in the App Store doesn't mean anyone searches for that uniqueness.** These stay
exactly what they always were — real, worthwhile features and strong
conversion material for screenshots/description — just not keyword-field
material. (Convenient timing on the Behavior Board terms specifically, given
that feature is likely being removed.)

### A genuine surprise, not yet acted on

`single parent` — pop **32** (real, not floored), diff **45** (low) — gap
**−13**, one of the better gaps in the whole dataset and startlingly better
than the entire `co-parenting`/`custody` cluster around it (`co-parenting`,
`co-parenting app`, `custody calendar`, `custody schedule`, `shared custody
schedule` — all floored). A real, underserved niche with an easier path than
expected. **Not applied** — narrower demographic fit than the app's core
positioning, and replacing a solid word like `agenda` for it is a marginal
call, not a clear win. Flagged in case a future revision wants it.

### Everything else: stable, no action needed

`calendar` (71/75), `countdown` (71/74), `habit tracker` (59/67), `wishlist`
(54/60), `pill reminder` (45/56), `meal planner` (55/64), `grocery list`
(53/69), `shared calendar` (46/66), `to do list` (65/76), `kids` (56/82),
`tasks` (58/71), `schedule` (50/75) — all within noise of the 07-31 numbers.
None of the App Name/Subtitle reasoning built on these needs revisiting.

---

## 2026-08-06 re-pull — full dataset refresh, one clean swap

A user-run Sonar screenshot covering the whole ~135-term list (all five
screenshots cross-checked term-by-term against the 08-03 figures above).

### The one actionable change: `agenda` + `schedule` → `motivation`

`motivation` was flagged back on 07-31 (54/67/−13) but held back for "weak
topical fit." Re-measured 08-06 at **55/67/−12** — pop held (even ticked up
slightly) while every currently-used standalone keyword either held flat or
got *harder*. Result: `motivation` now has the **best gap of any unused term
in the dataset**, and it beats both `agenda` (45/71/−26) and `schedule`
(50/73/−23) — the two weakest standalone words in the live keyword field —
**on every axis at once** (higher pop, lower difficulty, better gap than
either one individually). There's no scenario in this data where keeping
either of them over `motivation` is the better bet.

Revisiting the "topical fit" concern that held it back before: the app's own
star/streak/achievement system is a motivation mechanic in substance, so this
isn't a stretch — and Apple's keyword-field review is about spam/competitor-name
abuse, not topical narrowness, so this isn't an App Review risk.

Dropping *both* `agenda` and `schedule` for the *one* replacement word also
frees 5 characters (97 → 92 used of 100) — intentionally left unused rather
than force-filled; nothing else in this pull cleared the bar (see below).

```
Before: list,tasks,habit,tracker,wishlist,pill,reminder,grocery,countdown,home,stars,kids,schedule,agenda   (97 chars)
After:  list,tasks,habit,tracker,wishlist,pill,reminder,grocery,countdown,home,stars,kids,motivation        (92 chars)
```

**Applied to `APP_STORE_LISTING.md`.** ⚠️ Unlike Promotional Text, the
Keywords field is **not** exempt from App Review — a build/version update is
needed for this to take effect once the app is actually live. Free to change
now since nothing has shipped to the App Store yet.

### Everything else in active use: flat to slightly better, no other action

Every keyword already in the App Name, Subtitle, or Keywords field held
steady or *improved* this pull — nothing currently in use got worse enough to
warrant swapping out: `calendar` (75→73 diff, gap −4→−2), `countdown` (71→69
pop, gap −3→−6, still tiny), `meal planner` (64→62 diff, gap −9→−7), `home`,
`habit tracker`, `wishlist`, `pill reminder`, `grocery list`, `shared
calendar`, `to do list`, `tasks`, `kids`, `stars` all within noise.

### Two data-drift notes, no action needed

- **`meal prep` collapsed to floored** (was real volume 40, now 5/est. 25) —
  the same pattern `routine` showed on 08-03. Never used in the live listing
  (the app already indexes the stronger form `meal planner`), so this is
  logged for the record only, not a change.
- **Difficulty scores drifted broadly downward across dozens of already-floored
  terms** this pull (e.g. `chart` 68→58, `consistency` 58→42, `medication
  reminder` 64→58) — popularity stayed floored on every one of them, so none
  of this is actionable; a lower difficulty score on a term with no search
  volume is still worth roughly zero installs. Mentioned so a future reader
  doesn't mistake a difficulty drop alone for an opportunity — check
  popularity first, every time.

### Confirmed unchanged: the two standing "not yet applied" calls

- **`outlook calendar`** (51/84/−33) — identical to 08-03. Real volume, worst
  difficulty in the set. Still correctly deferred until the app has ratings.
- **`single parent`** (32/45/−13) — identical to 08-03. Still a legitimate
  gap, still not applied — `motivation` (added this round) covers a
  similarly-good gap with far higher raw popularity and none of the
  narrower-demographic-fit tradeoff, which is the more direct reason to reach
  for it first.

### Niche/low-volume terms — 2026-08-06

User question: could deliberately targeting a batch of low-volume-but-easy
terms (the floored `5 (XX)` ones) work as a "build early traction, then
compete for harder terms later" strategy?

**Mechanically, this mostly doesn't transfer the way it does for content
SEO.** A popularity of `5` means Apple's own tool can't distinguish that
query from noise — not "low volume," but "no reliably measurable volume."
The App Store's ranking algorithm rewards *recent install/rating velocity*,
not accumulated keyword history the way a domain builds SEO trust over time.
So ranking #1 for a truly zero-volume term doesn't generate the trickle of
installs/reviews needed to bootstrap that velocity — there's no traffic there
to convert in the first place. Stuffing the keyword field with many floored
terms is unlikely to move the needle.

**The one term in this whole dataset that actually fits the strategy as
described is `single parent`** — 32 popularity (**confirmed, not a floored
estimate**), 45 difficulty, gap −13. Real, if modest, measurable volume at
genuinely low difficulty is exactly the profile worth grabbing an early win
on. It's not currently used — held back only because it's a narrower
demographic fit than the app's core positioning (see the 08-03 section
above), not because the numbers are weak. If the strategy above is something
to lean into for real, this is the lever, not a batch of floored terms.

**For the floored terms themselves**, ranked by estimate-to-difficulty ratio
among the ones with decent real-feature fit:

| Keyword | Est. | Diff | Fit |
|---|---|---|---|
| `praise` | (17) | **17** | Best ratio measured. Matches the "Give praise" feature directly. |
| `shoutout` | (24) | 27 | Matches the Recent Shoutouts feature directly. |
| `streak` | (34) | 46 | Matches the streaks feature; bigger estimate, pricier difficulty. |
| `checklist` | (35) | 43 | Generic fit (chores/to-dos), decent ratio. |

**Added `praise`** (best ratio + exact feature match) into the 8 characters
that were otherwise sitting unused — pure bonus, displaces nothing already
in the field. Left `shoutout`/`streak`/`checklist` out: only 1 character of
budget remains after adding `praise`, and none of them are strong enough on
their own to justify displacing a real-volume term to make more room.

---

## How to use the three indexed fields

Apple indexes **App Name + Subtitle as one combined string**, and combines
words across all three fields when matching queries. Each field has a job:

| Field | Limit | Job |
|---|---|---|
| **App Name** | 30 | **Highest-weighted field.** Primary keyword FIRST, brand second. |
| **Subtitle** | 30 | Secondary keywords. No word repeated from the name. |
| **Keywords** | 100 | Everything else. No repeats from name/subtitle. Hidden from users. |

**Primary keyword goes in the name, not the keyword field.** This is the single
biggest lever and the easiest to get wrong — the instinct is to name the app
after the brand. Indie apps generally can't afford that; only established
brands (Duolingo) can lead with brand alone. The reference pattern is Habit
Kit, which ships as **"Habit Tracker - Habit Kit"**.

Concretely for this app: `family hub` measures **5 (38)** — below Apple's
measurable range — so a name of just "Family Hub+" spent the most valuable
field in the store on a term nobody searches, and left 19 of 30 characters
empty. Fixed by leading with `Shared Calendar`.

**Keyword-field rules** (each one costs characters if broken): comma-separated,
no spaces, no repeats from name/subtitle, no plural of a singular already used
(Apple stems them), no competitor app names (rejection risk), and use the full
100 characters.

---

## Current live configuration

Kept in sync with `APP_STORE_LISTING.md` — **that file is the source of truth**
for what to paste into App Store Connect.

| Field | Value | Chars |
|---|---|---|
| App Name | `Shared Calendar - Family Hub+` | 29 |
| Subtitle | `Chores, Meal Planner & To Do` | 28 |
| Keywords | `list,tasks,habit,tracker,wishlist,pill,reminder,grocery,countdown,home,stars,kids,motivation,praise` | 99 |

Verified: **zero token overlap** across the three fields, so no indexed
character is spent twice.

Indexed coverage this produces — `shared`, `calendar`, `family`, `hub`,
`chores`, `meal`, `planner`, `to`, `do`, `list`, `tasks`, `habit`, `tracker`,
`wishlist`, `pill`, `reminder`, `grocery`, `countdown`, `home`, `stars`,
`kids`, `motivation`, `praise` — which combines to reach `shared calendar`,
`meal planner`, `to do list`, `grocery list`, `habit tracker`, `pill reminder`,
`family planner`, `kids chores`, and `countdown` among others.

**History:**
- `routine` → `stars`, 2026-08-03: `routine`'s popularity had collapsed to
  floored while `stars` (the app's actual in-app currency name) came in at a
  comparable gap.
- `agenda` + `schedule` → `motivation`, 2026-08-06: both replaced by the one
  stronger term.
- `praise` added, 2026-08-06: a floored term (5, est. 17) with the best
  estimate-to-difficulty ratio (17/17) of anything measured, matching the
  real "Give praise" feature. Added into the leftover free budget — displaces
  nothing. See "Niche/low-volume terms — 2026-08-06" below for the full
  reasoning, including why floored terms in general are a weak vehicle for a
  "build momentum on easy terms first" strategy, and why `single parent`
  (real volume, not floored) is the better lever for that specific goal if
  ever wanted. 1 character currently unused (99/100).

### Superseded drafts (kept so the reasoning isn't re-litigated)

- **Name `Family Hub+`** (11 chars) — brand-only, on an unmeasurable term.
  Replaced once the "primary keyword in the name" rule was applied.
- **Subtitle `Calendar, chores & meal plans`** — fine in isolation, but
  `calendar` moved up into the App Name, so repeating it here would have been
  wasted budget.
- **Keywords `wishlist,pill,reminder,habit,tracker,planner,shared,grocery,list,tasks,routine,kids,allowance,gift`**
  — built under the since-corrected "avoid high difficulty" rule. `allowance`
  and `gift` were chosen for low difficulty despite below-threshold volume;
  both dropped. `countdown` (pop 71) and `home` (62) had been wrongly deferred
  and are now included.

---

## Competitive landscape (2026-07)

**Direct — all-in-one family organizers:**
- **Cozi** — category leader. Shared calendar, lists, basic chores. Weakness to
  position against: since 2024 the free tier only shows a 30-day agenda view;
  real calendar views are paywalled.
- **FamilyWall** — calendar + messaging + location + photos + meals. Broader but
  cluttered. **Same owner as Cozi since 2024** (In Tandem, which also owns
  OurFamilyWizard).
- **Picniic** — calendar, meals, groceries, document storage.

**Direct — chore/reward specialists:**
- **OurHome** — free, chore-focused with points/rewards, but **no calendar**.
  Family Hub+ combining both is a genuine differentiator.
- **S'moresUp** — chores + allowance + AI task suggestions + family chat.
- **Greenlight / RoosterMoney / BusyKid** — chore-to-real-money with debit cards.
  Overlaps the wallet/cash-out feature; they own the "kids money" search space.
- **ChoreMonster** (defunct since 2018) and **iRewardChart** (very limited free
  tier) — explain why "chore chart" is established vocabulary despite low volume.

**Adjacent, not direct:** Life360 (location/safety), Google Family Link
(device controls).

**Naming:** "Family Hub" alone is taken several times over on the App Store —
including Samsung's own Family Hub (refrigerators), which is why the app is
registered as **Family Hub+**. Notably `family hub` itself measures 5 (38), so
losing the exact-match name costs essentially nothing in search terms.

⚠️ **Source caution:** many "best chore app 2026" roundups are published by blogs
that share a name with the app they rank #1 (Homsy, Maple, Pistachio, Nori,
Kikaroo, PointUp, KidKarma) — a programmatic-SEO pattern. Those are real, live
App Store apps, but treat them as small new entrants, not established
competitors on Cozi/FamilyWall's level.
