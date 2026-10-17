// The catalogue's version: its cron makes all of the entries again after an update that changes it, which takes hours.
// It's a hash of src/entries.ts bundled as the Worker has it, with only the code of other files that it uses, and the
// filters in ../drtvrss/facets.json, without comments, so an update to anything else, like the series' pages, or to
// a comment, makes none of them again. esbuild is pinned in package.json, since a new one may bundle it differently.
import {createHash} from "node:crypto";
import {buildSync} from "esbuild";

/** The catalogue's version, of the Worker in `root` */
export function catalogueVersion(root) {
    const bundled = buildSync({
        absWorkingDir: root,
        entryPoints: ["src/entries.ts"],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        minify: true,
        legalComments: "none",
        // What the build writes is left out, as it has the versions of other things
        external: ["cloudflare:*", "node:*", "*-version.json", "*-versions.json"],
    });
    return createHash("sha256").update(bundled.outputFiles[0].contents).digest("hex").slice(0, 12);
}
