const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

let metroProcess = null;
const PUBLIC_ORIGIN_PLACEHOLDER =
  "https://expo-public-origin.invalid";
const configuredMetroPort = Number.parseInt(
  process.env.EXPO_METRO_PORT || "8081",
  10,
);

if (
  !Number.isInteger(configuredMetroPort) ||
  configuredMetroPort < 1 ||
  configuredMetroPort > 65535
) {
  console.error("ERROR: EXPO_METRO_PORT must be a valid TCP port");
  process.exit(1);
}

const metroBaseUrl = `http://localhost:${configuredMetroPort}`;

function exitWithError(message) {
  console.error(message);
  if (metroProcess) {
    metroProcess.kill();
  }
  process.exit(1);
}

function setupSignalHandlers() {
  const cleanup = () => {
    if (metroProcess) {
      console.log("Cleaning up Metro process...");
      metroProcess.kill();
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
}

function prepareDirectories(timestamp) {
  console.log("Preparing build directories...");

  if (fs.existsSync("static-build")) {
    fs.rmSync("static-build", { recursive: true });
  }

  const dirs = [
    path.join("static-build", timestamp, "_expo", "static", "js", "ios"),
    path.join("static-build", timestamp, "_expo", "static", "js", "android"),
    path.join("static-build", "ios"),
    path.join("static-build", "android"),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log("Build:", timestamp);
}

function clearMetroCache() {
  console.log("Clearing Metro cache...");

  const cacheDirs = [
    ...fs.globSync(".metro-cache"),
    ...fs.globSync("node_modules/.cache/metro"),
  ];

  for (const dir of cacheDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log("Cache cleared");
}

async function checkMetroHealth() {
  try {
    const response = await fetch(`${metroBaseUrl}/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    return (await response.text()).trim() === "packager-status:running";
  } catch {
    return false;
  }
}

async function startMetro(expoPublicDomain) {
  const isRunning = await checkMetroHealth();
  if (isRunning) {
    console.log("Metro already running");
    return;
  }

  console.log("Starting Metro...");
  console.log(`Setting EXPO_PUBLIC_DOMAIN=${expoPublicDomain}`);
  const env = {
    ...process.env,
    EXPO_OFFLINE: "1",
    EXPO_PUBLIC_DOMAIN: expoPublicDomain,
  };
  const expoCliPath = require.resolve("@expo/cli", {
    paths: [path.resolve(__dirname, "..")],
  });
  metroProcess = spawn(
    process.execPath,
    [
      expoCliPath,
      "start",
      "--no-dev",
      "--minify",
      "--localhost",
      "--clear",
      "--port",
      String(configuredMetroPort),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      env,
    },
  );

  if (metroProcess.stdout) {
    metroProcess.stdout.on("data", (data) => {
      const output = data.toString().trim();
      if (output) console.log(`[Metro] ${output}`);
    });
  }
  if (metroProcess.stderr) {
    metroProcess.stderr.on("data", (data) => {
      const output = data.toString().trim();
      if (output) console.error(`[Metro Error] ${output}`);
    });
  }

  for (let i = 0; i < 180; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (metroProcess.exitCode !== null) {
      throw new Error(
        `Metro exited before becoming ready (code ${metroProcess.exitCode})`,
      );
    }

    const healthy = await checkMetroHealth();
    if (healthy) {
      console.log("Metro ready");
      return;
    }
  }

  throw new Error("Metro did not become ready within 180 seconds");
}

async function formatHttpError(response) {
  let details = "";
  try {
    details = (await response.text()).trim().slice(0, 16_000);
  } catch {}

  return `HTTP ${response.status}${details ? `: ${details}` : ""}`;
}

async function downloadFile(url, outputPath) {
  const controller = new AbortController();
  const fiveMinMS = 5 * 60 * 1_000;
  const timeoutId = setTimeout(() => controller.abort(), fiveMinMS);

  try {
    console.log(`Downloading: ${url}`);
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(await formatHttpError(response));
    }

    const file = fs.createWriteStream(outputPath);
    await pipeline(Readable.fromWeb(response.body), file);

    const fileSize = fs.statSync(outputPath).size;

    if (fileSize === 0) {
      fs.unlinkSync(outputPath);
      throw new Error("Downloaded file is empty");
    }
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    if (error.name === "AbortError") {
      throw new Error(`Download timeout after 5m: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadBundle(platform, timestamp) {
  // For expo-router apps, the entry is node_modules/expo-router/entry
  const url = new URL(
    `${metroBaseUrl}/node_modules/expo-router/entry.bundle`,
  );
  url.searchParams.set("platform", platform);
  url.searchParams.set("dev", "false");
  url.searchParams.set("hot", "false");
  url.searchParams.set("lazy", "false");
  url.searchParams.set("minify", "true");

  const output = path.join(
    "static-build",
    timestamp,
    "_expo",
    "static",
    "js",
    platform,
    "bundle.js",
  );

  console.log(`Fetching ${platform} bundle...`);
  await downloadFile(url.toString(), output);
  console.log(`${platform} bundle ready`);
}

async function downloadManifest(platform) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  try {
    console.log(`Fetching ${platform} manifest...`);
    const response = await fetch(`${metroBaseUrl}/manifest`, {
      headers: { "expo-platform": platform },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await formatHttpError(response));
    }

    const manifest = await response.json();
    console.log(`${platform} manifest ready`);
    return manifest;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        `Manifest download timeout after 5m for platform: ${platform}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadBundlesAndManifests(timestamp) {
  console.log("Downloading bundles and manifests...");
  console.log("This may take several minutes for production builds...");

  try {
    await downloadBundle("ios", timestamp);
    const iosManifest = await downloadManifest("ios");
    await downloadBundle("android", timestamp);
    const androidManifest = await downloadManifest("android");

    console.log("All downloads completed successfully");
    return { ios: iosManifest, android: androidManifest };
  } catch (error) {
    exitWithError(`Download failed: ${error.message}`);
  }
}

function extractAssets(timestamp) {
  const bundles = {
    ios: fs.readFileSync(
      path.join(
        "static-build",
        timestamp,
        "_expo",
        "static",
        "js",
        "ios",
        "bundle.js",
      ),
      "utf-8",
    ),
    android: fs.readFileSync(
      path.join(
        "static-build",
        timestamp,
        "_expo",
        "static",
        "js",
        "android",
        "bundle.js",
      ),
      "utf-8",
    ),
  };

  return extractAssetsFromBundles(bundles);
}

function extractAssetsFromBundles(bundles) {
  const assetsMap = new Map();
  const assetPattern =
    /httpServerLocation:"([^"]+)"[^}]*scales:\[([^\]]*)\][^}]*hash:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"(?:[^}]*fileHashes:\[([^\]]*)\])?/g;

  const extractFromBundle = (bundle, platform) => {
    for (const match of bundle.matchAll(assetPattern)) {
      const originalPath = match[1];
      const scales = match[2]
        .split(",")
        .map((value) => Number.parseFloat(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
      const fileHashes = match[6]
        ? JSON.parse(`[${match[6]}]`)
        : [];

      const tempUrl = new URL(`${metroBaseUrl}${originalPath}`);
      const unstablePath = tempUrl.searchParams.get("unstable_path");

      if (!unstablePath) {
        throw new Error(`Asset missing unstable_path: ${originalPath}`);
      }

      const decodedPath = decodeURIComponent(unstablePath);
      const uniqueScales = scales.length > 0 ? [...new Set(scales)] : [1];

      for (const scale of uniqueScales) {
        const scaleIndex = scales.indexOf(scale);
        const scaleSuffix = scale === 1 ? "" : `@${scale}x`;
        const filename = `${match[4]}${scaleSuffix}.${match[5]}`;
        const key = path.posix.join(platform, decodedPath, filename);

        if (!assetsMap.has(key)) {
          const asset = {
            originalPath,
            filename,
            relativePath: decodedPath,
            hash: match[3],
            fileHash: fileHashes[scaleIndex] || match[3],
            scale,
            platform,
          };

          assetsMap.set(key, asset);
        }
      }
    }
  };

  extractFromBundle(bundles.ios, "ios");
  extractFromBundle(bundles.android, "android");

  return Array.from(assetsMap.values());
}

function rewriteBundleLocalUrls(bundle, baseUrl) {
  return bundle.replaceAll(`${metroBaseUrl}/`, `${baseUrl}/`);
}

async function downloadAssets(assets, timestamp) {
  if (assets.length === 0) {
    return 0;
  }

  console.log("Downloading assets...");
  let successCount = 0;
  const failures = [];

  const downloadAsset = async (asset) => {
    const platform = asset.platform;

    const tempUrl = new URL(`${metroBaseUrl}${asset.originalPath}`);
    const unstablePath = tempUrl.searchParams.get("unstable_path");

    if (!unstablePath) {
      throw new Error(`Asset missing unstable_path: ${asset.originalPath}`);
    }

    const decodedPath = decodeURIComponent(unstablePath);
    const metroUrl = new URL(
      `${metroBaseUrl}${path.posix.join("/assets", decodedPath, asset.filename)}`,
    );
    metroUrl.searchParams.set("platform", platform);
    metroUrl.searchParams.set("hash", asset.hash);

    const outputDir = path.join(
      "static-build",
      timestamp,
      "_expo",
      "static",
      "js",
      "assets",
      platform,
      asset.relativePath,
    );
    fs.mkdirSync(outputDir, { recursive: true });
    const output = path.join(outputDir, asset.filename);

    try {
      await downloadFile(metroUrl.toString(), output);
      successCount++;
    } catch (error) {
      failures.push({
        filename: asset.filename,
        error: error.message,
        url: metroUrl.toString(),
      });
    }
  };

  const pendingAssets = [...assets];
  const workerCount = Math.min(6, pendingAssets.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (pendingAssets.length > 0) {
        const asset = pendingAssets.shift();
        if (asset) await downloadAsset(asset);
      }
    }),
  );

  if (failures.length > 0) {
    const errorMsg =
      `Failed to download ${failures.length} asset(s):\n` +
      failures
        .map((f) => `  - ${f.filename}: ${f.error} (${f.url})`)
        .join("\n");
    exitWithError(errorMsg);
  }

  console.log(`Downloaded ${successCount} assets`);
  return successCount;
}

function updateBundleUrls(timestamp, baseUrl) {
  const updateForPlatform = (platform) => {
    const bundlePath = path.join(
      "static-build",
      timestamp,
      "_expo",
      "static",
      "js",
      platform,
      "bundle.js",
    );
    let bundle = fs.readFileSync(bundlePath, "utf-8");

    bundle = bundle.replace(
      /httpServerLocation:"(\/[^"]+)"/g,
      (_match, capturedPath) => {
        const tempUrl = new URL(`${metroBaseUrl}${capturedPath}`);
        const unstablePath = tempUrl.searchParams.get("unstable_path");

        if (!unstablePath) {
          throw new Error(
            `Asset missing unstable_path in bundle: ${capturedPath}`,
          );
        }

        const decodedPath = decodeURIComponent(unstablePath);
        return `httpServerLocation:"${baseUrl}/${timestamp}/_expo/static/js/assets/${platform}/${decodedPath}"`;
      },
    );
    bundle = rewriteBundleLocalUrls(bundle, baseUrl);

    fs.writeFileSync(bundlePath, bundle);
  };

  updateForPlatform("ios");
  updateForPlatform("android");
  console.log("Updated bundle URLs");
}

function rewriteManifestLocalUrls(value, baseUrl) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      if (typeof item === "string") {
        value[index] = rewriteManifestLocalUrl(item, baseUrl);
      } else if (item && typeof item === "object") {
        rewriteManifestLocalUrls(item, baseUrl);
      }
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      value[key] = rewriteManifestLocalUrl(item, baseUrl);
    } else if (item && typeof item === "object") {
      rewriteManifestLocalUrls(item, baseUrl);
    }
  }
}

function rewriteManifestLocalUrl(value, baseUrl) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
    url.hostname !== new URL(PUBLIC_ORIGIN_PLACEHOLDER).hostname
  ) {
    return value;
  }

  const normalizedPath = url.pathname.startsWith("/assets/assets/")
    ? url.pathname.slice("/assets".length)
    : url.pathname;
  return `${baseUrl}${normalizedPath}${url.search}${url.hash}`;
}

function updateManifests(manifests, timestamp, baseUrl, assetsByHash) {
  const updateForPlatform = (platform, manifest) => {
    if (!manifest.launchAsset || !manifest.extra) {
      exitWithError(`Malformed manifest for ${platform}`);
    }

    rewriteManifestLocalUrls(manifest, baseUrl);
    manifest.launchAsset.url = `${baseUrl}/${timestamp}/_expo/static/js/${platform}/bundle.js`;
    manifest.launchAsset.key = `bundle-${timestamp}`;
    manifest.createdAt = new Date(
      Number(timestamp.split("-")[0]),
    ).toISOString();
    const publicHost = new URL(baseUrl).host;
    manifest.extra.expoClient.hostUri = publicHost;
    delete manifest.extra.expoClient._internal;
    manifest.extra.expoGo.debuggerHost = publicHost;
    if (manifest.extra.expoGo.developer) {
      delete manifest.extra.expoGo.developer.projectRoot;
    }
    manifest.extra.expoGo.packagerOpts.dev = false;

    if (manifest.assets && manifest.assets.length > 0) {
      manifest.assets.forEach((asset) => {
        if (!asset.url) return;

        const hash = asset.hash;
        if (!hash) return;

        const assetInfo = assetsByHash.get(`${platform}:${hash}`);
        if (!assetInfo) return;

        asset.url = `${baseUrl}/${timestamp}/_expo/static/js/${assetInfo.relativePath}/${assetInfo.filename}`;
      });
    }

    fs.writeFileSync(
      path.join("static-build", platform, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  };

  updateForPlatform("ios", manifests.ios);
  updateForPlatform("android", manifests.android);
  console.log("Manifests updated");
}

async function main() {
  console.log("Building static Expo Go deployment...");

  setupSignalHandlers();

  const baseUrl = PUBLIC_ORIGIN_PLACEHOLDER;
  const timestamp = `${Date.now()}-${process.pid}`;

  prepareDirectories(timestamp);
  clearMetroCache();

  await startMetro(baseUrl);

  const downloadTimeout = 600000;
  const downloadPromise = downloadBundlesAndManifests(timestamp);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(
          `Overall download timeout after ${downloadTimeout / 1000} seconds. ` +
            "Metro may be struggling to generate bundles. Check Metro logs above.",
        ),
      );
    }, downloadTimeout);
  });

  const manifests = await Promise.race([downloadPromise, timeoutPromise]);

  console.log("Processing assets...");
  const assets = extractAssets(timestamp);
  console.log("Found", assets.length, "unique asset(s)");

  const assetsByHash = new Map();
  for (const asset of assets) {
    const assetInfo = {
      relativePath: path.posix.join(
        "assets",
        asset.platform,
        asset.relativePath,
      ),
      filename: asset.filename,
    };
    assetsByHash.set(`${asset.platform}:${asset.fileHash}`, assetInfo);
    const aggregateHashKey = `${asset.platform}:${asset.hash}`;
    if (!assetsByHash.has(aggregateHashKey) || asset.scale === 1) {
      assetsByHash.set(aggregateHashKey, assetInfo);
    }
  }

  const assetCount = await downloadAssets(assets, timestamp);

  if (assetCount > 0) {
    updateBundleUrls(timestamp, baseUrl);
  }

  console.log("Updating manifests and creating landing page...");
  updateManifests(manifests, timestamp, baseUrl, assetsByHash);

  console.log("Build complete");

  if (metroProcess) {
    metroProcess.kill();
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Build failed:", error.message);
    if (metroProcess) {
      metroProcess.kill();
    }
    process.exit(1);
  });
}

module.exports = {
  PUBLIC_ORIGIN_PLACEHOLDER,
  extractAssets,
  extractAssetsFromBundles,
  formatHttpError,
  rewriteManifestLocalUrl,
  rewriteBundleLocalUrls,
};
