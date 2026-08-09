const pool = require("../db/index");
const { answerQuestion, extractJson } = require("./aiEngine");

// ============================================================
// VECTOR SEARCH APPROACH (requires Hugging Face API)
// Commented out due to network restrictions on Nest server
// Uncomment this and comment out the Groq approach below
// when deploying to a server with unrestricted network access
// ============================================================

// const { generateEmbedding } = require("./aiEngine");

// async function storeMemory(content, type, workspaceId) {
//     const embedding = await generateEmbedding(content);
//     if (!embedding) {
//         throw new Error("Failed to generate embedding");
//     }
//     const result = await pool.query(
//         `INSERT INTO memories (type, content, embedding, workspace_id)
//          VALUES ($1, $2, $3, $4)
//          RETURNING *`,
//         [type || "general", content, embedding, workspaceId]
//     );
//     return result.rows[0];
// }

// async function searchMemory(question, workspaceId) {
//     const queryEmbedding = await generateEmbedding(question);
//     if (!queryEmbedding) {
//         throw new Error("Failed to generate query embedding");
//     }
//     const result = await pool.query(
//         `SELECT id, content, type, embedding FROM memories
//          WHERE workspace_id = $1`,
//         [workspaceId]
//     );
//     if (result.rows.length === 0) return null;
//
//     let bestMatch = null;
//     let bestScore = -1;
//     for (const memory of result.rows) {
//         const score = cosineSimilarity(queryEmbedding, memory.embedding);
//         if (score > bestScore) {
//             bestScore = score;
//             bestMatch = memory;
//         }
//     }
//     return bestScore > 0.5 ? bestMatch : null;
// }

// function cosineSimilarity(a, b) {
//     const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
//     const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
//     const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
//     return dot / (magA * magB);
// }

// ============================================================
// GROQ-POWERED SEARCH APPROACH (current -- MVP friendly)
// Uses the LLM itself to find relevant memories instead of
// doing vector math. Works well for small memory sets (<100).
// Switch to vector search above when scaling up.
// ============================================================

async function storeMemory(content, type, workspaceId) {
    const result = await pool.query(
        `INSERT INTO memories (type, content, workspace_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [type || "general", content, workspaceId]
    );
    return result.rows[0];
}

async function searchMemory(question, workspaceId) {
    const result = await pool.query(
        `SELECT id, content, type FROM memories
         WHERE workspace_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [workspaceId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const memoriesList = result.rows
        .map((m, i) => `${i + 1}. ${m.content}`)
        .join("\n");

    const prompt = `
You are a memory search assistant.

Here are stored memories:
${memoriesList}

Question: "${question}"

Which memory number is most relevant to the question?
Reply with ONLY a JSON object like: {"index": 1, "relevant": true}
If none are relevant, reply: {"index": -1, "relevant": false}`;

    try {
        const response = await answerQuestion(prompt);
        // Same chatty-model problem as detectIntent -- the reply may be fenced
        // or prefixed with prose, so pull the JSON object out of it.
        const parsed = extractJson(response);

        const index = Number(parsed.index);
        if (!parsed.relevant || !Number.isInteger(index) || index < 1) {
            return null;
        }

        return result.rows[index - 1] || null;

    } catch (err) {
        console.error("Memory search error:", err.message);
        return null;
    }
}

// searchMemory only ever surfaces ONE memory via the LLM, so without this there
// is no way to see or prune what has actually been stored.
async function getMemories(workspaceId) {
    const result = await pool.query(
        `SELECT id, type, content, created_at FROM memories
         WHERE workspace_id = $1
         ORDER BY created_at DESC`,
        [workspaceId]
    );
    return result.rows;
}

// Scoped by workspace for the same reason as updateTaskStatus.
async function deleteMemory(memoryId, workspaceId) {
    const id = Number(memoryId);
    if (!Number.isInteger(id)) return null;

    const result = await pool.query(
        `DELETE FROM memories
         WHERE id = $1 AND workspace_id = $2
         RETURNING *`,
        [id, workspaceId]
    );
    return result.rows[0] || null;
}

module.exports = { storeMemory, searchMemory, getMemories, deleteMemory };