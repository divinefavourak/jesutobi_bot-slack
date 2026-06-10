const pool = require("../db/index");
const { generateEmbeddings } = require("./aiEngine");

//store a memory with it's embedding

async function storeMemory(content, type, workspaceId) {
    //1. generate embedding for the content
    const embedding = await generateEmbeddings(content);

    if(!embedding){
        throw new Error("Failed to generate embedding");
        
    }
    const result = await pool.query(`
        INSERT INTO memories (type, content, worskspace_id)
        VALUES ($1, $2, $3, $4)
        REETURNING *`,
        [type || "general", content, type, workspaceId]
    );
    return result.rows[0];
}

async function searchMemory(question, workspaceId) {
    //1. convert question to embedding
    const queryEmbedding = await generateEmbeddings(question);

    if(!queryEmbedding){
        throw new Error("Failed to generate query embedding");
    }
    const result = await pool.query(`
        SELECT id, content, type, embedding FROM memories
        WHERE workspace_id = $1`,
        [workspaceId]
    );
    if (result.rows.length === 0 ){
        return null;
    }
    //3. calculate distance between question and each memory
    let bestMatch = null;
    let bestScore = -1;

    for (const memory of result.rows){
        const score = cosineSimilarity(queryEmbedding, memory.embedding);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = memory;
        }
    }

    //4. return if confident enough
    return bestScore > 0.5 ? bestMatch : null;
}

// measures how similar two embeddings are
// returns a number between -1 and 1
// closer to 1 = more similar
function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dot / (magA * magB);
}

module.exports = { storeMemory, searchMemory };