// Where the fixtures of DR's answers are, in ../tests/fixtures

/**
 * Named after its path in the API, as tests/update_fixtures.py saves them, and a letter of DR's list from A to Å
 * after its letter, like lists_348_m.json for /lists/348?param=TitleGroupKey:m
 */
export function fixtureName(path: string, params: URLSearchParams): string {
	if (path == "/page") {
		return "page_" + (params.get("path")!.replace(/^\/+|\/+$/g, "").replaceAll("/", "_") || "front") + ".json";
	}
	const name = path.replace(/^\/+|\/+$/g, "").replaceAll("/", "_");
	const letter = /^TitleGroupKey:(.+)$/.exec(params.get("param") ?? "")?.[1];
	return (letter ? `${name}_${letter.toLowerCase().replaceAll("æ", "ae").replaceAll("ø", "oe").replaceAll("å", "aa")}` : name) + ".json";
}
