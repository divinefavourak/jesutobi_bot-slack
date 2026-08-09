require("dotenv").config();
const pool = require("./index");

async function migrate() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                slack_id VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(100),
                workspace_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✓ Users table ready");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                assignee VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                due_date VARCHAR(50),
                workspace_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✓ Tasks table ready");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS memories (
                id SERIAL PRIMARY KEY,
                type VARCHAR(50),
                content TEXT,
                workspace_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✓ Memories table ready");
        
        await pool.query(`
            ALTER TABLE memories
            ADD COLUMN IF NOT EXISTS embedding FLOAT[];
            `);
        console.log("Embedding column ready");

        await pool.query(`
        CREATE TABLE IF NOT EXISTS workflows (
            id SERIAL PRIMARY KEY,
            trigger VARCHAR(100) NOT NULL,
            channel VARCHAR(100),
            action VARCHAR(100),
            payload TEXT,
            enabled BOOLEAN DEFAULT true,
            workspace_id VARCHAR(50),
            created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✓ Workflows table ready");

        // findMatchingWorkflows() runs on every channel join, so index the
        // exact columns it filters on.
        await pool.query(`
            CREATE INDEX IF NOT EXISTS workflows_lookup_idx
            ON workflows (trigger, workspace_id, channel);
        `);
        console.log("✓ Workflow lookup index ready");

        console.log("Migration complete");
        process.exit(0);

    } catch (err) {
        console.error("Migration failed:", err.message);
        process.exit(1);
    }
}

migrate();