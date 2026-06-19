const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_SESSION_HOME = process.env.SESSION_HOME || path.join(os.homedir(), ".ai-sessions");

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
}

function readSessionIndex(indexPath = path.join(DEFAULT_SESSION_HOME, "session_index.jsonl")) {
  const sessions = new Map();

  for (const line of readLines(indexPath)) {
    const row = safeParse(line);
    if (!row || !row.id) {
      continue;
    }

    const next = {
      title: row.thread_name || "Untitled session",
      updatedAt: row.updated_at || null,
    };
    const previous = sessions.get(row.id);
    const previousTime = Date.parse(previous?.updatedAt || "");
    const nextTime = Date.parse(next.updatedAt || "");

    if (!previous || Number.isNaN(previousTime) || nextTime >= previousTime) {
      sessions.set(row.id, next);
    }
  }

  return sessions;
}

function listSessionFiles(sessionHome = DEFAULT_SESSION_HOME) {
  const sessionsRoot = path.join(sessionHome, "sessions");
  if (!fs.existsSync(sessionsRoot)) {
    return [];
  }

  const files = [];
  const stack = [sessionsRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function truncate(value, maxLength = 220) {
  if (!value) {
    return "";
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function isInternalContextText(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("<environment_context>")
    || trimmed.startsWith("<permissions")
    || trimmed.startsWith("The following is the agent history whose request action you are assessing")
    || trimmed.startsWith(">>> TRANSCRIPT START");
}

function userTextFromPayload(payload) {
  if (!payload) {
    return "";
  }

  if (payload.type === "message" && payload.role === "user" && Array.isArray(payload.content)) {
    const text = payload.content
      .filter((item) => item && item.type === "input_text" && item.text)
      .map((item) => item.text)
      .join("\n");
    return isInternalContextText(text) ? "" : text;
  }

  if (payload.type === "user_message" && payload.message) {
    return isInternalContextText(payload.message) ? "" : payload.message;
  }

  return "";
}

function assistantTextFromPayload(payload) {
  if (!payload) {
    return null;
  }

  if (payload.type === "message" && payload.role === "assistant" && Array.isArray(payload.content)) {
    const text = payload.content
      .filter((item) => item && item.type === "output_text" && item.text)
      .map((item) => item.text)
      .join("\n");
    return text ? { text, phase: payload.phase || "" } : null;
  }

  if (payload.type === "agent_message" && payload.message) {
    return { text: payload.message, phase: payload.phase || "" };
  }

  return null;
}

function readPromptResponsePairs(filePath) {
  const pairs = [];

  for (const line of readLines(filePath)) {
    const row = safeParse(line);
    if (!row) {
      continue;
    }

    const userText = userTextFromPayload(row.payload);
    if (userText) {
      const lastPair = pairs[pairs.length - 1];
      if (!lastPair || lastPair.userPrompt !== userText || lastPair.aiResponse) {
        pairs.push({ userPrompt: userText, aiResponse: "" });
      }
      continue;
    }

    const assistant = assistantTextFromPayload(row.payload);
    if (!assistant || pairs.length === 0) {
      continue;
    }

    const lastPair = pairs[pairs.length - 1];
    if (assistant.phase === "final_answer" || !lastPair.aiResponse) {
      lastPair.aiResponse = assistant.text;
    }
  }

  return pairs;
}

function idFromFileName(filePath) {
  const match = path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

function readSessionMetaFast(filePath) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(64 * 1024);
  let leftover = "";

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      const text = leftover + buffer.subarray(0, bytesRead).toString("utf8");
      const lines = text.split(/\r?\n/);
      leftover = lines.pop() || "";

      for (const line of lines) {
        if (!line) {
          continue;
        }
        const row = safeParse(line);
        if (row?.type === "session_meta" && row.payload) {
          return row.payload;
        }
      }
    }

    if (leftover) {
      const row = safeParse(leftover);
      if (row?.type === "session_meta" && row.payload) {
        return row.payload;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return null;
}

function readHistoryIndex(historyPath = path.join(DEFAULT_SESSION_HOME, "history.jsonl")) {
  const histories = new Map();

  for (const line of readLines(historyPath)) {
    const row = safeParse(line);
    if (!row || !row.session_id || !row.text || isInternalContextText(row.text)) {
      continue;
    }
    const existing = histories.get(row.session_id) || {
      firstUserMessage: "",
      lastUserMessage: "",
      userMessages: [],
      userMessageCount: 0,
    };
    if (!existing.firstUserMessage) {
      existing.firstUserMessage = row.text;
    }
    existing.lastUserMessage = row.text;
    existing.userMessages.push(row.text);
    existing.userMessageCount += 1;
    histories.set(row.session_id, existing);
  }

  return histories;
}

function buildSessionSummary(filePath, sessionIndex = new Map(), historyIndex = new Map()) {
  if (historyIndex.size > 0) {
    const stat = fs.statSync(filePath);
    const meta = readSessionMetaFast(filePath);
    const id = meta?.id || idFromFileName(filePath) || path.basename(filePath, ".jsonl");
    const history = historyIndex.get(id);
    if (!history) {
      return buildSessionSummary(filePath, sessionIndex, new Map());
    }
    const firstUserMessage = history?.firstUserMessage || "";
    const lastUserMessage = history?.lastUserMessage || "";
    const userMessages = history?.userMessages || [];
    const indexed = sessionIndex.get(id);
    const fallbackTitle = truncate(firstUserMessage, 80) || "Untitled session";

    return {
      id,
      title: indexed?.title || fallbackTitle,
      updatedAt: indexed?.updatedAt || stat.mtime.toISOString(),
      createdAt: meta?.timestamp || null,
      cwd: meta?.cwd || "",
      source: meta?.source || "",
      originator: meta?.originator || "",
      cliVersion: meta?.cli_version || "",
      modelProvider: meta?.model_provider || "",
      filePath,
      fileSize: stat.size,
      lineCount: null,
      userMessageCount: history?.userMessageCount || 0,
      firstUserMessage: truncate(firstUserMessage),
      lastUserMessage: truncate(lastUserMessage),
      userMessages: userMessages.map((message) => truncate(message, 2000)),
    };
  }

  const lines = readLines(filePath);
  const stat = fs.statSync(filePath);
  let meta = null;
  const responseUserMessages = [];
  const eventUserMessages = [];
  let lastEventAt = null;
  for (const line of lines) {
    const row = safeParse(line);
    if (!row) {
      continue;
    }
    if (row.timestamp) {
      lastEventAt = row.timestamp;
    }
    if (row.type === "session_meta" && row.payload) {
      meta = row.payload;
    }

    const userText = userTextFromPayload(row.payload);
    if (userText) {
      if (row.type === "response_item") {
        responseUserMessages.push(userText);
      } else if (row.type === "event_msg") {
        eventUserMessages.push(userText);
      }
    }
  }

  const userMessages = responseUserMessages.length > 0 ? responseUserMessages : eventUserMessages;
  const id = meta?.id || idFromFileName(filePath) || path.basename(filePath, ".jsonl");
  const history = historyIndex.get(id);
  const firstUserMessage = history?.firstUserMessage || userMessages[0] || "";
  const lastUserMessage = history?.lastUserMessage || userMessages[userMessages.length - 1] || "";
  const userMessageCount = history?.userMessageCount ?? userMessages.length;
  const indexed = sessionIndex.get(id);
  const fallbackTitle = truncate(firstUserMessage, 80) || "Untitled session";

  return {
    id,
    title: indexed?.title || fallbackTitle,
    updatedAt: indexed?.updatedAt || lastEventAt || stat.mtime.toISOString(),
    createdAt: meta?.timestamp || null,
    cwd: meta?.cwd || "",
    source: meta?.source || "",
    originator: meta?.originator || "",
    cliVersion: meta?.cli_version || "",
    modelProvider: meta?.model_provider || "",
    filePath,
    fileSize: stat.size,
    lineCount: lines.length,
    userMessageCount,
    firstUserMessage: truncate(firstUserMessage),
    lastUserMessage: truncate(lastUserMessage),
    userMessages: userMessages.map((message) => truncate(message, 2000)),
  };
}

function buildSessionDetail(summary) {
  const pairs = readPromptResponsePairs(summary.filePath);
  if (pairs.length === 0) {
    return {
      ...summary,
      aiResponses: [],
    };
  }

  return {
    ...summary,
    userMessages: pairs.map((pair) => truncate(pair.userPrompt, 2000)),
    aiResponses: pairs.map((pair) => truncate(pair.aiResponse, 4000)),
    userMessageCount: pairs.length,
    firstUserMessage: truncate(pairs[0]?.userPrompt || ""),
    lastUserMessage: truncate(pairs[pairs.length - 1]?.userPrompt || ""),
  };
}

function folderLabel(cwd) {
  if (!cwd) {
    return "Unknown folder";
  }
  return path.basename(path.resolve(cwd)) || cwd;
}

function getSessionFolders(sessions) {
  const foldersByPath = new Map();

  for (const session of sessions) {
    const cwd = session.cwd || "";
    const key = cwd || "__unknown__";
    const existing = foldersByPath.get(key);
    if (existing) {
      existing.count += 1;
      existing.latestUpdatedAt = Date.parse(session.updatedAt || "") > Date.parse(existing.latestUpdatedAt || "")
        ? session.updatedAt
        : existing.latestUpdatedAt;
    } else {
      foldersByPath.set(key, {
        path: cwd,
        label: folderLabel(cwd),
        count: 1,
        latestUpdatedAt: session.updatedAt || null,
      });
    }
  }

  return Array.from(foldersByPath.values()).sort((a, b) => {
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

function filterSessionsByFolder(sessions, selectedFolder) {
  if (!selectedFolder) {
    return sessions;
  }
  return sessions.filter((session) => path.resolve(session.cwd || "") === path.resolve(selectedFolder));
}

function betterSessionCandidate(current, candidate) {
  if (!current) {
    return candidate;
  }
  if ((candidate.userMessageCount || 0) !== (current.userMessageCount || 0)) {
    return (candidate.userMessageCount || 0) > (current.userMessageCount || 0) ? candidate : current;
  }
  if ((candidate.fileSize || 0) !== (current.fileSize || 0)) {
    return (candidate.fileSize || 0) > (current.fileSize || 0) ? candidate : current;
  }
  return Date.parse(candidate.updatedAt || "") > Date.parse(current.updatedAt || "") ? candidate : current;
}

function dedupeSessionsById(sessions) {
  const byId = new Map();

  for (const session of sessions) {
    byId.set(session.id, betterSessionCandidate(byId.get(session.id), session));
  }

  return Array.from(byId.values());
}

function listSessions(options = {}) {
  const sessionHome = options.sessionHome || DEFAULT_SESSION_HOME;
  const sessionIndex = readSessionIndex(path.join(sessionHome, "session_index.jsonl"));
  const historyIndex = readHistoryIndex(path.join(sessionHome, "history.jsonl"));
  const sessions = dedupeSessionsById(listSessionFiles(sessionHome)
    .map((filePath) => buildSessionSummary(filePath, sessionIndex, historyIndex)))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));

  return sessions;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function copyThenRemove(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
}

function rewriteJsonlExcluding(filePath, shouldRemove, backupTag) {
  if (!fs.existsSync(filePath)) {
    return { removed: 0, backupPath: null };
  }

  const lines = readLines(filePath);
  let removed = 0;
  const kept = [];

  for (const line of lines) {
    const row = safeParse(line);
    if (row && shouldRemove(row)) {
      removed += 1;
    } else {
      kept.push(line);
    }
  }

  const backupPath = `${filePath}.bak.${backupTag}`;
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, kept.length > 0 ? `${kept.join("\n")}\n` : "");

  return { removed, backupPath };
}

function findSessionFilesById(id, sessionHome = DEFAULT_SESSION_HOME) {
  const files = listSessionFiles(sessionHome);
  return files.filter((filePath) => {
    if (path.basename(filePath).includes(id)) {
      return true;
    }
    const summary = buildSessionSummary(filePath);
    return summary.id === id;
  });
}

function deleteSession(id, options = {}) {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid session id");
  }

  const sessionHome = options.sessionHome || DEFAULT_SESSION_HOME;
  const mode = options.mode === "hard" ? "hard" : "archive";
  const now = options.now || new Date();
  const backupTag = timestampForFile(now);
  const sessionFiles = findSessionFilesById(id, sessionHome);

  if (sessionFiles.length === 0) {
    throw new Error(`Session not found: ${id}`);
  }

  const sessionsRoot = path.join(sessionHome, "sessions");
  const trashDir = mode === "archive" ? path.join(sessionHome, "session-trash", `${backupTag}-${id}`) : null;
  const movedFiles = [];
  const removedFiles = [];

  for (const sourcePath of sessionFiles) {
    if (mode === "hard") {
      fs.unlinkSync(sourcePath);
      removedFiles.push(sourcePath);
    } else {
      const relativePath = path.relative(sessionsRoot, sourcePath);
      const destinationPath = path.join(trashDir, "sessions", relativePath);
      copyThenRemove(sourcePath, destinationPath);
      movedFiles.push({ from: sourcePath, to: destinationPath });
    }
  }

  const indexResult = rewriteJsonlExcluding(
    path.join(sessionHome, "session_index.jsonl"),
    (row) => row.id === id,
    backupTag,
  );
  const historyResult = rewriteJsonlExcluding(
    path.join(sessionHome, "history.jsonl"),
    (row) => row.session_id === id,
    backupTag,
  );

  return {
    deletedId: id,
    mode,
    trashDir,
    movedFiles,
    removedFiles,
    index: indexResult,
    history: historyResult,
  };
}

module.exports = {
  DEFAULT_SESSION_HOME,
  buildSessionDetail,
  buildSessionSummary,
  deleteSession,
  filterSessionsByFolder,
  getSessionFolders,
  readPromptResponsePairs,
  dedupeSessionsById,
  listSessions,
  listSessionFiles,
  readHistoryIndex,
  readSessionIndex,
};
