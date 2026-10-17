-- DR's whole catalogue, from its list of everything from A to Å, which the catalogue's cron goes through once a day,
-- with what each title's own item says. See src/catalogue.ts.
CREATE TABLE titles (
    -- DR's id, like 540736
    id TEXT PRIMARY KEY,
    -- The row of DR's list from A to Å it's on, like "M"
    letter TEXT NOT NULL,
    -- What's kept of it from DR's list, and from its own item and newest season, as JSON
    item TEXT NOT NULL,
    details TEXT,
    -- Of item, so only what changed is written again
    hash TEXT NOT NULL,
    -- When it was first seen, in milliseconds, or 0 for what DR had when the catalogue began
    first_seen REAL NOT NULL,
    -- When DR's list didn't have it, until its own item says whether it's gone, and since then if it is
    missing_since REAL,
    -- When its own item is looked up next, in milliseconds
    details_due REAL NOT NULL DEFAULT 0,
    -- The names of DR's own rows it's on, as JSON, like ["Store danske serier"]
    rows TEXT,
    -- What the browser gets of it, as JSON, made from the above, and whether it must be made again
    entry TEXT,
    stale INTEGER NOT NULL DEFAULT 1,
    -- From entry, for finding them: its kind, or null for what isn't shown, like news; whether it's for children;
    -- when it leaves DR, and when it came, in milliseconds
    kind TEXT,
    kids INTEGER NOT NULL DEFAULT 0,
    expires REAL,
    added REAL
);
CREATE INDEX titles_by_letter ON titles (letter);
CREATE INDEX titles_by_due ON titles (details_due);
CREATE INDEX titles_stale ON titles (stale) WHERE stale = 1;

-- The few things the catalogue's cron keeps besides, by name, as JSON: where its sweep is, how the last one went,
-- the catalogue's version, and the front page's own rows
CREATE TABLE catalogue (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- The ids on each page of DR's list of the letter a sweep is at, for what's on none of them, once it has all of them
CREATE TABLE catalogue_pages (
    letter TEXT NOT NULL,
    page INTEGER NOT NULL,
    ids TEXT NOT NULL,
    PRIMARY KEY (letter, page)
);
