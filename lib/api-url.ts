function parseApiBaseUrl(
  value: string | undefined,
  inferProtocol: boolean,
): string | null {
  const input = value?.trim();
  if (!input) return null;

  try {
    const hasProtocol = /^https?:\/\//i.test(input);
    if (
      (!hasProtocol && input.includes("://")) ||
      (inferProtocol && !hasProtocol && /[/?#\\\s,]/.test(input))
    ) {
      return null;
    }

    const isLocal =
      /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(input);
    const candidate =
      inferProtocol && !hasProtocol
        ? `${isLocal ? "http" : "https"}://${input}`
        : input;
    const url = new URL(candidate);
    const isIpv6 = /^\[[a-f\d:.]+\]$/i.test(url.hostname);
    const isDnsOrIpv4 =
      /^[a-z\d.-]+$/i.test(url.hostname) &&
      !url.hostname.startsWith(".") &&
      !url.hostname.endsWith(".") &&
      !url.hostname.includes("..") &&
      url.hostname.split(".").every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          !label.startsWith("-") &&
          !label.endsWith("-"),
      );

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.hostname ||
      url.hostname.length > 253 ||
      (!isDnsOrIpv4 && !isIpv6)
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function getApiUrl(): string {
  const configuredUrl = parseApiBaseUrl(
    process.env.EXPO_PUBLIC_DOMAIN,
    true,
  );
  if (configuredUrl) return configuredUrl;

  if (typeof globalThis.location?.origin === "string") {
    const locationUrl = parseApiBaseUrl(globalThis.location.origin, false);
    if (locationUrl) return locationUrl;
  }

  return "http://localhost:5000/";
}
