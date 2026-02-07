import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      // Match Next.js standalone default bind (0.0.0.0) so
      // we don't pick a port that's only free on loopback.
      .listen(port, "0.0.0.0");
  });
}

async function findFreePort({ startPort = 3000, maxAttempts = 25 } = {}) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = startPort + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a free port starting at ${startPort} after ${maxAttempts} attempts`,
  );
}

function log(msg) {
  process.stdout.write(`[e2e] ${msg}\n`);
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${cmd} exited via signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${cmd} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function waitForHealthz({ timeoutMs = 60_000 } = {}) {
  const url = new URL("/api/healthz", process.env.TEST_API_URL).toString();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        return;
      }
    } catch {
      // ignore
    }

    await sleep(750);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  let server;
  let baseUrl = process.env.TEST_API_URL;

  // If the user points to an external server, don't start/stop one locally.
  const shouldStartServer =
    !process.env.TEST_API_URL || process.env.E2E_START_SERVER === "true";

  try {
    if (!baseUrl) {
      const port = await findFreePort({ startPort: 3000 });
      baseUrl = `http://localhost:${port}`;
      process.env.TEST_API_URL = baseUrl;
    }

    log(`Target base URL: ${baseUrl}`);
    await run("npm", ["run", "generate:indexes"]);

    if (shouldStartServer) {
      log("Building backend (standalone)…");
      await run("npm", ["run", "build:backend"]);

      log("Starting Next.js server…");
      const port = new URL(baseUrl).port;
      const localServerEnv = {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "test",
        PORT: process.env.PORT ?? port,
        HOSTNAME: process.env.HOSTNAME ?? "0.0.0.0",
        // Keep local E2E deterministic and independent from external infra.
        RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED ?? "0",
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        REDIS_URL: process.env.REDIS_URL ?? "",
      };

      server = spawn("npm", ["run", "start"], {
        stdio: "inherit",
        env: localServerEnv,
      });

      await waitForHealthz({ timeoutMs: 90_000 });
    } else {
      log("Using external server; skipping local start.");
      await waitForHealthz({ timeoutMs: 30_000 });
    }

    log("Running Vitest E2E suite…");
    await run(
      "npx",
      ["vitest", "run", "--run", "tests/e2e"],
      {
        env: {
          ...process.env,
          TEST_API_URL: baseUrl,
          SKIP_E2E_IF_SERVER_DOWN: "false",
        },
      },
    );

    log("E2E suite passed.");
  } finally {
    if (server) {
      log("Stopping Next.js server…");
      server.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
