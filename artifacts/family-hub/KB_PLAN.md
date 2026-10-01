# Knowledge Base — Implementation Plan (v2, decisions locked)

Goal, in the user's words: **people should be able to solve their issues by
searching the KB, not just find information.** That drives how articles are
tagged (§2) and what gets written (§7).

Status: **plan approved in principle; phase 1 scope agreed.** Awaiting the
go-ahead to implement.

---

## 0. Clearing up one thing first — two separate pieces

These got conflated in the v1 review, and the distinction matters:

| | **Articles** | **Submitted questions** |
|---|---|---|
| What it is | The help content people read | Questions people send when they can't find an answer |
| Where it lives | **Code** — typed files in the repo, bundled into the app | **Database** — a small `kb_questions` table |
| Why there | Ships with the app, so it **works offline** and searches instantly | Nothing to do with offline; it's your backlog of what to write next |
| Who edits | You, by asking me in Code | Nobody edits these; they're just recorded |

**So both, and they do different jobs:**

- The **database does NOT give offline access.** It's the opposite — putting
  articles in a database is what would *break* offline. Articles stay in code
  *specifically so* the KB still opens and searches when the connection is bad,
  which is exactly when someone's troubleshooting a sync or notification problem.
- The **database is only for the questions people submit to you.** Its value is
  that you get a running list — and can see when three people ask the same thing,
  which tells you what article to write next. The email to you happens either way;
  the table just means you don't have to reconstruct the backlog from your inbox.

**And yes — you'd update articles by asking me in Code.** "Add an article about
X," or "the stars article is wrong, it should say Y." I edit the files, you
review the diff, it ships on the next deploy. No admin panel, no login roles,
no rich-text editor to secure.

⚠️ **The one real tradeoff, stated plainly:** article edits require a deploy.
You can't fix a typo from your phone at 9pm. For content that changes weekly
at most, that's a fair trade for everything in the table above — but it is a
genuine constraint, not a free lunch.

---

## 1. Architecture (decided)

1. **Articles as typed code**, bundled with the app → offline, instant search,
   no admin panel, no new auth surface, version-controlled in git.
2. **No in-app editing.** `users` has no admin/role column today; inventing one
   plus a guarded editor is real security surface for a KB with one author.
   You edit via me in Code.
3. **Client-side fuzzy search**, heavily weighted toward **tags** (§2).
4. **`kb_questions` table** for submissions ✅ *(confirmed)*.
5. **No AI-generated answers in v1.** Deterministic search over vetted articles
   is more trustworthy for troubleshooting, and works offline. An AI layer over
   the KB is a reasonable later addition, not the thing people depend on to fix
   a broken sync.

---

## 2. Article format — and how tagging works

**One `tags` array per article. Put anything in it.** ✅ *(per your request —
you're never limited to words that appear in the article text.)*

```ts
export interface KbArticle {
  id: string;              // stable slug
  title: string;
  category: KbCategory;
  type: "how-to" | "guidance" | "troubleshooting" | "concept";
  summary: string;         // one sentence, shown in results
  tags: string[];          // ← the free-form search vocabulary. See below.
  blocks: KbBlock[];
  related?: string[];
  updatedAt: string;
}
```

I collapsed v1's three overlapping fields (`symptoms` / `keywords` / `tags`)
into **one `tags` list**, because in practice the distinction was fuzzy and
three lists is three things to maintain. Everything goes in one place:

```ts
tags: [
  // what the feature is called
  "stars", "points", "rewards",
  // what users call it instead
  "allowance", "chore money", "pocket money",
  // the symptom, phrased how a frustrated person types it
  "stars didn't add up", "missing stars", "star count wrong",
  "kid says they earned more",
  // common misspellings
  "starz", "reward store",
]
```

Search boosts `title` and `tags` well above body text, so tags are the lever
that makes an article findable. **To make an article easier to find, tell me
what phrase someone used and I'll add it to that article's tags** — that's a
one-line change.

**Block types** (structured, not markdown — no parser dependency, no HTML
sanitization surface, and a malformed article is a build error rather than
something that ships broken):

```ts
type KbBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; steps: string[] }        // numbered walkthrough
  | { kind: "path"; path: string[] }          // renders: Settings › People › Add Person
  | { kind: "note"; tone: "info" | "warn"; text: string }
  | { kind: "faq"; items: { q: string; a: string }[] }
```

---

## 3. Where users find it

- **Primary:** a `?` help icon in the Settings header, left of the theme toggle
  (as suggested — that header already has the 44×44 touch-target pattern).
- **Public `/help` route** ✅ — someone who can't sign in currently has no path
  to help at all.
- **`/support`'s hardcoded FAQ gets replaced** with a link into the KB ✅ —
  otherwise two FAQs silently drift apart. The "email us" section stays.

---

## 4. Navigation — easy to leave, hard to leave *by accident*

Opens as a full-screen overlay **above** Settings, which stays mounted
underneath, so closing returns you exactly where you were.

- Always-visible **`← Back to Settings`** in the header.
- **Two-level back:** article → list → Settings. Never a surprise exit.
- **Click-outside does NOT dismiss** (`onInteractOutside` → `preventDefault`).
  This app has documented history of a nested dialog accidentally closing
  Settings, so this is deliberate.
- **Escape** closes one level.
- **Android back / iOS swipe-back** steps one level rather than exiting the app.
- List scroll position preserved when returning from an article.

---

## 5. "I can't find my answer" → email flow

**Trigger:** automatically when a search returns nothing, plus an always-present
*"Still stuck? Ask us"* footer link.

**What you receive at chadcgiles@gmail.com:**
- Their question
- **What they searched for before giving up** (often more revealing than the question)
- Their account email + name
- App version, platform (iOS native / web), and which tab they came from

**Replying to them:** the email sets **`Reply-To: <their email>`** — you just hit
Reply in Gmail and it reaches them. No messaging system needed. Requires a small
addition to `lib/email.ts` (Resend supports `reply_to`; we don't pass it today).

**They also get** a short "we got your question" confirmation ✅.

**Stored** in `kb_questions` ✅ — your write-next backlog + duplicate signal.
⚠️ Requires a DB migration.

**Guardrails:** rate-limited per account (5/hour), 2000-char cap, signed-in only.

---

## 6. Files

```
src/kb/
  types.ts            KbArticle / KbBlock
  index.ts            collects articles, asserts unique ids at build time
  search.ts           MiniSearch index + query + snippet highlighting
  articles/*.ts       one file per category
src/components/kb/
  kb-panel.tsx        overlay shell: search + browse + results
  kb-article-view.tsx block renderer, related links
  kb-ask-form.tsx     can't-find-it form
src/pages/help.tsx    public /help route
api-server/src/routes/kb.ts   POST /api/kb/questions
```

Changed: `settings-modal.tsx` (help button), `App.tsx` (`/help`),
`support.tsx` (FAQ → KB), `lib/email.ts` (`reply_to`), schema (`kb_questions`).

**Search library:** MiniSearch (~7 KB gz, pure JS, Capacitor-safe). Compatibility
verified at implementation time against Capacitor 8, same as every dependency
added to this project. Fallback: hand-rolled scorer (viable at ~100 articles,
just without free typo tolerance).

**Bundle:** KB chunk lazy-loaded so it costs nothing at app start.

---

## 7. Article types — including the one v1 missed

Your examples ("how many stars *should* a chore be worth", "why do I need a
PIN?") aren't documentation — they're **advice**. v1 didn't plan for that, and
it's arguably the most valuable kind, because nothing in the UI answers it.
So there are now four types:

| Type | Answers | Example |
|---|---|---|
| **how-to** | "where do I click" | Switching redemption modes |
| **guidance** | "what *should* I do" | How many stars a chore should be worth |
| **concept** | "how does this work" | How streaks work |
| **troubleshooting** | "why is this broken" | A chore I checked off came back |

Guidance articles give an actual opinion with a starting point — e.g. *quick
job 1 star, medium 3, big 6; then adjust so a week of chores buys roughly one
reward* — rather than "it depends."

---

## 8. Phase 1 — the 25 articles ✅

Covers every example you named, plus the highest-traffic basics.

**Getting started (4)**
1. Welcome to Family Hub — what it does and how it's organised · *concept*
2. Adding the people in your family · *how-to*
3. Family Members vs People — what's the difference? · *concept* ← known confusion point
4. Inviting your partner or a caregiver · *how-to*

**Stars & rewards (5)**
5. How stars work · *concept*
6. **Deciding how many stars a chore should be worth** · *guidance* ← your example
7. **Rewards only, cash-out only, or both — choosing a redemption mode** · *how-to + guidance* ← your example
8. Setting up your reward store · *how-to*
9. Approving (or declining) a cash-out request · *how-to*

**Parent PIN (2)**
10. **Why set a Parent PIN?** · *guidance* ← your example
11. Setting, changing, or resetting a forgotten PIN · *how-to*

**Chores & tasks (4)**
12. The five kinds of tasks and when to use each · *concept*
13. Creating your first chore · *how-to*
14. Chores on some days but not others · *how-to*
15. Bonus chores vs target-count chores — which do I want? · *guidance*

**Streaks (2)**
16. How streaks work · *concept*
17. **Streaks when chores aren't every day** · *how-to* ← your example
    *(covers per-person skip days — verified against `lib/streak.ts`: skip days
    are stepped over in both directions, so weekend-free chores don't break a streak)*

**Notifications (2)**
18. **Turning on push notifications** · *how-to* ← your example
19. I'm not getting notifications · *troubleshooting*

**Calendar (3)**
20. Connecting Google or Outlook Calendar · *how-to*
21. Choosing which calendars sync · *how-to*
22. **My events show up as a different family member's** · *troubleshooting* ← your example
    *(verified in `calendar3-view.tsx`: assignment resolves by a 4-step priority
    chain — explicit assignment → creator email → calendar assignment → falls
    back to whoever's calendar it arrived on. That last fallback is the usual
    cause, and the fix is an explicit "Assign to" on the calendar.)*

**Troubleshooting core (3)**
23. A chore I checked off came back · *troubleshooting*
24. My stars don't add up · *troubleshooting*
25. Events aren't appearing on the calendar · *troubleshooting*

**Sourcing:** written from `CLAUDE.md`, which documents actual root causes and
their remaining caveats — so troubleshooting articles can explain *why*, not
just "try again."

**After your review:** expand to ~110 articles across full feature coverage
(remaining calendar/sync, meals & groceries, notes, health reminders, sharing,
account, privacy/kids, mobile-app specifics, and the rest of troubleshooting).

---

## 9. Build order

1. Types, article schema, search, and the panel/article/ask-form UI
2. Entry points (Settings `?`, `/help`, `/support` link)
3. `kb_questions` table + `POST /api/kb/questions` + `reply_to` email support
4. The 25 articles
5. Verification: search finds each article by its tags (not just its title),
   navigation can't be exited accidentally, ask-form email delivers with a
   working Reply-To

⚠️ **Needs a DB migration** (`kb_questions`) — folds into the same
`pnpm --filter @workspace/db push` already pending.
