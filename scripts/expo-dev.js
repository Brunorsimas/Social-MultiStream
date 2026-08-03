const path = require("node:path");
const { spawn } = require("node:child_process");

function normalizeHost(value) {
  const input = value?.trim();
  if (!input || /[,\s/\\?#]/.test(input.replace(/^https?:\/\//i, ""))) {
    return null;
  }

  try {
    const url = new URL(
      /^https?:\/\//i.test(input) ? input : `https://${input}`,
    );
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.hostname
    ) {
      return null;
    }
    return url.host;
  } catch {
    return null;
  }
}

function createExpoDevEnvironment(environment = process.env) {
  const replitApiHost = normalizeHost(environment.REPLIT_DEV_DOMAIN);
  const configuredApiHost = normalizeHost(environment.EXPO_PUBLIC_DOMAIN);
  const apiHost = replitApiHost || configuredApiHost;
  const expoHost =
    normalizeHost(environment.REPLIT_EXPO_DEV_DOMAIN) || replitApiHost;
  const result = { ...environment };

  delete result.EXPO_OFFLINE;
  result.EXPO_NO_DEPENDENCY_VALIDATION = "1";

  if (apiHost) {
    result.EXPO_PUBLIC_DOMAIN = apiHost;
  } else {
    delete result.EXPO_PUBLIC_DOMAIN;
  }

  if (replitApiHost) {
    result.REACT_NATIVE_PACKAGER_HOSTNAME = replitApiHost;
  }

  if (expoHost) {
    result.EXPO_PACKAGER_PROXY_URL = `https://${expoHost}`;
  }

  return result;
}

function resolveExpoCli(projectRoot = path.resolve(__dirname, "..")) {
  return require.resolve("@expo/cli", { paths: [projectRoot] });
}

function startExpoDev() {
  const expoCli = resolveExpoCli();
  let terminationSignal = null;
  const child = spawn(
    process.execPath,
    [expoCli, "start"],
    {
      env: createExpoDevEnvironment(),
      stdio: "inherit",
    },
  );

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      terminationSignal = signal;
      if (!child.killed) child.kill(signal);
    });
  }

  child.once("error", (error) => {
    console.error(`Unable to start Expo: ${error.message}`);
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    process.exitCode = terminationSignal ? 0 : (code ?? (signal ? 1 : 0));
  });
}

if (require.main === module) {
  startExpoDev();
}

module.exports = {
  createExpoDevEnvironment,
  normalizeHost,
  resolveExpoCli,
};
