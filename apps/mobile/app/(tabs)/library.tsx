import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { Gist } from "@gist/core";
import { formatMinutes } from "@gist/core";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { Field } from "../../lib/ui";

export default function Library() {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [gists, setGists] = useState<Gist[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => {
    setRefreshing(true);
    api.gists(q).then((r) => setGists(r.gists), () => {}).finally(() => setRefreshing(false));
  }, [q]);
  useFocusEffect(load);

  return (
    <FlatList
      contentContainerStyle={{ padding: 16 }}
      data={gists}
      keyExtractor={(g) => g.id}
      refreshing={refreshing}
      onRefresh={load}
      ListHeaderComponent={<Field value={q} onChangeText={setQ} placeholder="Search your gists" returnKeyType="search" onSubmitEditing={load} />}
      ListEmptyComponent={<Text style={{ color: t.muted }}>No gists yet. Paste or share a link to make one.</Text>}
      renderItem={({ item: g }) => (
        <Pressable onPress={() => router.push(`/gist/${g.id}`)} style={{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }} numberOfLines={2}>{g.favourite ? "★ " : ""}{g.summary?.title ?? g.source.title}</Text>
          <Text style={{ color: t.muted, marginTop: 4 }} numberOfLines={2}>
            {g.status === "processing" ? "Working on it…" : g.status === "failed" ? g.error : g.summary?.tldr}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {g.savings && <Text style={{ color: t.save, backgroundColor: t.saveSoft, paddingHorizontal: 8, borderRadius: 8, fontWeight: "600" }}>−{formatMinutes(g.savings.minutesSaved)}</Text>}
            {g.tags.slice(0, 3).map((tag) => <Text key={tag} style={{ color: t.muted }}>#{tag}</Text>)}
          </View>
        </Pressable>
      )}
    />
  );
}
