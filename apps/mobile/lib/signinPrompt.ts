import { Alert } from "react-native";
import { router } from "expo-router";

/** Asks a guest to create an account. Making, reading and sharing gists never needs one. */
export function askToSignIn(message = "Create a free account to do that. Your gists come with you.") {
  Alert.alert("Free account needed", message, [
    { text: "Not now", style: "cancel" },
    { text: "Create account", onPress: () => router.push("/signin") },
  ]);
}

/** True (and the prompt shown) when an API error means the guest needs an account. */
export function handledLoginRequired(e: unknown): boolean {
  if ((e as { code?: string })?.code !== "login_required") return false;
  askToSignIn((e as Error).message);
  return true;
}
