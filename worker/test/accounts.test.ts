// Notifications about new episodes, and passkeys

import {beforeEach, describe, expect, test} from "vitest";
import {cleanUp, run} from "../src/alerts";
import {vapidKeys} from "../src/alerts";
import {derToRaw} from "../src/webauthn";
import {fromBase64url, publicJwk, toBase64url} from "../src/webpush";
import {ctx, dr, env, get, load, post, request} from "./helpers";

const encoder = new TextEncoder();

async function sha256(data: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
}

const json = (r: {text: string}) => JSON.parse(r.text);

const send = (method: string, path: string, data: unknown) =>
	request(path, {method, body: JSON.stringify(data), headers: {"Content-Type": "application/json"}});

async function newCode(favorites: string[] = []): Promise<string> {
	const code = json(await post("/sync/")).code;
	await post(`/sync/${code}`, {favorites: favorites.map((id, i) => ({id, title: id, added: i + 1}))});
	return code;
}

beforeEach(async () => {
	const pair = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]) as CryptoKeyPair;
	env.VAPID_PUBLIC_KEY = toBase64url(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
	env.VAPID_PRIVATE_KEY = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
});

/** A browser that can be notified: its subscription, and what it can read */
async function browser(n = 1) {
	const pair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]) as CryptoKeyPair;
	const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const subscription = {endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: {p256dh: toBase64url(publicKey), auth: toBase64url(auth)}};

	/** Decrypts a notification, as the browser does (RFC 8291) */
	async function read(body: Uint8Array): Promise<any> {
		const hkdf = async (salt: Uint8Array, secret: Uint8Array, info: Uint8Array, length: number) => new Uint8Array(await crypto.subtle.deriveBits(
			{name: "HKDF", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, info: info as Uint8Array<ArrayBuffer>},
			await crypto.subtle.importKey("raw", secret as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveBits"]), length * 8));
		const salt = body.slice(0, 16);
		const senderPublic = body.slice(21, 21 + body[20]);
		const sender = await crypto.subtle.importKey("jwk", publicJwk(senderPublic), {name: "ECDH", namedCurve: "P-256"}, false, []);
		const shared = new Uint8Array(await crypto.subtle.deriveBits({name: "ECDH", public: sender} as any, pair.privateKey, 256));
		const ikm = await hkdf(auth, shared, new Uint8Array([...encoder.encode("WebPush: info\0"), ...publicKey, ...senderPublic]), 32);
		const key = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16) as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["decrypt"]);
		const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
		const plain = new Uint8Array(await crypto.subtle.decrypt({name: "AES-GCM", iv: nonce as Uint8Array<ArrayBuffer>}, key, body.slice(21 + body[20]) as Uint8Array<ArrayBuffer>));
		expect(plain.at(-1)).toBe(2);
		return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
	}

	return {subscription, read};
}

/** Rejseholdet, as DR describes it when its newest season has some number of episodes */
function rejseholdet(episodes: number) {
	const season = load("items_503612.json");
	const children = season.episodes.items;
	dr.answer = path => {
		if (path == "/items/503612") {
			return {...season, availableEpisodeCount: episodes};
		}
		if (path == "/items/503612/children") {
			return {items: children.slice(0, episodes)};
		}
		return undefined;
	};
}

async function rows(sql: string): Promise<unknown[]> {
	return (await env.SYNC.prepare(sql).all()).results;
}

describe("notifications", () => {
	test("say whether the server can send them", async () => {
		expect(json(await get("/konto.json"))).toEqual({push: env.VAPID_PUBLIC_KEY, passkeys: true});
		env.VAPID_PUBLIC_KEY = undefined;
		expect(json(await get("/konto.json")).push).toBeNull();
	});

	test("a device subscribes, and follows the code's series", async () => {
		const code = await newCode(["rejseholdet_503605", "matador_540736"]);
		const {subscription} = await browser();
		expect((await send("POST", `/push/${code}`, subscription)).status).toBe(201);
		expect(await rows("SELECT show FROM follows ORDER BY show")).toEqual([{show: "matador_540736"}, {show: "rejseholdet_503605"}]);
		// Films aren't followed, and syncing keeps the series up to date
		await post(`/sync/${code}`, {favorites: [{id: "a-film_1", kind: "film", added: 3}], removed_favorites: {matador_540736: 4}});
		expect(await rows("SELECT show FROM follows")).toEqual([{show: "rejseholdet_503605"}]);
		// Unsubscribing
		expect((await send("DELETE", `/push/${code}`, {endpoint: subscription.endpoint})).status).toBe(204);
		expect(await rows("SELECT endpoint FROM push")).toEqual([]);
	});

	test("only for push services, codes that exist, and a few devices", async () => {
		const code = await newCode();
		const {subscription} = await browser();
		expect((await send("POST", "/push/ABCD-EFGH-JKMN-PQRS", subscription)).status).toBe(404);
		expect((await send("POST", `/push/${code}`, {...subscription, endpoint: "https://example.com/push"})).status).toBe(400);
		expect((await send("POST", `/push/${code}`, {...subscription, keys: {p256dh: "<script>", auth: "x"}})).status).toBe(400);
		expect((await request(`/push/${code}`, {method: "POST", body: JSON.stringify(subscription), headers: {"Content-Type": "text/plain"}})).status).toBe(400);
		for (let i = 0; i < 10; i++) {
			expect((await send("POST", `/push/${code}`, (await browser(i)).subscription)).status).toBe(201);
		}
		expect((await send("POST", `/push/${code}`, (await browser(11)).subscription)).status).toBe(409);
		// The same device again is fine
		expect((await send("POST", `/push/${code}`, (await browser(3)).subscription)).status).toBe(201);
	});

	test("without our keys, there are none", async () => {
		env.VAPID_PRIVATE_KEY = undefined;
		const code = await newCode();
		expect((await send("POST", `/push/${code}`, (await browser()).subscription)).status).toBe(501);
	});

	test("a new episode is sent to the devices that follow its series", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		const phone = await browser(1);
		const laptop = await browser(2);
		await send("POST", `/push/${code}`, phone.subscription);
		await send("POST", `/push/${code}`, laptop.subscription);
		const someoneElse = await newCode(["matador_540736"]);
		await send("POST", `/push/${someoneElse}`, (await browser(3)).subscription);
		const keys = vapidKeys(env)!;

		// The first check only notes how far the series is
		rejseholdet(1);
		await run(ctx(), keys);
		expect(dr.pushed).toEqual([]);
		expect(await rows("SELECT show, season, seasons, episodes FROM shows WHERE show = 'rejseholdet_503605'")).toEqual([{show: "rejseholdet_503605", season: "503612", seasons: 4, episodes: 1}]);

		// Not checked again for a while
		rejseholdet(2);
		await run(ctx(), keys);
		expect(dr.pushed).toEqual([]);

		await env.SYNC.prepare("UPDATE shows SET checked = 0").run();
		dr.requested = [];
		await run(ctx(), keys);
		// One small request to DR to check it, and one for the new episode
		expect(dr.requested.filter(p => p.includes("503605") || p.includes("503612"))).toEqual(["/items/503612", "/items/503612/children"]);
		expect(dr.pushed.map(p => p.endpoint).sort()).toEqual([phone.subscription.endpoint, laptop.subscription.endpoint]);
		const pushed = dr.pushed.find(p => p.endpoint == phone.subscription.endpoint)!;
		expect(pushed.headers.get("Content-Encoding")).toBe("aes128gcm");
		expect(pushed.headers.get("TTL")).toBe("86400");
		expect(pushed.headers.get("Authorization")).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.VAPID_PUBLIC_KEY}$`));
		const notice = await phone.read(pushed.body);
		expect(notice).toMatchObject({title: "Nyt afsnit af Rejseholdet", url: "/rejseholdet_503605/rejseholdet_503636"});
		expect(notice.body).toBeTruthy();
		expect(notice.image).toContain("Width=640");
		// Sent, so gone from the outbox
		expect(await rows("SELECT id FROM outbox")).toEqual([]);
	});

	test("a new season is noticed, though less often", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		const phone = await browser();
		await send("POST", `/push/${code}`, phone.subscription);
		const keys = vapidKeys(env)!;
		rejseholdet(2);
		await run(ctx(), keys);
		// DR gets a fifth season, with its first episode
		const show = load("items_503605.json");
		const season = load("items_503612.json");
		dr.answer = path => ({
			"/items/503605": {...show, availableSeasonCount: 5, seasons: {...show.seasons, items: [...show.seasons.items, {id: "999", title: "Rejseholdet", path: "/saeson/rejseholdet_999", seasonNumber: 5}]}},
			"/items/503612": {...season, availableEpisodeCount: 2},
			"/items/999": {id: "999", type: "season", availableEpisodeCount: 1},
			"/items/999/children": {items: [{id: "1000", type: "episode", title: "Rejseholdet", contextualTitle: "1. episode", path: "/episode/rejseholdet_1000"}]},
		} as Record<string, unknown>)[path];
		// Within six hours, only the newest season it knows of is checked
		await env.SYNC.prepare("UPDATE shows SET checked = 0").run();
		await run(ctx(), keys);
		expect(dr.pushed).toEqual([]);
		await env.SYNC.prepare("UPDATE shows SET checked = 0, seasons_checked = 0").run();
		await run(ctx(), keys);
		expect(dr.pushed).toHaveLength(1);
		expect(await phone.read(dr.pushed[0].body)).toMatchObject({title: "Nyt afsnit af Rejseholdet", body: "1. episode", url: "/rejseholdet_503605/rejseholdet_1000"});
		expect(await rows("SELECT season, seasons, episodes FROM shows")).toEqual([{season: "999", seasons: 5, episodes: 1}]);
	});

	test("a series is checked by one run, though two run at once", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		await send("POST", `/push/${code}`, (await browser()).subscription);
		const keys = vapidKeys(env)!;
		rejseholdet(1);
		await run(ctx(), keys);
		await env.SYNC.prepare("UPDATE shows SET checked = 0").run();
		rejseholdet(2);
		await Promise.all([run(ctx(), keys), run(ctx(), keys)]);
		expect(dr.pushed).toHaveLength(1);
	});

	test("devices that unsubscribed are forgotten", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		await send("POST", `/push/${code}`, (await browser()).subscription);
		const keys = vapidKeys(env)!;
		rejseholdet(1);
		await run(ctx(), keys);
		await env.SYNC.prepare("UPDATE shows SET checked = 0").run();
		rejseholdet(2);
		dr.pushStatus = 410;
		await run(ctx(), keys);
		expect(dr.pushed).toHaveLength(1);
		expect(await rows("SELECT endpoint FROM push")).toEqual([]);
		expect(await rows("SELECT id FROM outbox")).toEqual([]);
	});

	test("what's run out is forgotten", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		await env.SYNC.prepare("INSERT INTO outbox (endpoint, payload, created) VALUES ('old', '{}', 0), ('new', '{}', ?)").bind(Date.now() / 1000).run();
		await env.SYNC.prepare("INSERT INTO challenges (challenge, code, expires) VALUES ('old', NULL, 0)").run();
		await env.SYNC.prepare("INSERT INTO shows (show) VALUES ('nobody-follows_1')").run();
		await cleanUp(ctx());
		expect(await rows("SELECT endpoint FROM outbox")).toEqual([{endpoint: "new"}]);
		expect(await rows("SELECT * FROM challenges")).toEqual([]);
		expect(await rows("SELECT show FROM shows")).toEqual([{show: "rejseholdet_503605"}]);
		expect(code).toBeTruthy();
	});

	test("deleting the synced data deletes the notifications and passkeys too", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		await send("POST", `/push/${code}`, (await browser()).subscription);
		await env.SYNC.prepare("INSERT INTO passkeys (id, code, user, public_key, algorithm, created) VALUES ('x', ?, 'u', '{}', -7, 0)").bind(code).run();
		expect((await request(`/sync/${code}`, {method: "DELETE"})).status).toBe(204);
		for (const table of ["sync", "push", "follows", "passkeys"]) {
			expect(await rows(`SELECT * FROM ${table}`), table).toEqual([]);
		}
	});
});

// Writes CBOR, as an authenticator does
function cbor(value: unknown): Uint8Array {
	const head = (type: number, n: number) => n < 24 ? [type << 5 | n] : n < 256 ? [type << 5 | 24, n] : [type << 5 | 25, n >> 8, n & 255];
	if (typeof value == "number") {
		return new Uint8Array(value >= 0 ? head(0, value) : head(1, -1 - value));
	}
	if (value instanceof Uint8Array) {
		return new Uint8Array([...head(2, value.length), ...value]);
	}
	if (typeof value == "string") {
		const bytes = encoder.encode(value);
		return new Uint8Array([...head(3, bytes.length), ...bytes]);
	}
	const entries = value instanceof Map ? [...value] : Object.entries(value as object);
	return new Uint8Array([...head(5, entries.length), ...entries.flatMap(([k, v]) => [...cbor(k), ...cbor(v)])]);
}

/** r and s, as the DER a passkey signs with */
function rawToDer(raw: Uint8Array): Uint8Array {
	const integer = (bytes: Uint8Array) => {
		let i = 0;
		while (i < bytes.length - 1 && bytes[i] == 0) i++;
		const trimmed = bytes.slice(i);
		const value = trimmed[0] & 0x80 ? [0, ...trimmed] : [...trimmed];
		return [0x02, value.length, ...value];
	};
	const body = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
	return new Uint8Array([0x30, body.length, ...body]);
}

/** A device's passkey, made in software */
async function authenticator(origin = "http://localhost", rpId = "localhost") {
	const pair = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]) as CryptoKeyPair;
	const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey;
	const id = crypto.getRandomValues(new Uint8Array(16));
	let count = 0;
	const rpIdHash = await sha256(encoder.encode(rpId));
	const counter = () => [count >>> 24, count >>> 16 & 255, count >>> 8 & 255, count & 255];

	return {
		id: toBase64url(id),
		create(options: any) {
			const clientData = encoder.encode(JSON.stringify({type: "webauthn.create", challenge: options.challenge, origin}));
			const key = new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, fromBase64url(jwk.x!)], [-3, fromBase64url(jwk.y!)]]);
			const authData = new Uint8Array([...rpIdHash, 0x45, ...counter(), ...new Uint8Array(16), 0, id.length, ...id, ...cbor(key)]);
			return {
				credential: {id: toBase64url(id), response: {clientDataJSON: toBase64url(clientData), attestationObject: toBase64url(cbor({fmt: "none", attStmt: {}, authData}))}},
				user: options.user.id,
			};
		},
		async get(options: any, {counting = true, signingFor = undefined as Uint8Array | undefined} = {}) {
			if (counting) {
				count++;
			}
			const clientData = encoder.encode(JSON.stringify({type: "webauthn.get", challenge: options.challenge, origin}));
			const authData = new Uint8Array([...rpIdHash, 0x05, ...counter()]);
			const signed = signingFor ?? new Uint8Array([...authData, ...await sha256(clientData)]);
			const raw = new Uint8Array(await crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, pair.privateKey, signed as Uint8Array<ArrayBuffer>));
			return {credential: {id: toBase64url(id), response: {clientDataJSON: toBase64url(clientData), authenticatorData: toBase64url(authData), signature: toBase64url(rawToDer(raw))}}};
		},
	};
}

describe("passkeys", () => {
	test("are made for a code, and log in to it on another device", async () => {
		const code = await newCode(["rejseholdet_503605"]);
		const passkey = await authenticator();
		const options = json(await post(`/passkeys/${code}/options`));
		expect(options).toMatchObject({rp: {id: "localhost", name: "dktv"}, attestation: "none", authenticatorSelection: {residentKey: "required"}});
		expect(options.pubKeyCredParams.map((p: {alg: number}) => p.alg)).toEqual([-8, -7, -257]);
		const made = await request(`/passkeys/${code}`, {method: "POST", body: JSON.stringify(passkey.create(options)),
			headers: {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36"}});
		expect(made.status).toBe(201);
		expect(json(made)).toMatchObject({id: passkey.id, name: "Chrome på Android"});
		expect(json(await get(`/passkeys/${code}`)).map((p: {id: string}) => p.id)).toEqual([passkey.id]);

		// Another passkey for the code isn't made on the same device
		expect(json(await post(`/passkeys/${code}/options`)).excludeCredentials).toEqual([{type: "public-key", id: passkey.id}]);

		const login = json(await post("/login/options"));
		expect(login.rpId).toBe("localhost");
		const r = await send("POST", "/login", await passkey.get(login));
		expect(r.status).toBe(200);
		expect(json(r)).toEqual({code});
	});

	test("an answer for another site, or to an old question, isn't accepted", async () => {
		const code = await newCode();
		const passkey = await authenticator();
		await send("POST", `/passkeys/${code}`, passkey.create(json(await post(`/passkeys/${code}/options`))));

		const elsewhere = await authenticator("https://evil.example", "evil.example");
		expect((await send("POST", `/passkeys/${code}`, elsewhere.create(json(await post(`/passkeys/${code}/options`))))).status).toBe(400);

		const options = json(await post("/login/options"));
		const answer = await passkey.get(options);
		expect((await send("POST", "/login", answer)).status).toBe(200);
		// Each question is answered once
		expect((await send("POST", "/login", answer)).status).toBe(400);
		// And a question to make a passkey isn't one to log in with
		const making = json(await post(`/passkeys/${code}/options`));
		expect((await send("POST", "/login", await passkey.get(making))).status).toBe(400);
	});

	test("a wrong signature, or a count that goes backwards, isn't accepted", async () => {
		const code = await newCode();
		const passkey = await authenticator();
		await send("POST", `/passkeys/${code}`, passkey.create(json(await post(`/passkeys/${code}/options`))));
		const forged = await passkey.get(json(await post("/login/options")), {signingFor: encoder.encode("something else")});
		expect((await send("POST", "/login", forged)).status).toBe(400);
		expect((await send("POST", "/login", await passkey.get(json(await post("/login/options"))))).status).toBe(200);
		// A copy of the passkey, which hasn't counted the signature since
		expect((await send("POST", "/login", await passkey.get(json(await post("/login/options")), {counting: false}))).status).toBe(400);
	});

	test("one that isn't kept, or is removed, doesn't log in", async () => {
		const code = await newCode();
		const passkey = await authenticator();
		expect((await send("POST", "/login", await passkey.get(json(await post("/login/options"))))).status).toBe(400);
		await send("POST", `/passkeys/${code}`, passkey.create(json(await post(`/passkeys/${code}/options`))));
		expect((await request(`/passkeys/${code}/${passkey.id}`, {method: "DELETE"})).status).toBe(204);
		expect(json(await get(`/passkeys/${code}`))).toEqual([]);
		expect((await send("POST", "/login", await passkey.get(json(await post("/login/options"))))).status).toBe(400);
	});

	test("only for codes that exist", async () => {
		expect((await post("/passkeys/ABCD-EFGH-JKMN-PQRS/options")).status).toBe(404);
		expect((await post("/passkeys/not-a-code/options")).status).toBe(404);
	});

	test("ECDSA signatures in DER, with and without leading zeros", () => {
		const raw = new Uint8Array(64).map((_, i) => (i == 0 ? 0x80 : i == 32 ? 0 : i));
		expect([...derToRaw(rawToDer(raw))]).toEqual([...raw]);
	});
});
