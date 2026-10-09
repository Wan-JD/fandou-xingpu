-- 为成员档案增加毕业或发展去向。NULL 表示尚未填写。
ALTER TABLE people ADD COLUMN destination TEXT
  CHECK (
    destination IS NULL OR destination IN (
      'big_tech',
      'postgraduate_985',
      'postgraduate_211',
      'startup',
      'further_study',
      'other'
    )
  );
