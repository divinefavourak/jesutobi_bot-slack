require("dotenv").config();
const axios = require ("axios");

const { App } = require("@slack/bolt");

const bot_log = console.log.bind(console, "Bot Log:");
bot_log("Initializing your bot...");

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true
});

app.command("/bomb", async ({ command, ack, respond }) => {
    await ack();
    bot_log(`Received /bomb command from user ${command.user_id}`);
    await respond({
        text: "Here are your bombing tasks: \n 1. Task A \n 2. Task B \n 3. Task C \n \n Oje bomb"
    });
});

app.command("/dsb-catfact", async({ ack, respond }) => {
    bot_log("Received /dsb-catfact command");
    await ack();
    try {
        const response = await axios.get("https://catfact.ninja/fact");
        await respond({ text: `Cat Fact: \n${response.data.fact}` });
    } catch(err){
        await respond({ text: "Failed to fetch a cat fact." });
    }
    });
app.command("/dsb-ping", async ({ command, ack, respond}) => {
    const start = Date.now();
    await ack();
    const latency = Date.now() - start;
    await respond({ text: `Pong! Latency: ${latency} ms` });
});

app.command("/help", async ({ command, ack, respond }) => {
    await ack();
    await respond({
        text: " Here are the available commands. \n /bomb - Get bombing tasks. \n /dsb-ping - Check bot latency. \n /help - Show this list of commands."
    });
});
app.command("/joke", async ({ ack, respond }) =>{
    await ack();
    try { 
        const response = await axios.get("https://official-joke-api.appspot.com/random_joke");
        await respond({ text: `${response.data.setup}
            ${response.data.punchline}` });
    } catch (err) {
        await respond({ text: "Failed to fetch a joke." });
    }
});

app.command("/no", async ({ ack, respond}) => {
       bot_log("User ${command.user.id} is asking for an excuse..");
        await ack();
    try{
        const response = await axios.get("https://naas.isalman.dev/no");
        await respond({text: `${response.data.reason}`}
        );  } catch (err){
            await respond({ text: "You just have to go with it man, I gat no excuses for this one." });
        }
});
(async () => {
    await app.start();
    console.log("Your bot is live");
})();