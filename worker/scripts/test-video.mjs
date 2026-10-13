// Makes the test video that the player plays locally instead of DR's streams, see test/browser:
// 90 seconds as HLS, with its time on the picture, a tone, an intro from 0:05 to 0:20,
// credits from 1:15, and Danish subtitles. VP9 and Opus, which Playwright's Chromium plays,
// unlike H.264. Needs ffmpeg; the files are committed, so only changing the video needs it.
import {execFileSync} from "node:child_process";
import {mkdirSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "test", "browser", "video");

export const DURATION = 90;
export const INTRO = {start: 5, end: 20};
export const CREDITS = 75;

const font = execFileSync("fc-match", ["-f", "%{file}", "DejaVu Sans:bold"], {encoding: "utf8"});
const text = (what, extra = "") => `drawtext=fontfile=${font}:fontcolor=0xf3efe6:${what}${extra}`;
const between = (from, to) => `:enable='between(t,${from},${to})'`;
const picture = [
    text("text='dktv testvideo':fontsize=22:x=24:y=20"),
    text("text='%{eif\\:floor(t/60)\\:d}\\:%{eif\\:mod(floor(t),60)\\:d\\:2}':fontsize=96:x=(w-tw)/2:y=(h-th)/2"),
    text("text='Intro':fontsize=36:x=(w-tw)/2:y=h-80", between(INTRO.start, INTRO.end)),
    text("text='Rulletekster':fontsize=36:x=(w-tw)/2:y=h-80", between(CREDITS, DURATION)),
].join(",");

rmSync(target, {recursive: true, force: true});
mkdirSync(target, {recursive: true});
execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x0f1013:s=640x360:r=25:d=${DURATION}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${DURATION}`,
    "-vf", picture,
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "56", "-deadline", "good", "-row-mt", "1", "-g", "50",
    "-c:a", "libopus", "-ac", "1", "-b:a", "12k", "-af", "volume=0.1",
    "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4",
    // One file, which the playlist has the parts of, so the test server has only it to serve
    "-hls_flags", "single_file", "-hls_segment_filename", join(target, "video.mp4"),
    join(target, "video.m3u8"),
], {stdio: "inherit"});

const clock = s => `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;
const cues = [[1, 4, "Undertekster til testvideoen"], [INTRO.start, INTRO.end, "Her er introen"], [CREDITS, DURATION, "Og her rulleteksterne"]];
writeFileSync(join(target, "subtitles.vtt"), "WEBVTT\n\n" + cues.map(([from, to, line]) => `${clock(from)} --> ${clock(to)}\n${line}\n`).join("\n"));
console.log("The test video is in test/browser/video:", readdirSync(target).join(", "));
