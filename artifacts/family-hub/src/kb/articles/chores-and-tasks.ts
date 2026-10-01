import type { KbArticle } from "../types";

export const choresAndTasksArticles: KbArticle[] = [
  {
    id: "five-kinds-of-tasks",
    title: "The five kinds of tasks and when to use each",
    category: "chores-and-tasks",
    type: "concept",
    summary: "Chore, Target chore, Bonus chore, To-do, and Inspiration — what each one is for.",
    tags: [
      "task types", "kinds of chores", "chore vs to-do", "what is a target chore",
      "what is a bonus chore", "types of tasks", "which kind of task",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "The app has five kinds of task. They look similar but solve different problems. Tap the + button, then Create a chore — the picker offers Chore, Target chore, Bonus chore and Inspiration. To-dos have their own entry: + → Add a to-do (or the To-Dos tab).",
      },
      {
        kind: "faq",
        items: [
          {
            q: "🔁 Chore",
            a: "A job on a set schedule — you pick which days of the week it applies. This is the default, everyday chore. Earns stars.",
          },
          {
            q: "🎯 Target chore",
            a: "Done a set number of times per week or month, on whichever days the person likes — no fixed schedule. Good for \"practice piano 3x this week\" style goals. Earns stars.",
          },
          {
            q: "✨ Bonus chore",
            a: "Optional extra job anyone (or just the people you pick) can grab for bonus stars, with an optional limit on how often it can be claimed.",
          },
          {
            q: "✅ To-do",
            a: "A simple task to check off. Never worth stars — it's for reminders, not chores.",
          },
          {
            q: "🌱 Inspiration",
            a: "An affirmation, Bible verse, memory verse, or mission to reflect on. Not worth stars either.",
          },
        ],
      },
      {
        kind: "text",
        text: "Each kind has its own article below with the exact fields and how it behaves day to day.",
      },
    ],
    related: [
      "kind-chore", "kind-target-chore", "kind-bonus-chore", "kind-todo", "kind-inspiration",
      "bonus-vs-target",
    ],
    updatedAt: "2026-09-30",
  },
  {
    id: "kind-chore",
    title: "Chores: the everyday, scheduled kind",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "A job that repeats on the weekdays you pick, and earns stars each time it's done.",
    tags: [
      "chore", "regular chore", "daily chore", "recurring chore", "weekly chore",
      "repeat chore", "make bed", "scheduled chore",
    ],
    blocks: [
      { kind: "path", path: ["+", "Create a chore", "Chore"] },
      {
        kind: "text",
        text:
          "A Chore shows up on the Chores tab for each person it's assigned to, on the days you choose, and can be checked off once per day. If it's assigned to several people, each of them gets it on their own list.",
      },
      {
        kind: "faq",
        items: [
          { q: "Days", a: "Tap each day it applies, or use the All, Weekdays or Weekends buttons. It only appears on those days." },
          { q: "Stars per completion", a: "How many stars each check-off earns. The Quick (a few min), Medium (10–20 min) and Big job (30+ min) buttons under the field fill in 1, 3 or 6. If your family earns stars by \"Completing all chores for a day\", this field is hidden — the daily bonus replaces it." },
          { q: "End date (optional)", a: "The chore stops appearing after this day. Leave it empty to keep it going." },
          { q: "Description (optional)", a: "Any extra detail about the job." },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "To edit or delete a chore later, tap Manage tasks (the checklist icon in the Chores card header on the Chores tab).",
      },
    ],
    related: ["five-kinds-of-tasks", "creating-first-chore", "chores-on-some-days", "deciding-star-value"],
    updatedAt: "2026-09-30",
  },
  {
    id: "kind-target-chore",
    title: "Target chores: \"3 times this week\" goals",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "A chore done a set number of times per week or month, on any days the person likes.",
    tags: [
      "target chore", "target count", "times per week", "times per month",
      "practice piano", "weekly goal", "monthly goal", "quest",
    ],
    blocks: [
      { kind: "path", path: ["+", "Create a chore", "Target chore"] },
      {
        kind: "text",
        text:
          "Instead of days, a Target chore asks How often: \"Complete [number] times per Week / Month\". It shows on the person's list every day until they reach that number.",
      },
      {
        kind: "faq",
        items: [
          { q: "When does the count reset?", a: "At the start of each new week or month, depending on which you picked." },
          { q: "What happens when they hit the target?", a: "The app celebrates (\"Target reached!\") and the chore drops off their list for the rest of that week or month — it can't be done extra times for more progress." },
          { q: "Can they do it twice in one day?", a: "No — like a regular chore, it's one check-off per day. Tapping it again the same day un-checks it." },
          { q: "Stars", a: "Set in Stars per completion, same as a regular chore. Target chores don't count toward the \"finished the whole day\" bonus." },
        ],
      },
    ],
    related: ["five-kinds-of-tasks", "bonus-vs-target", "kind-chore"],
    updatedAt: "2026-09-30",
  },
  {
    id: "kind-bonus-chore",
    title: "Bonus chores: optional extra credit",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "An optional job anyone can grab for extra stars, with an optional claim limit.",
    tags: [
      "bonus chore", "extra credit", "extra chore", "claim chore", "open chore",
      "limit reached", "earn extra stars", "wash the car",
    ],
    blocks: [
      { kind: "path", path: ["Chores", "Bonus Chores", "+"] },
      {
        kind: "text",
        text:
          "Create one from the + in the Bonus Chores card on the Chores tab, or + → Create a chore → Bonus chore. Bonus chores live in their own Bonus Chores card (\"Pick one up any time for extra stars\"), not on anyone's daily list.",
      },
      {
        kind: "faq",
        items: [
          { q: "Who can claim it", a: "Everyone, or Choose people. Only people you pick will see it." },
          { q: "How often can it be claimed?", a: "Anytime (no limit), Limit per period (\"Up to N times per day / week / month\"), or Fixed total (\"Only N times ever\"). Limits count every claim by anyone together, not per person — once it's used up it shows \"Limit reached\"." },
          { q: "When does a weekly limit reset?", a: "Weekly limits reset on Monday; daily at midnight; monthly on the 1st." },
          { q: "Stars for claiming it", a: "Bonus chores always pay their own star value, even if your family earns stars per finished day. 0 means no reward." },
        ],
      },
    ],
    related: ["five-kinds-of-tasks", "bonus-vs-target"],
    updatedAt: "2026-09-30",
  },
  {
    id: "kind-todo",
    title: "To-dos: one-off things to check off",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "A simple, no-stars task that stays on the list until it's done.",
    tags: [
      "to-do", "todo", "to do list", "add to-do", "one-off task", "reminder task",
      "sub-to-do", "checklist", "completed to-dos",
    ],
    blocks: [
      { kind: "path", path: ["+", "Add a to-do"] },
      {
        kind: "text",
        text:
          "To-dos live on the To-Dos tab. Add one from + → Add a to-do, or with Add a to-do on the To-Dos tab itself. Pick who it's for under Assign to — the create button stays off until someone is picked.",
      },
      {
        kind: "faq",
        items: [
          { q: "Does it repeat?", a: "No. A to-do has no days — it stays on the list until someone checks it off." },
          { q: "Sub-to-dos", a: "Tap \"+ sub-to-do\" under the name to add steps. A sub-to-do always goes to whoever its parent goes to." },
          { q: "Where do finished ones go?", a: "Tap Completed to-dos (the history icon on the To-Dos tab) for a record of the past 30 days. Tap Put back on the list to reopen one." },
          { q: "Stars", a: "None — see \"Why don't to-dos earn stars?\"" },
        ],
      },
    ],
    related: ["five-kinds-of-tasks", "todos-and-stars", "one-off-chore-no-stars"],
    updatedAt: "2026-09-30",
  },
  {
    id: "kind-inspiration",
    title: "Inspiration: affirmations, verses and missions",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "Something to read or reflect on each day — no stars attached.",
    tags: [
      "inspiration", "affirmation", "bible verse", "memory verse", "mission",
      "daily verse", "devotional", "reflect",
    ],
    blocks: [
      { kind: "path", path: ["+", "Create an inspiration", "Inspiration"] },
      {
        kind: "steps",
        steps: [
          "Tap +, then Create an inspiration (or Create a chore) and pick 🌱 Inspiration.",
          "Give it a short name — this is the title shown on the list.",
          "Under Kind, choose Affirmation, Bible verse, Memory verse, Mission, or Other.",
          "Type the full text in the box below (it's labelled for the kind — e.g. \"Verse text & reference\" for a Bible verse).",
          "Pick who it's for under Who it's for, then create it.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Inspiration items are never worth stars, and leaving one unticked doesn't stop someone's day from counting as finished.",
      },
    ],
    related: ["five-kinds-of-tasks"],
    updatedAt: "2026-09-30",
  },
  {
    id: "creating-first-chore",
    title: "Creating your first chore",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "Add a chore and assign it to someone.",
    tags: ["add chore", "create chore", "new chore", "assign chore"],
    blocks: [
      { kind: "path", path: ["+", "Create a chore", "Chore"] },
      {
        kind: "steps",
        steps: [
          "Tap the + button (it's on every tab).",
          "Choose Create a chore, then pick 🔁 Chore.",
          "Give it a name and pick an emoji (or one of the custom icons if the built-in set doesn't have what you need, like a mop or vacuum).",
          "Under Assign to, tap one or more people.",
          "Under Days, choose which days of the week it applies.",
          "Set Stars per completion (see \"Deciding how many stars a chore should be worth\" if you're not sure).",
          "Tap Create chore.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "You can add several chores at once from the same form by switching \"Just one\" to \"Several at once\" — every setting you pick applies to all of them.",
      },
    ],
    related: ["five-kinds-of-tasks", "kind-chore", "chores-on-some-days", "deciding-star-value"],
    updatedAt: "2026-09-30",
  },
  {
    id: "one-off-chore-no-stars",
    title: "Giving a child a one-off job that isn't worth any stars",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "Use a to-do — or a zero-star chore on a single day if you want it on their chore list.",
    tags: [
      "one-off chore", "one time chore", "no stars", "zero stars", "chore without stars",
      "single chore", "just this once", "unpaid chore", "assign kid a task",
    ],
    blocks: [
      {
        kind: "text",
        text: "There are two ways to do this. The first is the simplest, and is what to-dos are for.",
      },
      {
        kind: "faq",
        items: [
          {
            q: "Option 1 — a to-do (recommended)",
            a: "Tap + → Add a to-do, type the job, tap the child under Assign to, and create it. To-dos are never worth stars, don't repeat, and stay on the To-Dos tab until they're checked off.",
          },
          {
            q: "Option 2 — a zero-star chore on one day",
            a: "Tap + → Create a chore → Chore. Assign it to the child, under Days tap only the day it's due, and set Stars per completion to 0. Set End date to that same day so it doesn't come back the same weekday next week — or delete it from Manage tasks (the checklist icon in the Chores card header) once it's done.",
          },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        text:
          "With Option 2, the job counts as one of that day's chores — so if your family earns stars by \"Completing all chores for a day\", it has to be done for that day's bonus to be paid. Use a to-do if you don't want that.",
      },
    ],
    related: ["kind-todo", "todos-and-stars", "kind-chore"],
    updatedAt: "2026-09-30",
  },
  {
    id: "chores-on-some-days",
    title: "Chores on some days but not others",
    category: "chores-and-tasks",
    type: "how-to",
    summary: "Scheduling a chore for specific weekdays, or letting it happen any day a set number of times.",
    tags: [
      "weekday chores", "chore schedule", "only on weekends", "chore days",
      "specific days", "how often chore",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "A regular Chore is scheduled by day of the week — when creating or editing one, tap the days it applies to under Days (with All/Weekdays/Weekends quick-select buttons). It'll only show up, and only be checkable, on the days you picked.",
      },
      {
        kind: "text",
        text:
          "If the chore doesn't need to happen on specific days — just a certain number of times per week or month — use a Target chore instead. It doesn't ask for days at all; it just tracks progress toward the count you set, and the person can complete it whichever days they like.",
      },
    ],
    related: ["five-kinds-of-tasks", "kind-chore", "kind-target-chore"],
    updatedAt: "2026-09-30",
  },
  {
    id: "bonus-vs-target",
    title: "Bonus chores vs. target-count chores — which do I want?",
    category: "chores-and-tasks",
    type: "guidance",
    summary: "They sound similar but work differently — here's how to pick.",
    tags: [
      "bonus chore vs target", "difference bonus target", "extra chore",
      "open chore", "unassigned chore", "claim chore",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "These two are easy to mix up because both let a chore happen more than once and aren't tied to a fixed daily schedule — but they solve different situations.",
      },
      {
        kind: "faq",
        items: [
          {
            q: "Use a Target chore when…",
            a: "…it's a specific person's job with a goal. \"Practice piano 3 times this week\" is a target chore — it's Sam's job, it sits on Sam's list until the third time, then drops off until next week.",
          },
          {
            q: "Use a Bonus chore when…",
            a: "…it's optional and open to whoever gets to it first. Bonus chores can be offered to Everyone or to people you choose, and any claim limit you set (per day/week/month, or a fixed total) is shared by everyone — once it's reached, nobody else can claim it.",
          },
        ],
      },
      {
        kind: "note",
        tone: "info",
        text:
          "Short version: Target = one person's goal, done a set number of times. Bonus = optional extra credit open to a group, first come first served.",
      },
    ],
    related: ["five-kinds-of-tasks", "kind-target-chore", "kind-bonus-chore"],
    updatedAt: "2026-09-30",
  },
  {
    id: "todos-and-stars",
    title: "Why don't to-dos earn stars?",
    category: "chores-and-tasks",
    type: "guidance",
    summary: "To-dos are reminders, not chores — that's the whole distinction between them.",
    tags: [
      "to-do stars", "todo no stars", "why no stars", "to-dos points",
      "do to-dos count", "to-do vs chore", "reminders",
    ],
    blocks: [
      {
        kind: "text",
        text:
          "A to-do never has a star value. That isn't a setting — it's what separates a to-do from a chore.",
      },
      {
        kind: "text",
        text:
          "Chores are the recurring work a family shares out, and stars are how that work gets recognised and eventually cashed out. To-dos are one-off reminders: pack a permission slip, bring the trash bin in, text Grandma back. Attaching a price to those turns every passing reminder into a negotiation, and it makes the star balance mean less — a kid who finished their chores and a kid who wrote themselves ten easy to-dos would look the same.",
      },
      {
        kind: "faq",
        items: [
          {
            q: "I want this one to be worth stars.",
            a: "Then it's a chore, not a to-do. Create it as a Chore (pick the day it's due) or a Bonus chore (optional extra credit) and give it a star value.",
          },
          {
            q: "Does finishing to-dos affect streaks?",
            a: "Yes, a little: a streak counts any day with at least one thing checked off, and a to-do counts. To-dos don't count toward the \"finished the whole day\" bonus, though.",
          },
        ],
      },
    ],
    related: ["five-kinds-of-tasks", "kind-todo", "how-streaks-work"],
    updatedAt: "2026-09-30",
  },
];
