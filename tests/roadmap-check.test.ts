import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadScript() {
  const scriptPath = path.join(process.cwd(), "scripts", "roadmap-check.mjs");
  const href = pathToFileURL(scriptPath).href;
  const dynamicImport = new Function("specifier", "return import(specifier);");
  return dynamicImport(href);
}

function writeRoadmap(root: string, content: string) {
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "roadmap.yml"), content);
}

test("roadmap checker handles files, http, and sql checks", async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-check-"));
  const sqlQuery = "select 1";

  const server = http.createServer((req, res) => {
    if (req.url === "/http") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok marker");
      return;
    }
    if (req.url === "/sql") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (req.headers["x-test-header"] !== "pass") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "missing header" }));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body || "null");
        } catch (err) {
          parsed = null;
        }
        if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).symbol === sqlQuery) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              results: {
                [sqlQuery]: { ok: true },
              },
            }),
          );
          return;
        }
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "try again" }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(() => {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  fs.writeFileSync(path.join(tmpRoot, "exists.txt"), "hello", "utf8");

  writeRoadmap(
    tmpRoot,
    `weeks:\n  - id: week-1\n    title: Demo\n    items:\n      - id: item-1\n        name: Example\n        checks:\n          - type: files_exist\n            files:\n              - exists.txt\n          - type: http_ok\n            url: ${baseUrl}/http\n            must_match:\n              - marker\n          - type: sql_exists\n            query: ${JSON.stringify(sqlQuery)}\n`,
  );

  const { runRoadmapChecks } = await loadScript();
  const quietLogger = { log() {}, error() {} };
  const env = {
    READ_ONLY_CHECKS_URL: `${baseUrl}/sql`,
    READ_ONLY_CHECKS_HEADERS: "{\"x-test-header\":\"pass\"}",
  };

  const { status, failures, statusPath } = await runRoadmapChecks({
    projectRoot: tmpRoot,
    env,
    logger: quietLogger,
  });

  assert.equal(failures, 0);
  const item = status.weeks[0].items[0];
  assert.equal(item.done, true);
  assert.equal(item.checks.length, 3);
  assert.deepEqual(
    item.checks.map((c: any) => c.status),
    ["pass", "pass", "pass"],
  );

  const written = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.ok(written.weeks[0].items[0].checks);
  assert.ok(written.weeks[0].items[0].results);
});

test("sql_exists surfaces unreachable probe failures", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-check-"));
  const docsDir = path.join(tmpRoot, "docs");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(
    path.join(docsDir, "roadmap.yml"),
    `weeks:\n  - id: err\n    items:\n      - id: probe\n        checks:\n          - type: sql_exists\n            query: unreachable\n`,
  );

  const { port } = await new Promise<AddressInfo>((resolve) => {
    const temp = http.createServer();
    temp.listen(0, "127.0.0.1", () => {
      const info = temp.address() as AddressInfo;
      temp.close(() => resolve(info));
    });
  });

  const badUrl = `http://127.0.0.1:${port}/sql`;
  const { runRoadmapChecks } = await loadScript();
  const quietLogger = { log() {}, error() {} };

  const { status, failures } = await runRoadmapChecks({
    projectRoot: tmpRoot,
    env: { READ_ONLY_CHECKS_URL: badUrl },
    logger: quietLogger,
  });

  assert.equal(failures, 1);
  const check = status.weeks[0].items[0].checks[0];
  assert.equal(check.status, "fail");
  assert.ok(typeof check.error === "string" && check.error.length > 0);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
