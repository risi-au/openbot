import { isSlackChannelId } from "../ipc-messaging";
import { adminRoute, empty, fields, identifier, oneOf } from "./admin-wire";

export const SLACK_SOCKET_CHANNELS_CAPABILITY = "slack-socket-channels-v1";
export const SLACK_SOCKET_CHANNELS_ROUTE = "/v1/admin/connectors/slack/socket-channels/update";

export const SLACK_SOCKET_CHANNELS_CODEC = adminRoute(
  fields({
    workspaceId: identifier,
    channelId: (value) => {
      if (!isSlackChannelId(value)) throw new Error("Invalid Slack channel id.");
      return value;
    },
    action: oneOf("add", "remove"),
  }),
  empty,
);
