import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EXPO_PUBLIC_ORIGIN_PLACEHOLDER,
  injectExpoPublicOrigin,
  prepareExpoManifest,
  resolveExpoPublicOrigin,
  selectExpoPublicDomain,
  validateExpoBuild,
} from "../server/expo-deployment.ts";

const require = createRequire(import.meta.url);
const {
  extractAssetsFromBundles,
  formatHttpError,
  PUBLIC_ORIGIN_PLACEHOLDER: BUILD_ORIGIN_PLACEHOLDER,
  rewriteBundleLocalUrls,
} = require("../scripts/build.js");
const {
  createExpoDevEnvironment,
  normalizeHost,
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
  assert.match(
    replitConfig,
    /name\s*=\s*"Project"\s+mode\s*=\s*"parallel"[\s\S]*?task\s*=\s*"workflow\.run"\s+args\s*=\s*"Start App"/,
  );
  assert.equal(packageJson.scripts["expo:dev"], "node scripts/expo-dev.js");
});

test("usa o dominio dedicado do Metro no preview Replit", () => {
  const environment = createExpoDevEnvironment({
    REPLIT_DEV_DOMAIN: "api-workspace.replit.dev",
    REPLIT_EXPO_DEV_DOMAIN: "expo-workspace.replit.dev",
  });

  assert.equal(environment.EXPO_OFFLINE, "1");
  assert.equal(
    environment.EXPO_PACKAGER_PROXY_URL,
    "https://expo-workspace.replit.dev",
  );
  assert.equal(
    environment.REACT_NATIVE_PACKAGER_HOSTNAME,
    "api-workspace.replit.dev",
  );
  assert.equal(environment.EXPO_PUBLIC_DOMAIN, "api-workspace.replit.dev");
});

test("impede URLs malformadas no manifesto de desenvolvimento", () => {
  assert.equal(
    normalizeHost("https://workspace.replit.dev"),
    "workspace.replit.dev",
  );
  assert.equal(normalizeHost("https,workspace.replit.dev"), null);
  assert.equal(normalizeHost("one.replit.dev,two.replit.dev"), null);

  const localEnvironment = createExpoDevEnvironment({});
  assert.equal("EXPO_PACKAGER_PROXY_URL" in localEnvironment, false);
  assert.equal("REACT_NATIVE_PACKAGER_HOSTNAME" in localEnvironment, false);
  assert.equal("EXPO_PUBLIC_DOMAIN" in localEnvironment, false);
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
