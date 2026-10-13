// Watching together: what a room passes on between its viewers

import {afterEach, beforeEach, describe, expect, test, vi} from "vitest";
import type {Env} from "../src/dr";
import {CHAT_BURST, CHAT_KEPT, isRoomId, LEAVING_GRACE, MAX_CHAT, newRoomId, Room} from "../src/room";

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
			delete: async (key: string) => stored.delete(key),
			deleteAll: async () => stored.clear(),
			setAlarm: async (at: number) => { alarm = at; },
			deleteAlarm: async () => { alarm = null; },
		},
	};
	room = new Room(ctx as unknown as DurableObjectState, {} as Env);
	vi.useFakeTimers({toFake: ["Date"]});
	vi.setSystemTime(Date.UTC(2026, 9, 13, 20));
});

afterEach(() => {
	vi.useRealTimers();
});

/** A viewer leaving, as the WebSocket closing tells the room */
const leave = (ws: FakeSocket, code = 1000) => {
	ws.readyState = 3;
	return room.webSocketClose(ws as unknown as WebSocket, code);
};

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
		await leave(anna);
		expect(bo.last("people").people).toEqual(["Bo"]);
		await leave(bo);
		expect(alarm).toBe(Date.now() + 6 * 60 * 60 * 1000);
		// Not before then
		vi.advanceTimersByTime(60 * 60 * 1000);
		await room.alarm();
		expect(stored.get("state")).toBeDefined();
		vi.advanceTimersByTime(5 * 60 * 60 * 1000);
		await room.alarm();
		expect(stored.size).toBe(0);
	});

	test("isn't forgotten while someone has come back", async () => {
		const anna = await join("Anna");
		await say(anna, {type: "state", playing: true, position: 10});
		await leave(anna);
		vi.advanceTimersByTime(60 * 60 * 1000);
		await join("Bo");
		vi.advanceTimersByTime(5 * 60 * 60 * 1000);
		await room.alarm();
		expect(stored.get("state")).toBeDefined();
	});
});

describe("the chat", () => {
	const chats = (ws: FakeSocket) => ws.received.filter(m => m.type == "chat");

	test("passes messages on to everyone, the writer too, with who wrote it, where the video was, and when", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		await say(anna, {type: "goto", path: "/rejseholdet_503605/rejseholdet_503615"});
		await say(anna, {type: "state", playing: true, position: 120});
		vi.advanceTimersByTime(5000);
		await say(bo, {type: "chat", text: "Hvem er han?"});
		for (const ws of [anna, bo]) {
			expect(chats(ws)).toEqual([{type: "chat", text: "Hvem er han?", by: "Bo", viewer: "bo", position: 125, at: Date.now(), now: Date.now()}]);
		}
	});

	test("without a video, there's no time in it", async () => {
		const anna = await join("Anna");
		await say(anna, {type: "chat", text: "Hej"});
		expect(anna.last("chat")).toMatchObject({text: "Hej", position: null});
	});

	test("messages are on one line, without control characters, at most 300 characters, and never empty", async () => {
		const anna = await join("Anna");
		await say(anna, {type: "chat", text: "  Se\nlige\u0000 det\u0007\u202e her\t "});
		await say(anna, {type: "chat", text: "x".repeat(MAX_CHAT + 50)});
		await say(anna, {type: "chat", text: "😂".repeat(MAX_CHAT + 1)});
		await say(anna, {type: "chat", text: "   "});
		await say(anna, {type: "chat", text: "\u0000\u0001\n"});
		await say(anna, {type: "chat", text: 42});
		await say(anna, {type: "chat"});
		expect(chats(anna).map(m => m.text)).toEqual(["Se lige det her", "x".repeat(MAX_CHAT), "😂".repeat(MAX_CHAT)]);
	});

	test("lets each viewer write one message a second, with five to spare, and drops the rest without a word", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		for (let i = 1; i <= 8; i++) {
			await say(anna, {type: "chat", text: `Besked ${i}`});
		}
		expect(chats(bo).map(m => m.text)).toEqual(["Besked 1", "Besked 2", "Besked 3", "Besked 4", "Besked 5"]);
		expect(anna.received.filter(m => m.type == "error")).toEqual([]);
		// Others aren't held back by it
		await say(bo, {type: "chat", text: "Ro på"});
		expect(chats(anna).at(-1).text).toBe("Ro på");
		// A second later, one more
		vi.advanceTimersByTime(1000);
		await say(anna, {type: "chat", text: "Undskyld"});
		await say(anna, {type: "chat", text: "Igen"});
		expect(chats(bo).map(m => m.text).slice(-2)).toEqual(["Ro på", "Undskyld"]);
		// And all five again, after a while
		vi.advanceTimersByTime(60 * 1000);
		for (let i = 0; i < CHAT_BURST + 1; i++) {
			await say(anna, {type: "chat", text: `Senere ${i}`});
		}
		expect(chats(bo).filter(m => m.text.startsWith("Senere"))).toHaveLength(CHAT_BURST);
	});

	test("keeps the last 20 messages, and only what they say, for those who join later", async () => {
		const anna = await join("Anna");
		for (let i = 1; i <= CHAT_KEPT + 5; i++) {
			await say(anna, {type: "chat", text: `Besked ${i}`});
			vi.advanceTimersByTime(1000);
		}
		const kept = stored.get("chat") as any[];
		expect(kept).toHaveLength(CHAT_KEPT);
		expect(kept[0].text).toBe("Besked 6");
		expect(Object.keys(kept[0]).sort()).toEqual(["at", "by", "position", "text", "viewer"]);
		const bo = await join("Bo");
		const history = bo.last("history");
		expect(history.messages.map((m: any) => m.text)).toEqual(Array.from({length: CHAT_KEPT}, (_, i) => `Besked ${i + 6}`));
		expect(history.messages[0]).toMatchObject({by: "Anna", viewer: "anna"});
		// Sent with the room's state, before anything else is said
		expect(bo.received.findIndex(m => m.type == "history")).toBe(bo.received.findIndex(m => m.type == "state") + 1);
	});

	test("is forgotten along with the room", async () => {
		const anna = await join("Anna");
		await say(anna, {type: "chat", text: "Hej"});
		expect(stored.get("chat")).toHaveLength(1);
		await leave(anna);
		vi.advanceTimersByTime(6 * 60 * 60 * 1000);
		await room.alarm();
		expect(stored.has("chat")).toBe(false);
		const bo = await join("Bo");
		expect(bo.last("history").messages).toEqual([]);
	});

	test("says when someone comes in, and when they've gone, without keeping it", async () => {
		const anna = await join("Anna");
		const bo = await join("Bo");
		expect(anna.last("joined")).toMatchObject({by: "Bo"});
		expect(bo.last("joined")).toBeUndefined();
		await say(bo, {type: "hello", name: "Bo", tab: "bo-tab"});
		await leave(bo);
		// Not right away, since they may only be going on to the next episode
		expect(anna.last("left")).toBeUndefined();
		expect(alarm).toBe(Date.now() + LEAVING_GRACE);
		vi.advanceTimersByTime(LEAVING_GRACE);
		await room.alarm();
		expect(anna.last("left")).toMatchObject({by: "Bo"});
		expect(stored.get("chat")).toBeUndefined();
	});

	test("doesn't say anything when a viewer only goes on to another page", async () => {
		const anna = await join("Anna");
		const bo = new FakeSocket();
		sockets.push(bo);
		bo.serializeAttachment({id: "bo", name: "Gæst"});
		await say(bo, {type: "hello", name: "Bo", tab: "bo-tab"});
		const joined = anna.received.filter(m => m.type == "joined").length;
		// The old page closes, and the new one connects
		await leave(bo);
		const again = new FakeSocket();
		sockets.push(again);
		again.serializeAttachment({id: "bo-2", name: "Gæst"});
		vi.advanceTimersByTime(2000);
		await say(again, {type: "hello", name: "Bo", tab: "bo-tab"});
		// Or the new one connects first, and replaces the old
		const third = new FakeSocket();
		sockets.push(third);
		third.serializeAttachment({id: "bo-3", name: "Gæst"});
		await say(third, {type: "hello", name: "Bo", tab: "bo-tab"});
		await room.webSocketClose(again as unknown as WebSocket, 4000);
		vi.advanceTimersByTime(LEAVING_GRACE);
		await room.alarm();
		expect(anna.received.filter(m => m.type == "joined")).toHaveLength(joined);
		expect(anna.last("left")).toBeUndefined();
	});
});
