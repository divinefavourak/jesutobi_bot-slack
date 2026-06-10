require("dotenv").config();
//const OpenAI = require("openai");
const Groq = require("groq-sdk");
const axios = require("axios");

// const apiKey = process.env.OPENROUTER_API_KEY;
const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
    throw new Error("GROQ api key is missing from your .env file");
}

// const client = new OpenAI({
//     baseURL: "https://openrouter.ai/api/v1",
//     apiKey: apiKey,
// });
const client = new Groq({ apiKey });

async function detectIntent(userMessage) {
    const prompt = `
    You are SlackOS, an intelligent Slack assistant.

Analyze the user's message and return ONLY a valid JSON object — no explanation, no extra text.

The JSON must have:
- "intent": one of [create_task, ask_question, store_memory, create_workflow, unknown]
- "entities": object with any relevant data you can extract (assignee, task, deadline, question, topic, trigger, action)
- "confidence": number between 0 and 1

Examples:
User: "remind Divine to finish the UI by Friday"
Response: {"intent":"create_task","entities":{"assignee":"Divine","task":"Finish the UI","deadline":"Friday"},"confidence":0.95}

User: "what did we decide about the logo?"
Response: {"intent":"ask_question","entities":{"question":"What did we decide about the logo?","topic":"logo"},"confidence":0.91}

User: "when someone joins #design send them the onboarding doc"
Response: {"intent":"create_workflow","entities":{"trigger":"channel_member_join","channel":"design","action":"send_message","payload":"onboarding doc"},"confidence":0.88}

Now analyze this message:
User: "${userMessage}"
Response:`;

    try {
        const response = await client.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.1,
        });
        const raw = response.choices[0].message.content.trim();
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (err) {
        console.error("AI Engine error:", err.message);
        return {
            intent: "unknown",
            entities: {},
            confidence: 0
        };
    }
}

async function answerQuestion(question) {
    try {
        const response = await client.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: question }],
            max_tokens: 300,
            temperature: 0.7,
        });
        return response.choices[0]. message.content.trim();
    } catch (err) {
        console.error("AI Engine error;", err.message);
        return "I couldn't fetch an answer right now, try again."
    }
}

async function  generateEmbeddings(text) {
    try{
        const response = await axios.post(
            "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
            { inputs: text },
            {
                headers: {
                    Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );
        return response.data[0]; //array of 384 numbers
    } catch(err){
        console.error("Embedding error:", err.message)
        return null;
    }
    
}

module.exports = { detectIntent, answerQuestion, generateEmbeddings };