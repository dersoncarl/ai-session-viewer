const net = require("node:net");

function canListen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(preferredPort = 8787, maxPort = preferredPort + 100, host = "127.0.0.1") {
  if (preferredPort === 0) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, host, () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
  }

  for (let port = preferredPort; port <= maxPort; port += 1) {
    if (await canListen(port, host)) {
      return port;
    }
  }

  throw new Error(`No available port between ${preferredPort} and ${maxPort}`);
}

module.exports = {
  canListen,
  findAvailablePort,
};
