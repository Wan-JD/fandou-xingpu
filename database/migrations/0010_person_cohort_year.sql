-- 级别由成员入谱年份直接表示，不再依赖手动维护的 cohorts 记录。
-- 保留旧列用于兼容历史数据和回滚读取；新写入应使用 cohort_year。
ALTER TABLE people ADD COLUMN cohort_year INTEGER;

UPDATE people
SET cohort_year = (
  SELECT c.year
  FROM cohorts c
  WHERE c.id = people.cohort_id
)
WHERE cohort_year IS NULL AND cohort_id IS NOT NULL;

CREATE INDEX people_cohort_year_idx ON people(cohort_year, relation_scope, status);
