import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planLocalHealthNotifications,
  localNotificationId,
  MAX_LOCAL_HEALTH_NOTIFICATIONS,
  shouldSuppressRemoteHealthPush,
  lastOccurrenceAtOrBefore,
  type PlannableReminder,
} from "../../src/lib/healthReminderPlan.ts";

const NOW = new Date("2026-09-18T12:00:00Z");

function reminder(over: Partial<PlannableReminder> = {}): PlannableReminder {
  return {
    id: "r1",
    title: "Amoxicillin",
    dose: "1 tablet",
    scheduleJson: { kind: "daily", time: "08:00" },
    ...over,
  };
}

test("a daily reminder becomes ONE repeating trigger, not a dated series", () => {
  // This is what removes the 'someone must open the app every week' problem:
  // iOS re-fires a repeating trigger forever on its own.
  const [plan] = planLocalHealthNotifications([reminder()], NOW);
  assert.equal(plan.repeats, true);
  assert.deepEqual(plan.on, { hour: 8, minute: 0 });
  assert.equal(plan.at, undefined);
});

test("weekly makes one trigger per chosen day, converted to iOS weekdays", () => {
  const plans = planLocalHealthNotifications(
    [reminder({ scheduleJson: { kind: "weekly", time: "19:30", days: [0, 6] } })],
    NOW,
  );
  // The app stores 0 = Sunday; iOS uses 1 = Sunday. Getting this wrong fires
  // the reminder on the wrong day, which no type checker would catch.
  assert.deepEqual(
    plans.map((p) => p.on),
    [{ hour: 19, minute: 30, weekday: 1 }, { hour: 19, minute: 30, weekday: 7 }],
  );
  assert.ok(plans.every((p) => p.repeats));
});

test("monthly keeps the day of month", () => {
  const [plan] = planLocalHealthNotifications(
    [reminder({ scheduleJson: { kind: "monthly", time: "09:15", dayOfMonth: 3 } })],
    NOW,
  );
  assert.deepEqual(plan.on, { hour: 9, minute: 15, day: 3 });
});

test("a one-off in the future is scheduled; one in the past is dropped", () => {
  const future = planLocalHealthNotifications(
    [reminder({ scheduleJson: { kind: "once", at: "2026-09-19T08:00:00Z" } })],
    NOW,
  );
  assert.equal(future.length, 1);
  assert.equal(future[0].repeats, false);
  assert.equal(future[0].at?.toISOString(), "2026-09-19T08:00:00.000Z");

  const past = planLocalHealthNotifications(
    [reminder({ scheduleJson: { kind: "once", at: "2026-09-17T08:00:00Z" } })],
    NOW,
  );
  assert.equal(past.length, 0);
});

test("paused and expired reminders are not scheduled", () => {
  assert.equal(planLocalHealthNotifications([reminder({ isPaused: true })], NOW).length, 0);
  assert.equal(
    planLocalHealthNotifications([reminder({ endsAt: "2026-09-01T00:00:00Z" })], NOW).length,
    0,
  );
  // An end date still ahead of us stays scheduled.
  assert.equal(
    planLocalHealthNotifications([reminder({ endsAt: "2026-12-01T00:00:00Z" })], NOW).length,
    1,
  );
});

test("a malformed time is skipped rather than scheduled at midnight", () => {
  assert.equal(
    planLocalHealthNotifications([reminder({ scheduleJson: { kind: "daily", time: "" } })], NOW).length,
    0,
  );
  assert.equal(
    planLocalHealthNotifications(
      [reminder({ scheduleJson: { kind: "daily", time: "25:00" } })],
      NOW,
    ).length,
    0,
  );
});

test("the plan stays under the OS limit on pending notifications", () => {
  // iOS holds 64 and silently drops the rest, so exceeding it would lose
  // reminders with no error anywhere.
  const many = Array.from({ length: 80 }, (_, i) => reminder({ id: `r${i}` }));
  const plans = planLocalHealthNotifications(many, NOW);
  assert.equal(plans.length, MAX_LOCAL_HEALTH_NOTIFICATIONS);
  assert.ok(plans.length < 64);
});

test("ids are stable across runs and distinct per reminder and slot", () => {
  // Stability is what makes re-planning REPLACE rather than duplicate; there
  // is no other handle on a notification scheduled in an earlier app launch.
  assert.equal(localNotificationId("abc", 0), localNotificationId("abc", 0));
  assert.notEqual(localNotificationId("abc", 0), localNotificationId("abc", 1));
  assert.notEqual(localNotificationId("abc", 0), localNotificationId("abd", 0));
  const id = localNotificationId("abc", 0);
  assert.ok(Number.isInteger(id) && id > 0 && id < 2 ** 31);
});

test("the notification leaks nothing to a lock screen", () => {
  // A lock screen is readable without unlocking, so the medication name, the
  // dose and the person are all deliberately absent — the details live behind
  // the passcode, in the app.
  const [plan] = planLocalHealthNotifications(
    [reminder({ profileName: "Ava", type: "medication", title: "Amoxicillin", dose: "1 tablet" })],
    NOW,
  );
  assert.equal(plan.title, "Medication reminder");
  assert.equal(plan.body, "Tap to see the details.");
  const text = `${plan.title} ${plan.body}`;
  for (const secret of ["Ava", "Amoxicillin", "1 tablet", "tablet"]) {
    assert.ok(!text.includes(secret), `notification must not contain ${secret}`);
  }
});

test("each reminder type gets its own generic wording", () => {
  const titleFor = (type?: string) =>
    planLocalHealthNotifications([reminder({ type, title: "Amoxicillin" })], NOW)[0].title;
  assert.equal(titleFor("medication"), "Medication reminder");
  assert.equal(titleFor("appointment"), "Appointment reminder");
  assert.equal(titleFor("refill"), "Refill reminder");
  // Unknown or missing type still has to say something, and still says nothing.
  assert.equal(titleFor("something-new"), "Health reminder");
  assert.equal(titleFor(undefined), "Health reminder");
});

// ── Remote-push suppression ─────────────────────────────────────────────────
// 2026-09-28: reminders arrived while the app was open and never once it was
// closed. Scheduling had been rejecting for want of notification permission,
// but the server had already been told to stop sending its own push.

test("the server only goes quiet once iOS confirms every reminder", () => {
  assert.equal(shouldSuppressRemoteHealthPush(3, 3), true);
});

test("a partial or failed schedule leaves the server's push ON", () => {
  // The exact shape of the bug: we asked for three, iOS is holding none.
  assert.equal(shouldSuppressRemoteHealthPush(3, 0), false);
  // Partial acceptance counts as failure too — iOS silently drops anything
  // past its 64-notification ceiling, so "some" is not "all".
  assert.equal(shouldSuppressRemoteHealthPush(3, 2), false);
});

test("with nothing to schedule the server keeps its push", () => {
  // No local reminders means this device is not covering anything, so
  // suppressing the only other delivery path would silence the feature.
  assert.equal(shouldSuppressRemoteHealthPush(0, 0), false);
});

// ── Which dose fired ────────────────────────────────────────────────────────
// The device fires the reminder, so the app has to tell the server WHICH
// occasion it was — that is half the key the event row is stored under, and
// what stops two devices recording one dose twice.

test("a one-off reports itself only once it is due", () => {
  const at = "2026-09-29T18:48:00.000Z";
  const before = new Date("2026-09-29T18:47:00.000Z");
  const after = new Date("2026-09-29T18:49:00.000Z");
  assert.equal(lastOccurrenceAtOrBefore({ kind: "once", at }, before), null);
  assert.equal(lastOccurrenceAtOrBefore({ kind: "once", at }, after)?.toISOString(), at);
});

test("a daily reminder reports today's dose, or yesterday's before the time", () => {
  const sched = { kind: "daily", time: "09:00" } as const;
  const afterNine = new Date(2026, 8, 29, 9, 30);
  assert.equal(lastOccurrenceAtOrBefore(sched, afterNine)?.getDate(), 29);
  assert.equal(lastOccurrenceAtOrBefore(sched, afterNine)?.getHours(), 9);
  // Before today's dose the most recent one is yesterday's — not today's,
  // which has not happened yet.
  const beforeNine = new Date(2026, 8, 29, 8, 30);
  assert.equal(lastOccurrenceAtOrBefore(sched, beforeNine)?.getDate(), 28);
});

test("a weekly reminder skips back to a day it actually runs on", () => {
  // 2026-09-29 is a Tuesday. A Monday-only reminder must report Monday the
  // 28th, not today.
  const sched = { kind: "weekly", time: "09:00", days: [1] } as const;
  const found = lastOccurrenceAtOrBefore(sched, new Date(2026, 8, 29, 12, 0));
  assert.equal(found?.getDate(), 28);
  assert.equal(found?.getDay(), 1);
});

test("a monthly reminder finds the day of the month, even across a month end", () => {
  const sched = { kind: "monthly", time: "08:00", dayOfMonth: 15 } as const;
  const found = lastOccurrenceAtOrBefore(sched, new Date(2026, 8, 3, 12, 0)); // 3 Sept
  assert.equal(found?.getDate(), 15);
  assert.equal(found?.getMonth(), 7); // August
});

test("an unparseable schedule reports nothing rather than guessing", () => {
  assert.equal(lastOccurrenceAtOrBefore({ kind: "daily", time: "nonsense" } as never), null);
  assert.equal(lastOccurrenceAtOrBefore(undefined as never), null);
});
