-- What the catalogue's cron makes the entries of first: stale is 1 for a title that changed, or has none yet, and 2 for
-- one that's only made again after an update that makes entries differently, which waits for those. See src/catalogue.ts.
CREATE INDEX titles_to_make ON titles (stale) WHERE stale > 0;
