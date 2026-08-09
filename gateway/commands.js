const { route } = require("../router/eventRouter");
const { findMatchingWorkflows, ACTIONS } = require("../engines/workflowEngine");

// Slash commands that take a row id all share this: pull the first integer out
// of the command text so "/sos-done 3", "/sos-done #3" and "/sos-done task 3"
// all work.
function parseId(text) {
    const match = String(text || "").match(/\d+/);
    return match ? Number(match[0]) : null;
}

// Run whatever the workflow row says to do, instead of hardcoding a public
// welcome. `action` is already normalized to one of ACTIONS by workflowEngine.
async function executeWorkflowAction(client, workflow, event) {
    // A payload can be a one-liner ("the onboarding docs") or a whole handbook.
    // Short ones read fine inline; long or multi-line ones need their own block
    // so the greeting doesn't run straight into a wall of text.
    const body = workflow.payload || "Glad to have you here.";
    const text = (body.includes("\n") || body.length > 60)
        ? `Welcome <@${event.user}>!\n\n${body}`
        : `Welcome <@${event.user}>! ${body}`;

    if (workflow.action === ACTIONS.SEND_EPHEMERAL) {
        await client.chat.postEphemeral({ channel: event.channel, user: event.user, text });
        return;
    }

    if (workflow.action === ACTIONS.DM_USER) {
        try {
            // Posting to a user id opens the DM automatically, but that needs
            // the im:write scope -- which this app does not currently have.
            await client.chat.postMessage({ channel: event.user, text });
        } catch (err) {
            const reason = err.data?.error || err.message;
            console.error(
                `dm_user failed (${reason}). Add the "im:write" bot scope to enable DMs; ` +
                "falling back to a private in-channel note."
            );
            await client.chat.postEphemeral({ channel: event.channel, user: event.user, text });
        }
        return;
    }

    // ACTIONS.SEND_MESSAGE and anything unrecognised.
    await client.chat.postMessage({ channel: event.channel, text });
}

// Socket Mode redelivers an envelope if it isn't acked fast enough, which would
// post the same welcome twice. Remember the events we've already handled for a
// few minutes so a redelivery is a no-op.
const handledEvents = new Map();
const EVENT_TTL_MS = 5 * 60 * 1000;

function alreadyHandled(key) {
    const now = Date.now();
    for (const [k, seenAt] of handledEvents) {
        if (now - seenAt > EVENT_TTL_MS) handledEvents.delete(k);
    }
    if (handledEvents.has(key)) return true;
    handledEvents.set(key, now);
    return false;
}

module.exports = function registerCommands(app) {

    // Set DEBUG_SLACK_EVENTS=true in .env to log every payload Slack delivers.
    // This is the fastest way to tell "Slack never sent it" apart from
    // "Slack sent it and my handler is broken".
    if (process.env.DEBUG_SLACK_EVENTS === "true") {
        app.use(async ({ body, next }) => {
            const kind = body?.event?.type || body?.command || body?.type;
            console.log("[slack-debug] incoming:", kind);
            await next();
        });
    }

    // Every command carries the /sos- prefix so it can't clash with another app
    // installed in the same workspace. Slash command names are global to a
    // workspace, not scoped per app, so generic names like /help or /done are
    // first-come-first-served across every app a workspace has installed.
    app.command("/sos-ping", async ({ command, ack, respond }) => {
        console.log("Received /sos-ping command:", command);
        const start = Date.now();
        await ack();
        const latency = Date.now() - start;
        await respond({ text: `Pong! Latency: ${latency}ms` });
    });

    app.command("/sos-meow-fact", async ({ command, ack, respond }) => {
        console.log("Received /sos-meow-fact command:", command);
        await ack();
        const result = await route({ type: "catfact" });
        await respond({ text: result });
    });

    app.command("/sos-joke", async ({ ack, respond }) => {
        console.log("Received /sos-joke command");
        await ack();
        const result = await route({ type: "joke" });
        await respond({ text: result });
    });

    app.command("/sos-help", async ({ ack, respond }) => {
        await ack();
        const result = await route({ type: "help" });
        await respond({ text: result });
    });

    app.command("/sos-no", async ({ ack, respond }) => {
        console.log("Triggered silly excuse");
        await ack();
        const result = await route({ type: "excuse" });
        await respond({ text: result });
    });

    app.command("/sos-ask", async ({ command, ack, respond }) => {
        await ack();
        const userMessage = command.text;

        if (!userMessage) {
            await respond({
                text: "Type something after `/sos-ask`. Example: `/sos-ask remind Divine to finish the UI by Friday`"
            });
            return;
        }

        const result = await route({
            type: "ai_message",
            message: userMessage,
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    app.command("/sos-tasks", async ({ command, ack, respond }) => {
        await ack();
        const result = await route({
            type: "list_tasks",
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    app.command("/sos-done", async ({ command, ack, respond }) => {
        await ack();
        const result = await route({
            type: "complete_task",
            taskId: parseId(command.text),
            status: "done",
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    app.command("/sos-reopen", async ({ command, ack, respond }) => {
        await ack();
        const result = await route({
            type: "complete_task",
            taskId: parseId(command.text),
            status: "pending",
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    app.command("/sos-memories", async ({ command, ack, respond }) => {
        await ack();
        const result = await route({
            type: "list_memories",
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    app.command("/sos-forget", async ({ command, ack, respond }) => {
        await ack();
        const result = await route({
            type: "forget_memory",
            memoryId: parseId(command.text),
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    // Listing and managing live on one command. Keeping "/sos-workflow" and
    // "/sos-workflows" as separate commands meant a single missing "s" silently
    // ran the wrong one.
    //   /sos-workflows                -> list
    //   /sos-workflows disable 3      -> manage
    app.command("/sos-workflows", async ({ command, ack, respond }) => {
        await ack();

        const text = String(command.text || "").trim();

        if (!text) {
            const result = await route({
                type: "list_workflows",
                workspaceId: command.team_id
            });
            await respond({ text: result });
            return;
        }

        const op = (text.split(/\s+/)[0] || "").toLowerCase();

        if (!["enable", "disable", "delete"].includes(op)) {
            await respond({
                text: "Usage: `/sos-workflows` to list, or `/sos-workflows enable|disable|delete <id>` to manage one."
            });
            return;
        }

        const result = await route({
            type: "workflow_admin",
            op,
            workflowId: parseId(text),
            workspaceId: command.team_id
        });
        await respond({ text: result });
    });

    // Talk to the bot by @mentioning it, no slash command needed.
    // Requires the app_mentions:read scope (already granted) and "app_mention"
    // under Event Subscriptions -> Subscribe to bot events.
    app.event("app_mention", async ({ event, client, context }) => {
        // Socket Mode redelivery would otherwise cost a second Groq call and
        // post a duplicate reply.
        if (alreadyHandled(`mention:${event.channel}:${event.ts}`)) {
            console.log("Duplicate app_mention ignored:", event.ts);
            return;
        }

        // Never answer ourselves -- that is how mention loops start.
        if (event.bot_id || (context.botUserId && event.user === context.botUserId)) {
            return;
        }

        // Strip every <@U123> mention so the model sees plain english.
        const text = String(event.text || "").replace(/<@[A-Z0-9]+>/gi, "").trim();

        // Reply in-thread if the mention was in a thread, otherwise start one.
        const thread_ts = event.thread_ts || event.ts;

        if (!text) {
            await client.chat.postMessage({
                channel: event.channel,
                thread_ts,
                text: "Hey! Ask me something, e.g. `@SlackOS what did we decide about the logo?` — or run `/sos-help`."
            });
            return;
        }

        try {
            const result = await route({
                type: "ai_message",
                message: text,
                workspaceId: context.teamId || event.team
            });

            await client.chat.postMessage({ channel: event.channel, thread_ts, text: result });
        } catch (err) {
            console.error("app_mention error:", err.message);
            await client.chat.postMessage({
                channel: event.channel,
                thread_ts,
                text: "Something went wrong handling that. Try `/sos-help`."
            });
        }
    });

    // Listens for someone joining a channel -- a real Slack event, no command needed.
    //
    // Slack will only deliver this if ALL of the following are true:
    //   1. "member_joined_channel" is listed under Event Subscriptions ->
    //      "Subscribe to bot events" (required even in Socket Mode).
    //   2. The bot has channels:read (public channels) / groups:read (private).
    //   3. THE BOT IS A MEMBER OF THE CHANNEL. This is the one that bites:
    //      chat:write.public lets the bot POST to a channel it never joined,
    //      but events are only delivered for channels it actually belongs to.
    app.event("member_joined_channel", async ({ event, client, context }) => {
        console.log("member_joined_channel event received:", event);

        // Socket Mode can redeliver; only act on each join once.
        const eventKey = `${event.channel}:${event.user}:${event.event_ts || event.ts || ""}`;
        if (alreadyHandled(eventKey)) {
            console.log("Duplicate delivery ignored for", eventKey);
            return;
        }

        // When the bot itself is added to a channel Slack fires this same event.
        // Without this guard the bot welcomes itself on every install.
        if (context.botUserId && event.user === context.botUserId) {
            console.log("Ignoring the bot's own join event.");
            return;
        }

        try {
            // Resolve the channel ID to a name (no leading "#", already lowercase).
            let channelName;
            try {
                const channelInfo = await client.conversations.info({ channel: event.channel });
                channelName = channelInfo.channel.name;
            } catch (infoErr) {
                console.error(
                    `Could not read channel ${event.channel} (${infoErr.data?.error || infoErr.message}). ` +
                    "Check that the bot is in the channel and has channels:read / groups:read."
                );
                return;
            }

            // context.teamId is the reliable workspace id under Bolt; fall back to
            // event.team only if context is somehow unavailable.
            const workspaceId = context.teamId || event.team || null;

            if (!workspaceId) {
                console.error("No workspace id on this event; cannot match workflows.");
                return;
            }

            const matches = await findMatchingWorkflows(
                "channel_member_join",
                channelName,
                workspaceId
            );

            console.log(`Matched ${matches.length} workflow(s) for #${channelName} in ${workspaceId}`);

            // Duplicate rules (same action + payload) would post the same welcome
            // twice, so collapse them before sending.
            const seen = new Set();
            for (const workflow of matches) {
                const fingerprint = `${workflow.action || ""}|${workflow.payload || ""}`;
                if (seen.has(fingerprint)) continue;
                seen.add(fingerprint);

                await executeWorkflowAction(client, workflow, event);
            }
        } catch (err) {
            console.error("Workflow trigger error:", err.message);
        }
    });
};
