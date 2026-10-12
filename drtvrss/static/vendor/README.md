# Vendored libraries

Served from here instead of a CDN, so visitors' browsers don't contact a third party.
The files are unmodified copies from jsDelivr, and the pages check them with the
`integrity` hashes below.

| File | Source | License |
|---|---|---|
| `bootstrap-5.3.3.min.css` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css | MIT |
| `hls-1.7.3.min.js` | https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js | Apache-2.0 |
| `plyr-3.8.4.min.js` | https://cdn.jsdelivr.net/npm/plyr@3.8.4/dist/plyr.min.js | MIT |
| `plyr-3.8.4.css` | https://cdn.jsdelivr.net/npm/plyr@3.8.4/dist/plyr.css | MIT |
| `plyr-3.8.4.svg` | https://cdn.jsdelivr.net/npm/plyr@3.8.4/dist/plyr.svg | MIT |
| `schibsted-grotesk-5.3.0-latin.woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/schibsted-grotesk@5.3.0/files/schibsted-grotesk-latin-wght-normal.woff2 | OFL-1.1, see `schibsted-grotesk-LICENSE.txt` |
| `schibsted-grotesk-5.3.0-latin-ext.woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/schibsted-grotesk@5.3.0/files/schibsted-grotesk-latin-ext-wght-normal.woff2 | OFL-1.1 |

Plyr would load its icons and a blank video from its own CDN, so player.js
points it at plyr-3.8.4.svg here instead, and doesn't give it a blank video.

To update one, download the new version under a new name, and update its
`integrity` hash in the templates:
```
$ openssl dgst -sha384 -binary hls-1.7.3.min.js | base64
```
