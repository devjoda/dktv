// Watching together: what a room passes on between its viewers

import {beforeEach, describe, expect, test} from "vitest";
import type {Env} from "../src/dr";
import {isRoomId, newRoomId, Room} from "../src/room";

/** A viewer's WebSocket, which keeps what it's sent */
class FakeSocket {
	readyState = 1;
	received: any[] = [];
	private attachment: unknown;
	send(text: string) {
		this.received.push(JSON.parse(text));
	}
	close() {
		this.readyState = 3;
	}
	serializeAttachment(value: unknown) {
		this.attachment = structuredClone(value);
	}
	deserializeAttachment() {
		return structuredClone(this.attachment);
	}
	last(type: string) {
		return this.received.filter(m => m.type == type).at(-1);
	}
}

let room: Room;
let sockets: FakeSocket[];
let stored: Map<string, unknown>;
let alarm: number | null;

beforeEach(() => {
	sockets = [];
	stored = new Map();
	alarm = null;
	const ctx = {
		getWebSockets: () => sockets.filter(s => s.readyState < 2),
		acceptWebSocket: (ws: FakeSocket) => sockets.push(ws),
		storage: {
			get: async (key: string) => structuredClone(stored.get(key)),
			put: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
			deleteAll: async () => stored.clear(),
			setAlarm: async (at: number) => { alarm = at; },
			deleteAlarm: async () => { alarm = null; },
		},
	};
	room = new Room(ctx as unknown as DurableObjectState, {} as Env);
});

/** A viewer, joined as the room's Durable Object would take them */
async function join(name: string, path = "/rejseholdet_503605/rejseholdet_503615") {
	const ws = new FakeSocket();
	sockets.push(ws);
	ws.serializeAttachment({id: name.toLowerCase(), name: "Gæst"});
	await say(ws, {type: "hello", name, path});
	return ws;
}

const say = (ws: FakeSocket, message: object) => room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(message));

describe("watching together", () => {
	test("room ids are hard to guess, and easy to type", () => {
		const id = newRoomId();
		expect(id).toHaveLength(8);
		expect(isRoomId(id)).toBe(true);
		expect(isRoomId("IIIIOOOO")).toBe(false);
		expect(isRoomId("abc")).toBe(false);
	});

	test("viewers see who's watching, and the room's state when they join", async () => {
		const anna = await join("Anna");
		expect(anna.last("state")).toMatchObject({path: null, playing: false, position: 0});
		await say(anna, {type: "goto", path: "/rejseholdet_503605/rejseholdet_503615"});
		await say(anna, {type: "state", playing: true, position: 120});
		const bo = await join("Bo");
		expect(bo.last("state")).toMatchObject({path: "/rejseholdet_503605/rejseholdet_503615", playing: true, position: 120});
		expect(anna.last("people")).toMatchObject({people: ["Anna", "Bo"], you: "anna"});
		expect(bo.last("people")).toMatchObject({people: ["Anna", "Bo"], you: "bo"});
	});

	test("pausing, playing and skipping reach the others, with who did it", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		await say(anna, {type: "state", playing: false, position: 754.5});
		const paused = bo.last("state");
		expect(paused).toMatchObject({playing: false, position: 754.5, by: "Anna"});
		expect(typeof paused.at).toBe("number");
		expect(typeof paused.now).toBe("number");
		// Not back to whoever did it
		expect(anna.received.filter(m => m.type == "state")).toHaveLength(1);
	});

	test("moving on to another episode takes the others along", async () => {
		const anna = await join("Anna");
		await say(anna, {type: "goto", path: "/rejseholdet_503605/rejseholdet_503615"});
		const bo = await join("Bo");
		await say(anna, {type: "goto", path: "/rejseholdet_503605/rejseholdet_503640"});
		expect(bo.last("goto")).toMatchObject({path: "/rejseholdet_503605/rejseholdet_503640", by: "Anna"});
		expect(stored.get("state")).toMatchObject({path: "/rejseholdet_503605/rejseholdet_503640", playing: true, position: 0});
		// Only to pages here
		await say(anna, {type: "goto", path: "https://example.com/"});
		await say(anna, {type: "goto", path: "//example.com/x"});
		expect(bo.received.filter(m => m.type == "goto")).toHaveLength(1);
	});

	test("reactions, but only the room's own", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		await say(bo, {type: "react", emoji: "😂"});
		await say(bo, {type: "react", emoji: "<script>"});
		expect(anna.received.filter(m => m.type == "react")).toEqual([expect.objectContaining({emoji: "😂", by: "Bo"})]);
	});

	test("what isn't a message is left alone", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		await room.webSocketMessage(anna as unknown as WebSocket, "not json");
		await room.webSocketMessage(anna as unknown as WebSocket, JSON.stringify({type: "state", playing: true, position: "x".repeat(2000)}));
		await say(anna, {type: "state", playing: "yes", position: 1});
		await say(anna, {type: "state", playing: true, position: -5});
		expect(bo.received.filter(m => m.type == "state")).toHaveLength(1);
	});

	test("a tab that connects again, from another page, replaces itself", async () => {
		const anna = await join("Anna");
		await say(anna, {type: "hello", name: "Anna", tab: "tab-1"});
		const bo = await join("Bo");
		const again = new FakeSocket();
		sockets.push(again);
		again.serializeAttachment({id: "anna-2", name: "Gæst"});
		await say(again, {type: "hello", name: "Anna", tab: "tab-1"});
		expect(anna.readyState).toBe(3);
		expect(bo.last("people").people).toEqual(["Bo", "Anna"]);
	});

	test("names are short, and there's always one", async () => {
		const anna = await join("  Anna   Andersen  ");
		const nobody = await join("");
		await say(anna, {type: "name", name: "x".repeat(100)});
		expect(nobody.last("people").people).toEqual(["x".repeat(30), "Gæst"]);
	});

	test("a room is forgotten a while after the last viewer leaves", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		await say(anna, {type: "state", playing: true, position: 10});
		await room.webSocketClose(anna as unknown as WebSocket);
		expect(bo.last("people").people).toEqual(["Bo"]);
		expect(alarm).toBeNull();
		await room.webSocketClose(bo as unknown as WebSocket);
		expect(alarm).toBeGreaterThan(Date.now());
		await room.alarm();
		expect(stored.size).toBe(0);
	});
});
