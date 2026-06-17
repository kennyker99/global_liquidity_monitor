import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { scheduleDataRefresh } from "../dataFetcher";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // CDS 代理：转发 worldgovernmentbonds.com 请求（服务端绕过 CORS）
  app.get("/api/cds-proxy", async (_req, res) => {
    try {
      const https = await import("https");
      const zlib = await import("zlib");
      const url = "https://www.worldgovernmentbonds.com/cds-historical-data/united-states/5-years/";
      const options = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
        },
      };
      const request = https.default.get(url, options, (response: any) => {
        let output: any;
        const encoding = response.headers["content-encoding"];
        if (encoding === "gzip") output = response.pipe(zlib.createGunzip());
        else if (encoding === "br") output = response.pipe(zlib.createBrotliDecompress());
        else if (encoding === "deflate") output = response.pipe(zlib.createInflate());
        else output = response;
        let data = "";
        output.on("data", (chunk: any) => (data += chunk.toString()));
        output.on("end", () => {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.send(data);
        });
      });
      request.on("error", (err: any) => {
        console.error("[CDS Proxy] Error:", err.message);
        res.status(500).json({ error: err.message });
      });
      request.setTimeout(10000, () => {
        request.destroy();
        res.status(504).json({ error: "timeout" });
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // 自动建表
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (db) {
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS \`liquidity_indicators\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`indicatorType\` varchar(64) NOT NULL,
        \`fredSeriesId\` varchar(64),
        \`observationDate\` varchar(10) NOT NULL,
        \`currentValue\` varchar(255) NOT NULL,
        \`previousValue\` varchar(255),
        \`changeValue\` varchar(255),
        \`changePercent\` varchar(255),
        \`unit\` varchar(64) NOT NULL,
        \`frequency\` varchar(32) NOT NULL,
        \`riskLevel\` enum('normal','caution','warning') NOT NULL DEFAULT 'normal',
        \`riskDescription\` text,
        \`dataSource\` varchar(64) NOT NULL,
        \`lastUpdatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`liquidity_indicators_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`liquidity_indicators_indicatorType_unique\` UNIQUE(\`indicatorType\`)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS \`indicator_history\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`indicatorType\` varchar(64) NOT NULL,
        \`observationDate\` varchar(10) NOT NULL,
        \`value\` varchar(255) NOT NULL,
        \`unit\` varchar(64) NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`indicator_history_id\` PRIMARY KEY(\`id\`)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS \`data_update_log\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`indicatorType\` varchar(64) NOT NULL,
        \`status\` varchar(32) NOT NULL,
        \`errorMessage\` text,
        \`recordsUpdated\` int DEFAULT 0,
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`data_update_log_id\` PRIMARY KEY(\`id\`)
      )`);
      console.log("[Database] Tables initialized successfully");
    }
  } catch (err) {
    console.warn("[Database] Table initialization failed:", err);
  }

  // 初始化 FRED 数据获取器
  const fredApiKey = process.env.FRED_API_KEY;
  if (fredApiKey) {
    scheduleDataRefresh(fredApiKey);
  } else {
    console.warn("[DataFetcher] FRED_API_KEY not set, skipping data refresh");
  }
}

startServer().catch(console.error);
