const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function stripQuotes(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseDotEnv(content) {
  const values = {};

  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1));
    if (/^[A-Z0-9_]+$/i.test(key)) {
      values[key] = value;
    }
  }

  return values;
}

function readJsonConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  return parseDotEnv(fs.readFileSync(filePath, "utf8"));
}

function expandPath(value) {
  if (!value) {
    return value;
  }
  const text = String(value);
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text.replaceAll("$HOME", os.homedir());
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function deleteMode(value, fallback = "archive") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized === "hard" ? "hard" : "archive";
}

function loadAppConfig(appRoot, defaults = {}) {
  const jsonConfig = readJsonConfig(path.join(appRoot, "config.json"));
  const envFile = readDotEnv(path.join(appRoot, ".env"));

  const sessionHome = process.env.SESSION_HOME
    || envFile.SESSION_HOME
    || jsonConfig.sessionHome
    || defaults.sessionHome;
  const port = process.env.PORT
    || envFile.PORT
    || jsonConfig.port
    || defaults.port;
  const cacheTtlMs = process.env.SESSION_CACHE_TTL_MS
    || envFile.SESSION_CACHE_TTL_MS
    || jsonConfig.cacheTtlMs
    || defaults.cacheTtlMs;
  const mode = process.env.DELETE_MODE
    || envFile.DELETE_MODE
    || jsonConfig.deleteMode
    || defaults.deleteMode;

  return {
    sessionHome: expandPath(sessionHome),
    port: positiveNumber(port, defaults.port),
    cacheTtlMs: positiveNumber(cacheTtlMs, defaults.cacheTtlMs),
    deleteMode: deleteMode(mode, defaults.deleteMode),
  };
}

module.exports = {
  deleteMode,
  expandPath,
  loadAppConfig,
  parseDotEnv,
};
