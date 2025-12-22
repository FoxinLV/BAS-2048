// Minimal backend to collect stats into PostgreSQL.
// Start: `npm install` then `node server.js`

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl:
    process.env.POSTGRES_SSL === "true"
      ? { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false" }
      : false,
});

async function ensureTable() {
  await pool.query(`
    create table if not exists game_stats (
      id bigserial primary key,
      name text,
      score integer not null,
      size integer not null,
      seed text,
      max_tile integer,
      streak integer,
      games_played integer,
      created_at timestamptz default now()
    );
  `);
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/stats", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "select id, name, score, size, seed, max_tile, streak, games_played, created_at from game_stats order by score desc limit 50"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db_error" });
  }
});

app.post("/api/stats", async (req, res) => {
  const { name = "Гость", score, size, seed, maxTile, streak, gamesPlayed } = req.body || {};
  if (typeof score !== "number" || typeof size !== "number") {
    return res.status(400).json({ error: "invalid_payload" });
  }
  try {
    const insert = `
      insert into game_stats (name, score, size, seed, max_tile, streak, games_played)
      values ($1, $2, $3, $4, $5, $6, $7)
      returning id, created_at
    `;
    const params = [name, score, size, seed || null, maxTile || null, streak || 0, gamesPlayed || 0];
    const { rows } = await pool.query(insert, params);
    res.json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "db_error" });
  }
});

const port = Number(process.env.PORT || 3001);
ensureTable()
  .then(() => app.listen(port, () => console.log(`Stats API on :${port}`)))
  .catch((err) => {
    console.error("Failed to init table", err);
    process.exit(1);
  });
