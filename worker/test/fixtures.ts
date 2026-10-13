// Where the fixtures of DR's answers are, in ../tests/fixtures

/** Named after its path in the API, as tests/update_fixtures.py saves them */
export function fixtureName(path: string, params: URLSearchParams): string {
	if (path == "/page") {
		return "page_" + (params.get("path")!.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") || "front") + ".json";
	}
	return path.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") + ".json";
}
