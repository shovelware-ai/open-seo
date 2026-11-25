// LOCAL PATCH (shovelware): applies D1 migrations for a self-host stage with
// wrangler. alchemy 2.0.0-beta.85 refuses drizzle-kit's pre-v1 layout
// (drizzle/sqlite/meta/_journal.json), so the stack no longer migrates D1.
// wrangler keeps the same d1_migrations table alchemy used before.
// Usage: node scripts/selfhost-migrate.mjs [stage]   (default: selfhost)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const stage = process.argv[2] || "selfhost";
if (!/^[a-z0-9-]+$/.test(stage)) throw new Error(`Bad stage name: ${stage}`);
const name = `open-seo-db-${stage}`;

const wrangler = (args) =>
  execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });

const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
const database = databases.find((db) => db.name === name);
if (!database) throw new Error(`D1 database ${name} not found`);

const dir = mkdtempSync(path.join(tmpdir(), "openseo-migrate-"));
try {
  const config = path.join(dir, "wrangler.json");
  writeFileSync(
    config,
    JSON.stringify({
      name: `open-seo-migrate-${stage}`,
      compatibility_date: "2026-01-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: name,
          database_id: database.uuid,
          migrations_dir: path.resolve("drizzle/sqlite"),
        },
      ],
    }),
  );
  const execute = (sql) =>
    JSON.parse(
      wrangler([
        "d1",
        "execute",
        "DB",
        "--remote",
        "-c",
        config,
        "--json",
        "--command",
        sql,
      ]),
    )[0].results;

  // Databases first migrated by alchemy beta.61 have its d1_migrations table:
  // `id TEXT`, `applied_at TEXT NOT NULL` with no default. wrangler inserts
  // only `name`, so every pending migration fails on applied_at. Rebuild the
  // table once into wrangler's own shape, keeping every row. D1 runs the
  // statements of one command as a single batch, so it lands whole or not at all.
  const [table] = execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
  );
  if (table && !/applied_at[^,]*DEFAULT/i.test(table.sql)) {
    console.log("Converting d1_migrations to wrangler's table layout");
    execute(
      [
        "CREATE TABLE d1_migrations_wrangler (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
        "INSERT INTO d1_migrations_wrangler (id, name, applied_at) SELECT CAST(id AS INTEGER), name, applied_at FROM d1_migrations",
        "DROP TABLE d1_migrations",
        "ALTER TABLE d1_migrations_wrangler RENAME TO d1_migrations",
      ].join("; "),
    );
  }

  execFileSync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "-c", config],
    { stdio: "inherit", env: { ...process.env, CI: "1" } },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
