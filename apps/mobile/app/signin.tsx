import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { BRAND } from "@gist/core";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { Button, Field } from "../lib/ui";

/** Passwordless sign-in: an emailed 6-digit code. Guests can try Gist first. */
export default function SignIn() {
  const t = useTheme();
  const { user, signIn } = useSession();
  const { url } = useLocalSearchParams<{ url?: string }>();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const done = () => router.replace({ pathname: "/", params: url ? { url } : {} });

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 30, fontWeight: "800", color: t.text, marginBottom: 4 }}>{BRAND.name}</Text>
      <Text style={{ color: t.muted, marginBottom: 24 }}>{user?.isGuest ? "Create a free account. The gists you've made come with you." : BRAND.tagline}</Text>
      {!attemptId ? (
        <>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
          {error && <Text style={{ color: t.danger, marginBottom: 12 }}>{error}</Text>}
          <Button primary title="Email me a code" disabled={busy} onPress={run(async () => setAttemptId((await api.emailStart(email.trim())).attemptId))} />
          {user?.isGuest && <Button title="Not now" style={{ marginTop: 10 }} onPress={() => router.back()} />}
          {!user && (
            <Button
              title="Try it without an account"
              style={{ marginTop: 10 }}
              disabled={busy}
              onPress={run(async () => {
                const r = await api.guest();
                if (r.token) await signIn(r.token);
                done();
              })}
            />
          )}
        </>
      ) : (
        <>
          <Text style={{ color: t.text, marginBottom: 12 }}>We sent a 6-digit code to {email.trim()}. It works for 5 minutes.</Text>
          <Field label="Code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" />
          {error && <Text style={{ color: t.danger, marginBottom: 12 }}>{error}</Text>}
          <Button
            primary
            title="Continue"
            disabled={busy || code.length !== 6}
            onPress={run(async () => {
              const r = await api.emailVerify(code, attemptId);
              await signIn(r.token);
              done();
            })}
          />
          <Button title="Use a different email" style={{ marginTop: 10 }} onPress={() => (setAttemptId(null), setCode(""), setError(null))} />
        </>
      )}
    </ScrollView>
  );
}
