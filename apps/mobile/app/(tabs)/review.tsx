import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { IntervalPreview, MemoryCard, ReviewRating } from "@gist/core";
import { RATING_LABELS } from "@gist/core";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";
import { Button, Card } from "../../lib/ui";

type QueueCard = MemoryCard & { intervals: IntervalPreview };

/** Memory tab: review due cards with Again / Hard / Good / Easy, scheduled by FSRS on the server. */
export default function Review() {
  const t = useTheme();
  const [queue, setQueue] = useState<QueueCard[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState<{ streakDays: number; totalCards: number } | null>(null);
  const started = useRef(Date.now());

  const load = useCallback(() => {
    api.reviewQueue().then((r) => setQueue(r.cards), () => setQueue([]));
    api.memorySummary().then(setStats, () => {});
  }, []);
  useFocusEffect(useCallback(() => { setDone(0); load(); }, [load]));

  const card = queue?.[0];
  const answer = async (rating: ReviewRating) => {
    if (!card) return;
    const r = await api.review(card.id, rating, Date.now() - started.current).catch(() => null);
    setDone((n) => n + 1);
    setShown(false);
    started.current = Date.now();
    const rest = queue!.slice(1);
    // Cards still being learned come back in this session after their short step.
    if (r && new Date(r.card.memory.due).getTime() - Date.now() < 20 * 60_000) {
      const fresh = await api.reviewQueue().catch(() => null);
      const back = fresh?.cards.find((c) => c.id === card.id);
      setQueue(back ? [...rest, back] : rest);
    } else setQueue(rest);
  };

  if (!queue) return null;
  if (!card)
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Card>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: "800" }}>{done ? "Done for now" : "Nothing to review"}</Text>
          <Text style={{ color: t.muted, marginTop: 6 }}>
            {done
              ? `You reviewed ${done} card${done === 1 ? "" : "s"}. Gist will bring each one back just before you'd forget it.`
              : "Open a gist and tap ☆ beside a takeaway to start remembering it."}
          </Text>
          {stats && <Text style={{ color: t.muted, marginTop: 10 }}>{stats.totalCards} cards · {stats.streakDays} day streak</Text>}
        </Card>
        <Button title="Check again" onPress={load} />
      </ScrollView>
    );

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ color: t.muted, marginBottom: 8 }}>{queue.length} left · {done} done</Text>
      <Card style={{ minHeight: 220 }}>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: "700" }}>{card.front}</Text>
        {shown && (
          <View style={{ borderTopWidth: 1, borderTopColor: t.border, marginTop: 16, paddingTop: 16 }}>
            <Text style={{ color: t.text, fontSize: 18 }}>{card.back}</Text>
            {card.source && (
              <Text style={{ color: t.muted, marginTop: 10 }}>
                From {card.source.gistTitle}
                {card.source.url ? <Text style={{ color: t.accent }} onPress={() => Linking.openURL(card.source!.url!)}> · open the moment</Text> : null}
              </Text>
            )}
          </View>
        )}
      </Card>
      {!shown ? (
        <Button title="Show answer" primary onPress={() => setShown(true)} />
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {([1, 2, 3, 4] as ReviewRating[]).map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              onPress={() => answer(r)}
              style={({ pressed }) => ({ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: r === 3 ? t.accent : t.border, backgroundColor: t.surface, opacity: pressed ? 0.8 : 1 })}
            >
              <Text style={{ color: r === 1 ? t.danger : r === 3 ? t.accent : t.text, fontWeight: "700" }}>{RATING_LABELS[r]}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{card.intervals[r].label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
