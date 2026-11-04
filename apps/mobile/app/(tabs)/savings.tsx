import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { formatMinutes, formatMoney } from "@gist/core";
import { api, type Totals } from "../../lib/api";
import { useTheme } from "../../lib/theme";

export default function Savings() {
  const t = useTheme();
  const [totals, setTotals] = useState<Totals | null>(null);
  useFocusEffect(useCallback(() => void api.savings().then((r) => setTotals(r.totals), () => {}), []));
  const Stat = ({ v, l }: { v: string; l: string }) => (
    <View style={{ flexBasis: "47%", flexGrow: 1, backgroundColor: t.saveSoft, borderRadius: 14, padding: 14 }}>
      <Text style={{ color: t.save, fontSize: 24, fontWeight: "800" }}>{v}</Text>
      <Text style={{ color: t.save }}>{l}</Text>
    </View>
  );
  if (!totals) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Stat v={formatMinutes(totals.minutesSaved)} l="time saved" />
        <Stat v={formatMoney(totals.moneySaved, totals.currency)} l="value of that time" />
        <Stat v={Math.round(totals.wordsAvoided).toLocaleString("en-CA")} l="words you skipped" />
        <Stat v={String(totals.gists)} l="gists made" />
      </View>
      <Text style={{ color: t.muted, marginTop: 16 }}>
        Watching, reading and note-taking would have taken about {formatMinutes(totals.originalMinutes)}. Reading the gists takes about {formatMinutes(totals.gistMinutes)}.
      </Text>
    </ScrollView>
  );
}
