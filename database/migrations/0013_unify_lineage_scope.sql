-- All people now live in one lineage. Keep the legacy relation_scope column for
-- compatibility with older clients, but normalize historical guest records.
UPDATE people SET relation_scope = 'lineage' WHERE relation_scope = 'cohort_guest';
