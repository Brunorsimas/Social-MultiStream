import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";

import {
  isAppStartupReady,
  STARTUP_FONT_TIMEOUT_MS,
} from "../lib/startup.ts";
import { prepareExpoDevelopmentManifest } from "../server/expo-deployment.ts";

const require = createRequire(import.meta.url);

test("nao mantem o aplicativo preso quando as fontes nao respondem", () => {
  assert.equal(isAppStartupReady(false, null, false), false);
  assert.equal(isAppStartupReady(true, null, false), true);
  assert.equal(isAppStartupReady(false, new Error("font"), false), true);
  assert.equal(isAppStartupReady(false, null, true), true);
  assert.equal(STARTUP_FONT_TIMEOUT_MS, 2_000);
});

test("mantem o Expo Router e o desbloqueio da splash ligados ao layout raiz", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const rootLayout = readFileSync(
    new URL("../app/_layout.tsx", import.meta.url),
    "utf8",
  );
  const routerEntry = require.resolve(packageJson.main);

  assert.equal(packageJson.main, "expo-router/entry");
  assert.match(routerEntry, /node_modules[\\/]expo-router[\\/]entry\.js$/);
  assert.match(rootLayout, /SplashScreen\.preventAutoHideAsync\(\)/);
  assert.match(rootLayout, /STARTUP_FONT_TIMEOUT_MS/);
  assert.match(rootLayout, /SplashScreen\.hideAsync\(\)/);
  assert.match(rootLayout, /<Stack\.Screen name="index"/);
});

test("carrega manifesto, entrada do Expo Router, bundle e assets por HTTP", async () => {
  const routerEntry = readFileSync(require.resolve("expo-router/entry"), "utf8");
  const icon = readFileSync(
    new URL("../assets/images/icon.png", import.meta.url),
  );
  let publicOrigin;

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", publicOrigin.origin);

    if (requestUrl.pathname === "/") {
      const manifest = prepareExpoDevelopmentManifest(
        {
          launchAsset: {
            contentType: "application/javascript",
            url: "http://127.0.0.1:8081/index.bundle?platform=android&dev=true",
          },
          assets: [
            {
              url: "http://127.0.0.1:8081/assets/router-icon.png?platform=android",
            },
          ],
          extra: {
            expoClient: {
              hostUri: "127.0.0.1:8081",
              icon: "./assets/images/icon.png",
              splash: { image: "./assets/images/splash-icon.png" },
            },
            expoGo: {
              debuggerHost: "127.0.0.1:8081",
              packagerOpts: { dev: true },
            },
          },
        },
        "android",
        publicOrigin,
      );

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(manifest));
      return;
    }

    if (requestUrl.pathname === "/index.bundle") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(routerEntry);
      return;
    }

    if (requestUrl.pathname.startsWith("/assets/")) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(icon);
      return;
    }

    response.writeHead(404);
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    publicOrigin = {
      host: `127.0.0.1:${address.port}`,
      origin: `http://127.0.0.1:${address.port}`,
      protocol: "http",
    };

    const manifestResponse = await fetch(`${publicOrigin.origin}/`, {
      headers: { "expo-platform": "android" },
    });
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.json();

    assert.equal(new URL(manifest.launchAsset.url).origin, publicOrigin.origin);
    assert.equal(manifest.extra.expoClient.hostUri, publicOrigin.host);
    assert.equal(manifest.extra.expoGo.debuggerHost, publicOrigin.host);

    const bundleResponse = await fetch(manifest.launchAsset.url);
    assert.equal(bundleResponse.status, 200);
    assert.match(await bundleResponse.text(), /expo-router\/entry-classic/);

    const assetUrls = [
      ...manifest.assets.map((asset) => asset.url),
      manifest.extra.expoClient.iconUrl,
      manifest.extra.expoClient.splash.imageUrl,
    ];
    const assetResponses = await Promise.all(assetUrls.map((url) => fetch(url)));
    assert.equal(assetResponses.every((response) => response.status === 200), true);
    assert.equal(
      assetResponses.every(
        (response) => response.headers.get("content-type") === "image/png",
      ),
      true,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
