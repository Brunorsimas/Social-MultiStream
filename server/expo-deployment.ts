import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizePublicHost,
  resolvePublicOrigin,
  type PublicOrigin,
} from "./security.ts";

export const EXPO_PUBLIC_ORIGIN_PLACEHOLDER =
  "https://expo-public-origin.invalid";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstValidDomain(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (normalizePublicHost(value)) return value!.trim();
  }
  return null;
}

export function selectExpoPublicDomain(
  environment: Environment = process.env,
): string | null {
  const publicDomains = environment.REPLIT_DOMAINS?.split(",").map((domain) =>
    domain.trim(),
  );
  const published =
    environment.REPLIT_DEPLOYMENT === "1" ||
    environment.NODE_ENV === "production";

  return firstValidDomain([
    environment.EXPO_PUBLIC_DOMAIN,
    ...(publicDomains ?? []),
    ...(published
      ? []
      : [
          environment.REPLIT_DEV_DOMAIN,
          environment.REPLIT_INTERNAL_APP_DOMAIN,
        ]),
  ]);
}

export function resolveExpoPublicOrigin(
  environment: Environment,
  requestHost?: string | null,
  requestProtocol?: string | null,
): PublicOrigin {
  const configuredDomain = selectExpoPublicDomain(environment);
  return resolvePublicOrigin(
    configuredDomain,
    requestHost,
    requestProtocol,
  );
}

function lastForwardedValue(value?: string | null): string | null {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.at(-1) ?? null;
}

export function resolveExpoRequestOrigin(
  environment: Environment,
  requestHost?: string | null,
  requestProtocol?: string | null,
  forwardedHost?: string | null,
  forwardedProtocol?: string | null,
): PublicOrigin {
  const proxyHost = lastForwardedValue(forwardedHost);
  const safeProxyHost = normalizePublicHost(proxyHost) ? proxyHost : null;
  const proxyProtocol = lastForwardedValue(forwardedProtocol);
  const safeProxyProtocol =
    proxyProtocol === "http" || proxyProtocol === "https"
      ? proxyProtocol
      : null;

  return resolveExpoPublicOrigin(
    environment,
    safeProxyHost ?? requestHost,
    safeProxyProtocol ?? requestProtocol,
  );
}

export type MetroProxyHeaders = {
  host: string;
  forwardedHost: string;
  forwardedProto: "http" | "https";
};

export function resolveMetroProxyHeaders(
  environment: Environment,
  requestHost?: string | null,
  requestProtocol?: string | null,
): MetroProxyHeaders {
  const publicOrigin =
    resolveExpoPublicOrigin(environment, requestHost, requestProtocol) ??
    resolvePublicOrigin(null, requestHost, requestProtocol);

  return {
    host: publicOrigin.host,
    forwardedHost: publicOrigin.host,
    forwardedProto: publicOrigin.protocol,
  };
}

function rebaseUrl(value: unknown, origin: string): string {
  if (typeof value !== "string") {
    throw new Error("Expo manifest contains a non-string asset URL");
  }

  let url: URL;
  try {
    url = new URL(value, EXPO_PUBLIC_ORIGIN_PLACEHOLDER);
  } catch {
    throw new Error("Expo manifest contains an invalid asset URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Expo manifest contains an unsupported asset URL");
  }

  return `${origin}${url.pathname}${url.search}${url.hash}`;
}

function isLocalOrPlaceholderHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === new URL(EXPO_PUBLIC_ORIGIN_PLACEHOLDER).hostname
  );
}

function normalizePublishedAssetPath(pathname: string): string {
  if (pathname.startsWith("/assets/assets/")) {
    return pathname.slice("/assets".length);
  }
  return pathname;
}

function rewriteLocalManifestUrls(
  value: unknown,
  publicOrigin: PublicOrigin,
): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (typeof item === "string") {
        value[index] = rewriteLocalManifestUrl(item, publicOrigin);
      } else {
        rewriteLocalManifestUrls(item, publicOrigin);
      }
    }
    return;
  }

  if (!isObject(value)) return;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      value[key] = rewriteLocalManifestUrl(item, publicOrigin);
    } else {
      rewriteLocalManifestUrls(item, publicOrigin);
    }
  }
}

function rewriteLocalManifestUrl(
  value: string,
  publicOrigin: PublicOrigin,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !isLocalOrPlaceholderHost(url.hostname)
  ) {
    return value;
  }

  const pathname = normalizePublishedAssetPath(url.pathname);
  return `${publicOrigin.origin}${pathname}${url.search}${url.hash}`;
}

function getNestedValue(root: JsonObject, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setNestedValue(root: JsonObject, path: string[], value: string): void {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(current[segment])) current[segment] = {};
    current = current[segment] as JsonObject;
  }
  current[path.at(-1)!] = value;
}

function addDevelopmentConfigAssetUrls(
  expoClient: JsonObject,
  platform: "ios" | "android",
  publicOrigin: PublicOrigin,
): void {
  const assetFields: Array<[string[], string[]]> = [
    [["icon"], ["iconUrl"]],
    [["splash", "image"], ["splash", "imageUrl"]],
    [
      ["android", "adaptiveIcon", "foregroundImage"],
      ["android", "adaptiveIcon", "foregroundImageUrl"],
    ],
    [
      ["android", "adaptiveIcon", "backgroundImage"],
      ["android", "adaptiveIcon", "backgroundImageUrl"],
    ],
    [
      ["android", "adaptiveIcon", "monochromeImage"],
      ["android", "adaptiveIcon", "monochromeImageUrl"],
    ],
  ];

  for (const [sourcePath, outputPath] of assetFields) {
    const source = getNestedValue(expoClient, sourcePath);
    if (
      typeof source !== "string" ||
      !source.startsWith("./") ||
      source.includes("..") ||
      /[?#\\]/.test(source)
    ) {
      continue;
    }
    const assetPath = source
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    setNestedValue(
      expoClient,
      outputPath,
      `${publicOrigin.origin}/assets/${assetPath}?platform=${platform}`,
    );
  }
}

export function prepareExpoManifest(
  input: unknown,
  platform: "ios" | "android",
  publicOrigin: PublicOrigin,
): JsonObject {
  if (!isObject(input)) {
    throw new Error(`Malformed Expo manifest for ${platform}`);
  }

  const manifest = structuredClone(input);
  rewriteLocalManifestUrls(manifest, publicOrigin);

  if (!isObject(manifest.launchAsset)) {
    throw new Error(`Expo manifest has no launch asset for ${platform}`);
  }

  const launchUrl = rebaseUrl(manifest.launchAsset.url, publicOrigin.origin);
  const launchPath = new URL(launchUrl).pathname;
  const expectedSuffix = `/_expo/static/js/${platform}/bundle.js`;
  if (!launchPath.endsWith(expectedSuffix)) {
    throw new Error(`Expo launch asset does not match ${platform}`);
  }

  manifest.launchAsset.url = launchUrl;
  manifest.launchAsset.contentType = "application/javascript";

  if (Array.isArray(manifest.assets)) {
    for (const asset of manifest.assets) {
      if (!isObject(asset) || typeof asset.url !== "string") continue;

      const parsedAssetUrl = new URL(
        asset.url,
        EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
      );
      if (
        parsedAssetUrl.host ===
          new URL(EXPO_PUBLIC_ORIGIN_PLACEHOLDER).host ||
        parsedAssetUrl.pathname.includes("/_expo/static/js/")
      ) {
        asset.url = rebaseUrl(asset.url, publicOrigin.origin);
      }
    }
  }

  if (!isObject(manifest.extra)) manifest.extra = {};

  const extra = manifest.extra as JsonObject;
  if (!isObject(extra.expoClient)) extra.expoClient = {};
  const expoClient = extra.expoClient as JsonObject;
  expoClient.hostUri = publicOrigin.host;
  delete expoClient._internal;

  if (!isObject(extra.expoGo)) extra.expoGo = {};
  const expoGo = extra.expoGo as JsonObject;
  expoGo.debuggerHost = publicOrigin.host;
  if (isObject(expoGo.developer)) {
    delete expoGo.developer.projectRoot;
  }
  if (!isObject(expoGo.packagerOpts)) {
    expoGo.packagerOpts = {};
  }
  (expoGo.packagerOpts as JsonObject).dev = false;

  return manifest;
}

export function prepareExpoDevelopmentManifest(
  input: unknown,
  platform: "ios" | "android",
  publicOrigin: PublicOrigin,
): JsonObject {
  if (!isObject(input)) {
    throw new Error(`Malformed Expo development manifest for ${platform}`);
  }

  const manifest = structuredClone(input);
  rewriteLocalManifestUrls(manifest, publicOrigin);

  if (!isObject(manifest.launchAsset)) {
    throw new Error(`Expo development manifest has no launch asset for ${platform}`);
  }
  manifest.launchAsset.url = rebaseUrl(
    manifest.launchAsset.url,
    publicOrigin.origin,
  );
  manifest.launchAsset.contentType = "application/javascript";

  if (Array.isArray(manifest.assets)) {
    for (const asset of manifest.assets) {
      if (!isObject(asset) || typeof asset.url !== "string") continue;
      asset.url = rebaseUrl(asset.url, publicOrigin.origin);
    }
  }

  if (!isObject(manifest.extra)) manifest.extra = {};
  const extra = manifest.extra as JsonObject;

  if (!isObject(extra.expoClient)) extra.expoClient = {};
  const expoClient = extra.expoClient as JsonObject;
  expoClient.hostUri = publicOrigin.host;
  delete expoClient._internal;
  addDevelopmentConfigAssetUrls(expoClient, platform, publicOrigin);

  if (!isObject(extra.expoGo)) extra.expoGo = {};
  const expoGo = extra.expoGo as JsonObject;
  expoGo.debuggerHost = publicOrigin.host;
  if (isObject(expoGo.developer)) {
    delete expoGo.developer.projectRoot;
  }

  return manifest;
}

export function injectExpoPublicOrigin(
  bundle: string,
  publicOrigin: PublicOrigin,
): string {
  if (!bundle.includes(EXPO_PUBLIC_ORIGIN_PLACEHOLDER)) {
    throw new Error("Expo bundle has no public-origin placeholder");
  }

  return bundle.replaceAll(
    EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
    publicOrigin.origin,
  );
}

export function validateExpoBuild(buildRoot: string): void {
  for (const platform of ["ios", "android"] as const) {
    const manifestPath = path.join(buildRoot, platform, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Missing Expo manifest for ${platform}`);
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      throw new Error(`Invalid Expo manifest JSON for ${platform}`);
    }

    if (!isObject(manifest) || !isObject(manifest.launchAsset)) {
      throw new Error(`Malformed Expo manifest for ${platform}`);
    }

    const launchAssetUrl = manifest.launchAsset.url;
    if (typeof launchAssetUrl !== "string") {
      throw new Error(`Missing Expo launch asset URL for ${platform}`);
    }

    const launchPath = new URL(
      launchAssetUrl,
      EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
    ).pathname;
    const relativeLaunchPath = launchPath.replace(/^\/+/, "");
    const bundlePath = path.resolve(buildRoot, relativeLaunchPath);
    const relativeToRoot = path.relative(buildRoot, bundlePath);

    if (
      relativeToRoot.startsWith("..") ||
      path.isAbsolute(relativeToRoot) ||
      !fs.existsSync(bundlePath) ||
      fs.statSync(bundlePath).size === 0
    ) {
      throw new Error(`Missing Expo launch bundle for ${platform}`);
    }

    const bundle = fs.readFileSync(bundlePath, "utf-8");
    if (!bundle.includes(EXPO_PUBLIC_ORIGIN_PLACEHOLDER)) {
      throw new Error(
        `Expo launch bundle has no public-origin placeholder for ${platform}`,
      );
    }
  }
}
