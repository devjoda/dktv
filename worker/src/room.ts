// "Se sammen": watching a programme together, each from DR, but paused, played and skipped at once.
//
// Each room is a Durable Object, which the viewers' browsers are connected to with WebSockets.
// It only passes on what changes, like "paused at 12:34" or "on to the next episode", and keeps
// where the room has got to, for those who join later. The video itself never passes through here.
// While nothing is said, the room hibernates, which costs nothing.

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
}

function cleanName(value: unknown): string {
	const name = typeof value == "string" ? value.replace(/\s+/g, " ").trim().slice(0, 30) : "";
	return name || "Gæst";
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
		await this.ctx.storage.deleteAlarm();
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
			ws.serializeAttachment({...viewer, name: cleanName(message.name), tab});
			// The same tab, from the page it was on before, which may not have said goodbye
			if (tab) {
				for (const other of this.viewers(ws)) {
					if ((other.deserializeAttachment() as Viewer).tab == tab) {
						other.close(4000, "Connected again");
					}
				}
			}
			this.send(ws, {type: "state", ...await this.state()});
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
		}
	}

	async webSocketClose(ws: WebSocket) {
		try {
			ws.close();
		} catch {
			// Closed already
		}
		this.sendPeople();
		if (this.viewers(ws).length == 0) {
			await this.ctx.storage.setAlarm(Date.now() + KEPT_FOR);
		}
	}

	async webSocketError(ws: WebSocket) {
		await this.webSocketClose(ws);
	}

	/** Forgets the room, once nobody has been in it for a while */
	async alarm() {
		if (this.ctx.getWebSockets().length == 0) {
			await this.ctx.storage.deleteAll();
		}
	}
}
