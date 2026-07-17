export function getApiUrl(): string {
  const configuredDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();

  if (configuredDomain) {
    const hasProtocol = /^https?:\/\//i.test(configuredDomain);
    const isLocal = /^(localhost|127\.0\.0\.1)(:|$)/i.test(configuredDomain);
    const url = new URL(hasProtocol ? configuredDomain : `${isLocal ? "http" : "https"}://${configuredDomain}`);
    return url.href;
  }

  if (typeof globalThis.location?.origin === "string") {
    return new URL(globalThis.location.origin).href;
  }

  return "http://localhost:5000/";
}

