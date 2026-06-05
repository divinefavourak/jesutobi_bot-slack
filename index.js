require("dotenv").config();

const { App } = require("@slack/bolt");
//sanity check
console.log("BOT TOKEN loaded:", !!process.env.SLACK_BOT_TOKEN);
console.log("APP TOKEN loaded:", !!process.env.SLACK_APP_TOKEN);
const registerCommands = require("./gateway/commands");

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true
});

//register commands
registerCommands(app);

(async () => {
    await app.start();
    console.log("SlackOS is live");
})();