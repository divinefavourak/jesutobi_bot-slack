const pool = require("../db/index");

// the canonical trigger name used by the real-time event handler.
// the AI sometimes phrases this differently ("join", "member_joined_channel",
// "channel_member_join"), so we normalize anything join-related down to one value.
function normalizeTrigger(trigger) {
    if (!trigger) return "unknown";
    if (/join/i.test(trigger)) return "channel_member_join";
    return trigger;
}

// Slack channel names are always lowercase and have no leading "#".
// The AI returns "#design", "##design", " #design" or "<#C123|design>"
// interchangeably, so normalize hard before storing or comparing.
// Order matters: trim BEFORE stripping "#", otherwise the ^ anchor misses a
// hash that sits behind a leading space and we store "#design", which can
// never match the bare "design" that conversations.info returns.
function normalizeChannel(channel) {
    if (!channel) return null;

    let name = String(channel).trim();

    // Slack link form: <#C0123ABCD|general> -> general
    const link = name.match(/^<#[A-Z0-9]+\|([^>]*)>$/i);
    if (link) name = link[1];

    return name.replace(/^#+/, "").trim().toLowerCase() || null;
}

// The canonical actions the join handler knows how to execute. The AI phrases
// these freely ("send them a DM", "post a message"), so normalize to one of
// these before storing -- otherwise the action column holds prose that the
// dispatcher can't act on.
const ACTIONS = {
    SEND_MESSAGE: "send_message",     // public post in the channel
    DM_USER: "dm_user",               // direct message to the person who joined
    SEND_EPHEMERAL: "send_ephemeral"  // visible only to the person who joined
};

function normalizeAction(action) {
    if (!action) return ACTIONS.SEND_MESSAGE;

    // The model switches freely between "send a direct message", "dm_user" and
    // "send-direct-message", so flatten every separator to a single space
    // BEFORE matching -- otherwise \bdirect message\b never matches the
    // snake_case form and a DM rule silently becomes a public post.
    const text = String(action).toLowerCase().replace(/[_\-\s]+/g, " ").trim();

    if (/\b(dm|dms|direct message|direct messages|privately|private message)\b/.test(text)) {
        return ACTIONS.DM_USER;
    }
    if (/\b(ephemeral|only they|just them|quietly)\b/.test(text)) return ACTIONS.SEND_EPHEMERAL;

    // Anything else ("send onboarding docs", "post message", "welcome them")
    // is a public post -- that is the sane default for a join rule.
    return ACTIONS.SEND_MESSAGE;
}

// save a new workflow rule (not executed yet, just stored)
async function createWorkflow(entities, workspaceId) {
    const { trigger, channel, payload } = entities;
    const action = normalizeAction(entities.action);

    // Asking twice for the same rule used to insert a second row, which made
    // the join handler post the welcome message twice. Reuse the existing rule.
    const existing = await pool.query(
        `SELECT * FROM workflows
         WHERE trigger = $1
         AND channel IS NOT DISTINCT FROM $2
         AND action IS NOT DISTINCT FROM $3
         AND payload IS NOT DISTINCT FROM $4
         AND workspace_id = $5
         LIMIT 1`,
        [normalizeTrigger(trigger), normalizeChannel(channel), action || null, payload || null, workspaceId]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0];
    }

    const result = await pool.query(
        `INSERT INTO workflows (trigger, channel, action, payload, workspace_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [normalizeTrigger(trigger), normalizeChannel(channel), action || null, payload || null, workspaceId]
    );

    return result.rows[0];
}

// find workflows matching a specific trigger + channel
// this runs automatically when real Slack events happen.
// channel is compared case-insensitively to survive any historical
// rows that were stored with mixed case.
async function findMatchingWorkflows(trigger, channel, workspaceId) {
    const result = await pool.query(
        `SELECT * FROM workflows
         WHERE trigger = $1
         AND LOWER(channel) = LOWER($2)
         AND workspace_id = $3
         AND enabled = true`,
        [normalizeTrigger(trigger), normalizeChannel(channel), workspaceId]
    );

    return result.rows;
}

async function getWorkflows(workspaceId) {
    const result = await pool.query(
        `SELECT * FROM workflows WHERE workspace_id = $1 ORDER BY created_at DESC`,
        [workspaceId]
    );
    return result.rows;
}

// The enabled column was only ever read by findMatchingWorkflows -- nothing
// could flip it, so a rule could never be paused without deleting it.
async function setWorkflowEnabled(workflowId, enabled, workspaceId) {
    const id = Number(workflowId);
    if (!Number.isInteger(id)) return null;

    const result = await pool.query(
        `UPDATE workflows SET enabled = $1
         WHERE id = $2 AND workspace_id = $3
         RETURNING *`,
        [enabled, id, workspaceId]
    );
    return result.rows[0] || null;
}

async function deleteWorkflow(workflowId, workspaceId) {
    const id = Number(workflowId);
    if (!Number.isInteger(id)) return null;

    const result = await pool.query(
        `DELETE FROM workflows
         WHERE id = $1 AND workspace_id = $2
         RETURNING *`,
        [id, workspaceId]
    );
    return result.rows[0] || null;
}

module.exports = {
    createWorkflow,
    findMatchingWorkflows,
    getWorkflows,
    setWorkflowEnabled,
    deleteWorkflow,
    normalizeAction,
    ACTIONS
};