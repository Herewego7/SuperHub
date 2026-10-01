-- Keep every existing account free before subscription enforcement goes on.
--
-- Decided 2026-09-30: every account that exists when enforcement is switched
-- on keeps full access free. Accounts from before the trial system are
-- already comped (the column defaults to true, and an account with no row
-- gets a comped one the first time it is checked). Accounts created since were
-- given a 14-day trial instead, and would lose access when it ended. This
-- comps those.
--
-- ONE account is deliberately left on its trial: chadcgiles1@gmail.com, the
-- App Review sign-in. Subscribe Now only appears for an account with
-- something to buy, so comping it would stop the reviewer testing the
-- purchase.
--
-- ⚠️ Run against the PRODUCTION database (Replit's Database tool, production),
-- not `psql "$DATABASE_URL"` in the Shell, which is a different database.
-- Safe to run more than once. Nothing is deleted. New signups after this still
-- get their trial, because it only touches rows that exist when it runs.

-- 1. Preview: the accounts that will be changed.
SELECT u.email, e.trial_ends_at, e.apple_subscription_state
FROM entitlements e JOIN users u ON u.id = e.user_id
WHERE e.is_comped = false
  AND lower(coalesce(u.email, '')) <> 'chadcgiles1@gmail.com'
ORDER BY u.email;

-- 2. Comp them.
UPDATE entitlements e
SET is_comped = true, comped_reason = 'grandfathered at launch', updated_at = now()
FROM users u
WHERE u.id = e.user_id
  AND e.is_comped = false
  AND lower(coalesce(u.email, '')) <> 'chadcgiles1@gmail.com';

-- 3. Check: this should list only chadcgiles1@gmail.com (or nothing).
SELECT u.email, e.is_comped, e.trial_ends_at
FROM entitlements e JOIN users u ON u.id = e.user_id
WHERE e.is_comped = false;
