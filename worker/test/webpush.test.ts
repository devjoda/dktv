import {describe, expect, test} from "vitest";
import {encrypt, fromBase64url, isPushService, publicJwk, toBase64url, vapidAuthorization} from "../src/webpush";

// The example in RFC 8291, section 5
const RFC = {
	auth: "BTBZMqHH6r4Tts7J_aSIgg",
	receiverPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
	senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
	senderPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
	body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("Web Push", () => {
	test("encrypts like the example in RFC 8291", async () => {
		const body = fromBase64url(RFC.body);
		const encrypted = await encrypt(
			{endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV", p256dh: RFC.receiverPublic, auth: RFC.auth},
			"When I grow up, I want to be a watermelon",
			{senderPrivateKey: {...publicJwk(fromBase64url(RFC.senderPublic)), d: RFC.senderPrivate}, salt: body.slice(0, 16)},
		);
		expect(toBase64url(encrypted)).toBe(RFC.body);
	});

	test("with a new key and salt for every message", async () => {
		const subscription = {endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: RFC.receiverPublic, auth: RFC.auth};
		const [a, b] = [await encrypt(subscription, "Hej"), await encrypt(subscription, "Hej")];
		expect(toBase64url(a)).not.toBe(toBase64url(b));
		// Salt, record size, the key's length, the key, and the message with its delimiter and tag
		expect(a.length).toBe(16 + 4 + 1 + 65 + 3 + 1 + 16);
	});

	test("refuses a key that isn't on the curve", async () => {
		const bad = fromBase64url(RFC.receiverPublic);
		bad[40] ^= 1;
		await expect(encrypt({endpoint: "https://fcm.googleapis.com/x", p256dh: toBase64url(bad), auth: RFC.auth}, "Hej")).rejects.toThrow();
	});

	test("signs who it is from, for the push service", async () => {
		const pair = await crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]) as CryptoKeyPair;
		const publicKey = toBase64url(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
		const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;
		const now = Date.UTC(2026, 9, 12, 12);
		const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", {publicKey, privateKey, subject: "https://github.com/devjoda/dktv"}, now);
		const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
		expect(key).toBe(publicKey);
		const [head, claims, signature] = token.split(".");
		expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims)))).toEqual({aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "https://github.com/devjoda/dktv"});
		expect(await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, pair.publicKey, fromBase64url(signature), new TextEncoder().encode(`${head}.${claims}`))).toBe(true);
	});

	test("only sends to push services", () => {
		expect(isPushService("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
		expect(isPushService("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
		expect(isPushService("https://web.push.apple.com/abc")).toBe(true);
		expect(isPushService("https://wns2-db5p.notify.windows.com/w/?token=abc")).toBe(true);
		expect(isPushService("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
		expect(isPushService("https://example.com/fcm.googleapis.com")).toBe(false);
		expect(isPushService("https://fcm.googleapis.com.example.com/")).toBe(false);
		expect(isPushService("not a url")).toBe(false);
	});
});
