const axios = require("axios");
const { detectIntent, answerQuestion } = require("../engines/aiEngine");

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
                return handleCreateTask(result.entities);
            case "ask_questions":
                return await handleAskQuestion(result.entities);
            case "create_workflow":
                return handleCreateWorkflow(result.entities);
            case "store_memory":
                return handleStoreMemory(result.entities);
            default:
                return "I understood your message but I don't know how to handle that yet.";     
        }
    }
    return "I don't know how to handle that yet.";
}

//stub handlers ------ for AI intents
function handleCreateTask(entities) {
    const { assignee, task, deaddline } = entities;
    return `Got it. task Created: \n*Task:* ${task || "Unnamed"}\n*Assignee:* ${assignee || "Unassigned"}\n*Deadline:* ${deadline || "No deadline set"}`;
}

async function handleAskQuestion(entities) {
    const answer = await answerQuestion(entities.question);
    return answer;
}

function handleCreateWorkflow(entities) {
    return `Workflow noted:\nWhen *${entities.trigger}* in #{entities.channel}, I'll ${entities.action}.`;
}
function handleStoreMemmory(entities) {
    return `Memory stored about: ${entities.topic || "that topic"}.`;
}



module.exports = { route };