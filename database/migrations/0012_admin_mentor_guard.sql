-- Allow the active super administrator to manage lineage nodes while keeping
-- ordinary cohort guests out of the mentor chain. The original trigger only
-- looked at people.relation_scope, so an administrator bootstrap profile
-- stored as cohort_guest could not create a real student node.

DROP TRIGGER IF EXISTS people_mentor_guard_insert;
DROP TRIGGER IF EXISTS people_mentor_guard_update;

CREATE TRIGGER people_mentor_guard_insert
BEFORE INSERT ON people
BEGIN
  SELECT RAISE(ABORT, 'SCOPE_MENTOR_CONFLICT')
    WHERE NEW.relation_scope = 'cohort_guest' AND NEW.mentor_id IS NOT NULL;
  SELECT RAISE(ABORT, 'MENTOR_SELF')
    WHERE NEW.mentor_id IS NOT NULL AND NEW.mentor_id = NEW.id;
  SELECT RAISE(ABORT, 'MENTOR_NOT_FOUND')
    WHERE NEW.mentor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.mentor_id);
  SELECT RAISE(ABORT, 'MENTOR_NOT_LINEAGE')
    WHERE NEW.mentor_id IS NOT NULL
      AND NEW.relation_scope = 'lineage'
      AND EXISTS (
        SELECT 1
        FROM people mentor
        WHERE mentor.id = NEW.mentor_id
          AND mentor.relation_scope <> 'lineage'
          AND NOT EXISTS (
            SELECT 1 FROM users admin_account
            WHERE admin_account.person_id = mentor.id
              AND admin_account.role = 'admin'
              AND admin_account.status = 'active'
          )
      );
END;

CREATE TRIGGER people_mentor_guard_update
BEFORE UPDATE OF mentor_id, relation_scope ON people
BEGIN
  SELECT RAISE(ABORT, 'SCOPE_MENTOR_CONFLICT')
    WHERE NEW.relation_scope = 'cohort_guest' AND NEW.mentor_id IS NOT NULL;
  SELECT RAISE(ABORT, 'MENTOR_SELF')
    WHERE NEW.mentor_id IS NOT NULL AND NEW.mentor_id = NEW.id;
  SELECT RAISE(ABORT, 'MENTOR_NOT_FOUND')
    WHERE NEW.mentor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.mentor_id);
  SELECT RAISE(ABORT, 'MENTOR_NOT_LINEAGE')
    WHERE NEW.mentor_id IS NOT NULL
      AND NEW.relation_scope = 'lineage'
      AND EXISTS (
        SELECT 1
        FROM people mentor
        WHERE mentor.id = NEW.mentor_id
          AND mentor.relation_scope <> 'lineage'
          AND NOT EXISTS (
            SELECT 1 FROM users admin_account
            WHERE admin_account.person_id = mentor.id
              AND admin_account.role = 'admin'
              AND admin_account.status = 'active'
          )
      );
  SELECT RAISE(ABORT, 'HAS_LINEAGE_STUDENTS')
    WHERE NEW.relation_scope = 'cohort_guest'
      AND EXISTS (
        SELECT 1 FROM people WHERE mentor_id = NEW.id AND relation_scope = 'lineage'
      );
  SELECT RAISE(ABORT, 'MENTOR_CYCLE')
    WHERE NEW.mentor_id IS NOT NULL
      AND EXISTS (
        WITH RECURSIVE ancestors(id) AS (
          SELECT NEW.mentor_id
          UNION
          SELECT p.mentor_id
          FROM people p
          JOIN ancestors a ON p.id = a.id
          WHERE p.mentor_id IS NOT NULL
        )
        SELECT 1 FROM ancestors WHERE id = NEW.id
      );
END;
