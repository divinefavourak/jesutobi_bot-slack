const pool = require("../db/index");

// XP is awarded for doing real work in the bot, not just for playing with it.
// Finishing a task is worth more than answering trivia so the leaderboard
// rewards the people actually shipping.
const XP = {
    TASK_DONE: 10,
    MEMORY_SAVED: 5,
    WORKFLOW_BUILT: 15,
    TRIVIA_CORRECT: 20,
    SHOUTOUT_RECEIVED: 25,
    SHOUTOUT_GIVEN: 5
};

const XP_PER_LEVEL = 100;

// Titles are the reward you actually see. Levels beyond the list keep the last.
const TITLES = [
    "Lurker",          // 1
    "Button Masher",   // 2
    "Script Kiddie",   // 3
    "Bug Whisperer",   // 4
    "Merge Goblin",    // 5
    "Deploy Gremlin",  // 6
    "Rubber Ducker",   // 7
    "Stack Overlord",  // 8
    "Ship Captain",    // 9
    "Certified Menace" // 10+
];

function levelFor(xp) {
    return Math.floor((xp || 0) / XP_PER_LEVEL) + 1;
}

function titleFor(level) {
    return TITLES[Math.min(level, TITLES.length) - 1];
}

// XP still needed before the next level-up.
function xpToNext(xp) {
    return XP_PER_LEVEL - ((xp || 0) % XP_PER_LEVEL);
}

// A simple 10-cell bar. Slack renders these fine in a code span.
function progressBar(xp) {
    const filled = Math.floor(((xp || 0) % XP_PER_LEVEL) / (XP_PER_LEVEL / 10));
    return "█".repeat(filled) + "░".repeat(10 - filled);
}

// Compare calendar days, not timestamps: playing at 23:58 and again at 00:02
// is a two-day streak, and two plays in one afternoon is still one day.
function streakFrom(lastActive, current) {
    if (!lastActive) return 1;

    const last = new Date(lastActive);
    const today = new Date();
    const days = Math.round(
        (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
         Date.UTC(last.getFullYear(), last.getMonth(), last.getDate())) / 86400000
    );

    if (days === 0) return current || 1;  // already played today
    if (days === 1) return (current || 0) + 1;
    return 1;                              // missed a day, start over
}

async function getPlayer(slackId, workspaceId) {
    const result = await pool.query(
        `SELECT * FROM players WHERE slack_id = $1 AND workspace_id = $2`,
        [slackId, workspaceId]
    );
    return result.rows[0] || null;
}

// Award XP and roll the streak. Returns enough for the caller to celebrate a
// level-up without querying again.
async function awardXp(slackId, displayName, amount, workspaceId, extra = {}) {
    if (!slackId || !workspaceId) return null;

    const existing = await getPlayer(slackId, workspaceId);
    const oldXp = existing ? existing.xp : 0;
    const newXp = oldXp + amount;
    const streak = streakFrom(existing && existing.last_active, existing && existing.streak);

    const result = await pool.query(
        `INSERT INTO players (slack_id, display_name, xp, streak, last_active, shoutouts, trivia_correct, workspace_id)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7)
         ON CONFLICT (slack_id, workspace_id) DO UPDATE SET
           xp = players.xp + $3,
           display_name = COALESCE(EXCLUDED.display_name, players.display_name),
           streak = $4,
           last_active = CURRENT_DATE,
           shoutouts = players.shoutouts + $5,
           trivia_correct = players.trivia_correct + $6
         RETURNING *`,
        [
            slackId, displayName || null, amount, streak,
            extra.shoutout ? 1 : 0,
            extra.triviaCorrect ? 1 : 0,
            workspaceId
        ]
    );

    const player = result.rows[0];
    const oldLevel = levelFor(oldXp);
    const newLevel = levelFor(player.xp);

    return {
        player,
        gained: amount,
        level: newLevel,
        leveledUp: newLevel > oldLevel,
        title: titleFor(newLevel),
        streak: player.streak
    };
}

async function getLeaderboard(workspaceId, limit = 10) {
    const result = await pool.query(
        `SELECT slack_id, display_name, xp, streak, shoutouts
         FROM players
         WHERE workspace_id = $1 AND xp > 0
         ORDER BY xp DESC, slack_id ASC
         LIMIT $2`,
        [workspaceId, limit]
    );
    return result.rows;
}

// Where someone sits overall, so /sos-rank means something outside the top 10.
async function getStanding(slackId, workspaceId) {
    const result = await pool.query(
        `SELECT count(*)::int AS ahead FROM players
         WHERE workspace_id = $1 AND xp > (
           SELECT COALESCE(xp, 0) FROM players WHERE slack_id = $2 AND workspace_id = $1
         )`,
        [workspaceId, slackId]
    );
    const total = await pool.query(
        `SELECT count(*)::int AS total FROM players WHERE workspace_id = $1 AND xp > 0`,
        [workspaceId]
    );
    return { position: result.rows[0].ahead + 1, total: total.rows[0].total };
}

module.exports = {
    XP, XP_PER_LEVEL, TITLES,
    levelFor, titleFor, xpToNext, progressBar, streakFrom,
    getPlayer, awardXp, getLeaderboard, getStanding
};
