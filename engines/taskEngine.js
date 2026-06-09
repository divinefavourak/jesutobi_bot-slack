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

async function updateTaskStatus(taskId, status) {
    const result = await pool.query(
        `UPDATE tasks SET status = $1
        WHERE id = $2
        RETURNING *`,
        [status, taskId]
    );

    return result.rows[0]
    
}

module.exports = { createTask, getTasks, updateTaskStatus };