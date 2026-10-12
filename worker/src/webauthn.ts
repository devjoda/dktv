// Passkeys (WebAuthn), which give a device the sync code they were made for.
//
// A passkey is made on a device that syncs, and kept by the device or the viewer's password
// manager. Logging in with it on another device gives that device the code, so the viewer
// needn't type it. Nothing else about the viewer is asked for, or kept.

import {fromBase64url, toBase64url} from "./webpush";

/** A passkey's answer couldn't be accepted */
export class Refused extends Error {}

// How long the browser and the viewer have to answer, in seconds
export const CHALLENGE_FOR = 5 * 60;

// The algorithms passkeys may sign with, as COSE numbers: Ed25519, P-256 with SHA-256, and RSA with SHA-256
export const ALGORITHMS = [-8, -7, -257];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Reads CBOR, which passkeys describe themselves in; only what they use of it */
export function decodeCBOR(bytes: Uint8Array): unknown {
	let at = 0;

	function length(info: number): number {
		if (info < 24) {
			return info;
		}
		const size = {24: 1, 25: 2, 26: 4, 27: 8}[info];
		if (size === undefined || at + size > bytes.length) {
			throw new Refused("Unreadable CBOR");
		}
		let n = 0;
		for (let i = 0; i < size; i++) {
			n = n * 256 + bytes[at + i];
		}
		at += size;
		return n;
	}

	function item(): unknown {
		if (at >= bytes.length) {
			throw new Refused("CBOR ended early");
		}
		const first = bytes[at++];
		const type = first >> 5;
		const n = length(first & 31);
		switch (type) {
		case 0:
			return n;
		case 1:
			return -1 - n;
		case 2:
		case 3: {
			if (at + n > bytes.length) {
				throw new Refused("CBOR ended early");
			}
			const found = bytes.slice(at, at + n);
			at += n;
			return type == 2 ? found : decoder.decode(found);
		}
		case 4:
			return Array.from({length: n}, item);
		case 5: {
			const map = new Map<unknown, unknown>();
			for (let i = 0; i < n; i++) {
				const key = item();
				map.set(key, item());
			}
			return map;
		}
		case 7:
			if ((first & 31) == 20) return false;
			if ((first & 31) == 21) return true;
			if ((first & 31) == 22) return null;
		}
		throw new Refused(`Unexpected CBOR type ${type}`);
	}

	return item();
}

export interface AuthenticatorData {
	rpIdHash: Uint8Array;
	// The viewer was there, and showed who they are, like with a fingerprint
	present: boolean;
	verified: boolean;
	signCount: number;
	// Only when a passkey is made
	credentialId?: Uint8Array;
	publicKey?: Map<unknown, unknown>;
}

export function parseAuthenticatorData(data: Uint8Array): AuthenticatorData {
	if (data.length < 37) {
		throw new Refused("Authenticator data too short");
	}
	const flags = data[32];
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const parsed: AuthenticatorData = {
		rpIdHash: data.slice(0, 32),
		present: (flags & 0x01) != 0,
		verified: (flags & 0x04) != 0,
		signCount: view.getUint32(33),
	};
	// Attested credential data: the new passkey's id and public key
	if (flags & 0x40) {
		if (data.length < 55) {
			throw new Refused("Attested credential data too short");
		}
		const idLength = view.getUint16(53);
		parsed.credentialId = data.slice(55, 55 + idLength);
		const key = decodeCBOR(data.slice(55 + idLength));
		if (!(key instanceof Map)) {
			throw new Refused("The public key isn't a COSE key");
		}
		parsed.publicKey = key;
	}
	return parsed;
}

/** A COSE public key, as a JWK that the Web Crypto API can import, and its algorithm */
export function coseToJwk(key: Map<unknown, unknown>): {jwk: JsonWebKey; algorithm: number} {
	const kty = key.get(1);
	const algorithm = key.get(3) as number;
	const bytes = (label: number) => {
		const value = key.get(label);
		if (!(value instanceof Uint8Array)) {
			throw new Refused(`COSE key without ${label}`);
		}
		return toBase64url(value);
	};
	if (kty == 2 && algorithm == -7 && key.get(-1) == 1) {
		return {jwk: {kty: "EC", crv: "P-256", x: bytes(-2), y: bytes(-3)}, algorithm};
	}
	if (kty == 1 && algorithm == -8 && key.get(-1) == 6) {
		return {jwk: {kty: "OKP", crv: "Ed25519", x: bytes(-2)}, algorithm};
	}
	if (kty == 3 && algorithm == -257) {
		return {jwk: {kty: "RSA", n: bytes(-1), e: bytes(-2)}, algorithm};
	}
	throw new Refused(`Unsupported key: type ${kty}, algorithm ${algorithm}`);
}

/** An ECDSA signature as passkeys give it, in DER, as the Web Crypto API wants it: r and s, 32 bytes each */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
	let at = 0;
	const expect = (byte: number) => {
		if (der[at++] != byte) {
			throw new Refused("Unreadable signature");
		}
	};
	const integer = () => {
		expect(0x02);
		const size = der[at++];
		let value = der.slice(at, at + size);
		at += size;
		// Without the zero that keeps it from being negative
		while (value.length > 32 && value[0] == 0) {
			value = value.slice(1);
		}
		if (value.length > 32) {
			throw new Refused("Unreadable signature");
		}
		const padded = new Uint8Array(32);
		padded.set(value, 32 - value.length);
		return padded;
	};
	expect(0x30);
	at++;
	const raw = new Uint8Array(64);
	raw.set(integer(), 0);
	raw.set(integer(), 32);
	return raw;
}

const IMPORT: Record<number, SubtleCryptoImportKeyAlgorithm> = {
	[-7]: {name: "ECDSA", namedCurve: "P-256"},
	[-8]: {name: "Ed25519"},
	[-257]: {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
};

const VERIFY: Record<number, SubtleCryptoSignAlgorithm> = {
	[-7]: {name: "ECDSA", hash: "SHA-256"},
	[-8]: {name: "Ed25519"},
	[-257]: {name: "RSASSA-PKCS1-v1_5"},
};

export async function verifySignature(jwk: JsonWebKey, algorithm: number, signature: Uint8Array, data: Uint8Array<ArrayBuffer>): Promise<boolean> {
	if (!(algorithm in IMPORT)) {
		return false;
	}
	const key = await crypto.subtle.importKey("jwk", jwk, IMPORT[algorithm], false, ["verify"]);
	const raw = algorithm == -7 ? derToRaw(signature) : new Uint8Array(signature) as Uint8Array<ArrayBuffer>;
	return crypto.subtle.verify(VERIFY[algorithm], key, raw, data);
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/** What the browser says it signed: what for, the challenge, and where */
export interface ClientData {
	type: string;
	challenge: string;
	origin: string;
}

export function parseClientData(base64url: string): {data: ClientData; bytes: Uint8Array<ArrayBuffer>} {
	const bytes = fromBase64url(base64url);
	let data: ClientData;
	try {
		data = JSON.parse(decoder.decode(bytes));
	} catch {
		throw new Refused("Unreadable client data");
	}
	return {data, bytes};
}

/** Checks what the browser says against what was asked, and where */
export function checkClientData(data: ClientData, type: "webauthn.create" | "webauthn.get", origin: string) {
	if (data.type != type) {
		throw new Refused(`Expected ${type}, got ${data.type}`);
	}
	if (data.origin != origin) {
		throw new Refused(`Made for ${data.origin}, not ${origin}`);
	}
}

export async function checkRpId(authenticator: AuthenticatorData, rpId: string) {
	const expected = await sha256(new Uint8Array(encoder.encode(rpId)));
	if (toBase64url(authenticator.rpIdHash) != toBase64url(expected)) {
		throw new Refused("Made for another site");
	}
	if (!authenticator.present) {
		throw new Refused("The viewer wasn't there");
	}
}

/** A short name for the device a passkey was made on, like "Chrome på Android" */
export function deviceName(userAgent: string): string {
	const browser = /Edg\//.test(userAgent) ? "Edge"
		: /Firefox\//.test(userAgent) ? "Firefox"
		: /(Chrome|CriOS)\//.test(userAgent) ? "Chrome"
		: /Safari\//.test(userAgent) ? "Safari"
		: "En browser";
	const system = /iPhone/.test(userAgent) ? "iPhone"
		: /iPad/.test(userAgent) ? "iPad"
		: /Android/.test(userAgent) ? "Android"
		: /Mac OS X/.test(userAgent) ? "Mac"
		: /Windows/.test(userAgent) ? "Windows"
		: /CrOS/.test(userAgent) ? "Chromebook"
		: /Linux/.test(userAgent) ? "Linux"
		: "";
	return system ? `${browser} på ${system}` : browser;
}
