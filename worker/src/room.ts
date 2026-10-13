// "Se sammen": watching a programme together, each from DR, but paused, played and skipped at once.
//
// Each room is a Durable Object, which the viewers' browsers are connected to with WebSockets.
// It only passes on what changes, like "paused at 12:34" or "on to the next episode", and keeps
// where the room has got to, for those who join later. The video itself never passes through here.
// Viewers can write to each other too: the room keeps its last messages, for those who join later,
// and forgets them along with itself. While nothing is said, the room hibernates, which costs nothing.

import {DurableObject} from "cloudflare:workers";
import type {Env} from "./dr";

// Without I, O, 0 and 1, like sync codes
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ID_LENGTH = 8;
export const MAX_VIEWERS = 12;
// What a message may be, at most, in characters
const MAX_MESSAGE = 1024;
// How long a room is kept after the last viewer leaves, in milliseconds
const KEPT_FOR = 6 * 60 * 60 * 1000;
export const REACTIONS = ["👏", "😂", "😮", "😢", "❤️"];
// The page of an episode or a programme, which a room watches
const VIDEO_PAGE = /^\/(program\/[\w-]{1,200}|[\w-]{1,200}\/[\w-]{1,200})$/;
// What a chat message may be, at most, in characters
export const MAX_CHAT = 300;
// How many of the chat's messages the room keeps, for those who join later
export const CHAT_KEPT = 20;
// How fast a viewer may write: one message a second, with five to spare
export const CHAT_BURST = 5;
const CHAT_PER_SECOND = 1;
// How long a viewer who left may take to come back, like from the next episode's page,
// before the others are told they left, in milliseconds
export const LEAVING_GRACE = 10 * 1000;
// Control characters, and those that turn text around, which could make a message look like another's
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function newRoomId(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(ID_LENGTH)), b => ALPHABET[b % ALPHABET.length]).join("");
}

export function isRoomId(id: string): boolean {
	return id.length == ID_LENGTH && [...id].every(c => ALPHABET.includes(c));
}

/** Where the room has got to: what it watches, whether it plays, and where it was at a moment */
export interface RoomState {
	path: string | null;
	playing: boolean;
	// In seconds of video, at the time `at`, in milliseconds
	position: number;
	at: number;
}

interface Viewer {
	id: string;
	name: string;
	// The browser tab, which connects again from each page it goes on to
	tab?: string;
	// How many chat messages the viewer may send right away, as of `checked`, in milliseconds
	tokens?: number;
	checked?: number;
}

/** A message in the chat, as the room passes it on and keeps it */
export interface ChatMessage {
	text: string;
	by: string;
	viewer: string;
	// Where the video was, in seconds, if the room watches something
	position: number | null;
	// The server's time, in milliseconds
	at: number;
}

/** A viewer who left, whom the others are told about unless they come back soon */
interface Leaving {
	tab?: string;
	name: string;
	at: number;
}

function cleanName(value: unknown): string {
	const name = typeof value == "string" ? value.replace(/\s+/g, " ").trim().slice(0, 30) : "";
	return name || "Gæst";
}

/** A chat message's text, on one line, without what can't be printed, and at most MAX_CHAT characters; empty if nothing's left */
export function cleanChat(value: unknown): string {
	if (typeof value != "string") {
		return "";
	}
	const text = value.replace(/[\r\n\t]+/g, " ").replace(UNPRINTABLE, "").trim();
	return [...text].slice(0, MAX_CHAT).join("").trim();
}

/** Where the room is in its video now, in seconds */
function positionNow(state: RoomState, now: number): number | null {
	if (state.path === null) {
		return null;
	}
	return Math.round(state.playing ? state.position + Math.max(0, now - state.at) / 1000 : state.position);
}

export class Room extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") != "websocket") {
			return new Response("Expected a WebSocket", {status: 426});
		}
		if (this.ctx.getWebSockets().length >= MAX_VIEWERS) {
			return new Response("The room is full", {status: 409});
		}
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({id: crypto.randomUUID().slice(0, 8), name: "Gæst"} satisfies Viewer);
		return new Response(null, {status: 101, webSocket: client});
	}

	private async state(): Promise<RoomState> {
		return (await this.ctx.storage.get<RoomState>("state")) ?? {path: null, playing: false, position: 0, at: Date.now()};
	}

	private viewers(except?: WebSocket): WebSocket[] {
		return this.ctx.getWebSockets().filter(ws => ws !== except && ws.readyState === WebSocket.OPEN);
	}

	private send(ws: WebSocket, message: object) {
		try {
			ws.send(JSON.stringify({...message, now: Date.now()}));
		} catch {
			// Gone already; webSocketClose tidies up
		}
	}

	private broadcast(message: object, except?: WebSocket) {
		for (const ws of this.viewers(except)) {
			this.send(ws, message);
		}
	}

	/** Who's watching, sent to each, with which of them they are */
	private sendPeople() {
		const people = this.viewers().map(ws => ws.deserializeAttachment() as Viewer);
		for (const ws of this.viewers()) {
			this.send(ws, {type: "people", people: people.map(p => p.name), you: (ws.deserializeAttachment() as Viewer).id, ids: people.map(p => p.id)});
		}
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		if (typeof raw != "string" || raw.length > MAX_MESSAGE) {
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		const viewer = ws.deserializeAttachment() as Viewer;
		switch (message.type) {
		case "hello": {
			const tab = typeof message.tab == "string" ? message.tab.slice(0, 40) : undefined;
			const name = cleanName(message.name);
			ws.serializeAttachment({...viewer, name, tab});
			// The same tab, from the page it was on before, which may not have said goodbye: not someone new
			let returning = false;
			if (tab) {
				for (const other of this.viewers(ws)) {
					if ((other.deserializeAttachment() as Viewer).tab == tab) {
						other.close(4000, "Connected again");
						returning = true;
					}
				}
				const leaving = (await this.ctx.storage.get<Leaving[]>("leaving")) ?? [];
				if (leaving.some(l => l.tab == tab)) {
					returning = true;
					await this.ctx.storage.put("leaving", leaving.filter(l => l.tab != tab));
				}
			}
			this.send(ws, {type: "state", ...await this.state()});
			this.send(ws, {type: "history", messages: (await this.ctx.storage.get<ChatMessage[]>("chat")) ?? []});
			if (!returning) {
				this.broadcast({type: "joined", by: name}, ws);
			}
			this.sendPeople();
			break;
		}
		case "name": {
			ws.serializeAttachment({...viewer, name: cleanName(message.name)});
			this.sendPeople();
			break;
		}
		case "state": {
			const position = Number(message.position);
			if (!Number.isFinite(position) || position < 0 || typeof message.playing != "boolean") {
				return;
			}
			const state = {...await this.state(), playing: message.playing, position, at: Date.now()};
			await this.ctx.storage.put("state", state);
			this.broadcast({type: "state", ...state, by: viewer.name}, ws);
			break;
		}
		case "goto": {
			if (typeof message.path != "string" || !VIDEO_PAGE.test(message.path)) {
				return;
			}
			const before = await this.state();
			const state = {path: message.path, playing: true, position: 0, at: Date.now()};
			await this.ctx.storage.put("state", state);
			// The first to open a video sets it, without moving the others
			if (before.path !== null && before.path != message.path) {
				this.broadcast({type: "goto", path: message.path, by: viewer.name}, ws);
			}
			break;
		}
		case "react": {
			if (typeof message.emoji == "string" && REACTIONS.includes(message.emoji)) {
				this.broadcast({type: "react", emoji: message.emoji, by: viewer.name}, ws);
			}
			break;
		}
		case "chat": {
			const text = cleanChat(message.text);
			if (!text) {
				return;
			}
			// One a second, with some to spare; what's more is dropped, without a word
			const now = Date.now();
			const tokens = Math.min(CHAT_BURST, (viewer.tokens ?? CHAT_BURST) + (now - (viewer.checked ?? now)) / 1000 * CHAT_PER_SECOND);
			if (tokens < 1) {
				ws.serializeAttachment({...viewer, tokens, checked: now});
				return;
			}
			ws.serializeAttachment({...viewer, tokens: tokens - 1, checked: now});
			const chat: ChatMessage = {text, by: viewer.name, viewer: viewer.id, position: positionNow(await this.state(), now), at: now};
			const kept = (await this.ctx.storage.get<ChatMessage[]>("chat")) ?? [];
			await this.ctx.storage.put("chat", [...kept, chat].slice(-CHAT_KEPT));
			// To everyone, the writer too, so all see the messages in the same order
			this.broadcast({type: "chat", ...chat});
			break;
		}
		}
	}

	async webSocketClose(ws: WebSocket, code?: number) {
		try {
			ws.close();
		} catch {
			// Closed already
		}
		this.sendPeople();
		const viewer = ws.deserializeAttachment() as Viewer;
		if (this.viewers(ws).length == 0) {
			// Nobody to tell; the room is forgotten a while from now, unless someone comes back
			await this.ctx.storage.delete("leaving");
			await this.ctx.storage.put("emptySince", Date.now());
			await this.ctx.storage.setAlarm(Date.now() + KEPT_FOR);
		} else if (code != 4000) {
			// Unless the same tab connected again from another page, which replaced this one
			const leaving = (await this.ctx.storage.get<Leaving[]>("leaving")) ?? [];
			await this.ctx.storage.put("leaving", [...leaving, {tab: viewer.tab, name: viewer.name, at: Date.now()}]);
			await this.ctx.storage.setAlarm(Date.now() + LEAVING_GRACE);
		}
	}

	async webSocketError(ws: WebSocket) {
		await this.webSocketClose(ws);
	}

	/**
	 * Tells the others who left and didn't come back, and forgets the room, along with its chat,
	 * once nobody has been in it for a while
	 */
	async alarm() {
		const now = Date.now();
		const leaving = (await this.ctx.storage.get<Leaving[]>("leaving")) ?? [];
		const gone = leaving.filter(l => now - l.at >= LEAVING_GRACE);
		const waiting = leaving.filter(l => now - l.at < LEAVING_GRACE);
		for (const l of gone) {
			this.broadcast({type: "left", by: l.name});
		}
		if (gone.length) {
			await this.ctx.storage.put("leaving", waiting);
		}
		if (this.viewers().length == 0) {
			// Without a time, the room was left before rooms kept one, and its time is up
			const emptySince = await this.ctx.storage.get<number>("emptySince");
			if (emptySince === undefined || now - emptySince >= KEPT_FOR) {
				await this.ctx.storage.deleteAll();
			} else {
				await this.ctx.storage.setAlarm(emptySince + KEPT_FOR);
			}
			return;
		}
		if (waiting.length) {
			await this.ctx.storage.setAlarm(Math.min(...waiting.map(l => l.at)) + LEAVING_GRACE);
		}
	}
}
