import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Share, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { Gist, MemoryCard } from "@gist/core";
import { formatMinutes, formatMoney, formatTimestamp, sourceLinks, timestampLink, toMarkdown, toPlainText } from "@gist/core";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { Button } from "../../lib/ui";
import { ListenBar } from "../../lib/ListenBar";
import { ShareSheet } from "../../lib/ShareSheet";

export default function GistScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [g, setG] = useState<Gist | null>(null);
  const [sharing, setSharing] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [cards, setCards] = useState<MemoryCard[]>([]);
  const ready = g?.status === "ready";
  useEffect(() => {
    if (ready) api.gistCards(id).then((r) => setCards(r.cards), () => {});
  }, [ready, id]);
  const starred = (text: string) => cards.some((c) => c.source?.text === text);
  const toggleStar = async (sectionId: string, itemIndex: number, text: string) => {
    try {
      const mine = cards.filter((c) => c.source?.text === text);
      if (mine.length) {
        await Promise.all(mine.map((c) => api.deleteCard(c.id)));
        setCards((cs) => cs.filter((c) => c.source?.text !== text));
      } else {
        const r = await api.starTakeaways(id, { items: [{ sectionId, itemIndex }] });
        setCards((cs) => [...cs, ...r.cards]);
      }
    } catch (e) {
      Alert.alert("Couldn't update Memory", (e as Error).message);
    }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const load = () =>
      api.gist(id).then((r) => {
        if (!alive) return;
        setG(r.gist);
        if (r.gist.status === "processing") timer = setTimeout(load, 1500);
      }, () => {});
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  if (!g) return <ActivityIndicator style={{ marginTop: 40 }} />;

  const send = async (target: "notion" | "obsidian") => {
    try {
      const r = await api.send(g.id, target);
      if (r.url) await Linking.openURL(r.url);
      else Alert.alert("Sent");
    } catch (e) {
      Alert.alert("Couldn't send", (e as Error).message);
    }
  };
  const exportSheet = () =>
    Alert.alert("Send to…", undefined, [
      { text: "Notes app (share sheet)", onPress: () => Share.share({ title: g.summary?.title, message: toPlainText(g) }) },
      { text: "Markdown (share sheet)", onPress: () => Share.share({ title: g.summary?.title, message: toMarkdown(g, { frontMatter: true }) }) },
      { text: "Notion", onPress: () => send("notion") },
      { text: "Obsidian", onPress: () => send("obsidian") },
      { text: "Cancel", style: "cancel" },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Stack.Screen options={{ title: "", headerRight: () => (g.status === "ready" ? <Text onPress={exportSheet} style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Send</Text> : null) }} />
      <Text style={{ fontSize: 22, fontWeight: "800", color: t.text }}>{g.summary?.title ?? g.source.title}</Text>
      <Text style={{ color: t.muted, marginTop: 4 }} onPress={() => g.source.url && Linking.openURL(g.source.url)}>
        {g.source.title}{g.source.author ? ` · ${g.source.author}` : ""}
      </Text>

      {g.status === "processing" && (
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginTop: 24 }}>
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.text }}>Working on it…</Text>
        </View>
      )}
      {g.status === "failed" && <Text style={{ color: t.danger, marginTop: 16 }}>{g.error}</Text>}

      {g.status === "ready" && g.summary && (
        <>
          {g.savings && (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
              <Text style={{ color: t.save, backgroundColor: t.saveSoft, padding: 8, borderRadius: 10, fontWeight: "700" }}>Saved {formatMinutes(g.savings.minutesSaved)}</Text>
              <Text style={{ color: t.save, backgroundColor: t.saveSoft, padding: 8, borderRadius: 10, fontWeight: "700" }}>{formatMoney(g.savings.moneySaved, g.savings.currency)}</Text>
            </View>
          )}
          <ListenBar gist={g} onSegment={setSpeaking} />
          <Text style={{ color: t.text, fontSize: 16, marginTop: 16, backgroundColor: speaking === "tldr" ? "rgba(251,191,36,.22)" : undefined, borderLeftWidth: 4, borderLeftColor: t.accent, paddingLeft: 10 }}>
            <Text style={{ fontWeight: "800" }}>TL;DR </Text>
            {g.summary.tldr}
          </Text>
          {g.summary.sections.map((sec) =>
            !sec.paragraph && !sec.items.length ? null : (
              <View key={sec.id} style={{ marginTop: 20 }}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", marginBottom: 6 }}>{sec.heading}</Text>
                {sec.paragraph && <Text style={{ color: t.text, lineHeight: 22 }}>{sec.paragraph}</Text>}
                {sec.items.map((it, i) => {
                  const link = it.timestamp != null ? timestampLink(g.source.kind, g.source.url, it.timestamp, g.source.audioUrl) : null;
                  const bullet = sec.format === "numbered" ? `${i + 1}.` : sec.format === "checklist" ? "☐" : "•";
                  return (
                    <Text key={i} style={{ color: t.text, lineHeight: 22, marginBottom: 6, backgroundColor: speaking === `i:${sec.id}:${i}` ? "rgba(251,191,36,.22)" : undefined }}>
                      {bullet} {it.text}
                      {it.timestamp != null && (
                        <Text style={{ color: link ? t.accent : t.muted }} onPress={() => link && Linking.openURL(link)}> ({formatTimestamp(it.timestamp)})</Text>
                      )}
                      <Text accessibilityRole="button" accessibilityLabel={starred(it.text) ? "Remove from Memory" : "Remember this"} style={{ color: starred(it.text) ? t.save : t.muted, fontSize: 18 }} onPress={() => toggleStar(sec.id, i, it.text)}>
                        {"  "}{starred(it.text) ? "★" : "☆"}
                      </Text>
                    </Text>
                  );
                })}
              </View>
            ),
          )}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
            <Text style={{ color: t.muted, flex: 1 }}>{cards.length ? `★ ${cards.length} card${cards.length === 1 ? "" : "s"} in Memory` : "Tap ☆ on a takeaway to remember it."}</Text>
            <Button title="Remember all" onPress={async () => { try { const r = await api.starTakeaways(g.id, { all: true }); setCards((cs) => [...cs, ...r.cards]); } catch (e) { Alert.alert("Couldn't make cards", (e as Error).message); } }} />
          </View>
          {sourceLinks(g.source).length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", marginBottom: 6 }}>Sources</Text>
              {sourceLinks(g.source).map((l) => (
                <Text key={l.kind + l.url} style={{ color: t.accent, lineHeight: 24 }} onPress={() => Linking.openURL(l.url)}>
                  {l.kind === "transcript" ? "📄" : l.kind === "audio" ? "🎧" : "↗"} {l.label}
                  {l.note ? <Text style={{ color: t.muted }}>{"\n"}{l.note}</Text> : null}
                </Text>
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
            <Button title="Share" primary onPress={() => setSharing(true)} />
            <Button title={g.favourite ? "★ Favourite" : "☆ Favourite"} onPress={async () => setG((await api.updateGist(g.id, { favourite: !g.favourite })).gist)} />
            <Button title="Delete" onPress={() => Alert.alert("Delete this gist?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { await api.deleteGist(g.id); router.back(); } }])} />
          </View>
        </>
      )}
      {g.status === "ready" && g.summary && <ShareSheet gist={g} visible={sharing} onClose={() => setSharing(false)} />}
    </ScrollView>
  );
}
