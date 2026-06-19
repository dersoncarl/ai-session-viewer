const assert = require("node:assert/strict");
const net = require("node:net");
const test = require("node:test");

const { findAvailablePort } = require("../src/port");

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("findAvailablePort returns preferred port when available", async () => {
  const port = await findAvailablePort(0);

  assert.equal(Number.isInteger(port), true);
  assert.equal(port > 0, true);
});

test("findAvailablePort skips a used preferred port", async () => {
  const server = await listen(0);
  const usedPort = server.address().port;

  try {
    const port = await findAvailablePort(usedPort, usedPort + 3);
    assert.notEqual(port, usedPort);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
