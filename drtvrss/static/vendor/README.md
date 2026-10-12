# Vendored libraries

Served from here instead of a CDN, so visitors' browsers don't contact a third party.
The files are unmodified copies from jsDelivr, and the pages check them with the
`integrity` hashes below.

| File | Source | License |
|---|---|---|
| `bootstrap-5.3.3.min.css` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css | MIT |
| `hls-1.7.3.min.js` | https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js | Apache-2.0 |

To update one, download the new version under a new name, and update its
`integrity` hash in the templates:
```
$ openssl dgst -sha384 -binary hls-1.7.3.min.js | base64
```
