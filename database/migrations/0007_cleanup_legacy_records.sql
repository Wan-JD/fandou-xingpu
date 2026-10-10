-- Remove legacy seeded records and the historical account marker.
-- The predicates target only the historical seeded ids and legacy account email.
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

DELETE FROM auth_sessions
WHERE user_id IN (
  SELECT id FROM users
  WHERE id = 'demo-account-001' OR lower(email) = 'demo@fandou.local' OR is_local_demo = 1
);

DELETE FROM invitations
WHERE mentor_id LIKE 'demo-person-%' OR accepted_person_id LIKE 'demo-person-%';

DELETE FROM users
WHERE id = 'demo-account-001' OR lower(email) = 'demo@fandou.local' OR is_local_demo = 1;

DELETE FROM people
WHERE id IN (
  'demo-person-001', 'demo-person-002', 'demo-person-003',
  'demo-person-004', 'demo-person-005', 'demo-person-006'
);

DELETE FROM cohorts
WHERE id IN ('cohort-2019', 'cohort-2021', 'cohort-2023', 'cohort-2024')
  AND NOT EXISTS (SELECT 1 FROM people WHERE people.cohort_id = cohorts.id);

ALTER TABLE users DROP COLUMN is_local_demo;

COMMIT;
