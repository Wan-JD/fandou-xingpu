-- 经验分享草稿箱，以及“徒弟必须晚于师傅入组”的谱系约束。

-- 草稿只对作者本人可见；发布时记录发布时间。
ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published'));
ALTER TABLE posts ADD COLUMN published_at TEXT;
UPDATE posts SET published_at = created_at WHERE published_at IS NULL;
CREATE INDEX posts_person_status_idx ON posts(person_id, status, created_at DESC);

-- 同级成员不能互为师徒：徒弟的级别年份必须大于师傅。任一方未分级时不做限制。
-- 旧数据不会被改写，只有新的写入需要满足约束。
CREATE TRIGGER people_cohort_order_insert
BEFORE INSERT ON people
WHEN NEW.mentor_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'COHORT_ORDER')
    WHERE COALESCE(NEW.cohort_year, (SELECT year FROM cohorts WHERE id = NEW.cohort_id)) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM people mentor
        WHERE mentor.id = NEW.mentor_id
          AND COALESCE(mentor.cohort_year, (SELECT year FROM cohorts WHERE id = mentor.cohort_id))
            >= COALESCE(NEW.cohort_year, (SELECT year FROM cohorts WHERE id = NEW.cohort_id))
      );
END;

CREATE TRIGGER people_cohort_order_update
BEFORE UPDATE OF mentor_id, cohort_year, cohort_id ON people
BEGIN
  -- This person against their (new) mentor.
  SELECT RAISE(ABORT, 'COHORT_ORDER')
    WHERE NEW.mentor_id IS NOT NULL
      AND COALESCE(NEW.cohort_year, (SELECT year FROM cohorts WHERE id = NEW.cohort_id)) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM people mentor
        WHERE mentor.id = NEW.mentor_id
          AND COALESCE(mentor.cohort_year, (SELECT year FROM cohorts WHERE id = mentor.cohort_id))
            >= COALESCE(NEW.cohort_year, (SELECT year FROM cohorts WHERE id = NEW.cohort_id))
      );
  -- This person against their students when their own cohort moves.
  SELECT RAISE(ABORT, 'COHORT_ORDER')
    WHERE COALESCE(NEW.cohort_year, (SELECT year FROM cohorts WHERE id = NEW.cohort_id)) IS NOT NULL
      AND COALESCE(NEW.cohort_year, -1) IS NOT COALESCE(OLD.cohort_year, -1)
      AND EXISTS (
        SELECT 1 FROM people student
        WHERE student.mentor_id = NEW.id
          AND COALESCE(student.cohort_year, (SELECT year FROM cohorts WHERE id = student.cohort_id))
            <= COALESCE(NEW.cohort_year, (SELECT year FROM cohorts WHERE id = NEW.cohort_id))
      );
END;
