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

  // 初始化 FRED 数据获取器
  const fredApiKey = process.env.FRED_API_KEY;
  if (fredApiKey) {
    scheduleDataRefresh(fredApiKey);
  } else {
    console.warn("[DataFetcher] FRED_API_KEY not set, skipping data refresh");
  }
}

startServer().catch(console.error);
