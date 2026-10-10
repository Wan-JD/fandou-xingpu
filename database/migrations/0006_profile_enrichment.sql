-- Structured personal profile fields. JSON columns keep the first release flexible
-- while preserving optimistic version updates on the people row.
ALTER TABLE people ADD COLUMN contact_email TEXT;
ALTER TABLE people ADD COLUMN education TEXT;
ALTER TABLE people ADD COLUMN experience TEXT;
ALTER TABLE people ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE people ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]';
