# SlackOS

An AI teammate for Slack that turns plain sentences into real actions — tasks,
team memory, and automations that fire on live Slack events.

No forms, no menus. You type what you mean.

```
/ask remind Divine to finish the UI by Friday
→ Got it. 1 task saved:
  1. Finish the UI — Divine — Friday

/ask when someone joins #design, DM them the handbook
→ Workflow saved as #4:
  When channel_member_join in #design, I'll DM them ("handbook").
```

---

## What it does

**Tasks** — Describe work in plain English and SlackOS pulls out the assignee,
the deadline and the task itself. It handles several tasks in one sentence.
List them with `/tasks`, close them with `/done <id>`, reopen with `/reopen <id>`.

**Memory** — Tell it what the team decided and it remembers. Ask later in normal
language and it finds the relevant note and answers using that context.
`/memories` shows everything stored, `/forget <id>` removes one.

**Automations** — Describe a rule once and it runs itself. When someone joins a
channel, SlackOS can post a public welcome, send a note only that person sees,
or DM them the onboarding docs. Rules are matched against real Slack events in
real time. Pause or remove them with `/workflow enable|disable|delete <id>`.

**Mentions** — `@SlackOS what's our standup time?` works in any channel it's in,
and it replies in a thread so channels stay readable.

---

## Commands

| Command | What it does |
|---|---|
| `/ask <message>` | Natural language — creates tasks, answers questions, saves memories, builds workflows |
| `/tasks` | List saved tasks with their ids |
| `/done <id>` | Mark a task done |
| `/reopen <id>` | Move a task back to pending |
| `/memories` | List everything SlackOS remembers |
| `/forget <id>` | Delete a memory |
| `/workflows` | List saved automation rules |
| `/workflow enable\|disable\|delete <id>` | Manage a rule |
| `/help` | Show all commands |
| `/joke`, `/meow-fact`, `/no`, `/dping` | Morale and latency |

---

## Architecture

Events come in through one gateway, get routed once, and are handled by a
single engine per concern. Nothing talks to Slack except the gateway.

```
Slack (Socket Mode)
      │
      ▼
gateway/commands.js      slash commands + live event listeners
      │
      ▼
router/eventRouter.js    one router, decides which engine handles what
      │
      ├──► engines/aiEngine.js        Groq (llama-3.3-70b) intent detection
      ├──► engines/taskEngine.js      task CRUD
      ├──► engines/memoryEngine.js    memory storage + semantic search
      └──► engines/workflowEngine.js  automation rules
                    │
                    ▼
            db/index.js  →  PostgreSQL
```

### Two design notes

**Semantic search without embeddings.** Memory search normally needs a vector
database. The Hugging Face inference API is unreachable from the network this
was built on, so instead the LLM itself is handed the stored memories and asked
which one is relevant. This works well below roughly 100 memories and needs no
extra infrastructure. The vector-search implementation is kept, commented, in
`engines/memoryEngine.js` for when it's worth switching.

**The LLM is treated as an unreliable narrator.** It returns the same meaning in
different shapes between calls — `{task, deadline}` one time, `{tasks: [...]}`
or `task1/deadline1` the next, and `send_direct_message` where you expected
`dm_user`. Every handler normalizes aggressively before use: key aliases,
separator flattening, and channel names stripped of `#` regardless of how
they arrive. Assuming one surface form is the single largest source of bugs
in this codebase's history.

---

## Running it locally

**You need:** Node 18+, Docker, a [Groq API key](https://console.groq.com), and
a Slack app.

```bash
git clone https://github.com/divinefavourak/jesutobi_bot-slack.git
cd jesutobi_bot-slack
npm install
docker compose up -d      # starts PostgreSQL on :5432
npm run migrate           # creates the tables
npm start
```

Create a `.env` in the project root:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
GROQ_API_KEY=gsk_...
DATABASE_URL=postgresql://slackos:slackos123@localhost:5432/slackos
```

Set `DEBUG_SLACK_EVENTS=true` to log every payload Slack delivers — useful for
telling "Slack never sent it" apart from "my handler is broken".

### Slack app setup

Socket Mode means there is no public URL and no Request URL to configure.

1. **Socket Mode** → enable it. Generate an app-level token with
   `connections:write` — that's your `SLACK_APP_TOKEN`.
2. **OAuth & Permissions** → add these bot scopes:
   `chat:write`, `chat:write.public`, `commands`, `channels:read`,
   `channels:history`, `groups:read`, `app_mentions:read`, `im:write`
3. **Event Subscriptions** → enable, then subscribe to bot events:
   `member_joined_channel` and `app_mention`
4. **Slash Commands** → create each command from the table above.
5. **Install to Workspace**, then copy the Bot User OAuth Token into
   `SLACK_BOT_TOKEN`.

> **Invite the bot to every channel you want automations in** — `/invite @SlackOS`.
> Slack only delivers `member_joined_channel` for channels the bot is a member
> of. `chat:write.public` lets it *post* to channels it hasn't joined, which
> makes it look present when it isn't — this is the most common reason a
> workflow silently never fires.

---

## License

ISC
