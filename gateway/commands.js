const axios = require("axios");
const { route } = require("../router/eventRouter");

module.exports = function registerCommands(app) {

    app.command("/dsb-ping", async ({ ack, respond }) => {
        console.log("Received command: /dsb-ping");
        const start = Date.now();
        await ack();
        const latency = Date.now() - start;
        await respond({ text: `Pong! Latency: ${latency}ms` });
    });

    app.command("/dsb-catfact", async ({ ack, respond }) => {
        await ack();
        const result = await route({ type: "catfact" });
        await respond({ text: result });
    });

    app.command("/joke", async ({ ack, respond }) => {
        await ack();
        const result = await route({ type: "joke" });
        await respond({ text: result });
    });

    app.command("/help", async ({ ack, respond }) => {
        await ack();
        const result = await route({ type: "help" });
        await respond({ text: result });
    });
};