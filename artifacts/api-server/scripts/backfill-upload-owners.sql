-- Backfill uploaded_files.user_id
--
-- Every upload before 2026-09-19 was stored with no owner: the route read
-- `req.user?.id`, which does not exist on this codebase's auth shape, so the
-- value was undefined on every single upload and the nullable column accepted
-- it silently.
--
-- The uploaded_files row itself cannot say who owns it, so the owner is
-- recovered from whatever REFERENCES the object path. Four tables carry one
-- today; re-check before running, because a fifth may have been added:
--     grep -rn 'photo_url\|image_url' lib/db/src/schema/
--
-- Safe to run more than once: every statement is scoped to `user_id IS NULL`.
-- Nothing is ever deleted here.
--
-- Run it inside a transaction and read the counts before committing:
--     psql "$DATABASE_URL" -1 -f backfill-upload-owners.sql

\echo '--- before ---'
SELECT count(*) FILTER (WHERE user_id IS NULL) AS unowned,
       count(*)                                AS total
FROM uploaded_files;

-- 1. Profile photos. profiles.user_id IS the family owner id.
UPDATE uploaded_files f
SET user_id = p.user_id
FROM profiles p
WHERE f.user_id IS NULL
  AND p.user_id IS NOT NULL
  AND p.photo_url = '/objects/uploads/' || f.id;

-- 2. Celebration photos. celebration_photos has no user_id of its own, so go
--    through the celebration it belongs to.
UPDATE uploaded_files f
SET user_id = c.user_id
FROM celebration_photos cp
JOIN celebrations c ON c.id = cp.celebration_id
WHERE f.user_id IS NULL
  AND c.user_id IS NOT NULL
  AND cp.image_url = '/objects/uploads/' || f.id;

-- 3. Wishlist items.
UPDATE uploaded_files f
SET user_id = w.user_id
FROM wishlist_items w
WHERE f.user_id IS NULL
  AND w.user_id IS NOT NULL
  AND w.photo_url = '/objects/uploads/' || f.id;

-- 4. Savings goals.
UPDATE uploaded_files f
SET user_id = g.user_id
FROM savings_goals g
WHERE f.user_id IS NULL
  AND g.user_id IS NOT NULL
  AND g.photo_url = '/objects/uploads/' || f.id;

\echo '--- after ---'
SELECT count(*) FILTER (WHERE user_id IS NULL) AS still_unowned,
       count(*)                                AS total
FROM uploaded_files;

-- Whatever is still unowned is genuinely orphaned: uploaded and then replaced,
-- or referenced from somewhere not listed above. DO NOT DELETE IT as part of
-- this work — note the count and handle it deliberately, after the signed-URL
-- change lands and there is a way to tell "orphaned" from "not yet enumerated".
--
-- To see how much space it is costing:
--     SELECT pg_size_pretty(sum(octet_length(data))::bigint)
--     FROM uploaded_files WHERE user_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- UNRELATED TO THIS FILE'S BACKFILL, but run it at the same time:
-- before `pnpm --filter @workspace/db push` applies the 2026-09-21 index
-- changes, check nothing would violate the newly-real unique constraint.
--
-- calendar_assignments_unique_idx was declared as a PLAIN index despite its
-- name, so it enforced nothing. Making it unique fails the push if duplicates
-- already exist. Expect zero rows:
--
--   SELECT calendar_type, calendar_id, profile_id, count(*)
--   FROM calendar_assignments
--   GROUP BY 1, 2, 3 HAVING count(*) > 1;
--
-- If any come back, keep the most recently updated row of each group and
-- delete the rest BY HAND before pushing — which to keep is a judgement call,
-- not something to automate.
--
-- The Google event-assignment key widens from (calendar_id, event_id) to
-- (user_id, calendar_id, event_id). Widening a unique key can never create a
-- violation, so that one needs no check.

-- Also new on 2026-09-21: calendar_settings.user_id and location_settings.user_id
-- gained a real unique index. Expect zero rows from each:
--
--   SELECT user_id, count(*) FROM calendar_settings GROUP BY 1 HAVING count(*) > 1;
--   SELECT user_id, count(*) FROM location_settings GROUP BY 1 HAVING count(*) > 1;
--
-- ⚠️ Both columns are still NULLABLE. Postgres treats NULLs as distinct, so a
-- legacy row with no user_id does not collide and will survive the push. The
-- application never writes NULL any more (userId is required by the update
-- signature), so this only concerns rows predating the family model. To find
-- and deal with one:
--
--   SELECT * FROM calendar_settings WHERE user_id IS NULL;
--   SELECT * FROM location_settings  WHERE user_id IS NULL;
--
-- Adopt it (set user_id to the owner) or delete it BY HAND, then the columns
-- can be made NOT NULL. Left nullable here deliberately: a NOT NULL migration
-- that hits an existing NULL fails the whole deploy, and that is not a trade
-- worth making automatically.
