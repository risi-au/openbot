// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { slackDriver } from "./slack-driver";

const origin = "http://slack.test";
const channelId = "CAPPROVALS";
const credentials = {
  botToken: "xoxb-testing",
  socketAppToken: "xapp-testing",
  socketChannelIds: `${channelId},CSECOND`,
  socketUserId: "UOWNER",
};

let directory: string;
let calls: Array<{ path: string; body: URLSearchParams | null }>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-slack-upload-"));
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const body = typeof init?.body === "string" || init?.body instanceof URLSearchParams ? init.body : null;
    calls.push({ path: url.pathname, body: body === null ? null : new URLSearchParams(body.toString()) });
    switch (url.pathname) {
      case "/api/files.getUploadURLExternal":
        return Response.json({ ok: true, upload_url: `${origin}/upload/F1`, file_id: "F1" });
      case "/upload/F1":
        return new Response("OK");
      case "/api/files.completeUploadExternal":
        return Response.json({ ok: true, files: [{ id: "F1" }] });
      default:
        throw new Error(`Unexpected Slack call: ${url.pathname}`);
    }
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function socketAdapter() {
  return slackDriver({ origin }).createAdapter(credentials, { connectionId: "test", rateLimited: () => {} });
}

async function approvalFile() {
  const path = join(directory, "post.png");
  await writeFile(path, Buffer.from("png bytes"));
  return { name: "post.png", path, mimeType: "image/png" };
}

describe("Slack Socket Mode uploads", () => {
  it("uploads a file into a thread of an allowed channel", async () => {
    const result = await Effect.runPromise(
      socketAdapter().upload({ platformChannelId: channelId, replyThreadId: "1764116111.000100" }, [
        await approvalFile(),
      ]),
    );

    expect(result).toEqual({ skipped: [], firstId: null });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/files.getUploadURLExternal",
      "/upload/F1",
      "/api/files.completeUploadExternal",
    ]);
    expect(Object.fromEntries(calls[0]?.body ?? [])).toEqual({ filename: "post.png", length: "9" });
    expect(Object.fromEntries(calls[2]?.body ?? [])).toEqual({
      files: JSON.stringify([{ id: "F1", title: "post.png" }]),
      channel_id: channelId,
      thread_ts: "1764116111.000100",
    });
  });

  it("refuses a channel outside the allow-list before sending any bytes", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        socketAdapter().upload({ platformChannelId: "COTHER", replyThreadId: null }, [await approvalFile()]),
      ),
    );

    expect(result._tag).toBe("Failure");
    expect(calls).toEqual([]);
  });
});
