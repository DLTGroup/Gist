import { useEffect, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { useSession } from "../../lib/session";
import { api, API_URL } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { Button, Card, Field } from "../../lib/ui";

export default function Settings() {
  const t = useTheme();
  const { user, setUser, signOut } = useSession();
  const [rate, setRate] = useState(String(user?.settings.hourlyRate ?? 35));
  const [vault, setVault] = useState(user?.settings.obsidianVault ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ available: boolean; label: string; details: string } | null>(null);
  useEffect(() => {
    api.marketingConsent().then(setConsent, () => {});
  }, []);
  const setMarketing = async (v: boolean) => {
    try {
      setUser((await api.setMarketing(v)).user);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const save = async () => {
    try {
      const r = await api.updateSettings({ hourlyRate: Number(rate) || 0, obsidianVault: vault || null });
      setUser(r.user);
      setMsg("Saved");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Field label="Your time is worth (per hour)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        <Field label="Obsidian vault name" value={vault} onChangeText={setVault} autoCapitalize="none" />
        <Text style={{ color: t.muted, marginBottom: 12 }}>Connect Notion and webhooks from the web or desktop app.</Text>
        <Button primary title="Save" onPress={save} />
        {msg && <Text style={{ color: t.muted, marginTop: 8 }}>{msg}</Text>}
      </Card>
      {consent?.available && !user?.isGuest && (
        <Card style={{ marginTop: 12 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Text style={{ flex: 1, color: t.text }}>{consent.label}</Text>
            <Switch value={!!user?.marketingOptIn} onValueChange={setMarketing} accessibilityLabel={consent.label} />
          </View>
          <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 8 }}>{consent.details}</Text>
        </Card>
      )}
      <Text style={{ color: t.muted, marginVertical: 12 }}>{user?.email} · {API_URL}</Text>
      <Button title="Sign out" onPress={signOut} />
    </ScrollView>
  );
}
