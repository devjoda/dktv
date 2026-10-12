import {describe, expect, test} from "vitest";
import * as sync from "../src/sync";
import {env, get, post, request} from "./helpers";

function progress(time: number, updated: number, extra: Record<string, unknown> = {}) {
	return {time, duration: 3600, watched: false, updated, title: "1. episode", url: "/show_1/ep_1", ...extra};
}

const dashed = (code: string) => [code.slice(0, 4), code.slice(4, 8), code.slice(8, 12), code.slice(12)].join("-");

describe("codes", () => {
	test("are long, and can be typed with dashes and in lower case", () => {
		const code = sync.newCode();
		expect(code).toHaveLength(16);
		expect(sync.normalizeCode(code)).toBe(code);
		expect(sync.normalizeCode(dashed(code).toLowerCase())).toBe(code);
		expect(sync.normalizeCode("ABCD")).toBeUndefined();
		// Not in codes, since they're mixed up with 1 and 0
		expect(sync.normalizeCode("IIIIOOOOIIIIOOOO")).toBeUndefined();
	});

	test("use every letter", () => {
		const letters = new Set(Array.from({length: 200}, sync.newCode).join(""));
		expect(letters.size).toBe(sync.ALPHABET.length);
	});
});

describe("merging", () => {
	test("the newest progress wins", () => {
		const a = sync.clean({progress: {"1": progress(100, 1000), "2": progress(50, 3000)}});
		const b = sync.clean({progress: {"1": progress(900, 2000), "2": progress(10, 2000), "3": progress(5, 1)}});
		const merged = sync.merge(a, b).progress;
		expect(merged["1"].time).toBe(900);
		expect(merged["2"].time).toBe(50);
		expect(merged["3"].time).toBe(5);
	});

	test("the newest of adding or removing a favourite wins", () => {
		const phone = sync.clean({favorites: [{id: "matador_1", title: "Matador", added: 100}]});
		const laptop = sync.clean({removed_favorites: {matador_1: 200}, favorites: [{id: "rejseholdet_2", title: "Rejseholdet", added: 50}]});
		let merged = sync.merge(phone, laptop);
		expect(merged.favorites.map(f => f.id)).toEqual(["rejseholdet_2"]);
		expect(merged.removed_favorites).toEqual({matador_1: 200});
		// And made a favourite again, later
		const again = sync.clean({favorites: [{id: "matador_1", title: "Matador", added: 300}]});
		merged = sync.merge(merged, again);
		expect(merged.favorites.map(f => f.id)).toEqual(["matador_1", "rejseholdet_2"]);
		expect(merged.removed_favorites).toEqual({});
	});

	test("favourite films stay films", () => {
		const cleaned = sync.clean({favorites: [{id: "film_1", kind: "film", added: 1}, {id: "show_2", added: 2}, {id: "x_3", kind: "other", added: 3}]});
		expect(cleaned.favorites.map(f => f.kind)).toEqual(["film", "show", "show"]);
	});

	test("what devices send is checked", () => {
		const cleaned = sync.clean({
			favorites: [{id: "../../etc", title: "x", added: 1}, {id: "matador_1", image: "javascript:alert(1)", added: 1}],
			removed_favorites: {ok_1: "yesterday", ok_2: 5},
			progress: {
				"123": progress(10, 5, {url: "javascript:alert(1)", image: "http://example.com/x.jpg"}),
				"456": progress(10, 5, {url: "//evil.example/"}),
				"not-an-id": progress(1, 1),
				"789": {time: "soon"},
			},
			other: "ignored",
		});
		expect(cleaned.favorites.map(f => f.id)).toEqual(["matador_1"]);
		expect(cleaned.favorites[0].image).toBeNull();
		expect(cleaned.removed_favorites).toEqual({ok_2: 5});
		expect(Object.keys(cleaned.progress).sort()).toEqual(["123", "456"]);
		expect(cleaned.progress["123"].url).toBeNull();
		expect(cleaned.progress["123"].image).toBeNull();
		expect(cleaned.progress["456"].url).toBeNull();
		expect(() => sync.clean(["not", "an", "object"])).toThrow(TypeError);
	});
});

describe("syncing", () => {
	test("between two devices", async () => {
		const r = await post("/sync/");
		expect(r.status).toBe(201);
		const code = JSON.parse(r.text).code;

		const phone = {favorites: [{id: "matador_540736", title: "Matador", added: 100}], progress: {"503615": progress(600, 1000)}};
		const fromPhone = await post(`/sync/${code}`, phone);
		expect(fromPhone.status).toBe(200);
		expect(JSON.parse(fromPhone.text).favorites[0].id).toBe("matador_540736");

		// The code can be typed with dashes and in lower case
		const laptop = {progress: {"503615": progress(1200, 2000), "503640": progress(30, 1500)}};
		const merged = JSON.parse((await post(`/sync/${dashed(code).toLowerCase()}`, laptop)).text);
		expect(merged.favorites.map((f: {id: string}) => f.id)).toEqual(["matador_540736"]);
		expect(merged.progress["503615"].time).toBe(1200);
		expect(Object.keys(merged.progress).sort()).toEqual(["503615", "503640"]);

		expect((await request(`/sync/${code}`, {method: "DELETE"})).status).toBe(204);
		expect((await post(`/sync/${code}`, phone)).status).toBe(404);
	});

	test("when another device synced at the same time, its changes are kept too", async () => {
		const code = JSON.parse((await post("/sync/")).text).code;
		const database = env.SYNC;
		let interrupted = false;
		// The phone syncs between the laptop's reading and its writing
		env.SYNC = {
			prepare(sql: string) {
				const statement = database.prepare(sql);
				if (!sql.startsWith("UPDATE") || interrupted) {
					return statement;
				}
				return {
					bind(...args: unknown[]) {
						const bound = statement.bind(...args);
						return {
							async run() {
								interrupted = true;
								await post(`/sync/${code}`, {favorites: [{id: "matador_1", title: "Matador", added: 100}]});
								return bound.run();
							},
						};
					},
				};
			},
		} as unknown as D1Database;
		const merged = JSON.parse((await post(`/sync/${code}`, {progress: {"503615": progress(600, 1000)}})).text);
		env.SYNC = database;
		expect(merged.favorites.map((f: {id: string}) => f.id)).toEqual(["matador_1"]);
		expect(Object.keys(merged.progress)).toEqual(["503615"]);
	});

	test("unknown codes, and what isn't JSON", async () => {
		expect((await post("/sync/ABCD-EFGH-JKMN-PQRS", {})).status).toBe(404);
		expect((await post("/sync/not-a-code", {})).status).toBe(404);
		const code = JSON.parse((await post("/sync/")).text).code;
		// Which other sites could send here without the browser asking first
		expect((await post(`/sync/${code}`, "not json", "text/plain")).status).toBe(400);
		expect((await post(`/sync/${code}`, JSON.stringify({}), "text/plain")).status).toBe(400);
		expect((await post(`/sync/${code}`, [1, 2])).status).toBe(400);
		expect((await post(`/sync/${code}`, "{not json")).status).toBe(400);
	});

	test("too much", async () => {
		const code = JSON.parse((await post("/sync/")).text).code;
		const r = await request(`/sync/${code}`, {method: "POST", body: "{}", headers: {"Content-Type": "application/json", "Content-Length": String(3 * 1024 * 1024)}});
		expect(r.status).toBe(413);
	});

	test("without the database", async () => {
		env.SYNC = {prepare() { throw new Error("D1 is down"); }} as unknown as D1Database;
		const r = await post("/sync/");
		expect(r.status).toBe(503);
		expect(JSON.parse(r.text).error).toContain("Prøv igen senere");
		expect((await post("/sync/ABCD-EFGH-JKMN-PQRS", {})).status).toBe(503);
		expect((await request("/sync/ABCD-EFGH-JKMN-PQRS", {method: "DELETE"})).status).toBe(503);
	});

	test("its page", async () => {
		const r = await get("/sync/");
		expect(r.status).toBe(200);
		expect(r.text).toContain('id="sync-page"');
		expect(r.text).toContain("Opret en kode");
		expect((await get("/")).text).toContain('<a href="/sync/">');
	});
});
