// Sending notifications to browsers, with the Web Push protocol: the message is encrypted for
// the browser (RFC 8291), and signed by us, so push services know who sends it (RFC 8292, VAPID).

export interface Subscription {
	endpoint: string;
	// The browser's public key, and a secret shared with it, as base64url
	p256dh: string;
	auth: string;
}

/** Our keys, which browsers are given the public one of when they subscribe */
export interface VapidKeys {
	// The public key, uncompressed, as base64url
	publicKey: string;
	// The private key, as a JWK
	privateKey: JsonWebKey;
	// How push services can reach whoever runs this, like an https: or mailto: URL
	subject: string;
}

const encoder = new TextEncoder();

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
	return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

export function toBase64url(bytes: ArrayBuffer | Uint8Array): string {
	let text = "";
	for (const byte of new Uint8Array(bytes)) {
		text += String.fromCharCode(byte);
	}
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({name: "HKDF", hash: "SHA-256", salt, info}, key, length * 8));
}

/** An uncompressed P-256 public key, as a JWK */
export function publicJwk(raw: Uint8Array): JsonWebKey {
	if (raw.length != 65 || raw[0] != 4) {
		throw new TypeError("Expected an uncompressed P-256 public key");
	}
	return {kty: "EC", crv: "P-256", x: toBase64url(raw.slice(1, 33)), y: toBase64url(raw.slice(33)), ext: true};
}

/** For tests: the sender's key and salt, which are otherwise new for every message */
export interface Fixed {
	senderPrivateKey: JsonWebKey;
	salt: Uint8Array<ArrayBuffer>;
}

/** The message, encrypted for the browser with "aes128gcm" */
export async function encrypt(subscription: Subscription, message: string, fixed?: Fixed): Promise<Uint8Array<ArrayBuffer>> {
	const receiverPublic = fromBase64url(subscription.p256dh);
	// Importing it checks that it's a point on the curve
	const receiverKey = await crypto.subtle.importKey("jwk", publicJwk(receiverPublic), {name: "ECDH", namedCurve: "P-256"}, false, []);
	let sender: CryptoKeyPair;
	if (fixed) {
		const {d, ...publicPart} = fixed.senderPrivateKey;
		sender = {
			privateKey: await crypto.subtle.importKey("jwk", fixed.senderPrivateKey, {name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]),
			publicKey: await crypto.subtle.importKey("jwk", publicPart, {name: "ECDH", namedCurve: "P-256"}, true, []),
		};
	} else {
		sender = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]) as CryptoKeyPair;
	}
	const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey) as ArrayBuffer);
	// Cloudflare's types call it $public, though it's public in Workers as in browsers
	const ecdh = {name: "ECDH", public: receiverKey} as unknown as SubtleCryptoDeriveKeyAlgorithm;
	const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, sender.privateKey, 256));

	const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16) as Uint8Array<ArrayBuffer>);
	const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic);
	const ikm = await hkdf(fromBase64url(subscription.auth), shared, keyInfo, 32);
	const cek = await hkdf(salt, ikm, concat(encoder.encode("Content-Encoding: aes128gcm\0")), 16);
	const nonce = await hkdf(salt, ikm, concat(encoder.encode("Content-Encoding: nonce\0")), 12);

	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
	// The message in one record, ending with the delimiter 2
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce}, key, concat(encoder.encode(message), new Uint8Array([2]))));
	const recordSize = new Uint8Array([0, 0, 16, 0]);
	return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, ciphertext);
}

// Signed headers, for each push service, which are used again for a while, since signing takes time
const signed = new Map<string, {authorization: string; until: number}>();
// How long a signed header is used, of the 12 hours it's valid, in milliseconds
const SIGNED_FOR = 6 * 60 * 60 * 1000;
let privateKey: {jwk: JsonWebKey; key: CryptoKey} | undefined;

/** The Authorization header, which tells the push service it's us */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
	const audience = new URL(endpoint).origin;
	const found = signed.get(`${keys.publicKey} ${audience}`);
	if (found && now < found.until) {
		return found.authorization;
	}
	const authorization = await sign(audience, keys, now);
	signed.set(`${keys.publicKey} ${audience}`, {authorization, until: now + SIGNED_FOR});
	return authorization;
}

async function sign(audience: string, keys: VapidKeys, now: number): Promise<string> {
	const header = toBase64url(encoder.encode(JSON.stringify({typ: "JWT", alg: "ES256"})));
	const claims = toBase64url(encoder.encode(JSON.stringify({
		aud: audience,
		// At most a day, says RFC 8292
		exp: Math.floor(now / 1000) + 12 * 60 * 60,
		sub: keys.subject,
	})));
	if (privateKey?.jwk !== keys.privateKey) {
		privateKey = {jwk: keys.privateKey, key: await crypto.subtle.importKey("jwk", keys.privateKey, {name: "ECDSA", namedCurve: "P-256"}, false, ["sign"])};
	}
	const signature = await crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, privateKey.key, encoder.encode(`${header}.${claims}`));
	return `vapid t=${header}.${claims}.${toBase64url(signature)}, k=${keys.publicKey}`;
}

// Push services, which are the only places subscriptions may lead to
const PUSH_SERVICES = [
	/^fcm\.googleapis\.com$/,
	// Google's too, which Chromium uses
	/^jmt17\.google\.com$/,
	/^updates\.push\.services\.mozilla\.com$/,
	/^web\.push\.apple\.com$/,
	/\.push\.apple\.com$/,
	/\.notify\.windows\.com$/,
];

export function isPushService(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		return url.protocol == "https:" && PUSH_SERVICES.some(host => host.test(url.hostname));
	} catch {
		return false;
	}
}

/** What became of sending a notification */
export type Sent = "sent" | "gone" | "failed";

/** Sends a message to a browser, which its service worker shows */
export async function send(subscription: Subscription, message: string, keys: VapidKeys): Promise<Sent> {
	const response = await fetch(subscription.endpoint, {
		method: "POST",
		headers: {
			"Content-Encoding": "aes128gcm",
			"Content-Type": "application/octet-stream",
			// A new episode is still news for a day
			"TTL": String(24 * 60 * 60),
			"Urgency": "normal",
			"Authorization": await vapidAuthorization(subscription.endpoint, keys),
		},
		body: await encrypt(subscription, message),
	});
	if (response.ok) {
		return "sent";
	}
	// The browser unsubscribed, or the subscription ran out
	if (response.status == 404 || response.status == 410) {
		return "gone";
	}
	console.log("Could not send a notification", response.status, (await response.text()).slice(0, 200));
	return "failed";
}
