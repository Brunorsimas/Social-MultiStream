import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
  injectExpoPublicOrigin,
  prepareExpoDevelopmentManifest,
  prepareExpoManifest,
  resolveExpoPublicOrigin,
  resolveExpoRequestOrigin,
  resolveMetroProxyHeaders,
  selectExpoPublicDomain,
  validateExpoBuild,
} from "../server/expo-deployment.ts";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const gitSafeDirectory = repositoryRoot
  .replaceAll("\\", "/")
  .replace(/\/+$/, "");
const {
  extractAssetsFromBundles,
  formatHttpError,
  PUBLIC_ORIGIN_PLACEHOLDER: BUILD_ORIGIN_PLACEHOLDER,
  rewriteBundleLocalUrls,
} = require("../scripts/build.js");
const {
  createTerminalQrCode,
  createExpoDevEnvironment,
  normalizeHost,
  resolveExpoPreviewUrl,
  resolveExpoCli,
} = require("../scripts/expo-dev.js");

test("usa somente um domínio público no deployment", () => {
  assert.equal(
    selectExpoPublicDomain({
      NODE_ENV: "production",
      REPLIT_DOMAINS: "published.replit.app,custom.example",
      REPLIT_DEV_DOMAIN: "workspace.replit.dev",
      REPLIT_INTERNAL_APP_DOMAIN: "internal.invalid",
    }),
    "published.replit.app",
  );

  assert.equal(
    selectExpoPublicDomain({
      NODE_ENV: "production",
      EXPO_PUBLIC_DOMAIN: "https://custom.example",
      REPLIT_DOMAINS: "published.replit.app",
    }),
    "https://custom.example",
  );

  assert.equal(
    selectExpoPublicDomain({
      NODE_ENV: "production",
      REPLIT_DEV_DOMAIN: "workspace.replit.dev",
      REPLIT_INTERNAL_APP_DOMAIN: "internal.invalid",
    }),
    null,
  );
});

test("publica somente a porta do servidor Express", () => {
  const replitConfig = readFileSync(
    new URL("../.replit", import.meta.url),
    "utf8",
  );
  const externalPorts = [
    ...replitConfig.matchAll(/externalPort\s*=\s*(\d+)/g),
  ].map((match) => Number(match[1]));

  assert.deepEqual(externalPorts, [80]);
  assert.match(
    replitConfig,
    /\[\[ports\]\]\s+localPort\s*=\s*5000\s+externalPort\s*=\s*80/,
  );
});

test("não bloqueia o preview reinstalando dependências ou validando a rede", () => {
  const replitConfig = readFileSync(
    new URL("../.replit", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.doesNotMatch(replitConfig, /\bnpm\s+(?:ci|install)\b/);
  assert.doesNotMatch(replitConfig, /ensurePreviewReachable/);
  assert.match(
    replitConfig,
    /name\s*=\s*"Project"\s+mode\s*=\s*"parallel"[\s\S]*?task\s*=\s*"workflow\.run"\s+args\s*=\s*"Start App"/,
  );
  assert.equal(packageJson.scripts["expo:dev"], "node scripts/expo-dev.js");
  assert.equal(packageJson.scripts.start, "npm run expo:dev");
  const expoDevScript = readFileSync(
    new URL("../scripts/expo-dev.js", import.meta.url),
    "utf8",
  );
  const serverIndex = readFileSync(
    new URL("../server/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(expoDevScript, /\[expoCli,\s*"start",\s*"--localhost"\]/);
  assert.match(serverIndex, /serveDevelopmentExpoManifest\(metroPort/);
  assert.match(
    serverIndex,
    /catch \(error\) \{\s*expoStatus = "static-unavailable";/,
  );
});

test("usa o dominio dedicado do Metro no preview Replit", () => {
  const environment = createExpoDevEnvironment({
    REPLIT_DEV_DOMAIN: "api-workspace.replit.dev",
    REPLIT_EXPO_DEV_DOMAIN: "expo-workspace.replit.dev",
  });

  assert.equal("EXPO_OFFLINE" in environment, false);
  assert.equal(environment.EXPO_NO_DEPENDENCY_VALIDATION, "1");
  assert.equal(
    environment.EXPO_PACKAGER_PROXY_URL,
    "https://expo-workspace.replit.dev",
  );
  assert.equal(
    environment.REACT_NATIVE_PACKAGER_HOSTNAME,
    "api-workspace.replit.dev",
  );
  assert.equal(environment.EXPO_PUBLIC_DOMAIN, "api-workspace.replit.dev");
  assert.equal(
    resolveExpoPreviewUrl({
      REPLIT_DEV_DOMAIN: "api-workspace.replit.dev",
    }),
    "exps://api-workspace.replit.dev",
  );
});

test("gera QR no console mesmo quando o workflow nao possui TTY", async () => {
  const qrCode = await createTerminalQrCode(
    "exps://api-workspace.replit.dev",
  );

  assert.ok(qrCode.length > 100);
  assert.match(qrCode, /\u001b\[/);
});

test("executa a CLI local fixada no projeto", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packageLock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const cliPath = resolveExpoCli();

  assert.equal(packageJson.devDependencies["@expo/cli"], "54.0.26");
  assert.equal(
    packageLock.packages[""].devDependencies["@expo/cli"],
    "54.0.26",
  );
  assert.match(
    cliPath,
    /node_modules[\\/]@expo[\\/]cli[\\/]build[\\/]bin[\\/]cli$/,
  );
  assert.doesNotMatch(cliPath, /node_modules[\\/]expo[\\/]bin[\\/]cli$/);
});

test("mantem o postMerge portavel e executavel no Linux", () => {
  const replitConfig = readFileSync(
    new URL("../.replit", import.meta.url),
    "utf8",
  );
  const packageLock = readFileSync(
    new URL("../package-lock.json", import.meta.url),
    "utf8",
  );
  const postMergeScript = readFileSync(
    new URL("../scripts/post-merge.sh", import.meta.url),
    "utf8",
  );
  const gitAttributes = readFileSync(
    new URL("../.gitattributes", import.meta.url),
    "utf8",
  );
  const gitMode = spawnSync(
    "git",
    [
      "-c",
      `safe.directory=${gitSafeDirectory}`,
      "ls-files",
      "--stage",
      "--",
      "scripts/post-merge.sh",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );

  assert.doesNotMatch(packageLock, /package-firewall\.replit\.local/);
  assert.match(postMergeScript, /^#!\/usr\/bin\/env bash\n/);
  assert.equal(postMergeScript.includes("\r"), false);
  assert.match(postMergeScript, /npm ci --legacy-peer-deps/);
  assert.doesNotMatch(postMergeScript, /^\s*npm install/m);
  assert.match(postMergeScript, /require\.resolve\("@expo\/cli"\)/);
  assert.match(gitAttributes, /^\*\.sh text eol=lf$/m);
  assert.equal(gitMode.status, 0, gitMode.stderr);
  assert.match(gitMode.stdout, /^100755\s/);
  assert.match(replitConfig, /\[postMerge\][\s\S]*timeoutMs\s*=\s*900000/);
});

test("impede URLs malformadas no manifesto de desenvolvimento", () => {
  assert.equal(
    normalizeHost("https://workspace.replit.dev"),
    "workspace.replit.dev",
  );
  assert.equal(normalizeHost("https,workspace.replit.dev"), null);
  assert.equal(normalizeHost("one.replit.dev,two.replit.dev"), null);

  const localEnvironment = createExpoDevEnvironment({});
  assert.equal("EXPO_OFFLINE" in localEnvironment, false);
  assert.equal(localEnvironment.EXPO_NO_DEPENDENCY_VALIDATION, "1");
  assert.equal("EXPO_PACKAGER_PROXY_URL" in localEnvironment, false);
  assert.equal("REACT_NATIVE_PACKAGER_HOSTNAME" in localEnvironment, false);
  assert.equal("EXPO_PUBLIC_DOMAIN" in localEnvironment, false);

  const configuredEnvironment = createExpoDevEnvironment({
    EXPO_OFFLINE: "1",
    EXPO_PUBLIC_DOMAIN: "https://api.example.test",
  });
  assert.equal("EXPO_OFFLINE" in configuredEnvironment, false);
  assert.equal(configuredEnvironment.EXPO_NO_DEPENDENCY_VALIDATION, "1");
  assert.equal(
    configuredEnvironment.EXPO_PUBLIC_DOMAIN,
    "api.example.test",
  );
});

test("normaliza headers duplicados antes de encaminhar ao Metro", () => {
  assert.deepEqual(
    resolveMetroProxyHeaders(
      { REPLIT_DEV_DOMAIN: "workspace.replit.dev" },
      "workspace.replit.dev, workspace.replit.dev",
      "https, http",
    ),
    {
      host: "workspace.replit.dev",
      forwardedHost: "workspace.replit.dev",
      forwardedProto: "https",
    },
  );

  assert.deepEqual(
    resolveMetroProxyHeaders({}, "127.0.0.1:5000", "http"),
    {
      host: "127.0.0.1:5000",
      forwardedHost: "127.0.0.1:5000",
      forwardedProto: "http",
    },
  );

  assert.deepEqual(
    resolveExpoRequestOrigin(
      { NODE_ENV: "production" },
      "internal.invalid:5000",
      "http",
      "attacker.invalid, published.replit.app",
      "http, https",
    ),
    {
      host: "published.replit.app",
      origin: "https://published.replit.app",
      protocol: "https",
    },
  );
});

test("mantém o patch HTTPS alinhado à versão instalada do expo-asset", () => {
  const packageLock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const expoAssetVersion =
    packageLock.packages["node_modules/expo-asset"]?.version;

  assert.ok(expoAssetVersion, "expo-asset ausente do package-lock.json");

  const patch = readFileSync(
    new URL(
      `../patches/expo-asset+${expoAssetVersion}.patch`,
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    patch,
    /\+\s+const scheme = manifestBaseUrl\?\.startsWith\('https:\/\/'\)/,
  );
  assert.match(
    patch,
    /\+\s+\? scheme \+ manifest2\.extra\.expoGo\.debuggerHost/,
  );
});

test("mantém fallback local apenas no desenvolvimento", () => {
  assert.equal(
    selectExpoPublicDomain({
      NODE_ENV: "development",
      REPLIT_DEV_DOMAIN: "workspace.replit.dev",
    }),
    "workspace.replit.dev",
  );

  assert.deepEqual(
    resolveExpoPublicOrigin(
      { NODE_ENV: "development" },
      "localhost:5000",
      "http",
    ),
    {
      host: "localhost:5000",
      origin: "http://localhost:5000",
      protocol: "http",
    },
  );

  assert.deepEqual(
    resolveExpoPublicOrigin(
      { NODE_ENV: "production" },
      "published.example.test",
      "https",
    ),
    {
      host: "published.example.test",
      origin: "https://published.example.test",
      protocol: "https",
    },
  );
});

test("reescreve o manifesto de desenvolvimento para o proxy público", () => {
  const manifest = prepareExpoDevelopmentManifest(
    {
      launchAsset: {
        contentType: "application/javascript",
        url: "http://127.0.0.1:8081/index.bundle?platform=android&dev=true",
      },
      assets: [
        {
          url: "http://127.0.0.1:8081/assets/icon.png?platform=android",
        },
      ],
      extra: {
        expoClient: {
          hostUri: "127.0.0.1:8081",
          icon: "./assets/images/icon.png",
          splash: { image: "./assets/images/splash-icon.png" },
          _internal: { projectRoot: "C:\\private" },
        },
        expoGo: {
          debuggerHost: "127.0.0.1:8081",
          developer: { projectRoot: "C:\\private" },
          packagerOpts: { dev: true },
        },
      },
    },
    "android",
    {
      host: "workspace.replit.dev",
      origin: "https://workspace.replit.dev",
      protocol: "https",
    },
  );

  assert.equal(
    manifest.launchAsset.url,
    "https://workspace.replit.dev/index.bundle?platform=android&dev=true",
  );
  assert.equal(
    manifest.assets[0].url,
    "https://workspace.replit.dev/assets/icon.png?platform=android",
  );
  assert.equal(manifest.extra.expoClient.hostUri, "workspace.replit.dev");
  assert.equal(
    manifest.extra.expoClient.iconUrl,
    "https://workspace.replit.dev/assets/./assets/images/icon.png?platform=android",
  );
  assert.equal(
    manifest.extra.expoClient.splash.imageUrl,
    "https://workspace.replit.dev/assets/./assets/images/splash-icon.png?platform=android",
  );
  assert.equal(manifest.extra.expoGo.debuggerHost, "workspace.replit.dev");
  assert.equal(manifest.extra.expoGo.packagerOpts.dev, true);
  assert.equal("_internal" in manifest.extra.expoClient, false);
  assert.equal("projectRoot" in manifest.extra.expoGo.developer, false);
});

test("reescreve o manifesto para o host publicado sem caminhos de plataforma", () => {
  const manifest = prepareExpoManifest(
    {
      id: "test-update",
      launchAsset: {
        key: "bundle",
        contentType: "application/javascript",
        url: "https://workspace.replit.dev/123-45/_expo/static/js/android/bundle.js",
      },
      assets: [
        {
          hash: "local",
          url: `${EXPO_PUBLIC_ORIGIN_PLACEHOLDER}/123-45/_expo/static/js/assets/icon.png`,
        },
        {
          hash: "external",
          url: "https://cdn.example/icon.png",
        },
      ],
      extra: {
        expoClient: {
          hostUri: "localhost:8081/android",
          iconUrl:
            "http://localhost:8081/assets/./assets/images/icon.png?platform=android",
          _internal: { projectRoot: "C:\\private\\project" },
        },
        expoGo: {
          debuggerHost: "localhost:8081/android",
          developer: {
            tool: "expo-cli",
            projectRoot: "C:\\private\\project",
          },
          packagerOpts: { dev: true },
        },
      },
    },
    "android",
    {
      host: "published.replit.app",
      origin: "https://published.replit.app",
      protocol: "https",
    },
  );

  assert.equal(
    manifest.launchAsset.url,
    "https://published.replit.app/123-45/_expo/static/js/android/bundle.js",
  );
  assert.equal(
    manifest.assets[0].url,
    "https://published.replit.app/123-45/_expo/static/js/assets/icon.png",
  );
  assert.equal(manifest.assets[1].url, "https://cdn.example/icon.png");
  assert.equal(
    manifest.extra.expoClient.iconUrl,
    "https://published.replit.app/assets/images/icon.png?platform=android",
  );
  assert.equal(
    manifest.extra.expoClient.hostUri,
    "published.replit.app",
  );
  assert.equal(
    manifest.extra.expoGo.debuggerHost,
    "published.replit.app",
  );
  assert.equal(manifest.extra.expoGo.packagerOpts.dev, false);
  assert.equal("_internal" in manifest.extra.expoClient, false);
  assert.equal(
    "projectRoot" in manifest.extra.expoGo.developer,
    false,
  );
});

test("injeta a origem pública no bundle estático", () => {
  assert.equal(
    BUILD_ORIGIN_PLACEHOLDER,
    EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
  );

  const bundle = [
    `const api="${EXPO_PUBLIC_ORIGIN_PLACEHOLDER}/api";`,
    `const asset="${EXPO_PUBLIC_ORIGIN_PLACEHOLDER}/asset.png";`,
  ].join("");

  const rewritten = injectExpoPublicOrigin(bundle, {
    host: "published.replit.app",
    origin: "https://published.replit.app",
    protocol: "https",
  });

  assert.doesNotMatch(rewritten, /expo-public-origin\.invalid/);
  assert.equal(
    rewritten.match(/https:\/\/published\.replit\.app/g)?.length,
    2,
  );
  assert.throws(
    () =>
      injectExpoPublicOrigin("const value = 1;", {
        host: "published.replit.app",
        origin: "https://published.replit.app",
        protocol: "https",
      }),
    /no public-origin placeholder/,
  );
});

test("remove URLs locais do Metro no bundle estático", () => {
  const bundle = [
    "const fallback = 'http://localhost:8081/';",
    "//# sourceMappingURL=http://localhost:8081/index.map",
  ].join("\n");

  const rewritten = rewriteBundleLocalUrls(
    bundle,
    BUILD_ORIGIN_PLACEHOLDER,
  );

  assert.equal(rewritten.includes("localhost:8081"), false);
  assert.equal(
    rewritten.match(/https:\/\/expo-public-origin\.invalid/g)?.length,
    2,
  );
});

test("executa o Metro de build sem depender da rede externa", () => {
  const buildScript = readFileSync(
    new URL("../scripts/build.js", import.meta.url),
    "utf8",
  );

  assert.match(buildScript, /EXPO_OFFLINE:\s*"1"/);
  assert.match(buildScript, /require\.resolve\("@expo\/cli"/);
  assert.doesNotMatch(buildScript, /require\.resolve\("expo\/bin\/cli"\)/);
  assert.match(buildScript, /const downloadTimeout = 600000;/);
});

test("preserva todas as variantes de escala dos assets Metro", () => {
  const descriptor =
    'httpServerLocation:"/assets/?unstable_path=.%2Fassets%2Fimages",' +
    'width:24,height:24,scales:[1,2,3,4],hash:"asset-hash",' +
    'name:"icon",type:"png",' +
    'fileHashes:["hash-1","hash-2","hash-3","hash-4"]';

  const assets = extractAssetsFromBundles({
    ios: descriptor,
    android: descriptor,
  });

  assert.deepEqual(
    assets.map((asset) => `${asset.platform}/${asset.filename}`),
    [
      "ios/icon.png",
      "ios/icon@2x.png",
      "ios/icon@3x.png",
      "ios/icon@4x.png",
      "android/icon.png",
      "android/icon@2x.png",
      "android/icon@3x.png",
      "android/icon@4x.png",
    ],
  );
  assert.deepEqual(
    assets.map((asset) => asset.fileHash),
    [
      "hash-1",
      "hash-2",
      "hash-3",
      "hash-4",
      "hash-1",
      "hash-2",
      "hash-3",
      "hash-4",
    ],
  );
});

test("preserva o diagnóstico retornado pelo Metro em falhas HTTP", async () => {
  const message = await formatHttpError(
    new Response("Unable to resolve module example", { status: 500 }),
  );

  assert.equal(
    message,
    "HTTP 500: Unable to resolve module example",
  );
});

test("bloqueia a inicialização sem os artefatos Expo completos", () => {
  const buildRoot = mkdtempSync(join(tmpdir(), "unichat-expo-build-"));

  try {
    assert.throws(
      () => validateExpoBuild(buildRoot),
      /Missing Expo manifest for ios/,
    );

    for (const platform of ["ios", "android"]) {
      const bundleDirectory = join(
        buildRoot,
        "123-45",
        "_expo",
        "static",
        "js",
        platform,
      );
      const manifestDirectory = join(buildRoot, platform);
      mkdirSync(bundleDirectory, { recursive: true });
      mkdirSync(manifestDirectory, { recursive: true });
      writeFileSync(
        join(bundleDirectory, "bundle.js"),
        `const origin="${EXPO_PUBLIC_ORIGIN_PLACEHOLDER}";`,
      );
      writeFileSync(
        join(manifestDirectory, "manifest.json"),
        JSON.stringify({
          launchAsset: {
            url: `${EXPO_PUBLIC_ORIGIN_PLACEHOLDER}/123-45/_expo/static/js/${platform}/bundle.js`,
          },
        }),
      );
    }

    assert.doesNotThrow(() => validateExpoBuild(buildRoot));
  } finally {
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
