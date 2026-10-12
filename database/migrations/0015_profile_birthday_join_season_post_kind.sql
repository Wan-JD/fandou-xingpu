-- 生日、进组季节和动态类型。
ALTER TABLE people ADD COLUMN birthday TEXT CHECK (
  birthday IS NULL OR (
    length(birthday) = 10
    AND birthday GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND CAST(substr(birthday, 1, 4) AS INTEGER) BETWEEN 1900 AND 2200
    AND CAST(substr(birthday, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    AND CAST(substr(birthday, 9, 2) AS INTEGER) BETWEEN 1 AND CASE CAST(substr(birthday, 6, 2) AS INTEGER)
      WHEN 2 THEN CASE
        WHEN CAST(substr(birthday, 1, 4) AS INTEGER) % 400 = 0
          OR (CAST(substr(birthday, 1, 4) AS INTEGER) % 4 = 0 AND CAST(substr(birthday, 1, 4) AS INTEGER) % 100 <> 0)
        THEN 29 ELSE 28 END
      WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
      ELSE 31 END
  )
);

-- 旧数据按原日期所在半年归并为春季/秋季，今后继续复用 joined_at 列。
UPDATE people
SET joined_at = substr(COALESCE(joined_at, created_at), 1, 4)
  || CASE WHEN CAST(substr(COALESCE(joined_at, created_at), 6, 2) AS INTEGER) < 9
    THEN '-03-01' ELSE '-09-01' END;

ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'note'
  CHECK (kind IN ('note', 'experience'));
