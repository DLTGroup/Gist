import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import type { Gist, SummaryPart } from "@gist/core";
import { formatMinutes, formatMoney, formatTimestamp, sourceLinks, timestampLink, toMarkdown, toPlainText } from "@gist/core";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { askToSignIn, handledLoginRequired } from "../../lib/signinPrompt";
import { useTheme } from "../../lib/theme";
import { Button } from "../../lib/ui";
import { ListenBar } from "../../lib/ListenBar";
import { ShareSheet } from "../../lib/ShareSheet";

export default function GistScreen() {
  const t = useTheme();
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [g, setG] = useState<Gist | null>(null);
  const [sharing, setSharing] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  // The last piece removed, for the Undo bar.
  const [justRemoved, setJustRemoved] = useState<string | null>(null);

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
      if (!handledLoginRequired(e)) Alert.alert("Couldn't send", (e as Error).message);
    }
  };
  /** Removes one piece of the summary; it stays out of anything sent or shared as text. */
  const removePiece = async (part: SummaryPart, label: string) => {
    try {
      setG((await api.updateGist(g.id, { remove: part })).gist);
      setJustRemoved(label);
    } catch (e) {
      if (!handledLoginRequired(e)) Alert.alert("Couldn't remove that", (e as Error).message);
    }
  };
  const restore = async (which: "last" | "all") => {
    try {
      setG((await api.updateGist(g.id, { restore: which })).gist);
      setJustRemoved(null);
    } catch (e) {
      Alert.alert("Couldn't put it back", (e as Error).message);
    }
  };
  const removed = g.removedCount ?? 0;
  const X = ({ what, onPress }: { what: string; onPress: () => void }) => (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${what}`} style={({ pressed }) => ({ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: pressed ? t.saveSoft : undefined })}>
      <Text style={{ color: t.muted, fontSize: 16, fontWeight: "700" }}>×</Text>
    </Pressable>
  );
  const exportSheet = () =>
    user?.isGuest
      ? askToSignIn("Create a free account to send gists to your notes app. This gist comes with you.")
      : Alert.alert("Send to…", undefined, [
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
          {!!g.summary.tldr && (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 16, backgroundColor: speaking === "tldr" ? t.saveSoft : undefined, borderLeftWidth: 4, borderLeftColor: t.accent, paddingLeft: 10 }}>
              <Text style={{ flex: 1, color: t.text, fontSize: 16 }}>
                <Text style={{ fontWeight: "800" }}>TL;DR </Text>
                {g.summary.tldr}
              </Text>
              <X what="the TL;DR" onPress={() => removePiece({ kind: "tldr" }, "the TL;DR")} />
            </View>
          )}
          {(justRemoved || removed > 0) && (
            <View accessibilityLiveRegion="polite" style={{ marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: t.saveSoft, gap: 8 }}>
              <Text style={{ color: t.text }}>
                {justRemoved ? `Removed ${justRemoved}.` : `${removed} ${removed === 1 ? "piece" : "pieces"} removed.`} Removed pieces are left out when you send this gist.
              </Text>
              <View style={{ flexDirection: "row", gap: 18 }}>
                {justRemoved && <Text style={{ color: t.accent, fontWeight: "700" }} onPress={() => restore("last")}>Undo</Text>}
                {removed > 1 && <Text style={{ color: t.accent, fontWeight: "700" }} onPress={() => restore("all")}>Restore all {removed}</Text>}
                {!justRemoved && removed === 1 && <Text style={{ color: t.accent, fontWeight: "700" }} onPress={() => restore("all")}>Restore it</Text>}
              </View>
            </View>
          )}
          {g.summary.sections.map((sec) =>
            !sec.paragraph && !sec.items.length ? null : (
              <View key={sec.id} style={{ marginTop: 20 }}>
                <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", marginBottom: 6 }}>{sec.heading}</Text>
                {sec.paragraph && (
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
                    <Text style={{ flex: 1, color: t.text, lineHeight: 22 }}>{sec.paragraph}</Text>
                    <X what="this paragraph" onPress={() => removePiece({ kind: "paragraph", sectionId: sec.id }, "a paragraph")} />
                  </View>
                )}
                {sec.items.map((it, i) => {
                  const link = it.timestamp != null ? timestampLink(g.source.kind, g.source.url, it.timestamp, g.source.audioUrl) : null;
                  const bullet = sec.format === "numbered" ? `${i + 1}.` : sec.format === "checklist" ? "☐" : "•";
                  return (
                    <View key={`${i}:${it.text.slice(0, 24)}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 6, backgroundColor: speaking === `i:${sec.id}:${i}` ? t.saveSoft : undefined }}>
                      <Text style={{ flex: 1, color: t.text, lineHeight: 22 }}>
                        {bullet} {it.text}
                        {it.timestamp != null && (
                          <Text style={{ color: link ? t.accent : t.muted }} onPress={() => link && Linking.openURL(link)}> ({formatTimestamp(it.timestamp)})</Text>
                        )}
                      </Text>
                      <X what="this point" onPress={() => removePiece({ kind: "item", sectionId: sec.id, index: i }, "a point")} />
                    </View>
                  );
                })}
              </View>
            ),
          )}
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
