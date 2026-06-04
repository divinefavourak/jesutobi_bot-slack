const axios = require("axios");

async function route(event) {
    switch (event.type) {
        case "catfact": {
            const res = await axios.get("https://catfact.ninja/fact");
            return `Cat Fact: \n${res.data.fact}`;
        }
        case "joke": {
            const res = await axios.get("https://official-joke-api.appspot.com/jokes/random");
            return `${res.data.setup}\n${res.data.punchline}`;
        }
        case "help": {
            return "Available commands: \n /dsb-ping\n/joke\n/catfact\n/help";
        }
        default: 
            return "I don't know how to handle that yet"
    }
}

module.exports = { route };