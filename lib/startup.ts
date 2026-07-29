export const STARTUP_FONT_TIMEOUT_MS = 8_000;

export function isAppStartupReady(
  fontsLoaded: boolean,
  fontError: unknown,
  fontWaitExpired: boolean,
): boolean {
  return fontsLoaded || Boolean(fontError) || fontWaitExpired;
}
