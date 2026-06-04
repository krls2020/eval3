import express from "express";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- schema -----------------------------------------------------------------
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id          BIGSERIAL PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      search      tsvector GENERATED ALWAYS AS (
                    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))
                  ) STORED
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING GIN (search);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS notes_updated_idx ON notes (updated_at DESC);`
  );
}

// --- app --------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(__dirname, "public")));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "error", error: String(err) });
  }
});

// List / search notes (returns lightweight rows, no full content)
app.get("/api/notes", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    let rows;
    if (q) {
      rows = (
        await pool.query(
          `SELECT id, title, left(content, 200) AS excerpt, created_at, updated_at
             FROM notes
            WHERE search @@ websearch_to_tsquery('simple', $1)
            ORDER BY ts_rank(search, websearch_to_tsquery('simple', $1)) DESC,
                     updated_at DESC
            LIMIT 200`,
          [q]
        )
      ).rows;
    } else {
      rows = (
        await pool.query(
          `SELECT id, title, left(content, 200) AS excerpt, created_at, updated_at
             FROM notes
            ORDER BY updated_at DESC
            LIMIT 200`
        )
      ).rows;
    }
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/notes/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, content, created_at, updated_at FROM notes WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/api/notes", async (req, res, next) => {
  try {
    const title = (req.body.title ?? "").toString();
    const content = (req.body.content ?? "").toString();
    const { rows } = await pool.query(
      `INSERT INTO notes (title, content) VALUES ($1, $2)
       RETURNING id, title, content, created_at, updated_at`,
      [title, content]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put("/api/notes/:id", async (req, res, next) => {
  try {
    const title = (req.body.title ?? "").toString();
    const content = (req.body.content ?? "").toString();
    const { rows } = await pool.query(
      `UPDATE notes SET title = $1, content = $2, updated_at = now()
        WHERE id = $3
       RETURNING id, title, content, created_at, updated_at`,
      [title, content, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/notes/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM notes WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  // The database may still be initializing when the app boots (fresh project),
  // so retry the first connection / schema setup instead of crashing immediately.
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initSchema();
      break;
    } catch (err) {
      console.error(
        `Database not ready (attempt ${attempt}/${maxAttempts}): ${err.message}`
      );
      if (attempt === maxAttempts) {
        console.error("Giving up waiting for the database.");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Notes app listening on 0.0.0.0:${PORT}`);
  });
}

start();
