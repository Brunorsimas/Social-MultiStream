import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts, Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatProvider, useChats } from "@/lib/chat-context";
import {
  isAppStartupReady,
  STARTUP_FONT_TIMEOUT_MS,
} from "@/lib/startup";
import { StatusBar } from "expo-status-bar";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootLayoutNav() {
  const { themeColors, settings } = useChats();
  return (
    <>
      <StatusBar style={settings.theme === "dark" ? "light" : "dark"} />
      <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: themeColors.background },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="manage" />
      <Stack.Screen name="add-chat" />
      <Stack.Screen name="multichat" />
      <Stack.Screen name="single-chat" />
      <Stack.Screen name="platform-login" options={{ animation: "slide_from_bottom" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontWaitExpired, setFontWaitExpired] = React.useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
  });
  const startupReady = isAppStartupReady(
    fontsLoaded,
    fontError,
    fontWaitExpired,
  );

  useEffect(() => {
    if (fontsLoaded || fontError) return;

    const timeout = setTimeout(
      () => setFontWaitExpired(true),
      STARTUP_FONT_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (startupReady) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [startupReady]);

  if (!startupReady) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <ChatProvider>
            <RootLayoutNav />
          </ChatProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
