-- When a followed series leaves DR, in milliseconds, and the date its followers were last told it's leaving
ALTER TABLE shows ADD COLUMN expires REAL;
ALTER TABLE shows ADD COLUMN leaving_notified REAL;
