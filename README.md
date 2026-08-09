# SlackOS

An AI teammate for Slack that turns plain sentences into real actions — tasks,
team memory, and automations that fire on live Slack events.

No forms, no menus. You type what you mean.

```
/sos-ask remind Divine to finish the UI by Friday
→ Got it. 1 task saved:
  1. Finish the UI — Divine — Friday

/sos-ask when someone joins #design, DM them the handbook
→ Workflow saved as #4:
  When channel_member_join in #design, I'll DM them ("handbook").
```

Every command is prefixed `/sos-`. Slash command names belong to the whole
workspace rather than to one app, so `/help` or `/done` would collide with
whatever else is already installed.

---

## What it does

**Tasks** — Describe work in plain English and SlackOS pulls out the assignee,
the deadline and the task itself. It handles several tasks in one sentence.
List them with `/sos-tasks`, close them with `/sos-done <id>`, reopen with
`/sos-reopen <id>`.

**Memory** — Tell it what the team decided and it remembers. Ask later in normal
language and it finds the relevant note and answers using that context.
`/sos-memories` shows everything stored, `/sos-forget <id>` removes one.

**Automations** — Describe a rule once and it runs itself. When someone joins a
channel, SlackOS can post a public welcome, send a note only that person sees,
or DM them the onboarding docs. Rules are matched against real Slack events in
real time. Pause or remove them with `/sos-workflows enable|disable|delete <id>`.

**Mentions** — `@SlackOS what's our standup time?` works in any channel it's in,
and it replies in a thread so channels stay readable.

**XP and levels** — Real work earns points. Finishing a task is 10 XP, saving a
memory 5, building an automation 15, winning trivia 20, and getting a shoutout
25. Every 100 XP is a level, and every level has a title worth chasing (you
start as a Lurker and end up a Certified Menace). Daily streaks count too.
`/sos-rank` shows yours, `/sos-leaderboard` shows everyone's.

Completing an already-completed task pays nothing — otherwise the first thing
anyone does is spam `/sos-done` on the same row.

---

## Commands

All twenty commands, with the description and usage hint to register for each
one in the Slack dashboard.

**Work**

| # | Command | Description | Usage hint |
|---|---|---|---|
| 1 | `/sos-ask` | Talk to SlackOS in plain English | `[message]` |
| 2 | `/sos-tasks` | List saved tasks with their ids | |
| 3 | `/sos-done` | Mark a task done | `[task id]` |
| 4 | `/sos-reopen` | Move a task back to pending | `[task id]` |
| 5 | `/sos-memories` | List everything SlackOS remembers | |
| 6 | `/sos-forget` | Delete a memory | `[memory id]` |
| 7 | `/sos-workflows` | List automation rules, or manage one | `[enable\|disable\|delete] [id]` |
| 8 | `/sos-help` | Show every command | |

**Games**

| # | Command | Description | Usage hint |
|---|---|---|---|
| 9 | `/sos-trivia` | Start a computing trivia question | |
| 10 | `/sos-answer` | Answer the open trivia question | `[a, b, c or d]` |
| 11 | `/sos-rank` | Your XP, level, streak and standing | |
| 12 | `/sos-leaderboard` | Who's winning | |
| 13 | `/sos-shoutout` | Give someone props and XP | `[@someone] for [reason]` |

**Fun**

| # | Command | Description | Usage hint |
|---|---|---|---|
| 14 | `/sos-meme` | A programming meme | |
| 15 | `/sos-roast` | A playful roast | `[@someone]` |
| 16 | `/sos-hype` | Hype someone up | `[@someone]` |
| 17 | `/sos-8ball` | Ask the magic 8-ball | `[question]` |
| 18 | `/sos-joke` | A random joke | |
| 19 | `/sos-meow-fact` | A random cat fact | |
| 20 | `/sos-no` | A silly excuse | |

`/sos-ping` is registered too if you want a latency check — it's the one command
that exists purely for debugging.

`/sos-workflows` does double duty: bare it lists your rules, and with a verb it
manages one (`/sos-workflows disable 3`). Keeping it as a single command avoids
a near-identical `/sos-workflow` sitting next to `/sos-workflows`, where one
missing letter silently runs the wrong thing.

You can also skip commands and `@SlackOS` the bot in any channel it belongs to.

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
