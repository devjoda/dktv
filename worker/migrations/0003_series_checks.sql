-- A series' title, for its notifications, and when it was last checked for a new season,
-- which is less often than for new episodes in its newest one
ALTER TABLE shows ADD COLUMN title TEXT;
ALTER TABLE shows ADD COLUMN seasons_checked REAL NOT NULL DEFAULT 0;

-- Each notification carries the keys of the device it's for, so a run can take it from the
-- outbox and send it, without another run sending it too
ALTER TABLE outbox ADD COLUMN p256dh TEXT;
ALTER TABLE outbox ADD COLUMN auth TEXT;
