import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import type { ExtractionTemplate } from "@gist/core";
import { DEFAULT_TEMPLATE_ID, detectCollection, detectSourceKind, extractLinks } from "@gist/core";
import { api } from "../../lib/api";
import { handledLoginRequired } from "../../lib/signinPrompt";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { Button, Field } from "../../lib/ui";

const KIND = { youtube: "▶ YouTube video", podcast: "🎙 Podcast episode", web: "📰 Article", text: "📝 Text" } as const;

export default function NewGist() {
  const t = useTheme();
  const { user } = useSession();
  const params = useLocalSearchParams<{ url?: string }>();
  const [input, setInput] = useState(params.url ?? "");
  const [focus, setFocus] = useState("");
  const [templates, setTemplates] = useState<ExtractionTemplate[]>([]);
  const [templateId, setTemplateId] = useState(user?.settings.defaultTemplateId ?? DEFAULT_TEMPLATE_ID);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.url) setInput(params.url);
  }, [params.url]);
  useEffect(() => {
    if (user) api.templates().then((r) => setTemplates(r.templates), () => {});
  }, [user]);

  const kind = input.trim() ? detectSourceKind(input) : null;
  const links = extractLinks(input);
  const collection = links.length === 1 ? detectCollection(links[0]) : null;
  const bulk = links.length > 1;
  const importMode = bulk || (!!collection && !collection.ambiguous);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (importMode) {
        const { import: imp } = await api.createImport({ ...(bulk ? { urls: links } : { url: input.trim() }), limit: 25, templateId, focus });
        setInput("");
        Alert.alert("Import started", `${imp.total} items from "${imp.title}" are being summarized into a folder of the same name.`);
        router.push("/library");
        return;
      }
      const { gist } = await api.createGist(kind === "text" ? { text: input, templateId, focus } : { url: input.trim(), templateId, focus });
      setInput("");
      setFocus("");
      router.push(`/gist/${gist.id}`);
    } catch (e) {
      if (!handledLoginRequired(e)) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 24, fontWeight: "800", color: t.text, marginBottom: 4 }}>What do you want the gist of?</Text>
      <Text style={{ color: t.muted, marginBottom: 16 }}>Tip: share a link to {"“"}Gist{"”"} straight from YouTube, Podcasts, Spotify or your browser.</Text>
      <Field value={input} onChangeText={setInput} placeholder="Paste a link or text" multiline autoCapitalize="none" autoCorrect={false} />
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: -4, marginBottom: 12 }}>
        <Button title="Paste" onPress={async () => setInput(await Clipboard.getStringAsync())} />
        {kind && <Text style={{ color: t.muted }}>{bulk ? `${links.length} links: each gets a gist` : collection && !collection.ambiguous ? "Playlist: up to 25 items" : KIND[kind]}</Text>}
      </View>
      <Field label="What are you looking for? (optional)" value={focus} onChangeText={setFocus} placeholder="e.g. the workout routine" />
      <Text style={{ color: t.text, fontWeight: "600", marginBottom: 8 }}>Format</Text>
      {templates.map((tp) => {
        const on = tp.id === templateId;
        return (
          <Pressable key={tp.id} onPress={() => setTemplateId(tp.id)} accessibilityState={{ selected: on }} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accentSoft : t.surface, marginBottom: 8 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>{tp.icon} {tp.name}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{tp.description || tp.sections.map((s) => s.heading).join(" · ")}</Text>
          </Pressable>
        );
      })}
      {error && <Text style={{ color: t.danger, marginVertical: 8 }}>{error}</Text>}
      <Button primary title={busy ? "Starting…" : importMode ? "Summarize them all" : "Get the gist"} onPress={submit} disabled={busy || !input.trim()} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
