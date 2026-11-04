import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { SessionProvider, useSession } from "../lib/session";
import { useTheme } from "../lib/theme";

/** When a link is shared to Gist from YouTube, Podcasts, Spotify or a browser, open the composer with it. */
function ShareHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const { user, ready } = useSession();
  useEffect(() => {
    if (!ready || !hasShareIntent) return;
    const url = shareIntent.webUrl ?? shareIntent.text?.match(/https?:\/\/\S+/)?.[0];
    if (url) router.replace({ pathname: user ? "/" : "/signin", params: { url } });
    resetShareIntent();
  }, [hasShareIntent, ready, user, shareIntent, resetShareIntent]);
  return null;
}

function Gate() {
  const { user, ready } = useSession();
  const t = useTheme();
  useEffect(() => {
    if (ready && !user) router.replace("/signin");
  }, [ready, user]);
  return (
    <>
      <StatusBar style="auto" />
      <ShareHandler />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="signin" options={{ title: "Sign in", headerBackVisible: false }} />
        <Stack.Screen name="gist/[id]" options={{ title: "" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ShareIntentProvider>
  );
}
