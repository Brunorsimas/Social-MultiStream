import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import {
  buildContentSecurityPolicy,
  escapeHtml,
  normalizePublicHost,
  resolvePublicOrigin,
} from "./security";
import {
  injectExpoPublicOrigin,
  prepareExpoDevelopmentManifest,
  prepareExpoManifest,
  resolveExpoRequestOrigin,
  resolveMetroProxyHeaders,
  validateExpoBuild,
} from "./expo-deployment";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "node:crypto";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createQrCodeSvg } from "./qr-code";

const app = express();
const log = console.log;
const expoBundleCache = new Map<
  string,
  { mtimeMs: number; content: Buffer }
>();
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

function getRequestPublicOrigin(req: Request) {
  return resolveExpoRequestOrigin(
    process.env,
    req.get("host"),
    req.protocol,
    req.get("x-forwarded-host"),
    req.get("x-forwarded-proto"),
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

function getProxyRequestPublicOrigin(req: {
  headers: Record<string, string | string[] | undefined>;
  socket: object;
}) {
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted;
  return resolveExpoRequestOrigin(
    process.env,
    headerValue(req.headers.host),
    encrypted ? "https" : "http",
    headerValue(req.headers["x-forwarded-host"]),
    headerValue(req.headers["x-forwarded-proto"]),
  );
}

function copyExpoResponseHeaders(
  source: globalThis.Response,
  destination: Response,
) {
  for (const name of [
    "expo-protocol-version",
    "expo-sfv-version",
    "cache-control",
  ]) {
    const value = source.headers.get(name);
    if (value) destination.setHeader(name, value);
  }
}

async function serveDevelopmentExpoManifest(
  metroPort: number,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const platform =
    req.header("expo-platform") ??
    (typeof req.query.platform === "string" ? req.query.platform : undefined);
  const isManifestPath =
    req.path === "/" || req.path === "/manifest" || req.path === "/index.exp";
  if (!isManifestPath || (platform !== "ios" && platform !== "android")) {
    next();
    return;
  }

  try {
    const upstreamHeaders: Record<string, string> = {};
    for (const name of [
      "accept",
      "expo-platform",
      "expo-protocol-version",
      "user-agent",
    ]) {
      const value = req.header(name);
      if (value) upstreamHeaders[name] = value;
    }

    const upstream = await fetch(
      `http://127.0.0.1:${metroPort}${req.originalUrl}`,
      {
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(120_000),
      },
    );
    const body = await upstream.text();
    copyExpoResponseHeaders(upstream, res);

    if (!upstream.ok) {
      res.status(upstream.status).type("text/plain").send(body);
      return;
    }

    const manifest = prepareExpoDevelopmentManifest(
      JSON.parse(body),
      platform,
      getRequestPublicOrigin(req),
    );
    res
      .status(200)
      .type("application/expo+json")
      .setHeader("cache-control", "no-store");
    res.send(JSON.stringify(manifest));
  } catch (error) {
    next(error);
  }
}

function serveExpoManifest(
  platform: "ios" | "android",
  req: Request,
  res: Response,
) {
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

  const publicOrigin = getRequestPublicOrigin(req);
  if (!publicOrigin) {
    return res.status(503).json({ error: "Public deployment domain unavailable" });
  }

  const manifest = prepareExpoManifest(
    JSON.parse(fs.readFileSync(manifestPath, "utf-8")),
    platform,
    publicOrigin,
  );

  res.setHeader("expo-protocol-version", "0");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "private, max-age=0");

  res.status(200).send(JSON.stringify(manifest));
}

function serveExpoBundle(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();

  const match = req.path.match(
    /^\/(\d+-\d+)\/_expo\/static\/js\/(ios|android)\/bundle\.js$/,
  );
  if (!match) return next();

  const bundlePath = path.resolve(
    process.cwd(),
    "static-build",
    match[1],
    "_expo",
    "static",
    "js",
    match[2],
    "bundle.js",
  );
  if (!fs.existsSync(bundlePath)) return next();

  const publicOrigin = getRequestPublicOrigin(req);
  if (!publicOrigin) {
    return res.status(503).json({ error: "Public deployment domain unavailable" });
  }

  const cacheKey = `${bundlePath}\0${publicOrigin.origin}`;
  const mtimeMs = fs.statSync(bundlePath).mtimeMs;
  let cachedBundle = expoBundleCache.get(cacheKey);

  if (!cachedBundle || cachedBundle.mtimeMs !== mtimeMs) {
    cachedBundle = {
      mtimeMs,
      content: Buffer.from(
        injectExpoPublicOrigin(
          fs.readFileSync(bundlePath, "utf-8"),
          publicOrigin,
        ),
      ),
    };
    expoBundleCache.delete(cacheKey);
    expoBundleCache.set(cacheKey, cachedBundle);

    while (expoBundleCache.size > 4) {
      const oldestKey = expoBundleCache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      expoBundleCache.delete(oldestKey);
    }
  }

  res.setHeader(
    "content-type",
    "application/javascript; charset=utf-8",
  );
  res.setHeader("cache-control", "private, max-age=0");
  res.setHeader("content-length", cachedBundle.content.length);
  res.status(200).send(cachedBundle.content);
}

async function serveLandingPage({
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
  const { host, origin: baseUrl } = getRequestPublicOrigin(req);
  const expsUrl = host;
  const deepLink = `exps://${expsUrl}`;
  const cspNonce = randomBytes(18).toString("base64");
  const qrCodeSvg = await createQrCodeSvg(deepLink);

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/QR_CODE_PLACEHOLDER/g, qrCodeSvg)
    .replace(/APP_NAME_PLACEHOLDER/g, escapeHtml(appName))
    .replace(/CSP_NONCE_PLACEHOLDER/g, cspNonce);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    buildContentSecurityPolicy(cspNonce),
  );
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const buildRoot = path.resolve(process.cwd(), "static-build");
  validateExpoBuild(buildRoot);

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

    if (
      req.path !== "/" &&
      req.path !== "/manifest" &&
      req.path !== "/index.exp"
    ) {
      return next();
    }

    const platform =
      req.header("expo-platform") ??
      (typeof req.query.platform === "string"
        ? req.query.platform
        : undefined);
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, req, res);
    }

    if (req.path === "/") {
      void serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      }).catch(next);
      return;
    }

    next();
  });

  app.use(serveExpoBundle);
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(buildRoot));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function configureDevelopmentMetroProxy(app: express.Application) {
  const metroPort = Number.parseInt(
    process.env.EXPO_METRO_PORT || "8081",
    10,
  );
  if (
    !Number.isInteger(metroPort) ||
    metroPort < 1 ||
    metroPort > 65535
  ) {
    throw new Error("EXPO_METRO_PORT must be a valid TCP port");
  }

  const metroProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${metroPort}`,
    ws: true,
    changeOrigin: false,
    // Do not ask the proxy library to create another forwarded-header layer.
    // The hooks below also replace any comma-separated values already supplied
    // by upstream Replit proxies before Metro attempts to construct a URL.
    xfwd: false,
    on: {
      proxyReq: (proxyReq, req) => {
        const requestOrigin = getProxyRequestPublicOrigin(req);
        const headers = resolveMetroProxyHeaders(
          process.env,
          requestOrigin.host,
          requestOrigin.protocol,
        );
        proxyReq.setHeader("host", headers.host);
        proxyReq.setHeader("x-forwarded-host", headers.forwardedHost);
        proxyReq.setHeader("x-forwarded-proto", headers.forwardedProto);
      },
      proxyReqWs: (proxyReq, req) => {
        const requestOrigin = getProxyRequestPublicOrigin(req);
        const headers = resolveMetroProxyHeaders(
          process.env,
          requestOrigin.host,
          requestOrigin.protocol,
        );
        proxyReq.setHeader("host", headers.host);
        proxyReq.setHeader("x-forwarded-host", headers.forwardedHost);
        proxyReq.setHeader("x-forwarded-proto", headers.forwardedProto);
      },
    },
    // At "/" we only proxy if the request is from Expo Go (has expo-platform header).
    // Browser requests to "/" skip the proxy so the landing page with QR code is shown.
    // "/api" and "/healthz" are always handled by the Express app itself.
    pathFilter: (pathname, req) => {
      if (!pathname.startsWith("/api") && pathname !== "/healthz") {
        if (pathname === "/") {
          const platform = (req as { headers?: Record<string, string | string[] | undefined> }).headers?.["expo-platform"];
          return platform === "ios" || platform === "android";
        }
        return true;
      }
      return false;
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    void serveDevelopmentExpoManifest(metroPort, req, res, next);
  });
  app.use(metroProxy);
  return metroProxy;
}

function configureUnavailableExpo(
  app: express.Application,
  startupError: unknown,
) {
  const diagnostic =
    startupError instanceof Error ? startupError.message : String(startupError);
  console.error(`Expo static build unavailable: ${diagnostic}`);

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.path !== "/" &&
      req.path !== "/manifest" &&
      req.path !== "/index.exp"
    ) {
      next();
      return;
    }

    res.status(503).json({
      error: "Expo build unavailable",
      retryable: false,
    });
  });
}

function configureDevelopmentLandingPage(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  if (!fs.existsSync(templatePath)) return;

  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  app.get("/", (req: Request, res: Response, next: NextFunction) => {
    void serveLandingPage({ req, res, landingPageTemplate, appName }).catch(
      next,
    );
  });
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

  let expoStatus =
    process.env.NODE_ENV === "production" ? "static" : "metro-proxy";

  app.get("/healthz", (_req, res) => {
    res.status(200).json({
      status: "ok",
      expo: expoStatus,
    });
  });

  const metroProxy =
    process.env.NODE_ENV === "production"
      ? null
      : configureDevelopmentMetroProxy(app);

  if (process.env.NODE_ENV === "production") {
    try {
      configureExpoAndLanding(app);
    } catch (error) {
      expoStatus = "static-unavailable";
      configureUnavailableExpo(app, error);
    }
  } else {
    // Serve the landing page with QR code at "/" in dev mode.
    // The Metro proxy above skips "/" so this handler is reached.
    configureDevelopmentLandingPage(app);
  }

  const server = await registerRoutes(app);

  if (metroProxy) {
    server.on("upgrade", metroProxy.upgrade);
  }

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
