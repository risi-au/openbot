import { isSlackSocketChannelList } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import WebSocket from "ws";
import type { ConnectionIdentity, MessagingTransport, TransportSink } from "../messaging-types";
import { MessagingConnectionError } from "../messaging-types";
import { slackInboundMessage } from "./slack-events";
import { SlackApiError, SlackWebApi } from "./slack-web-api";

export const SLACK_SOCKET_APP_ID = "socket-mode";

export interface SlackSocketSettings {
  appToken: string;
  channelIds: readonly string[];
  userId: string;
}

export function slackSocketSettings(credentials: Record<string, string>): SlackSocketSettings | null {
  const { socketAppToken, socketChannelId, socketChannelIds, socketUserId } = credentials;
  const channels = socketChannelIds === undefined ? [socketChannelId] : socketChannelIds.split(",");
  return /^xapp-[\w-]+$/u.test(socketAppToken ?? "") &&
    isSlackSocketChannelList(channels) &&
    /^[UW][A-Z0-9]+$/u.test(socketUserId ?? "") &&
    socketAppToken &&
    socketUserId
    ? { appToken: socketAppToken, channelIds: channels, userId: socketUserId }
    : null;
}

export class SlackSocketTransport implements MessagingTransport {
  readonly #seen = new Set<string>();
  readonly #api: SlackWebApi;
  #sink: TransportSink | null = null;
  #session: AbortController | null = null;
  #socket: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly identity: ConnectionIdentity,
    private readonly settings: SlackSocketSettings,
    origin?: string,
    private readonly connectSocket = (url: URL) =>
      new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: 1024 * 1024 }),
    private readonly channels = () => settings.channelIds,
  ) {
    this.#api = new SlackWebApi({ token: settings.appToken, origin });
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    this.reconnect();
  }

  reconnect(): void {
    this.#close();
    if (!this.#sink) return;
    this.#sink.state("connecting");
    const session = new AbortController();
    this.#session = session;
    void this.#open(session);
  }

  readonly stop = Effect.fn("SlackSocket.stop")(() =>
    Effect.sync(() => {
      this.#sink = null;
      this.#close();
    }),
  );

  #close(): void {
    this.#session?.abort();
    this.#session = null;
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
    this.#socket?.terminate();
    this.#socket = null;
  }

  #reconnectLater(session: AbortController): void {
    if (session.signal.aborted || this.#retry !== null || !this.#sink) return;
    this.#sink.state("reconnecting");
    this.#retry = setTimeout(() => this.reconnect(), 5_000);
    this.#retry.unref();
  }

  async #open(session: AbortController): Promise<void> {
    try {
      const result = await Effect.runPromise(
        Effect.result(this.#api.call("apps.connections.open", {}, { rateLimitRetries: 0 })),
        { signal: session.signal },
      );
      if (session.signal.aborted) return;
      if (result._tag === "Failure") {
        const failure = result.failure.cause;
        if (failure instanceof MessagingConnectionError) {
          this.#sink?.state(failure.state);
          return;
        }
        if (failure instanceof SlackApiError && failure.code === "missing_scope") {
          this.#sink?.state("missing_scope");
          return;
        }
        this.#reconnectLater(session);
        return;
      }
      const url = isString(result.success.url) ? URL.parse(result.success.url) : null;
      if (
        url?.protocol !== "wss:" ||
        !url.hostname.endsWith(".slack.com") ||
        url.port ||
        url.username ||
        url.password
      ) {
        this.#sink?.state("error");
        return;
      }

      const socket = this.connectSocket(url);
      this.#socket = socket;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(deadline);
        deadline = setTimeout(() => socket.terminate(), 45_000);
        deadline.unref();
      };
      arm();
      socket.on("ping", arm);
      socket.on("error", () => socket.terminate());
      socket.on("close", () => {
        clearTimeout(deadline);
        this.#reconnectLater(session);
      });
      socket.on("message", (data) => {
        if (session.signal.aborted) return;
        arm();
        this.#receive(socket, data.toString());
      });
    } catch {
      this.#reconnectLater(session);
    }
  }

  #receive(socket: WebSocket, text: string): void {
    let envelope: unknown;
    try {
      envelope = JSON.parse(text);
    } catch {
      return;
    }
    if (!isDynamicRecord(envelope)) return;
    if (envelope.type === "hello") this.#sink?.state("connected");
    if (envelope.type === "disconnect") socket.close();
    if (isString(envelope.envelope_id) && socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    const payload = envelope.payload;
    if (envelope.type !== "events_api" || !isDynamicRecord(payload) || payload.type !== "event_callback") return;
    const event = payload.event;
    if (
      payload.is_ext_shared_channel === true ||
      !isDynamicRecord(event) ||
      event.type !== "app_mention" ||
      !isString(event.channel) ||
      !this.channels().includes(event.channel) ||
      event.user !== this.settings.userId ||
      !isString(event.text) ||
      !event.text.includes(`<@${this.identity.botUserId}>`) ||
      !isString(payload.event_id) ||
      this.#seen.has(payload.event_id)
    )
      return;
    const message = slackInboundMessage(payload, this.identity.workspaceId, this.identity.botUserId);
    if (!message) return;
    this.#seen.add(payload.event_id);
    if (this.#seen.size > 2000) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    this.#sink?.message({ ...message, files: [] });
  }
}
