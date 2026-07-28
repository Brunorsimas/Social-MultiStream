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
  PUBLIC_ORIGIN_PLACEHOLDER: BUILD_ORIGIN_PLACEHOLDER,
} = require("../scripts/build.js");

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
