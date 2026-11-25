import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

const base = process.env;
const cli = base.OPENBOT_CLI;
const automationDir = base.OPENBOT_AUTOMATION_DIR;
const agentId = base.OPENBOT_AGENT_ID;
const replyTimeout = 10 * 60 * 1000;
const validId = (value, pattern) => typeof value === "string" && pattern.test(value);

function openBot(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--json"], {
      env: { OPENBOT_AUTOMATION_DIR: automationDir },
      stdio: ["pipe", "pipe", "ignore"],
      timeout: replyTimeout + 15_000,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1_000_000) child.kill();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.once("error", () => reject(new Error("OpenBot CLI could not start.")));
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(`OpenBot CLI failed (exit ${code ?? "signal"}).`));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("OpenBot CLI returned an invalid result."));
      }
    });
  });
}

async function slack(method, token, body = {}) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  }).catch(() => {
    throw new Error(`Slack ${method} could not be reached.`);
  });
  if (!response.ok) throw new Error(`Slack ${method} failed (HTTP ${response.status}).`);
  const result = await response.json().catch(() => null);
  if (result?.ok !== true) {
    const reason = validId(result?.error, /^[a-z0-9_]{1,60}$/u) ? result.error : "invalid response";
    throw new Error(`Slack ${method} failed (${reason}).`);
  }
  return result;
}

function mention(envelope, identity, channel, user) {
  const payload = envelope.payload;
  const event = payload?.event;
  const tag = `<@${identity.user_id}>`;
  if (
    envelope.type !== "events_api" ||
    payload?.type !== "event_callback" ||
    payload.team_id !== identity.team_id ||
    payload.is_ext_shared_channel === true ||
    !validId(payload.event_id, /^Ev[A-Z0-9]{2,80}$/u) ||
    event?.type !== "app_mention" ||
    event.channel !== channel ||
    event.user !== user ||
    event.bot_id ||
    event.subtype ||
    typeof event.text !== "string" ||
    !event.text.includes(tag)
  )
    return null;
  const thread = event.thread_ts ?? event.ts;
  const text = event.text.replaceAll(tag, "").trim();
  if (!validId(thread, /^\d{8,16}\.\d{1,9}$/u) || !text || text.length > 4000) return null;
  return { id: payload.event_id, thread, text };
}

function connect(url, onEnvelope) {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    const handshake = setTimeout(() => socket.close(), 15_000);
    socket.addEventListener("error", () => socket.close(), { once: true });
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(handshake);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener("message", ({ data }) => {
      let envelope;
      try {
        envelope = JSON.parse(data);
      } catch {
        return;
      }
      if (!envelope || typeof envelope !== "object") return;
      if (envelope.type === "hello") {
        clearTimeout(handshake);
        console.log("Slack Socket Mode connected.");
      }
      if (typeof envelope.envelope_id === "string") {
        socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        onEnvelope(envelope);
      }
      if (envelope.type === "disconnect") socket.close();
    });
  });
}

async function main() {
  if (!cli?.startsWith("/") || !automationDir?.startsWith("/")) {
    throw new Error("Set OPENBOT_CLI and OPENBOT_AUTOMATION_DIR to absolute paths.");
  }
  await access(cli).catch(() => {
    throw new Error("The OpenBot CLI file is missing.");
  });
  const { agents } = await openBot(["list"]);
  if (!Array.isArray(agents)) throw new Error("OpenBot returned an invalid agent list.");
  if (process.argv[2] === "--check") {
    if (agentId && !agents.some((agent) => agent.id === agentId)) throw new Error("The selected agent is unavailable.");
    console.log(`OpenBot local API is reachable. ${agents.length} agents allow Local scripts.`);
    return;
  }

  const { SLACK_APP_TOKEN: appToken, SLACK_BOT_TOKEN: botToken, SLACK_CHANNEL_ID: channel, SLACK_USER_ID: user } = base;
  if (
    !agentId ||
    !agents.some((agent) => agent.id === agentId) ||
    !appToken?.startsWith("xapp-") ||
    !botToken?.startsWith("xoxb-") ||
    !validId(channel, /^[CG][A-Z0-9]{2,40}$/u) ||
    !validId(user, /^[UW][A-Z0-9]{2,40}$/u)
  )
    throw new Error(
      "Set both Slack tokens, one channel ID, one user ID and an OpenBot agent ID with Local scripts enabled.",
    );

  const identity = await slack("auth.test", botToken);
  if (!identity.team_id || !identity.user_id) throw new Error("Slack did not identify the bot and workspace.");
  const seen = new Map();
  let pending = 0;
  let work = Promise.resolve();

  function onEnvelope(envelope) {
    const task = mention(envelope, identity, channel, user);
    if (!task || seen.has(task.id)) return;
    seen.set(task.id, true);
    if (seen.size > 2048) seen.delete(seen.keys().next().value);
    if (pending >= 5) {
      console.warn("Dropped a mention because the local queue is full.");
      return;
    }
    pending++;
    work = work
      .then(async () => {
        const delivery = await openBot(
          ["run", agentId, "-", "--wait", "--timeout", "10m", "--id", `slack-${task.id}`],
          `This request arrived as a Slack mention in the bridge's test channel. Your answer will be posted in that Slack thread. Keep it brief and suitable for the channel. Do not include secrets or private information.\n\nSlack message:\n${task.text}`,
        );
        if (delivery.status !== "completed" || typeof delivery.answer !== "string" || !delivery.answer.trim()) return;
        await slack("chat.postMessage", botToken, {
          channel,
          thread_ts: task.thread,
          text: delivery.answer.slice(0, 3800).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
          mrkdwn: false,
          unfurl_links: false,
          unfurl_media: false,
        });
      })
      .catch((error) => console.error(error.message))
      .finally(() => {
        pending--;
      });
  }

  for (;;) {
    try {
      const result = await slack("apps.connections.open", appToken);
      const url = URL.parse(result.url);
      if (url?.protocol !== "wss:" || !url.hostname.endsWith(".slack.com") || url.username || url.password) {
        throw new Error("Slack returned an invalid socket address.");
      }
      await connect(url, onEnvelope);
    } catch (error) {
      console.error(error.message);
    }
    await wait(5000);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
