-- What's kept under each sync code: the favourites and progress of one viewer's devices.
-- version goes up with every change, so two devices syncing at once don't lose each other's changes.
CREATE TABLE sync (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated REAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 0
);
