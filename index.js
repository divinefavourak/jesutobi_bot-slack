require("dotenv").config();

const { App } = require("@slack/bolt");

const app = new App({
    token: process.env.SLACK_BOLT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true
});

//register commands
registerCommands(app);

(async () => {
    await app.start();
    console.log("SlackOS is live");
})();