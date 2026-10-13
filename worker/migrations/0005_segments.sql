-- Where intros and credits are in DR's videos, as viewers with accounts have marked them,
-- each mark under the account that made it. Only times, in seconds.
CREATE TABLE segments (
    video TEXT NOT NULL,
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    start REAL NOT NULL,
    "end" REAL NOT NULL,
    duration REAL NOT NULL,
    -- "marked" with the marking tool, or "answered" with a yes to "Sprang du introen over?"
    source TEXT NOT NULL,
    created REAL NOT NULL,
    PRIMARY KEY (video, kind, code)
);
CREATE INDEX segments_by_code ON segments (code, created);

-- "Forkert?", and confirmations, each account's once
CREATE TABLE segment_votes (
    video TEXT NOT NULL,
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    vote INTEGER NOT NULL,
    created REAL NOT NULL,
    PRIMARY KEY (video, kind, code)
);
