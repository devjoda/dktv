// Gets the browser's files ready to be served: copies them from ../drtvrss/static into public/,
// and notes a version of each of ours, for their URLs to change along with them.
// Only what changed is written, since `wrangler dev` builds again whenever a file changes.
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {catalogueVersion} from "./catalogue-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "drtvrss", "static");
const target = join(root, "public");

function write(path, content) {
    if (existsSync(path) && readFileSync(path).equals(Buffer.from(content))) {
        return;
    }
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
}

function files(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

const wanted = new Map();
for (const path of files(source)) {
    wanted.set(join("static", relative(source, path)), readFileSync(path));
}
// From the root, so it may keep images for every page
wanted.set("sw.js", readFileSync(join(source, "sw.js")));
wanted.set("favicon.ico", readFileSync(join(root, "..", "drtvrss", "templates", "favicon.ico")));
wanted.set("favicon.svg", readFileSync(join(root, "..", "drtvrss", "templates", "favicon.svg")));
// Our own files' URLs change with them, so browsers may keep them for good.
// The libraries have their versions in their names.
wanted.set("_headers", `/static/*
  Cache-Control: public, max-age=31536000, immutable
/sw.js
  Cache-Control: no-cache
/favicon.ico
  Cache-Control: public, max-age=86400
/favicon.svg
  Cache-Control: public, max-age=86400
`);

for (const [path, content] of wanted) {
    write(join(target, path), content);
}
if (existsSync(target)) {
    for (const path of files(target)) {
        if (!wanted.has(relative(target, path))) {
            rmSync(path);
        }
    }
}

const versions = {};
for (const name of readdirSync(source)) {
    if (/\.(js|css|webmanifest)$/.test(name)) {
        versions[name] = createHash("sha256").update(readFileSync(join(source, name))).digest("hex").slice(0, 12);
    }
}
write(join(root, "src", "static-versions.json"), JSON.stringify(versions, null, 1) + "\n");

// What the Worker keeps of DR's data changes along with the code that makes it, so a new
// version of that code doesn't read what an older one kept
const keeping = createHash("sha256");
for (const name of ["cache.ts", "discover.ts", "live.ts", "models.ts", "search.ts", "show.ts"]) {
    keeping.update(readFileSync(join(root, "src", name)));
}
write(join(root, "src", "kept-version.json"), JSON.stringify({version: keeping.digest("hex").slice(0, 12)}) + "\n");

// The catalogue's entries change along with the code and the filters that make them, so the catalogue's cron makes
// them again after an update that changes them, and not after one that only changes the cron
write(join(root, "src", "catalogue-version.json"), JSON.stringify({version: catalogueVersion(root)}) + "\n");
console.log("The browser's files are in public/");
