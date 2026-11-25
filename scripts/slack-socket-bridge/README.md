# Local Slack bridge

The bridge waits for explicit Slack mentions on one channel from one user. It sends each mention to one OpenBot agent and posts a reply in the Slack thread. Run the bridge and OpenBot as the same OS user on the same machine. Use Node.js 22 or later.

1. At [Slack app settings](https://api.slack.com/apps), create an app **From a manifest** in your workspace. Import [slack-manifest.json](./slack-manifest.json). Install it and copy its Bot User OAuth Token from **OAuth & Permissions**.
2. In **Basic Information → App-Level Tokens**, generate an app token with `connections:write`. Invite the bot to one private test channel. Copy the channel ID from channel details and your Slack user ID from your profile.
3. In OpenBot, select or create a dedicated agent with **Local scripts** enabled. Use an agent without private chat history or unrelated integrations. List the IDs with the installed CLI:

   ```sh
   OPENBOT_AUTOMATION_DIR="$HOME/.config/OpenBot Personal/automation" \
     node "$HOME/.local/opt/openbot-personal/current/resources/cli/openbot-cli.mjs" list
   ```

4. Create a private environment file outside Git. Use `umask 077` when creating it. Put the tokens in that file using your editor. Set the paths and IDs for this host:

   ```dotenv
   SLACK_APP_TOKEN=xapp-...
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_CHANNEL_ID=C...
   SLACK_USER_ID=U...
   OPENBOT_AGENT_ID=...
   OPENBOT_CLI="/home/rishi/.local/opt/openbot-personal/current/resources/cli/openbot-cli.mjs"
   OPENBOT_AUTOMATION_DIR="/home/rishi/.config/OpenBot Personal/automation"
   ```

5. From this folder, start the bridge. Add `--check` after `bridge.mjs` to check only the local OpenBot connection without contacting Slack.

   ```sh
   node --env-file="$HOME/.local/state/openbot-slack-bridge.env" bridge.mjs
   ```

6. Wait for `Slack Socket Mode connected.` Mention the bot in the test channel from the allowed account and check for a thread reply. The bridge replies only when the OpenBot turn completes with text. If the agent needs approval, answer in OpenBot. If a turn times out or the bridge exits mid-turn, send a new mention only after checking the original delivery.

## Move it to another host

Stop the PC bridge before starting the VPS bridge with the same Slack app. Move OpenBot using its data migration process and verify the agent ID and **Local scripts** access on the VPS. Copy these bridge files and transfer the tokens securely, then update the paths for the VPS user. Keep both processes running there, for example with services that start after boot. Slack uses an outbound WebSocket connection, so the bridge needs no public inbound port. The bridge keeps its pending messages and recent Slack event IDs only in memory. Complete pending turns before moving it.
