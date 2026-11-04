import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { BRAND } from "@gist/core";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { Button, Field } from "../lib/ui";

export default function SignIn() {
  const t = useTheme();
  const { signIn } = useSession();
  const { url } = useLocalSearchParams<{ url?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (mode: "login" | "signup") => async () => {
    setBusy(true);
    setError(null);
    try {
      const r = mode === "signup" ? await api.signup(email, password) : await api.login(email, password);
      await signIn(r.token, r.user);
      router.replace({ pathname: "/", params: url ? { url } : {} });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 30, fontWeight: "800", color: t.text, marginBottom: 4 }}>{BRAND.name}</Text>
      <Text style={{ color: t.muted, marginBottom: 24 }}>{BRAND.tagline}</Text>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      {error && <Text style={{ color: t.danger, marginBottom: 12 }}>{error}</Text>}
      <Button primary title="Sign in" onPress={go("login")} disabled={busy} />
      <Button title="Create an account" onPress={go("signup")} disabled={busy} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}
