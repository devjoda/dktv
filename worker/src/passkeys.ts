// Making passkeys for a sync code, and logging in with them, kept in D1

import {type Ctx} from "./dr";
import {ALGORITHMS, CHALLENGE_FOR, checkClientData, checkRpId, coseToJwk, decodeCBOR, deviceName, parseAuthenticatorData, parseClientData, Refused, sha256, verifySignature} from "./webauthn";
import {fromBase64url, toBase64url} from "./webpush";

// Per sync code
export const MAX_PASSKEYS = 20;

const seconds = () => Date.now() / 1000;
const random = (size: number) => toBase64url(crypto.getRandomValues(new Uint8Array(size)));

/** Where the site is, which passkeys are made for */
export interface Site {
	// Like https://dktv.example
	origin: string;
	// Like dktv.example
	rpId: string;
	name: string;
}

async function newChallenge(ctx: Ctx, code: string | null): Promise<string> {
	const challenge = random(32);
	ctx.budget.spend();
	await ctx.env.SYNC.prepare("INSERT INTO challenges (challenge, code, expires) VALUES (?, ?, ?)")
		.bind(challenge, code, seconds() + CHALLENGE_FOR)
		.run();
	return challenge;
}

/** Uses up a challenge, which must have been made for the code, or for logging in */
async function useChallenge(ctx: Ctx, challenge: string, code: string | null): Promise<void> {
	ctx.budget.spend();
	const found = await ctx.env.SYNC.prepare("DELETE FROM challenges WHERE challenge = ? AND expires > ? RETURNING code")
		.bind(challenge, seconds())
		.first<{code: string | null}>();
	if (found === null || found.code !== code) {
		throw new Refused("Unknown or used challenge");
	}
}

/** What the browser needs to make a passkey for a code, or undefined if there's nothing under it */
export async function creationOptions(ctx: Ctx, site: Site, code: string) {
	const db = ctx.env.SYNC;
	ctx.budget.spend();
	const exists = await db.prepare("SELECT 1 AS found FROM sync WHERE code = ?").bind(code).first();
	if (exists === null) {
		return undefined;
	}
	ctx.budget.spend();
	const existing = await db.prepare("SELECT id, user FROM passkeys WHERE code = ?").bind(code).all<{id: string; user: string}>();
	if (existing.results.length >= MAX_PASSKEYS) {
		throw new Refused("Too many passkeys");
	}
	return {
		challenge: await newChallenge(ctx, code),
		rp: {id: site.rpId, name: site.name},
		// The same for all of a code's passkeys, so a password manager keeps one of them
		user: {id: existing.results[0]?.user ?? random(16), name: site.name, displayName: site.name},
		pubKeyCredParams: ALGORITHMS.map(alg => ({type: "public-key", alg})),
		authenticatorSelection: {residentKey: "required", requireResidentKey: true, userVerification: "preferred"},
		attestation: "none",
		excludeCredentials: existing.results.map(row => ({type: "public-key", id: row.id})),
		timeout: CHALLENGE_FOR * 1000,
	};
}

/** What the browser sends back after making a passkey, with its parts as base64url */
export interface Creation {
	id: string;
	response: {clientDataJSON: string; attestationObject: string};
}

export interface Passkey {
	id: string;
	name: string;
	created: number;
	used: number | null;
}

/** Keeps a passkey the browser made for a code */
export async function register(ctx: Ctx, site: Site, code: string, user: string, creation: Creation, userAgent: string): Promise<Passkey> {
	const {data} = parseClientData(creation.response.clientDataJSON);
	checkClientData(data, "webauthn.create", site.origin);
	await useChallenge(ctx, data.challenge, code);
	const attestation = decodeCBOR(fromBase64url(creation.response.attestationObject));
	const authData = attestation instanceof Map ? attestation.get("authData") : undefined;
	if (!(authData instanceof Uint8Array)) {
		throw new Refused("No authenticator data");
	}
	const authenticator = parseAuthenticatorData(authData);
	await checkRpId(authenticator, site.rpId);
	if (!authenticator.credentialId || !authenticator.publicKey) {
		throw new Refused("No new passkey");
	}
	const id = toBase64url(authenticator.credentialId);
	if (id != creation.id) {
		throw new Refused("The passkey's id doesn't match");
	}
	const {jwk, algorithm} = coseToJwk(authenticator.publicKey);
	const passkey = {id, name: deviceName(userAgent), created: seconds(), used: null};
	ctx.budget.spend();
	await ctx.env.SYNC.prepare("INSERT INTO passkeys (id, code, user, public_key, algorithm, sign_count, name, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
		.bind(id, code, user, JSON.stringify(jwk), algorithm, authenticator.signCount, passkey.name, passkey.created)
		.run();
	return passkey;
}

/** What the browser needs to log in with any passkey for the site */
export async function requestOptions(ctx: Ctx, site: Site) {
	return {
		challenge: await newChallenge(ctx, null),
		rpId: site.rpId,
		userVerification: "preferred",
		timeout: CHALLENGE_FOR * 1000,
	};
}

/** What the browser sends back after logging in with a passkey */
export interface Assertion {
	id: string;
	response: {clientDataJSON: string; authenticatorData: string; signature: string};
}

/** The code a passkey was made for, if it signed what was asked */
export async function login(ctx: Ctx, site: Site, assertion: Assertion): Promise<string> {
	const {data, bytes} = parseClientData(assertion.response.clientDataJSON);
	checkClientData(data, "webauthn.get", site.origin);
	await useChallenge(ctx, data.challenge, null);
	ctx.budget.spend();
	const passkey = await ctx.env.SYNC.prepare("SELECT code, public_key, algorithm, sign_count FROM passkeys WHERE id = ?")
		.bind(assertion.id)
		.first<{code: string; public_key: string; algorithm: number; sign_count: number}>();
	if (passkey === null) {
		throw new Refused("Unknown passkey");
	}
	const authData = fromBase64url(assertion.response.authenticatorData);
	const authenticator = parseAuthenticatorData(authData);
	await checkRpId(authenticator, site.rpId);
	const signed = new Uint8Array([...authData, ...await sha256(bytes)]);
	if (!await verifySignature(JSON.parse(passkey.public_key), passkey.algorithm, fromBase64url(assertion.response.signature), signed)) {
		throw new Refused("Wrong signature");
	}
	// Passkeys that count their signatures never count backwards, unless they've been copied
	if ((authenticator.signCount > 0 || passkey.sign_count > 0) && authenticator.signCount <= passkey.sign_count) {
		throw new Refused("The passkey's count went backwards");
	}
	ctx.budget.spend();
	await ctx.env.SYNC.prepare("UPDATE passkeys SET sign_count = ?, used = ? WHERE id = ?")
		.bind(authenticator.signCount, seconds(), assertion.id)
		.run();
	return passkey.code;
}

export async function list(ctx: Ctx, code: string): Promise<Passkey[]> {
	ctx.budget.spend();
	const found = await ctx.env.SYNC.prepare("SELECT id, name, created, used FROM passkeys WHERE code = ? ORDER BY created")
		.bind(code)
		.all<Passkey>();
	return found.results;
}

export async function remove(ctx: Ctx, code: string, id: string): Promise<void> {
	ctx.budget.spend();
	await ctx.env.SYNC.prepare("DELETE FROM passkeys WHERE code = ? AND id = ?").bind(code, id).run();
}
