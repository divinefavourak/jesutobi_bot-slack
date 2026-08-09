const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    //ssl: { rejectUnauthorized: false }
});

// Startup health check. The client MUST be released -- without it that
// connection stays checked out for the life of the process, permanently
// costing one slot in the pool and making pool.end() hang forever.
pool.connect()
    .then((client) => {
        client.release();
        console.log("Database connected");
    })
    .catch((err) => console.error("Database connection error:", err.message));


module.exports = pool;