-- 头像和简历各自只有一个可用版本；替换操作在同一 D1 batch 内完成。
UPDATE attachments
SET status = 'deleted', updated_at = datetime('now')
WHERE status = 'ready'
  AND category IN ('avatar', 'resume')
  AND EXISTS (
    SELECT 1 FROM attachments newer
    WHERE newer.person_id = attachments.person_id
      AND newer.category = attachments.category
      AND newer.status = 'ready'
      AND (newer.created_at > attachments.created_at OR (newer.created_at = attachments.created_at AND newer.id > attachments.id))
  );

CREATE UNIQUE INDEX attachments_single_slot_ready_idx
  ON attachments(person_id, category)
  WHERE category IN ('avatar', 'resume') AND status = 'ready';
