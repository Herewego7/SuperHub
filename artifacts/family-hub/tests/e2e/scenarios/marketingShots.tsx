import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import FamilyHub from "@/pages/family-hub";
import { markCelebratedAllDone } from "@/lib/allDoneCelebration";
import { installMockApi, baselineRoutes, ok } from "../mockApi";

// The fixture App Store screenshots are rendered from.
//
// Deliberately NOT screenshotInventory: that one is a stress-test fixture,
// full of deliberately absurd strings and identical star counts, because its
// job is to catch clipping and overflow. Those are exactly the things that
// must never appear in a store listing. This one's job is the opposite — a
// real-looking family of four on a busy Tuesday, mid-week, mid-routine, with
// history behind them: stars banked, streaks running, trophies won.
//
// Photos live in tests/e2e/assets/family/ and are served by the dev server at
// screenshot time. Deliberately NOT in public/, so they never ship inside the
// app bundle.
const PHOTO = (name: string) => `/tests/e2e/assets/family/${name}.jpg`;

const now = new Date();
const at = (dayOffset: number, h: number, m = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
};
const iso = (d: Date) => d.toISOString();

const profiles = [
  { id: "all", name: "All Family", isAllFamilyProfile: true, initials: "AF",
    color: "#8a8f98", photoUrl: PHOTO("family") },
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6", role: "adult",
    photoUrl: PHOTO("dad"), googleCalendarConnected: true },
  { id: "mom", name: "Mom", initials: "M", color: "#a855f7", role: "adult",
    photoUrl: PHOTO("mom") },
  { id: "ava", name: "Ava", initials: "A", color: "#ef4444", role: "child",
    isChild: true, photoUrl: PHOTO("ava") },
  { id: "noah", name: "Noah", initials: "N", color: "#22c55e", role: "child",
    isChild: true, photoUrl: PHOTO("noah") },
];

const chore = (o: Record<string, unknown>) => ({
  userId: "u1", isActive: true, isBonus: false, targetCount: 0, description: null,
  taskType: "chore", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], recurrenceType: "daily",
  endDate: null, parentChoreId: null, ...o,
});

// The kids carry more than the grown-ups, which is how these apps are used.
const chores = [
  chore({ id: "a1", title: "Make your bed", icon: "🛏️", points: 2, profileIds: ["ava"], displayOrder: 0 }),
  chore({ id: "a2", title: "Unload the dishwasher", icon: "🍽️", points: 5, profileIds: ["ava"], displayOrder: 1 }),
  chore({ id: "a3", title: "Practice violin", icon: "🎻", points: 4, profileIds: ["ava"], displayOrder: 2 }),
  chore({ id: "a4", title: "Homework before screens", icon: "📚", points: 5, profileIds: ["ava"], displayOrder: 3 }),
  chore({ id: "n1", title: "Feed the dog", icon: "🐕", points: 3, profileIds: ["noah"], displayOrder: 4 }),
  chore({ id: "n2", title: "Make your bed", icon: "🛏️", points: 2, profileIds: ["noah"], displayOrder: 5 }),
  chore({ id: "n3", title: "Reading, 20 minutes", icon: "📖", points: 4, profileIds: ["noah"], displayOrder: 6 }),
  chore({ id: "d1", title: "Take the bins out", icon: "🗑️", points: 2, profileIds: ["dad"], displayOrder: 7 }),
  chore({ id: "d2", title: "Walk the dog", icon: "🦮", points: 3, profileIds: ["dad"], displayOrder: 8 }),
  chore({ id: "m1", title: "Water the plants", icon: "🪴", points: 2, profileIds: ["mom"], displayOrder: 9 }),
  chore({ id: "m2", title: "Fold the laundry", icon: "🧺", points: 4, profileIds: ["mom"], displayOrder: 10 }),
  chore({ id: "b1", title: "Wash the car", icon: "🚗", points: 15, isBonus: true, profileIds: [], displayOrder: 11 }),
  chore({ id: "b2", title: "Weed the front beds", icon: "🌿", points: 12, isBonus: true, profileIds: [], displayOrder: 12 }),
  chore({ id: "b3", title: "Clean out the garage", icon: "📦", points: 25, isBonus: true, profileIds: [], displayOrder: 13 }),
  chore({ id: "t1", title: "Pack for the camping trip", taskType: "todo", points: 0,
          profileIds: ["mom"], daysOfWeek: [], recurrenceType: null, displayOrder: 14 }),
  chore({ id: "t1a", title: "Sleeping bags from the loft", taskType: "todo", points: 0,
          profileIds: ["mom"], daysOfWeek: [], recurrenceType: null, parentChoreId: "t1", displayOrder: 15 }),
  chore({ id: "t1b", title: "Charge the lantern", taskType: "todo", points: 0,
          profileIds: ["mom"], daysOfWeek: [], recurrenceType: null, parentChoreId: "t1", displayOrder: 16 }),
  chore({ id: "t2", title: "Book Ava's dentist appointment", taskType: "todo", points: 0,
          profileIds: ["mom"], daysOfWeek: [], recurrenceType: null, displayOrder: 17 }),
  chore({ id: "t3", title: "Return the library books", taskType: "todo", points: 0,
          profileIds: ["dad"], daysOfWeek: [], recurrenceType: null, displayOrder: 18 }),
];

// ── Today ────────────────────────────────────────────────────────────────────
// Noah has finished everything — the "all done" state, which a store listing
// wants to show. Everyone else is part-way.
//
// ⚠️ Finishing someone's last chore fires the all-done celebration, and a
// screenshot taken during it catches a screenful of confetti (learned the hard
// way, 2026-09-15). setup() marks Noah's as already celebrated today, which is
// exactly what the app does after it has fired once.
const todayCompletions = [
  { id: "x1", choreId: "n1", profileId: "noah", points: 3, completedAt: iso(at(0, 7, 5)) },
  { id: "x2", choreId: "n2", profileId: "noah", points: 2, completedAt: iso(at(0, 7, 15)) },
  { id: "x3", choreId: "n3", profileId: "noah", points: 4, completedAt: iso(at(0, 7, 50)) },
  { id: "x4", choreId: "a1", profileId: "ava", points: 2, completedAt: iso(at(0, 7, 10)) },
  { id: "x5", choreId: "a2", profileId: "ava", points: 5, completedAt: iso(at(0, 7, 40)) },
  { id: "x6", choreId: "d2", profileId: "dad", points: 3, completedAt: iso(at(0, 6, 50)) },
  { id: "x7", choreId: "m1", profileId: "mom", points: 2, completedAt: iso(at(0, 7, 35)) },
];

// ── History ──────────────────────────────────────────────────────────────────
// Ten days of completed chores behind today. This is what makes the streaks and
// star totals believable rather than asserted — the Trophy Case and history
// drawer read the same rows.
const history: typeof todayCompletions = [];
let hid = 0;
for (let day = 1; day <= 10; day++) {
  const per: [string, string, number][] = [
    ["ava", "a1", 2], ["ava", "a2", 5], ["ava", "a3", 4],
    ["noah", "n1", 3], ["noah", "n2", 2],
    ["dad", "d2", 3], ["mom", "m1", 2],
  ];
  for (const [profileId, choreId, points] of per) {
    // Ava missed a couple of days — a streak nobody ever breaks reads as fake.
    if (profileId === "ava" && (day === 4 || day === 9)) continue;
    history.push({
      id: `h${hid++}`, choreId, profileId, points,
      completedAt: iso(at(-day, 7 + (hid % 3), 20)),
    });
  }
}

const POINTS: Record<string, number> = { dad: 96, mom: 118, ava: 247, noah: 189 };
const STREAKS: Record<string, number> = { dad: 11, mom: 14, ava: 7, noah: 23 };

const achievements = [
  { id: "ach1", profileId: "noah", title: "Three weeks running", type: "streak",
    description: "21-day chore streak", icon: "🔥", earnedAt: iso(at(-2, 18)) },
  { id: "ach2", profileId: "ava", title: "200 stars", type: "milestone",
    description: "Banked 200 stars", icon: "⭐", earnedAt: iso(at(-5, 17)) },
  { id: "ach3", profileId: "ava", title: "Perfect week", type: "goal",
    description: "Every chore, seven days", icon: "🏆", earnedAt: iso(at(-8, 19)) },
  { id: "ach4", profileId: "noah", title: "100 stars", type: "milestone",
    description: "Banked 100 stars", icon: "⭐", earnedAt: iso(at(-12, 16)) },
  { id: "ach5", profileId: "mom", title: "Ten days running", type: "streak",
    description: "10-day streak", icon: "🔥", earnedAt: iso(at(-3, 20)) },
  { id: "ach6", profileId: "dad", title: "First cash-out", type: "milestone",
    description: "Traded stars for real money", icon: "💵", earnedAt: iso(at(-15, 12)) },
];

const who = (id: string) => profiles.find(p => p.id === id)!;
const activity = (
  id: string, type: string, profileId: string, description: string, when: Date,
) => {
  const p = who(profileId);
  return {
    id, activityType: type, profileId, profileName: p.name, profileColor: p.color,
    profileInitials: p.initials, profilePhotoUrl: p.photoUrl ?? null,
    toProfileId: null, toProfileName: null, toProfileColor: null,
    description, entityTitle: null, metadata: null, timestamp: iso(when),
  };
};

const activityLog = [
  activity("g1", "chore_complete", "noah", "Completed Reading, 20 minutes", at(0, 7, 50)),
  activity("g2", "chore_complete", "ava", "Completed Unload the dishwasher", at(0, 7, 40)),
  activity("g3", "chore_complete", "mom", "Completed Water the plants", at(0, 7, 35)),
  activity("g4", "chore_complete", "noah", "Completed Make your bed", at(0, 7, 15)),
  activity("g5", "shoutout", "ava", "Great job on your violin practice!", at(0, 7, 12)),
  activity("g6", "chore_complete", "ava", "Completed Make your bed", at(0, 7, 10)),
  activity("g7", "chore_complete", "dad", "Completed Walk the dog", at(0, 6, 50)),
  activity("g8", "reward_redeem", "noah", "Redeemed Movie night pick", at(-1, 19, 20)),
  activity("g9", "point_adjustment", "ava", "Added 10 stars — helping with the shopping", at(-1, 17, 5)),
  activity("g10", "cashout_requested", "ava", "Requested a $10 cash-out", at(-2, 16, 40)),
];

// ── The calendar ─────────────────────────────────────────────────────────────
// Built as a ROUTINE rather than a list, because that is what a family
// calendar actually is: the same school run every weekday, activities on
// their fixed evenings, church and lunch on Sunday — and then the handful of
// one-offs that make a particular week that week.
//
// Generated across seven weeks so the month view is full in every row. Aiming
// for "full but not crazy busy": roughly four or five things on a weekday,
// two or three at the weekend, and Friday evening deliberately left clear.
const ev = (
  id: string, title: string, day: number, h: number, m: number, durMin: number,
  profileIds: string[], drivers: string[] = [], location: string | null = null,
) => {
  const start = at(day, h, m);
  const end = new Date(start.getTime() + durMin * 60_000);
  return {
    id, title, startTime: iso(start), endTime: iso(end),
    isAllDay: false, profileIds, drivingProfileIds: drivers, location,
    description: null, recurrenceType: null, daysOfWeek: [],
  };
};

const KIDS = ["ava", "noah"];
const ALL = ["dad", "mom", "ava", "noah"];
const events: ReturnType<typeof ev>[] = [];
let eid = 0;
const push = (
  title: string, day: number, h: number, m: number, dur: number,
  who_: string[], drivers: string[] = [], loc: string | null = null,
) => { events.push(ev(`g${eid++}`, title, day, h, m, dur, who_, drivers, loc)); };

// Offset of the Sunday that starts this week, so `sun + n` lands on a weekday.
const sunday = -now.getDay();

for (let week = -3; week <= 3; week++) {
  const sun = sunday + week * 7;

  // Sunday — church, then everyone at Grandma's.
  push("Church", sun, 9, 30, 90, ALL, [], "Grace Chapel");
  push("Lunch at Grandma's", sun, 11, 45, 105, ALL, ["dad"]);

  // Weekdays. Dad drives the morning run Mon/Wed/Fri and Mom collects; they
  // swap on Tue/Thu — the arrangement most two-parent households actually run.
  for (const d of [1, 2, 3, 4, 5]) {
    const dadMorning = d === 1 || d === 3 || d === 5;
    // 40 minutes, not 25: that is what the round trip actually takes, and a
    // sliver too short to hold its own title is no use in the week view.
    push("Drop-off", sun + d, 7, 45, 40, KIDS, [dadMorning ? "dad" : "mom"], "Lincoln Elementary");
    push("Pick-up", sun + d, 15, 15, 40, KIDS, [dadMorning ? "mom" : "dad"], "Lincoln Elementary");
  }

  // Activities on their fixed evenings.
  push("Swim team", sun + 1, 6, 30, 60, ["ava"], ["dad"], "Aquatic Center");
  push("Soccer practice", sun + 2, 16, 30, 90, ["noah"], ["dad"], "Riverside Fields");
  push("Book club", sun + 2, 19, 0, 120, ["mom"], [], "Ellen's house");
  push("Swim team", sun + 3, 6, 30, 60, ["ava"], ["dad"], "Aquatic Center");
  push("Violin lesson", sun + 3, 16, 15, 45, ["ava"], ["dad"], "Northside Music");
  push("Scouts", sun + 3, 18, 0, 90, ["noah"], ["mom"], "Community Hall");
  push("Soccer practice", sun + 4, 16, 30, 90, ["noah"], ["dad"], "Riverside Fields");

  // A couple of midday things for the grown-ups, so the middle of the day
  // isn't a dead band on every weekday.
  push("Client lunch", sun + 2, 12, 15, 60, ["dad"], [], "Marlowe's");
  push("Volunteering", sun + 4, 10, 0, 120, ["mom"], [], "Public Library");

  // Dinner together most nights, but not Friday — that's takeaway night.
  for (const d of [1, 2, 3, 4]) push("Family dinner", sun + d, 18, 45, 45, ALL);

  // Saturday: a match, the market, and something social.
  push("Soccer game", sun + 6, 9, 0, 90, ["noah"], ["dad"], "Riverside Fields");
  push("Farmers market", sun + 6, 11, 0, 90, ["mom", "ava"], ["mom"]);
}

// The one-offs that make this particular fortnight. These sit on top of the
// routine above rather than replacing it.
push("Ava's orthodontist", 0, 15, 15, 45, ["ava"], ["mom"], "Dr. Whitfield");
push("Swim practice", 0, 17, 30, 60, ["ava"], ["dad"], "Aquatic Center");
push("Family movie night", 0, 19, 30, 90, ALL);
push("Dentist — Noah", 1, 9, 0, 60, ["noah"], ["mom"], "Dr. Whitfield");
push("Parent–teacher evening", 2, 17, 30, 90, ["dad", "mom"], [], "Lincoln Elementary");
push("School play rehearsal", 3, 15, 30, 120, ["ava"], ["mom"], "School auditorium");
push("Date night", 3, 19, 30, 150, ["dad", "mom"], [], "Osteria");
push("Swim meet", 5, 8, 0, 180, ["ava"], ["mom"], "Aquatic Center");
push("Birthday party — Jack's", 5, 14, 0, 120, ["noah"], ["dad"], "Jump Zone");
push("Sleepover at Maya's", 5, 17, 0, 900, ["ava"], ["mom"]);
push("Camping trip departs", 6, 15, 0, 120, ALL, ["dad"]);
push("Coffee with Ellen", 4, 9, 30, 60, ["mom"], [], "Blue Door Cafe");
push("Haircuts", 13, 10, 30, 60, KIDS, ["mom"]);

// ── Meals, groceries and rewards ─────────────────────────────────────────────
// A real family's week, not three sample rows: every slot filled, a grocery
// list with things already ticked off, and a reward shelf a child would
// actually save for. The App Store shot has to show the app doing its job,
// and an empty planner shows nothing.

const dateOnly = (d: Date) => iso(d).slice(0, 10);

interface Ing { id: string; item: string; quantity: string | null; displayOrder: number }
const ing = (mealKey: string, items: [string, string | null][]): Ing[] =>
  items.map(([item, quantity], i) => ({
    id: `${mealKey}-i${i}`, item, quantity, displayOrder: i,
  }));

/** The family's saved ideas — what Meals looks like once a family has used it. */
const savedMeals = [
  ["sm1", "Sheet Pan Chicken & Veggies", "Everyone's favourite — 35 min start to finish", [["chicken thighs", "2 lb"], ["broccoli", "2 heads"], ["baby potatoes", "1.5 lb"], ["olive oil", null], ["paprika", "1 tsp"]]],
  ["sm2", "Taco Tuesday", "Double the beef, freeze half", [["ground beef", "1 lb"], ["taco shells", "12"], ["cheddar", "8 oz"], ["salsa", "1 jar"], ["romaine", "1 head"]]],
  ["sm3", "Spaghetti & Meatballs", "Ava helps roll the meatballs", [["spaghetti", "1 lb"], ["marinara", "2 jars"], ["ground beef", "1 lb"], ["parmesan", "4 oz"]]],
  ["sm4", "Homemade Pizza Night", "Friday tradition", [["pizza dough", "2"], ["mozzarella", "16 oz"], ["pepperoni", "6 oz"], ["pizza sauce", "1 jar"]]],
  ["sm5", "Chicken Tortilla Soup", "Freezes well", [["chicken breast", "1.5 lb"], ["black beans", "2 cans"], ["corn", "1 can"], ["tortilla chips", "1 bag"], ["lime", "2"]]],
  ["sm6", "Slow Cooker Pot Roast", "Start it before church", [["chuck roast", "3 lb"], ["carrots", "1 lb"], ["yellow onion", "2"], ["beef broth", "32 oz"]]],
  ["sm7", "Baked Salmon & Rice", "Noah will eat this one", [["salmon fillets", "4"], ["jasmine rice", "2 cups"], ["asparagus", "1 bunch"], ["lemon", "2"]]],
  ["sm8", "Breakfast for Dinner", "Pancakes, bacon, the works", [["pancake mix", "1 box"], ["bacon", "1 lb"], ["eggs", "1 dozen"], ["maple syrup", null]]],
  ["sm9", "Turkey Chili", "Make a double batch", [["ground turkey", "2 lb"], ["kidney beans", "2 cans"], ["diced tomatoes", "2 cans"], ["chili powder", null]]],
  ["sm10", "Greek Chicken Bowls", "Mom's lunch prep", [["chicken breast", "2 lb"], ["cucumber", "2"], ["feta", "6 oz"], ["pita", "1 pack"], ["tzatziki", "1 tub"]]],
  ["sm11", "Beef Stir Fry", "20 minutes on a busy night", [["flank steak", "1.5 lb"], ["snap peas", "12 oz"], ["jasmine rice", "2 cups"], ["soy sauce", null]]],
  ["sm12", "BBQ Chicken Sandwiches", "Good for a game day", [["chicken breast", "2 lb"], ["brioche buns", "8"], ["bbq sauce", "1 bottle"], ["coleslaw mix", "1 bag"]]],
].map(([id, name, notes, items]) => ({
  id: id as string, userId: "u1", name: name as string, notes: notes as string,
  recipeUrl: null, directions: null, sourceName: null, importedAt: null,
  createdAt: iso(at(-30, 10)),
  ingredients: ing(id as string, items as [string, string | null][]),
}));

/** This week, every slot filled — Sunday through Saturday. */
const WEEK_PLAN: [string, string, string][] = [
  // breakfast, lunch, dinner
  ["Pancakes & Bacon", "Lunch after church", "Slow Cooker Pot Roast"],
  ["Oatmeal & Berries", "Turkey Sandwiches", "Sheet Pan Chicken & Veggies"],
  ["Scrambled Eggs & Toast", "Leftover Pot Roast", "Taco Tuesday"],
  ["Yogurt Parfaits", "Mac & Cheese", "Spaghetti & Meatballs"],
  ["Smoothies", "Quesadillas", "Beef Stir Fry"],
  ["Cereal & Fruit", "PB&J and Apples", "Homemade Pizza Night"],
  ["Bagels & Cream Cheese", "Grilled Cheese & Tomato Soup", "Baked Salmon & Rice"],
];

const weekMeals = (() => {
  const out: Record<string, unknown>[] = [];
  // Three weeks, not one: the planner's week may start on Sunday or Monday
  // depending on the family's setting, and a screenshot of a grid with one
  // empty column looks like the feature doesn't work. Filling a wide window
  // means every column is full whichever week the app happens to show.
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() - 7);
  for (let d = 0; d < 21; d++) {
    const day = WEEK_PLAN[d % 7];
    const date = new Date(start);
    date.setDate(start.getDate() + d);
    (["breakfast", "lunch", "dinner"] as const).forEach((slot, si) => {
      const name = day[si];
      const source = savedMeals.find(sm => sm.name === name);
      out.push({
        id: `m${d}-${slot}`, userId: "u1", date: dateOnly(date), slot, name,
        notes: source?.notes ?? null, recipeUrl: null, directions: null,
        sourceName: null, importedAt: null, createdAt: iso(at(-2, 9)),
        ingredients: source ? source.ingredients.map(i => ({ ...i, id: `m${d}-${slot}-${i.id}` })) : [],
      });
    });
  }
  return out;
})();

/** Mid-shop: some things already in the trolley, most not. */
const groceryItems = [
  ["Chicken thighs", "2 lb", "Meat & Seafood", true],
  ["Ground beef", "2 lb", "Meat & Seafood", true],
  ["Salmon fillets", "4", "Meat & Seafood", false],
  ["Chuck roast", "3 lb", "Meat & Seafood", false],
  ["Broccoli", "2 heads", "Produce", true],
  ["Baby potatoes", "1.5 lb", "Produce", false],
  ["Carrots", "1 lb", "Produce", false],
  ["Romaine", "1 head", "Produce", false],
  ["Asparagus", "1 bunch", "Produce", false],
  ["Strawberries", "2 lb", "Produce", true],
  ["Bananas", "1 bunch", "Produce", true],
  ["Lemons", "2", "Produce", false],
  ["Milk", "2 gal", "Dairy & Eggs", true],
  ["Eggs", "2 dozen", "Dairy & Eggs", true],
  ["Cheddar", "8 oz", "Dairy & Eggs", false],
  ["Mozzarella", "16 oz", "Dairy & Eggs", false],
  ["Greek yogurt", "4 cups", "Dairy & Eggs", false],
  ["Spaghetti", "1 lb", "Pantry", false],
  ["Marinara", "2 jars", "Pantry", false],
  ["Jasmine rice", "2 cups", "Pantry", true],
  ["Black beans", "2 cans", "Pantry", false],
  ["Tortilla chips", "1 bag", "Pantry", false],
  ["Pancake mix", "1 box", "Pantry", false],
  ["Bagels", "6", "Bakery", false],
  ["Brioche buns", "8", "Bakery", false],
  ["Frozen peas", "1 bag", "Frozen", false],
].map(([name, quantity, category, isChecked], i) => ({
  id: `g${i}`, userId: "u1", name, quantity, category, isChecked,
  // Items that came from this week's planned meals carry a source id, so the
  // list reads as "Live from meals" rather than claiming nothing is planned.
  sourceMealIds: i < 14 ? ["m-week"] : [], createdAt: iso(at(-1, 18)),
}));

/** What /api/grocery-list/aggregate returns: the meal-derived half of the list. */
const groceryAggregate = groceryItems
  .filter((g) => g.sourceMealIds.length > 0)
  .map((g) => ({ name: g.name, quantity: g.quantity, sourceMealIds: g.sourceMealIds }));

/** A shelf worth saving for — cheap wins through to the big one. */
const rewards = [ // pointsCost, not cost: the card renders "⭐ stars" with no
  // number when the field name is wrong, which is easy to miss in a thumbnail.
  { id: "r1", title: "Pick tonight's dinner", icon: "🍽️", pointsCost: 15, isActive: true },
  { id: "r2", title: "Movie night pick", icon: "🍿", pointsCost: 25, isActive: true },
  { id: "r3", title: "Stay up 30 minutes late", icon: "🌙", pointsCost: 30, isActive: true },
  { id: "r4", title: "Ice cream trip", icon: "🍦", pointsCost: 40, isActive: true },
  { id: "r5", title: "Extra hour of screen time", icon: "🎮", pointsCost: 60, isActive: true },
  { id: "r6", title: "Choose the weekend outing", icon: "🗺️", pointsCost: 75, isActive: true },
  { id: "r7", title: "New book of your choice", icon: "📚", pointsCost: 90, isActive: true },
  { id: "r8", title: "Friend sleepover", icon: "🏕️", pointsCost: 120, isActive: true },
  { id: "r9", title: "Day trip to the zoo", icon: "🦁", pointsCost: 200, isActive: true },
];

/** The dates a family is counting down to. */
const celebrations = (() => {
  const mk = (
    id: string, name: string, type: string, daysUntil: number,
    year: number | null, profileId: string | null, gifts: string[],
  ) => {
    const next = new Date(now);
    next.setDate(next.getDate() + daysUntil);
    return {
      id, userId: "u1", name, monthDay: `${next.getMonth() + 1}-${next.getDate()}`,
      year, type, customLabel: null, profileId,
      profileIds: profileId ? [profileId] : [],
      notes: null, showYear: year != null,
      nextOccurrence: iso(next), daysUntil,
      ageThisYear: year ? next.getFullYear() - year : null,
      giftIdeas: gifts.map((title, i) => ({
        id: `${id}-g${i}`, celebrationId: id, title, url: null, isPurchased: i === 0,
      })),
      photos: [],
    };
  };
  return [
    mk("c1", "Ava", "birthday", 11, 2014, "ava", ["Art set she circled", "Concert tickets", "New swim goggles"]),
    mk("c2", "Mom & Dad's anniversary", "anniversary", 19, 2009, null, ["Book the sitter", "Dinner at Alma"]),
    mk("c3", "Grandma Ruth", "birthday", 34, 1951, null, ["Photo book of the kids"]),
    mk("c4", "Noah", "birthday", 58, 2016, "noah", ["Soccer boots", "Lego set"]),
    mk("c5", "Mom", "birthday", 92, 1986, "mom", []),
  ];
})();

export function setup(): void {
  try { window.localStorage.clear(); } catch { /* private mode */ }
  // See the ⚠️ above todayCompletions — stops Noah's finished list firing the
  // celebration across the shot.
  try { markCelebratedAllDone("noah", new Date(), "chores"); } catch { /* fine */ }
  // The "Quick wins" feature-nudge sheet opens over the whole app for a family
  // with this much history, which is correct behaviour and useless in a
  // screenshot — it covers the screen and swallows taps. Marking it as shown
  // just now is what the app itself records once someone has seen it.
  try { window.localStorage.setItem("familyHub_featureNudgeShownAt", String(Date.now())); } catch { /* fine */ }
  // The calendar defaults to 0.75 zoom — 48px per hour — which leaves a 40
  // minute school run 32px tall and its title clipped to "Sch…" with the time
  // spilling out below. 1.25 gives the short events room to say what they are.
  // This is a stored per-device preference, so it is ordinary app state, not a
  // screenshot-only trick.
  try { window.localStorage.setItem("familyHub_calZoom", "1.25"); } catch { /* fine */ }

  // Which cards the Chores tab shows, and in what order. Ordinary per-device
  // app state (Customize Tasks Page), not a screenshot-only trick.
  //
  // Two reasons to set it: Star Insights is OFF by default, so it never
  // appeared in a shot at all; and the two columns alternate by index, so
  // this order puts Rewards and Trophies down the left and Bonus Chores and
  // Star Insights down the right, which fills a tablet's width evenly instead
  // of leaving one column short.
  try {
    window.localStorage.setItem("tasksPageCardSettings_v1", JSON.stringify([
      { id: "rewards", name: "Rewards", visible: true, order: 0 },
      { id: "bonus", name: "Bonus Chores", visible: true, order: 1 },
      { id: "trophies", name: "Trophies", visible: true, order: 2 },
      { id: "starInsights", name: "Star Insights", visible: true, order: 3 },
    ]));
  } catch { /* fine */ }

  installMockApi(
    baselineRoutes({
      "/api/auth/user": {
        id: "u1", email: "hello@hubforfamilies.com",
        onboardingCompletedAt: iso(now), createdAt: iso(at(-120, 9)),
      },
      "/api/profiles": profiles,
      "/api/chores": chores,
      // ⚠️ Explicit, because the mock matches the LONGEST path first and
      // "/api/chores" would otherwise answer this one with everything — which
      // is how the to-do list ended up rendering inside Bonus Chores, each
      // item worth zero stars.
      "/api/chores/bonus": chores.filter(c => c.isBonus),
      "/api/chore-completions": [...todayCompletions, ...history],
      "/api/events": events,
      "/api/achievements": achievements,
      "/api/activity-log": activityLog,
      // Both of these are per-profile paths, so they need the id off the URL.
      "/api/points/": (url: string) => {
        const id = url.split("/api/points/")[1]?.split(/[?/]/)[0] ?? "";
        return ok({ profileId: id, points: POINTS[id] ?? 0 });
      },
      "/api/streaks/": (url: string) => {
        const id = url.split("/api/streaks/")[1]?.split(/[?/]/)[0] ?? "";
        const streak = STREAKS[id] ?? 0;
        return ok({ profileId: id, streak, longestStreak: streak + 4, freezesAvailable: 1 });
      },
      // Star Insights charts a per-profile ledger. Without this route the
      // card throws on `l.events` and takes the whole page down with it —
      // worth knowing that it trusts the shape completely.
      "/api/stars/ledger": (url: string) => {
        const id = url.split("/api/stars/ledger/")[1]?.split(/[?/]/)[0] ?? "";
        const balance = POINTS[id] ?? 0;
        // A plausible ninety days: earning most days, spending occasionally.
        const events = [];
        let running = 0;
        for (let d = 90; d >= 0; d--) {
          const earn = 4 + ((d * 7 + balance) % 9);
          running += earn;
          events.push({ at: iso(at(-d, 17)), delta: earn, kind: "completion" });
          if (d % 14 === 0 && d !== 90) {
            const spend = 25 + (d % 3) * 15;
            running -= spend;
            events.push({ at: iso(at(-d, 19)), delta: -spend, kind: "redemption" });
          }
        }
        const totalEarned = events.filter(e => e.delta > 0).reduce((n, e) => n + e.delta, 0);
        const totalSpent = events.filter(e => e.delta < 0).reduce((n, e) => n - e.delta, 0);
        return ok({ balance, totalEarned, totalSpent, events });
      },
      // Birthdays and anniversaries far enough out to still act on — the
      // whole point of the Celebrations screen is the countdown.
      "/api/celebrations": celebrations,
      // ⚠️ Explicit, for the same reason as /api/chores/bonus: the mock
      // matches the LONGEST path first, so "/api/celebrations" would answer
      // this one with list-shaped rows that have no `start` — and the
      // calendar crashes on `c.start.slice(...)` rather than skipping them.
      "/api/celebrations/calendar": celebrations.map(c => ({
        id: `${c.id}-occ`, celebrationId: c.id, title: c.name,
        type: c.type, monthDay: c.monthDay, year: c.year,
        ageThisYear: c.ageThisYear, profileId: c.profileId,
        start: c.nextOccurrence, end: c.nextOccurrence,
      })),
      "/api/rewards": rewards,
      "/api/saved-meals": savedMeals,
      "/api/meals": weekMeals,
      "/api/grocery-items": groceryItems,
      "/api/grocery-list/aggregate": groceryAggregate,
    }),
  );
}

export function Component() {
  return (
    <QueryClientProvider client={queryClient}>
      <FamilyHub />
    </QueryClientProvider>
  );
}
