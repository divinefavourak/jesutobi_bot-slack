const axios = require("axios");
const { route } = require("../router/eventRouter");

module.exports = function registerCommands(app) {

    app.command("/dsb-ping", async ({ command, ack, respond }) => {
        console.log("Received /dsb-ping command:", command);
        const start = Date.now();
        await ack();
        const latency = Date.now() - start;
        await respond({ text: `Pong! Latency: ${latency}ms` });
    });

    app.command("/dsb-catfact", async ({ command, ack, respond }) => {
        console.log("Received /dsb-catfact command:", command);
        await ack();
        const result = await route({ type: "catfact" });
        await respond({ text: result });
    });

    app.command("/joke", async ({ ack, respond }) => {
        console.log("Received /joke command");
        await ack();
        const result = await route({ type: "joke" });
        await respond({ text: result });
    });

    app.command("/help", async ({ ack, respond }) => {
        await ack();
        const result = await route({ type: "help" });
        await respond({ text: result });
    });
    app.command("/no", async ({ ack, respond}) => {
        console.log("Triggered silly excuse");
        await ack();
        const result = await route({ type: "excuse" });
        await respond({ text: result});
    });
 app.command("/ask", async ({ command, ack, respond }) => {
    await ack();
    const userMessage = command.text;
    console.log("Asked ai question", userMessage);

    if (!userMessage) {
        await respond({
            text: "Type something after /ask. Example: `/ask remind Divine to finish the UI by Friday`"
        });
        return;
    }

    const result = await route({
        type: "ai_message",
        message: userMessage
    });
    await respond({ text: result });
});
};