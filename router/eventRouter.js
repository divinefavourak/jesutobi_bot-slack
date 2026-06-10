const axios = require("axios");
const { detectIntent, answerQuestion } = require("../engines/aiEngine");
const { createTask, getTasks } = require("../engines/taskEngine");
const { storeMemory, searchMemory } = require("../engines/memoryEngine");

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
        return "Available commands:\n/dsb-ping\n/joke\n/catfact\n/help\n/ask [your question]";
    }
    if (event.type === "excuse") {
        const res = await axios.get("https://naas.isalman.dev/no");
        return `Here's a silly excuse for you: ${res.data}`;
    }

    //ai setup
    if (event.type === "ai_message") {
        const result = await detectIntent(event.message);

        console.log("AI Engine result:", JSON.stringify(result, null, 2));

        if (result.confidence < 0.5) {
            return "I'm not sure what you mean. Can you rephrase that?";
            
        }

        switch (result.intent) {
            case "create_task":
                return await handleCreateTask(result.entities, event.workspaceId);
            case "ask_question":
                return await handleAskQuestion(result.entities, event.workspaceId);
            case "create_workflow":
                return handleCreateWorkflow(result.entities);
            case "store_memory":
                return handleStoreMemory(result.entities, event.workspaceId);
            default:
                return "I understood your message but I don't know how to handle that yet.";     
        }
    }
    //list availabele tasks 
    if (event.type === "list_tasks") {
        const tasks = await getTasks(event.workspaceId);

        if  (tasks.length === 0) {
            return "No tasks yet. Try `/ask remind someone to do something`";
        }

         const formatted = tasks.map((t, i) =>
        `${i + 1}. *${t.title}* — ${t.assignee || "Unassigned"} — ${t.due_date || "No deadline"} — _${t.status}_`
    ).join("\n");

        return `Here are your tasks:\n${formatted}`;
    }
    return "I don't know how to handle that yet.";
}

//stub handlers --- for AI intents
async function handleCreateTask(entities, workspaceId) {
    const assignee = entities.assignee || null;

    // handle both single task and multiple tasks
    const taskList = entities.tasks
        ? entities.tasks
        : entities.task
        ? [{ task: entities.task, deadline: entities.deadline }]
        : [];

    if (taskList.length === 0) {
        return "I detected a task but couldn't extract the details. Try being more specific.";
    }

    const saved = [];
    for (const item of taskList) {
        const task = await createTask(
            { task: item.task, assignee, deadline: item.deadline },
            workspaceId
        );
        saved.push(task);
    }

    const formatted = saved.map((t, i) =>
        `${i + 1}. *${t.title}* — ${t.assignee || "Unassigned"} — ${t.due_date || "No deadline"}`
    ).join("\n");

    return `Got it. ${saved.length} task${saved.length > 1 ? "s" : ""} saved:\n${formatted}`;
}

async function handleAskQuestion(entities, workspaceId) {
    //first check memory for relevant context
    const answer = await answerQuestion(entities.question, workspaceId);
    if (memory){
        //found a relevant memory -- use it as context
        const answer = await answerQuestion(
            `Context from our team's memory: "${memory.content}"\n\nQuestion: ${entities.question}\n\nAnswer using the context if relevant.`
        );
        return `${answer}\n\n_Based on saved memory_`;
    }

    return answer;
}

function handleCreateWorkflow(entities) {
    return `Workflow noted:\nWhen *${entities.trigger}* in #${entities.channel}, I'll ${entities.action}.`;
}
async function handleStoreMemory(entities, workspaceId) {
    const content = entities.content || entities.topic; 
    if (!content) {
        return "What should I remember? Try `/ask remember we decided to use blue for the logo`"
    }
    const memory = await storeMemory(content, "general", workspaceId);
    return `Got it. I'll remember that:\n_"${memory.content}"_`;
}



module.exports = { route };