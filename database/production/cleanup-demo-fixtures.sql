-- Run explicitly on a brand-new production database immediately after all migrations.
-- Do not run after real data has been added. Local development keeps these fictional fixtures.
PRAGMA foreign_keys = ON;

DELETE FROM auth_sessions WHERE user_id = 'demo-account-001';
DELETE FROM invitations WHERE mentor_id LIKE 'demo-person-%' OR accepted_person_id LIKE 'demo-person-%';
DELETE FROM users WHERE id = 'demo-account-001' OR lower(email) = 'demo@fandou.local';
DELETE FROM people WHERE id IN (
  'demo-person-001', 'demo-person-002', 'demo-person-003',
  'demo-person-004', 'demo-person-005', 'demo-person-006'
);
DELETE FROM cohorts WHERE id IN ('cohort-2019', 'cohort-2021', 'cohort-2023', 'cohort-2024')
  AND NOT EXISTS (SELECT 1 FROM people WHERE people.cohort_id = cohorts.id);
