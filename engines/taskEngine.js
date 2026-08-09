const pool = require("../db/index");

async function createTask(entities, workspaceId) {
    const { task, assignee, deadline } = entities;

    const result = await pool.query(
            `INSERT INTO tasks (title, assignee, due_date, workspace_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [task || "Unnamed task", assignee || null, deadline || null, workspaceId || null]
    );

    return result.rows[0];
    
}

async function getTasks(workspaceId) {
    const result = await pool.query(
        `SELECT * FROM tasks
        WHERE workspace_id = $1
        ORDER BY created_at DESC`,
        [workspaceId]
    );

    return result.rows
    
}

const VALID_STATUSES = ["pending", "in_progress", "done"];

// workspaceId is part of the WHERE clause, not a check afterwards: task ids are
// sequential integers, so without it anyone could complete another workspace's
// task by guessing a number.
async function updateTaskStatus(taskId, status, workspaceId) {
    const id = Number(taskId);
    if (!Number.isInteger(id)) return null;

    if (!VALID_STATUSES.includes(status)) {
        throw new Error(`Invalid status "${status}". Use one of: ${VALID_STATUSES.join(", ")}`);
    }

    // The CTE captures the status as it was before the write, so callers can
    // tell a real completion from re-running /sos-done on an already-done task.
    // That distinction is what stops people farming XP by toggling a task.
    const result = await pool.query(
        `WITH before AS (
            SELECT status FROM tasks WHERE id = $2 AND workspace_id = $3
         )
         UPDATE tasks SET status = $1
         WHERE id = $2 AND workspace_id = $3
         RETURNING *, (SELECT status FROM before) AS previous_status`,
        [status, id, workspaceId]
    );

    return result.rows[0] || null;
}

module.exports = { createTask, getTasks, updateTaskStatus, VALID_STATUSES };