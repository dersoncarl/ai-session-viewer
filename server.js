const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const {
  DEFAULT_SESSION_HOME,
  buildSessionDetail,
  deleteSession,
  filterSessionsByFolder,
  getSessionFolders,
  listSessions,
} = require("./src/sessionStore");
const { loadAppConfig } = require("./src/config");
const { findAvailablePort } = require("./src/port");

const appRoot = __dirname;
const publicRoot = path.join(appRoot, "public");
const config = loadAppConfig(appRoot, {
  sessionHome: DEFAULT_SESSION_HOME,
  port: 8787,
  cacheTtlMs: 5000,
  deleteMode: "archive",
});
const sessionHome = config.sessionHome;
const deleteMode = config.deleteMode;
const preferredPort = config.port;
const host = "127.0.0.1";
const runtimePath = path.join(appRoot, ".runtime.json");
const urlPath = path.join(appRoot, ".url");
const cacheTtlMs = config.cacheTtlMs;
let datasetCache = null;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy(new Error("Body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function invalidateDataset() {
  datasetCache = null;
}

function getDataset() {
  const now = Date.now();
  if (datasetCache && now - datasetCache.loadedAt < cacheTtlMs) {
    return datasetCache.value;
  }

  const allSessions = listSessions({ sessionHome });
  const folders = getSessionFolders(allSessions);
  const value = { allSessions, folders };
  datasetCache = { loadedAt: now, value };
  return value;
}

function apiSessions(request, response, url) {
  const query = (url.searchParams.get("query") || "").trim().toLowerCase();
  const selectedFolder = url.searchParams.get("folder") || "";
  const { allSessions, folders } = getDataset();
  const sessions = filterSessionsByFolder(allSessions, selectedFolder)
    .filter((session) => {
      if (!query) {
        return true;
      }
      const haystack = [
        session.title,
        session.id,
        session.cwd,
        session.firstUserMessage,
        session.lastUserMessage,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });

  sendJson(response, 200, {
    sessionHome,
    deleteMode,
    selectedFolder,
    folders,
    total: sessions.length,
    sessions,
  });
}

async function apiDeleteSession(request, response, id) {
  await readBody(request);
  const result = deleteSession(id, { sessionHome, mode: deleteMode });
  invalidateDataset();
  sendJson(response, 200, result);
}

function apiSessionDetail(response, id) {
  const { allSessions } = getDataset();
  const session = allSessions.find((item) => item.id === id);
  if (!session) {
    sendError(response, 404, "Session not found");
    return;
  }
  sendJson(response, 200, buildSessionDetail(session));
}

function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicRoot, relativePath);

  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    sendError(response, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendError(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, sessionHome, deleteMode });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/sessions") {
      apiSessions(request, response, url);
      return;
    }

    const deleteMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === "GET" && deleteMatch) {
      apiSessionDetail(response, decodeURIComponent(deleteMatch[1]));
      return;
    }
    if (request.method === "DELETE" && deleteMatch) {
      await apiDeleteSession(request, response, decodeURIComponent(deleteMatch[1]));
      return;
    }

    if (request.method === "GET") {
      serveStatic(response, url.pathname);
      return;
    }

    sendError(response, 405, "Method not allowed");
  } catch (error) {
    sendError(response, 500, error.message || "Internal server error");
  }
});

async function start() {
  const port = await findAvailablePort(preferredPort);
  const url = `http://${host}:${port}`;

  server.listen(port, host, () => {
    const runtime = {
      url,
      host,
      port,
      sessionHome,
      deleteMode,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
    fs.writeFileSync(urlPath, `${url}\n`);
    console.log(`AI Session Viewer: ${url}`);
    console.log(`SESSION_HOME: ${sessionHome}`);
    console.log(`DELETE_MODE: ${deleteMode}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
