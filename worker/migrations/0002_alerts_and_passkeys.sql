-- Devices that get a notification when a favourite series gets a new episode,
-- under the sync code whose favourites they follow
CREATE TABLE push (
    endpoint TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created REAL NOT NULL
);
CREATE INDEX push_by_code ON push (code);

-- The series among each code's favourites
CREATE TABLE follows (
    code TEXT NOT NULL,
    show TEXT NOT NULL,
    PRIMARY KEY (code, show)
);
CREATE INDEX follows_by_show ON follows (show);

-- What was last seen of each followed series on DR: its newest season, how many seasons
-- it has, and how many episodes the newest has. Nothing yet, until it's first checked.
CREATE TABLE shows (
    show TEXT PRIMARY KEY,
    season TEXT,
    seasons INTEGER,
    episodes INTEGER,
    checked REAL NOT NULL DEFAULT 0
);

-- Notifications waiting to be sent
CREATE TABLE outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    payload TEXT NOT NULL,
    created REAL NOT NULL
);

-- Passkeys, which give a device the sync code they were made for
CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    user TEXT NOT NULL,
    public_key TEXT NOT NULL,
    algorithm INTEGER NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    created REAL NOT NULL,
    used REAL
);
CREATE INDEX passkeys_by_code ON passkeys (code);

-- What a passkey is asked to sign, each used once
CREATE TABLE challenges (
    challenge TEXT PRIMARY KEY,
    code TEXT,
    expires REAL NOT NULL
);
