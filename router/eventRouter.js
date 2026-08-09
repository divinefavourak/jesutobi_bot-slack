const axios = require("axios");
const { detectIntent, answerQuestion } = require("../engines/aiEngine");
const { createTask, getTasks, updateTaskStatus } = require("../engines/taskEngine");
const { storeMemory, searchMemory, getMemories, deleteMemory } = require("../engines/memoryEngine");
const {
    createWorkflow,
    getWorkflows,
    setWorkflowEnabled,
    deleteWorkflow,
    normalizeAction,
    ACTIONS
} = require("../engines/workflowEngine");

// The LLM is not consistent about entity key names or shapes between calls --
// the same sentence can come back as {task, deadline}, {title, due}, or
// {tasks: [...]}. These helpers let every handler accept any of them instead of
// silently reading `undefined`.

// Return the first key present on `obj` that has a usable value.
function pick(obj, ...keys) {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number") return String(value);
    }
    return null;
}

// Turn an action phrase into the message body it implies:
//   "send them the onboarding doc" -> "onboarding doc"
//   "send_message"                 -> null (a bare action token, not content)
//   "dm the user"                  -> null (no content, just a delivery method)
function payloadFromActionPhrase(phrase) {
    if (!phrase) return null;
    if (/^[a-z]+(_[a-z]+)*$/i.test(phrase)) return null;

    const stripped = String(phrase)
        .replace(/^(please\s+)?(send|post|share|give|dm|message)\s+/i, "")
        .replace(/^(them|they|him|her|the user)\s+/i, "")
        .replace(/^(the|a|an)\s+/i, "")
        .trim();

    return stripped || null;
}

// The AI sometimes returns a bare string where an object is expected
// (e.g. tasks: ["ship the UI"] instead of tasks: [{task: "ship the UI"}]).
function asObject(value, primaryKey) {
    if (typeof value === "string") return { [primaryKey]: value };
    if (value && typeof value === "object") return value;
    return {};
}

async function route(event) {
   //using if for the commands instead of switch for better readability and flexibility
   if (event.type === "joke") {
    const res = await axios.get("https://official-joke-api.appspot.com/random_joke");
    return `${res.data.setup}\n${res.data.punchline}`;
   }
   if (event.type === "catfact") {
    const res = await axios.get("https://catfact.ninja/fact");
    return `Cat fact: ${res.data.fact}`;
   }
    if (event.type === "help") {
        return [
            "Every command starts with `/sos-` so it can't clash with another app.",
            "",
            "*Natural language*",
            "`/sos-ask [message]` — create tasks, ask questions, save memories, build automations",
            "",
            "*Tasks*",
            "`/sos-tasks` — list saved tasks",
            "`/sos-done [id]` — mark a task done",
            "`/sos-reopen [id]` — move a task back to pending",
            "",
            "*Memory*",
            "`/sos-memories` — list everything I've remembered",
            "`/sos-forget [id]` — delete a memory",
            "",
            "*Automations*",
            "`/sos-workflows` — list your rules",
            "`/sos-workflows enable|disable|delete [id]` — manage a rule",
            "",
            "*For fun*",
            "`/sos-joke` · `/sos-meow-fact` · `/sos-no` · `/sos-ping`",
            "",
            "You can also just @mention me in a channel instead of using `/sos-ask`.",
            "`/sos-help` — this message"
        ].join("\n");
    }
    if (event.type === "excuse") {
        const res = await axios.get("https://naas.isalman.dev/no");
        return `Here's a silly excuse for you: ${res.data.reason}`;
    }
    if (event.type === "list_workflows") {
    const workflows = await getWorkflows(event.workspaceId);

    if (workflows.length === 0) {
        return "No workflows yet. Try `/sos-ask when someone joins #design, send onboarding docs`";
    }

    // Print the real primary key, not the array position -- these ids are what
    // /sos-workflows enable|disable|delete take as an argument.
    const formatted = workflows.map((w) =>
        `\`#${w.id}\` When *${w.trigger}* in #${w.channel || "any channel"}, ${w.action}` +
        `${w.payload ? ` ("${w.payload}")` : ""} — _${w.enabled ? "enabled" : "disabled"}_`
    ).join("\n");

    return `Here are your workflows:\n${formatted}\n\n_Use \`/sos-workflows disable <id>\` to pause one._`;
    }

    if (event.type === "workflow_admin") {
        return await handleWorkflowAdmin(event);
    }

    if (event.type === "list_memories") {
        const memories = await getMemories(event.workspaceId);

        if (memories.length === 0) {
            return "I haven't remembered anything yet. Try `/sos-ask remember that standup is at 9am`";
        }

        const formatted = memories.map((m) =>
            `\`#${m.id}\` ${m.content}`
        ).join("\n");

        return `Here's what I remember:\n${formatted}\n\n_Use \`/sos-forget <id>\` to remove one._`;
    }

    if (event.type === "forget_memory") {
        if (!event.memoryId) {
            return "Which memory? Use `/sos-forget <id>` — run `/sos-memories` to see the ids.";
        }

        const removed = await deleteMemory(event.memoryId, event.workspaceId);

        if (!removed) {
            return `I couldn't find memory \`#${event.memoryId}\`. Run \`/sos-memories\` to see the ids.`;
        }

        return `Forgotten:\n_"${removed.content}"_`;
    }

    if (event.type === "complete_task") {
        if (!event.taskId) {
            return "Which task? Use `/sos-done <id>` — run `/sos-tasks` to see the ids.";
        }

        const status = event.status || "done";
        const updated = await updateTaskStatus(event.taskId, status, event.workspaceId);

        if (!updated) {
            return `I couldn't find task \`#${event.taskId}\`. Run \`/sos-tasks\` to see the ids.`;
        }

        return status === "done"
            ? `Nice. *${updated.title}* is done.`
            : `*${updated.title}* is back to _${updated.status}_.`;
    }

    //ai setup
    if (event.type === "ai_message") {
        const result = await detectIntent(event.message);

        console.log("AI Engine result:", JSON.stringify(result, null, 2));

        if (result.confidence < 0.5) {
            return "I'm not sure what you mean. Can you rephrase that?";

        }

        // The model occasionally omits "entities" entirely; without this every
        // handler below would throw on property access.
        const entities = (result.entities && typeof result.entities === "object")
            ? result.entities
            : {};

        switch (result.intent) {
            case "create_task":
                return await handleCreateTask(entities, event.workspaceId);
            case "ask_question":
                return await handleAskQuestion(entities, event.workspaceId, event.message);
            case "create_workflow":
                return await handleCreateWorkflow(entities, event.workspaceId, event.message);
            case "store_memory":
                return await handleStoreMemory(entities, event.workspaceId, event.message);
            default:
                return "I understood your message but I don't know how to handle that yet.";
        }
    }
    //list availabele tasks
    if (event.type === "list_tasks") {
        const tasks = await getTasks(event.workspaceId);

        if  (tasks.length === 0) {
            return "No tasks yet. Try `/sos-ask remind someone to do something`";
        }

        // Real primary keys, not array positions -- /sos-done takes these ids, and
        // numbering by position would complete the wrong row.
        const formatted = tasks.map((t) =>
        `${t.status === "done" ? "✓" : "•"} \`#${t.id}\` *${t.title}* — ${t.assignee || "Unassigned"} — ${t.due_date || "No deadline"} — _${t.status}_`
    ).join("\n");

        return `Here are your tasks:\n${formatted}\n\n_Use \`/sos-done <id>\` when one is finished._`;
    }
    return "I don't know how to handle that yet.";
}

//stub handlers --- for AI intents
async function handleCreateTask(entities, workspaceId) {
    const defaultAssignee = pick(entities, "assignee", "person", "who", "owner");

    // build task list from whatever shape the AI returned
    let taskList = [];

    if (Array.isArray(entities.tasks)) {
        // shape 1: { tasks: [{ task, deadline }] } or { tasks: ["do the thing"] }
        taskList = entities.tasks.map((entry) => asObject(entry, "task"));
    } else if (entities.task1 || entities.task_1) {
        // shape 2: { task1, deadline1, task2, deadline2 }
        let i = 1;
        while (entities[`task${i}`] || entities[`task_${i}`]) {
            taskList.push({
                task: entities[`task${i}`] || entities[`task_${i}`],
                deadline: entities[`deadline${i}`] || entities[`deadline_${i}`] || null,
                assignee: entities[`assignee${i}`] || entities[`assignee_${i}`] || null
            });
            i++;
        }
    } else if (pick(entities, "task", "title", "description", "todo")) {
        // shape 3: single task { task, deadline }
        taskList = [entities];
    }

    // Normalize every entry to { task, deadline, assignee } and drop empties.
    taskList = taskList
        .map((entry) => ({
            task: pick(entry, "task", "title", "description", "todo", "name"),
            deadline: pick(entry, "deadline", "due", "due_date", "dueDate", "date", "when"),
            assignee: pick(entry, "assignee", "person", "who", "owner") || defaultAssignee
        }))
        .filter((entry) => entry.task);

    if (taskList.length === 0) {
        return "I detected a task but couldn't extract the details. Try being more specific.";
    }

    const saved = [];
    for (const item of taskList) {
        const task = await createTask(
            { task: item.task, assignee: item.assignee, deadline: item.deadline },
            workspaceId
        );
        saved.push(task);
    }

    const formatted = saved.map((t, i) =>
        `${i + 1}. *${t.title}* — ${t.assignee || "Unassigned"} — ${t.due_date || "No deadline"}`
    ).join("\n");

    return `Got it. ${saved.length} task${saved.length > 1 ? "s" : ""} saved:\n${formatted}`;
}

async function handleAskQuestion(entities, workspaceId, originalMessage) {
    // The model sometimes labels the question "query" or "text", and sometimes
    // drops it entirely -- fall back to what the user actually typed.
    const question =
        pick(entities, "question", "query", "text", "prompt", "topic") || originalMessage;

    if (!question) {
        return "What would you like to know?";
    }

    // first check memory for relevant context
    const memory = await searchMemory(question, workspaceId);

    if (memory) {
        // found a relevant memory -- use it as context
        const answer = await answerQuestion(
            `Context from our team's memory: "${memory.content}"\n\nQuestion: ${question}\n\nAnswer using the context if relevant.`
        );
        return `${answer}\n\n_📌 Based on saved memory_`;
    }

    // no relevant memory -- just answer directly
    const answer = await answerQuestion(question);
    return answer;
}

async function handleWorkflowAdmin(event) {
    const { op, workflowId, workspaceId } = event;

    if (!workflowId) {
        return `Which workflow? Use \`/sos-workflows ${op} <id>\` — run \`/sos-workflows\` to see the ids.`;
    }

    if (op === "delete") {
        const removed = await deleteWorkflow(workflowId, workspaceId);
        if (!removed) {
            return `I couldn't find workflow \`#${workflowId}\`. Run \`/sos-workflows\` to see the ids.`;
        }
        return `Deleted workflow \`#${removed.id}\` (was: *${removed.trigger}* in #${removed.channel}).`;
    }

    const enabled = op === "enable";
    const updated = await setWorkflowEnabled(workflowId, enabled, workspaceId);

    if (!updated) {
        return `I couldn't find workflow \`#${workflowId}\`. Run \`/sos-workflows\` to see the ids.`;
    }

    return enabled
        ? `Workflow \`#${updated.id}\` is active again — I'll watch #${updated.channel}.`
        : `Workflow \`#${updated.id}\` is paused. It won't fire until you re-enable it.`;
}

async function handleCreateWorkflow(entities, workspaceId, originalMessage) {
    // Accept the different key names the model uses for the same four fields.
    let rawAction = pick(entities, "action", "do", "then");

    // Safety net: if the user plainly asked for a DM but the model didn't say
    // so in `action`, believe the user. The failure direction matters here --
    // guessing "public" for something meant to be private leaks it to the
    // whole channel, so the user's own wording wins.
    const userAskedForDm = /\b(dm|dms|direct message|privately|private message)\b/i
        .test(String(originalMessage || "").replace(/[_\-]+/g, " "));

    if (userAskedForDm && normalizeAction(rawAction) === ACTIONS.SEND_MESSAGE) {
        rawAction = ACTIONS.DM_USER;
    }
    let payload = pick(entities, "payload", "message", "text", "content", "body");

    // The model often puts the whole instruction in `action` and leaves
    // `payload` empty ("action": "send onboarding docs"). normalizeAction would
    // collapse that to "send_message" and the wording would be lost, so recover
    // it as the payload before that happens.
    if (!payload) {
        payload = payloadFromActionPhrase(rawAction);
    }

    const normalized = {
        trigger: pick(entities, "trigger", "event", "on", "when"),
        channel: pick(entities, "channel", "channel_name", "channelName", "target_channel"),
        action: rawAction || ACTIONS.SEND_MESSAGE,
        payload
    };

    // Without a channel the rule can never match a real event, so say so now
    // instead of saving a rule that silently never fires.
    if (!normalized.channel) {
        return "Which channel should that apply to? Try: `/sos-ask when someone joins #design, send onboarding docs`";
    }

    const workflow = await createWorkflow(normalized, workspaceId);

    return [
        `Workflow saved as \`#${workflow.id}\`:`,
        `When *${workflow.trigger}* in #${workflow.channel || "any channel"}, I'll ${describeAction(workflow)}.`
    ].join("\n");
}

// Turn a stored row into something readable in Slack.
function describeAction(workflow) {
    const content = workflow.payload ? ` ("${workflow.payload}")` : "";

    switch (workflow.action) {
        case ACTIONS.DM_USER:
            return `DM them${content}`;
        case ACTIONS.SEND_EPHEMERAL:
            return `send them a private note in the channel${content}`;
        default:
            return `post a welcome in the channel${content}`;
    }
}

async function handleStoreMemory(entities, workspaceId, originalMessage) {
    // build full content from whatever entities the AI extracted
    const topic = pick(entities, "topic", "subject", "about");
    const decision = pick(entities, "decision", "choice", "outcome");
    const schedule = pick(entities, "schedule", "time", "when");
    const direct = pick(entities, "content", "memory", "fact", "note", "text", "detail");

    let content;

    if (decision && topic) {
        content = `Decision about ${topic}: ${decision}`;
    } else if (direct) {
        content = direct;
    } else if (schedule && topic) {
        content = `${topic}: ${schedule}`;
    } else if (decision) {
        content = decision;
    } else if (topic) {
        content = topic;
    } else {
        // Nothing structured came back -- store the raw sentence rather than
        // losing what the user asked us to remember.
        content = originalMessage;
    }

    if (!content) {
        return "What should I remember? Try: `/sos-ask remember that we decided to use blue for the logo`";
    }

    const memory = await storeMemory(content, "general", workspaceId);
    return `Got it. I'll remember that:\n_"${memory.content}"_`;
}



module.exports = { route };
