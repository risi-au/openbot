import assert from "node:assert/strict";
import { Effect } from "effect";
import WebSocket from "ws";
import type { InboundMessage } from "../src/backend/messaging/messaging-types";
import { slackDriver } from "../src/backend/messaging/slack/slack-driver";
import { SlackSocketTransport } from "../src/backend/messaging/slack/slack-socket-transport";

const channelId = "CTEST";
const secondChannelId = "CSECOND";
let channels = [channelId, secondChannelId];
const settings = { appToken: "xapp-testing", channelIds: [channelId], userId: "UALLOWED" };
const botToken = "xoxb-testing";
const workspaceId = "TTEST";
const botUserId = "UBOT";
const posts: URLSearchParams[] = [];
const acknowledgements: string[] = [];
const envelopes = [
  ["accept", channelId, settings.userId, workspaceId, "EvAllowed"],
  ["duplicate", channelId, settings.userId, workspaceId, "EvAllowed"],
  ["second-channel", secondChannelId, settings.userId, workspaceId, "EvSecondChannel"],
  ["wrong-author", channelId, "UOTHER", workspaceId, "EvOther"],
  ["wrong-channel", "COTHER", settings.userId, workspaceId, "EvOtherChannel"],
  ["wrong-workspace", channelId, settings.userId, "TOTHER", "EvOtherWorkspace"],
];

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request, host) {
    switch (new URL(request.url).pathname) {
      case "/socket":
        if (host.upgrade(request)) return undefined;
        return new Response(null, { status: 400 });
      case "/api/auth.test":
        assert.equal(request.headers.get("authorization"), `Bearer ${botToken}`);
        return Response.json(
          { ok: true, team_id: workspaceId, team: "Test workspace", user_id: botUserId, bot_id: "BTEST" },
          { headers: { "x-oauth-scopes": "app_mentions:read,chat:write" } },
        );
      case "/api/apps.connections.open":
        assert.equal(request.headers.get("authorization"), `Bearer ${settings.appToken}`);
        return Response.json({ ok: true, url: "wss://wss-primary.slack.com/link" });
      case "/api/chat.postMessage":
        assert.equal(request.headers.get("authorization"), `Bearer ${botToken}`);
        posts.push(new URLSearchParams(await request.text()));
        return Response.json({ ok: true, ts: "1764116111.000200" });
      default:
        throw new Error(`Unexpected Slack call: ${new URL(request.url).pathname}`);
    }
  },
  websocket: {
    open(socket) {
      socket.subscribe("additional-events");
      socket.send(JSON.stringify({ type: "hello" }));
      for (const [envelopeId, channel, user, teamId, eventId] of envelopes)
        socket.send(
          JSON.stringify({
            type: "events_api",
            envelope_id: envelopeId,
            payload: {
              type: "event_callback",
              team_id: teamId,
              event_id: eventId,
              event: { type: "app_mention", ts: "1764116111.000100", text: "<@UBOT> hello", channel, user },
            },
          }),
        );
    },
    message(_socket, data) {
      acknowledgements.push(JSON.parse(data.toString()).envelope_id);
    },
  },
});

const origin = server.url.origin;
const driver = slackDriver({ origin });
const adapter = driver.createAdapter(
  { botToken, socketAppToken: settings.appToken, socketChannelId: channelId, socketUserId: settings.userId },
  {
    connectionId: "test",
    rateLimited: () => {},
    readCredentials: () => ({
      botToken,
      socketAppToken: settings.appToken,
      socketChannelId: channelId,
      socketChannelIds: channels.join(","),
      socketUserId: settings.userId,
    }),
  },
);
let transport: SlackSocketTransport | undefined;
try {
  const identity = await Effect.runPromise(adapter.identify());
  assert.equal(identity.workspaceId, workspaceId);
  assert.deepEqual(identity.missingScopes, []);
  const messages: InboundMessage[] = [];
  const states: string[] = [];
  transport = new SlackSocketTransport(
    identity,
    settings,
    origin,
    (url) => {
      assert.equal(url.host, "wss-primary.slack.com");
      const local = new URL("/socket", origin);
      local.protocol = "ws:";
      return new WebSocket(local);
    },
    () => channels,
  );
  transport.start({
    state: (state) => states.push(state),
    message: (message) => messages.push(message),
    action: () => assert.fail("The test has no interactive events"),
  });
  const deadline = Date.now() + 5_000;
  while (acknowledgements.length < envelopes.length) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for Slack acknowledgements");
    await Bun.sleep(10);
  }
  assert.deepEqual(
    acknowledgements,
    envelopes.map(([id]) => id),
  );
  assert.deepEqual(states, ["connecting", "connected"]);
  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.platformChannelId, secondChannelId);
  assert.equal(messages[0]?.text.trim(), "hello");
  assert.deepEqual(messages[0]?.target, { platformChannelId: channelId, replyThreadId: "1764116111.000100" });
  assert.equal(
    await Effect.runPromise(adapter.post({ platformChannelId: channelId, replyThreadId: null }, { text: "hello" })),
    "1764116111.000200",
  );
  await Effect.runPromise(adapter.post({ platformChannelId: secondChannelId, replyThreadId: null }, { text: "hello" }));
  channels = [channelId];
  server.publish(
    "additional-events",
    JSON.stringify({
      type: "events_api",
      envelope_id: "after-removal",
      payload: {
        type: "event_callback",
        team_id: workspaceId,
        event_id: "EvRemovedChannel",
        event: {
          type: "app_mention",
          ts: "1764116112.000100",
          text: "<@UBOT> hello",
          channel: secondChannelId,
          user: settings.userId,
        },
      },
    }),
  );
  const removalDeadline = Date.now() + 5_000;
  while (!acknowledgements.includes("after-removal")) {
    if (Date.now() > removalDeadline) assert.fail("Timed out waiting for the removed channel's acknowledgement");
    await Bun.sleep(10);
  }
  assert.equal(messages.length, 2);
  assert.deepEqual(states, ["connecting", "connected"]);
  const removed = await Effect.runPromise(
    Effect.result(adapter.post({ platformChannelId: secondChannelId, replyThreadId: null }, { text: "hello" })),
  );
  assert.equal(removed._tag, "Failure");
  const rejected = await Effect.runPromise(
    Effect.result(adapter.post({ platformChannelId: "COTHER", replyThreadId: null }, { text: "hello" })),
  );
  assert.equal(rejected._tag, "Failure");
  assert.deepEqual(
    posts.map((post) => post.get("channel")),
    [channelId, secondChannelId],
  );
  process.stdout.write(
    "Slack Socket Mode acknowledged all envelopes, delivered mentions in both approved channels, and confined outbound posts.\n",
  );
} finally {
  if (transport) await Effect.runPromise(transport.stop());
  await server.stop(true);
}
