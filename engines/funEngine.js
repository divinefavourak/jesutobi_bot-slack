const axios = require("axios");
const { answerQuestion } = require("./aiEngine");

// ============================================================
// MEMES
// Never hit /gimme with no subreddit: that pulls from dankmemes
// and friends, which is unfiltered Reddit going straight into a
// workspace full of teenagers. Pin it to a whitelist AND check
// the nsfw/spoiler flags, because the whitelist alone is trust.
// ============================================================
const SAFE_SUBS = ["ProgrammerHumor", "wholesomememes", "softwaregore"];

// r/ProgrammerHumor has a house style of camelCase titles with no spaces, so
// posts arrive as "soDoYouSayGistAsInGif". Split them back into words or the
// bot posts something nobody can read.
function humanizeTitle(title) {
    if (!title) return "Meme";

    let t = String(title);
    if (!/\s/.test(t) && /[a-z][A-Z]/.test(t)) {
        t = t
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")      // justLet -> just Let
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");  // AIDo    -> AI Do
    }
    return t.charAt(0).toUpperCase() + t.slice(1);
}

async function getMeme() {
    for (let attempt = 0; attempt < 3; attempt++) {
        const sub = SAFE_SUBS[Math.floor(Math.random() * SAFE_SUBS.length)];
        try {
            const res = await axios.get(`https://meme-api.com/gimme/${sub}`, { timeout: 8000 });
            const m = res.data;

            if (!m || m.nsfw || m.spoiler || !m.url) continue;
            if (!/\.(jpg|jpeg|png|gif)$/i.test(m.url)) continue;   // skip video/gallery posts

            return {
                title: humanizeTitle(m.title),
                url: m.url,
                subreddit: m.subreddit,
                postLink: m.postLink
            };
        } catch (err) {
            console.error("Meme fetch failed:", err.message);
        }
    }
    return null;
}

// ============================================================
// MAGIC 8-BALL
// ============================================================
const EIGHT_BALL = [
    "It is certain.", "Without a doubt.", "Yes, obviously.", "Signs point to yes.",
    "Ask again after you've pushed to main.", "Reply hazy, try turning it off and on again.",
    "My sources say no.", "Absolutely not.", "Don't count on it.",
    "The compiler says no, and so do I.", "Yes, but you'll regret it.",
    "Only if you write tests first.", "That's a Friday deploy question. So no."
];

function eightBall(question) {
    const answer = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
    return question
        ? `🎱 *${question}*\n${answer}`
        : `🎱 ${answer}`;
}

// ============================================================
// TRIVIA
// Open Trivia DB returns HTML entities ("What&#039;s"), so decode
// before showing. Pending questions live in memory keyed by
// channel: losing them on restart just means asking a new one.
// ============================================================
const pending = new Map();
const TRIVIA_TTL_MS = 10 * 60 * 1000;
const LETTERS = ["a", "b", "c", "d"];

function decodeEntities(s) {
    return String(s)
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&eacute;/g, "é")
        .replace(/&rsquo;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
        .replace(/&hellip;/g, "...").replace(/&ntilde;/g, "ñ");
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function triviaKey(workspaceId, channelId) {
    return `${workspaceId}:${channelId}`;
}

// Open Trivia DB allows roughly one request per 5 seconds per IP and answers
// 429 past that. A channel of teenagers spamming /sos-trivia hits it instantly,
// so keep a local bank: the game never depends on someone else's rate limit.
const LOCAL_QUESTIONS = [
    ["What does 'HTTP' stand for?", "HyperText Transfer Protocol", ["HyperText Transmission Process", "High Transfer Text Protocol", "Hyperlink Text Transfer Path"], "easy"],
    ["Which company created JavaScript?", "Netscape", ["Microsoft", "Sun Microsystems", "Google"], "medium"],
    ["What does 'git commit' actually do?", "Saves a snapshot to your local repository", ["Uploads your code to GitHub", "Creates a new branch", "Merges two branches"], "easy"],
    ["In binary, what is 1010?", "10", ["8", "12", "20"], "easy"],
    ["What does 'CSS' stand for?", "Cascading Style Sheets", ["Computer Style Syntax", "Creative Styling System", "Cascading Syntax Sheets"], "easy"],
    ["Which of these is NOT a JavaScript data type?", "Float", ["Symbol", "BigInt", "Undefined"], "medium"],
    ["What port does HTTPS use by default?", "443", ["80", "8080", "22"], "medium"],
    ["What does 'API' stand for?", "Application Programming Interface", ["Applied Program Integration", "Automated Process Invocation", "Application Process Identifier"], "easy"],
    ["Who is credited with writing the first computer algorithm?", "Ada Lovelace", ["Alan Turing", "Grace Hopper", "Charles Babbage"], "medium"],
    ["What does SQL's 'JOIN' do?", "Combines rows from two or more tables", ["Merges two databases", "Appends one table to another", "Locks a table during writes"], "medium"],
    ["In Big-O notation, which is fastest for large inputs?", "O(log n)", ["O(n)", "O(n log n)", "O(n²)"], "medium"],
    ["What does 'DRY' stand for in programming?", "Don't Repeat Yourself", ["Do Rewrite Yearly", "Debug Rapidly Yourself", "Data Redundancy Yield"], "easy"],
    ["Which HTTP status code means 'Too Many Requests'?", "429", ["404", "500", "403"], "hard"],
    ["What is the default branch name Git uses today?", "main", ["master", "trunk", "default"], "easy"],
    ["What does 'RAM' stand for?", "Random Access Memory", ["Rapid Access Module", "Read Access Memory", "Runtime Allocated Memory"], "easy"]
];

function localRound() {
    const [question, correct, wrong, difficulty] =
        LOCAL_QUESTIONS[Math.floor(Math.random() * LOCAL_QUESTIONS.length)];
    const options = shuffle([correct, ...wrong]);
    return {
        question,
        options,
        correctIndex: options.indexOf(correct),
        difficulty,
        source: "local",
        askedAt: Date.now()
    };
}

async function startTrivia(workspaceId, channelId) {
    let round = null;

    try {
        // category 18 = Science: Computers
        const res = await axios.get(
            "https://opentdb.com/api.php?amount=1&category=18&type=multiple",
            { timeout: 8000 }
        );
        const q = res.data && res.data.results && res.data.results[0];

        if (q) {
            const correct = decodeEntities(q.correct_answer);
            const options = shuffle([correct, ...q.incorrect_answers.map(decodeEntities)]);
            round = {
                question: decodeEntities(q.question),
                options,
                correctIndex: options.indexOf(correct),
                difficulty: q.difficulty,
                source: "opentdb",
                askedAt: Date.now()
            };
        }
    } catch (err) {
        // 429 from the rate limit is the common case, not an outage.
        console.error("Trivia API unavailable, using local bank:", err.message);
    }

    if (!round) round = localRound();

    pending.set(triviaKey(workspaceId, channelId), round);
    return round;
}

function getPendingTrivia(workspaceId, channelId) {
    const key = triviaKey(workspaceId, channelId);
    const round = pending.get(key);
    if (!round) return null;
    if (Date.now() - round.askedAt > TRIVIA_TTL_MS) {
        pending.delete(key);
        return null;
    }
    return round;
}

// Accepts "a", "A", "a)" or the answer text itself.
function answerTrivia(workspaceId, channelId, guess) {
    const round = getPendingTrivia(workspaceId, channelId);
    if (!round) return { noRound: true };

    const cleaned = String(guess || "").trim().toLowerCase().replace(/[).:]$/, "");
    let index = LETTERS.indexOf(cleaned);

    if (index === -1) {
        index = round.options.findIndex(o => o.toLowerCase() === cleaned);
    }
    if (index === -1) return { badGuess: true, round };

    pending.delete(triviaKey(workspaceId, channelId));

    return {
        correct: index === round.correctIndex,
        chosen: round.options[index],
        answer: round.options[round.correctIndex],
        round
    };
}

function formatTrivia(round) {
    const lines = round.options.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n");
    return `🧠 *Trivia* _(${round.difficulty})_\n${round.question}\n\n${lines}\n\n_Answer with_ \`/sos-answer a\``;
}

// ============================================================
// ROAST / HYPE
// The roast is aimed at a workspace of teenagers, so the prompt
// is fenced hard: code and habits are fair game, people are not.
// ============================================================
async function roast(target) {
    const who = target || "this person";
    const prompt = `Write ONE short playful roast (max 25 words) about ${who}, a member of a
teen coding club, in the style of friendly banter between friends.

Rules you must follow:
- Tease only about coding habits: messy code, no tests, force-pushing, naming
  variables badly, deploying on Friday, 200-tab browsers, sleeping late.
- Never mention appearance, weight, race, gender, sexuality, religion,
  family, intelligence or anything about their real life.
- No profanity, no slurs, nothing that would upset someone reading it publicly.
- It should make them laugh, not feel bad. Affectionate, not cruel.

Reply with the roast only, no preamble, no quotes.`;

    const text = await answerQuestion(prompt);
    return `🔥 ${text.replace(/^["']|["']$/g, "")}`;
}

async function hype(target) {
    const who = target || "this person";
    const prompt = `Write ONE short, genuine hype message (max 25 words) for ${who}, a member of
a teen coding club who just shipped something. Warm and energetic, not corny
or corporate. No emoji. Reply with the message only, no quotes.`;

    const text = await answerQuestion(prompt);
    return `⚡ ${text.replace(/^["']|["']$/g, "")}`;
}

module.exports = {
    SAFE_SUBS, getMeme, humanizeTitle,
    eightBall, EIGHT_BALL,
    startTrivia, answerTrivia, getPendingTrivia, formatTrivia, decodeEntities, LETTERS,
    LOCAL_QUESTIONS, localRound,
    roast, hype
};
