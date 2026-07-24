import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import {
  buildContentSecurityPolicy,
  escapeHtml,
  normalizePublicHost,
  resolvePublicOrigin,
} from "./security";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "node:crypto";

const app = express();
const log = console.log;
app.disable("x-powered-by");

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    const addConfiguredOrigin = (value?: string) => {
      if (!normalizePublicHost(value)) return;
      origins.add(resolvePublicOrigin(value).origin);
    };

    addConfiguredOrigin(process.env.REPLIT_INTERNAL_APP_DOMAIN);
    addConfiguredOrigin(process.env.REPLIT_DEV_DOMAIN);
    addConfiguredOrigin(process.env.EXPO_PUBLIC_DOMAIN);

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        addConfiguredOrigin(d);
      });
    }

    const origin = req.header("origin");

    let isLocalhost = false;
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        isLocalhost =
          (parsedOrigin.protocol === "http:" ||
            parsedOrigin.protocol === "https:") &&
          (parsedOrigin.hostname === "localhost" ||
            parsedOrigin.hostname === "127.0.0.1" ||
            parsedOrigin.hostname === "::1") &&
          parsedOrigin.origin === origin;
      } catch {}
    }

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.vary("Origin");
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupSecurityHeaders(app: express.Application) {
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "100kb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const configuredDomain =
    process.env.REPLIT_INTERNAL_APP_DOMAIN ??
    process.env.REPLIT_DEV_DOMAIN ??
    process.env.REPLIT_DOMAINS?.split(",")[0] ??
    process.env.EXPO_PUBLIC_DOMAIN;
  if (
    process.env.NODE_ENV === "production" &&
    !normalizePublicHost(configuredDomain)
  ) {
    res.status(503).type("text/plain").send("Service unavailable");
    return;
  }
  const { host, origin: baseUrl } = resolvePublicOrigin(
    configuredDomain,
    req.get("host"),
    req.protocol,
  );
  const expsUrl = host;
  const cspNonce = randomBytes(18).toString("base64");

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName))
    .replace(/CSP_NONCE_PLACEHOLDER/g, cspNonce);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    buildContentSecurityPolicy(cspNonce),
  );
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const candidateStatus = error.status || error.statusCode;
    const status =
      Number.isInteger(candidateStatus) &&
      Number(candidateStatus) >= 400 &&
      Number(candidateStatus) <= 599
        ? Number(candidateStatus)
        : 500;
    const message =
      status >= 500
        ? "Internal Server Error"
        : error.message || "Request failed";

    if (status >= 500) {
      const diagnostic =
        err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error";
      console.error(
        `${req.method} ${req.path} failed: ${diagnostic
          .replace(/[\r\n]/g, " ")
          .slice(0, 500)}`,
      );
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

async function startServer() {
  setupSecurityHeaders(app);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      ...(process.platform === "win32" ? {} : { reusePort: true }),
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );
  return server;
}

export const serverPromise = startServer();
