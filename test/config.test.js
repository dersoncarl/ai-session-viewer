const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { expandPath, loadAppConfig, parseDotEnv } = require("../src/config");

test("parseDotEnv reads quoted and plain values", () => {
  const values = parseDotEnv(`
    # comment
    SESSION_HOME="$HOME/.ai-sessions"
    PORT=8787
    SESSION_CACHE_TTL_MS=5000
    DELETE_MODE=hard
  `);

  assert.equal(values.SESSION_HOME, "$HOME/.ai-sessions");
  assert.equal(values.PORT, "8787");
  assert.equal(values.SESSION_CACHE_TTL_MS, "5000");
  assert.equal(values.DELETE_MODE, "hard");
});

test("expandPath expands home shortcuts", () => {
  assert.equal(expandPath("~/Code"), path.join(os.homedir(), "Code"));
  assert.equal(expandPath("$HOME/.ai-sessions"), path.join(os.homedir(), ".ai-sessions"));
});

test("loadAppConfig uses .env over config.json and defaults", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-session-config-"));
  fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify({
    sessionHome: "/json/sessions",
    port: 9999,
    cacheTtlMs: 1000,
    deleteMode: "hard",
  }));
  fs.writeFileSync(path.join(temp, ".env"), [
    "SESSION_HOME=/env/sessions",
    "PORT=8787",
    "SESSION_CACHE_TTL_MS=5000",
    "DELETE_MODE=archive",
  ].join("\n"));

  const config = loadAppConfig(temp, {
    sessionHome: "/default/sessions",
    port: 1111,
    cacheTtlMs: 2222,
    deleteMode: "archive",
  });

  assert.equal(config.sessionHome, "/env/sessions");
  assert.equal(config.port, 8787);
  assert.equal(config.cacheTtlMs, 5000);
  assert.equal(config.deleteMode, "archive");
});

test("loadAppConfig lets process env override files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-session-config-env-"));
  fs.writeFileSync(path.join(temp, ".env"), [
    "SESSION_HOME=/env/sessions",
    "PORT=8787",
  ].join("\n"));

  const previous = {
    SESSION_HOME: process.env.SESSION_HOME,
    PORT: process.env.PORT,
  };

  try {
    process.env.SESSION_HOME = "/process/sessions";
    process.env.PORT = "8899";

    const config = loadAppConfig(temp, {
      sessionHome: "/default/sessions",
      port: 1111,
      cacheTtlMs: 2222,
      deleteMode: "archive",
    });

    assert.equal(config.sessionHome, "/process/sessions");
    assert.equal(config.port, 8899);
    assert.equal(config.deleteMode, "archive");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("loadAppConfig supports hard delete mode", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-session-config-delete-mode-"));
  fs.writeFileSync(path.join(temp, ".env"), [
    "SESSION_HOME=/env/sessions",
    "DELETE_MODE=hard",
  ].join("\n"));

  const config = loadAppConfig(temp, {
    sessionHome: "/default/sessions",
    port: 1111,
    cacheTtlMs: 2222,
    deleteMode: "archive",
  });

  assert.equal(config.deleteMode, "hard");
});

test("loadAppConfig falls back to archive delete mode", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-session-config-delete-mode-fallback-"));
  fs.writeFileSync(path.join(temp, ".env"), [
    "SESSION_HOME=/env/sessions",
    "DELETE_MODE=invalid",
  ].join("\n"));

  const config = loadAppConfig(temp, {
    sessionHome: "/default/sessions",
    port: 1111,
    cacheTtlMs: 2222,
    deleteMode: "archive",
  });

  assert.equal(config.deleteMode, "archive");
});
