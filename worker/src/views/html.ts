// Writing HTML. Pages are written as text with html`...`, which escapes what's put in it,
// since that's many times faster than building elements first, and the free plan gives
// a visit only 10 ms of the processor.

/** HTML, which is put in other HTML as it is */
export class Html {
	constructor(readonly text: string) {}

	toString() {
		return this.text;
	}
}

const SPECIAL = /[&<>"']/;
const ENTITIES: Record<string, string> = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};

export function escape(text: string): string {
	if (!SPECIAL.test(text)) {
		return text;
	}
	// Mostly DR's image URLs, like ResizeImage/$value?Format='jpg'&Quality=85&..., which come up again and again
	let found = escaped.get(text);
	if (found === undefined) {
		if (escaped.size > MAX_ESCAPED) {
			escaped.clear();
		}
		found = text.replace(/[&<>"']/g, c => ENTITIES[c]);
		escaped.set(text, found);
	}
	return found;
}

const escaped = new Map<string, string>();
const MAX_ESCAPED = 20_000;

/** What can be put in HTML: text, which is escaped, HTML, or nothing */
export type Content = Html | string | number | boolean | null | undefined | Content[];

function piece(value: Content): string {
	if (value instanceof Html) {
		return value.text;
	}
	if (typeof value == "string") {
		return escape(value);
	}
	if (typeof value == "number") {
		return String(value);
	}
	if (Array.isArray(value)) {
		let out = "";
		for (const v of value) {
			out += piece(v);
		}
		return out;
	}
	// Nothing, for things like ${shown && html`...`}
	return "";
}

export function html(strings: TemplateStringsArray, ...values: Content[]): Html {
	let out = strings[0];
	for (let i = 0; i < values.length; i++) {
		out += piece(values[i]) + strings[i + 1];
	}
	return new Html(out);
}

/** Text that is HTML already */
export function raw(text: string): Html {
	return new Html(text);
}

/** An attribute, like ` data-video-id="503615"`, or nothing without a value */
export function attr(name: string, value: string | number | null | undefined | false): Html | "" {
	if (value === undefined || value === null || value === false) {
		return "";
	}
	return new Html(` ${name}="${escape(String(value))}"`);
}

/** Each of items as HTML, one after the other */
export function each<T>(items: T[], f: (item: T, i: number) => Html): Html {
	let out = "";
	for (let i = 0; i < items.length; i++) {
		out += f(items[i], i).text;
	}
	return new Html(out);
}

/** JSON that's safe inside a <script> */
export function scriptJSON(value: unknown): Html {
	return new Html(JSON.stringify(value).replace(/</g, "\\u003c"));
}
