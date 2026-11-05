import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Speech from "expo-speech";
import { listenMinutes, speechSegments, type Gist } from "@gist/core";
import { useTheme } from "./theme";

const RATES = [1, 1.25, 1.5, 2, 0.75];

/** Reads the gist aloud point by point with the phone's own voices, and shows which point is being read. */
export function ListenBar({ gist, onSegment }: { gist: Gist; onSegment?: (key: string | null) => void }) {
  const t = useTheme();
  const segs = useMemo(() => speechSegments(gist), [gist]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const token = useRef(0);

  useEffect(() => () => { token.current++; Speech.stop(); }, []);

  const speakFrom = (k: number, r = rate) => {
    const tok = ++token.current;
    Speech.stop();
    if (k >= segs.length) { setI(0); setPlaying(false); onSegment?.(null); return; }
    setI(k);
    setPlaying(true);
    onSegment?.(segs[k].key);
    // Speech rate on phones is a multiplier where 1 is normal speed.
    Speech.speak(segs[k].text, { language: "en-CA", rate: r, onDone: () => { if (tok === token.current) speakFrom(k + 1, r); }, onError: () => { if (tok === token.current) setPlaying(false); } });
  };
  const pause = () => { token.current++; Speech.stop(); setPlaying(false); onSegment?.(null); };

  if (!segs.length) return null;
  const left = listenMinutes(segs.slice(i), rate);
  const btn = { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View style={{ marginTop: 16, padding: 8, borderRadius: 28, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable accessibilityLabel="Previous point" onPress={() => (playing ? speakFrom(Math.max(0, i - 1)) : setI(Math.max(0, i - 1)))} style={btn}><Text style={{ color: t.muted, fontSize: 16 }}>⏮</Text></Pressable>
      <Pressable accessibilityLabel={playing ? "Pause" : "Listen"} onPress={() => (playing ? pause() : speakFrom(i))} style={[btn, { width: 48, height: 48, borderRadius: 24, backgroundColor: t.text }]}>
        <Text style={{ color: t.bg, fontSize: 16, fontWeight: "800" }}>{playing ? "❚❚" : "▶"}</Text>
      </Pressable>
      <Pressable accessibilityLabel="Next point" onPress={() => (playing ? speakFrom(Math.min(segs.length - 1, i + 1)) : setI(Math.min(segs.length - 1, i + 1)))} style={btn}><Text style={{ color: t.muted, fontSize: 16 }}>⏭</Text></Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ color: t.text, fontWeight: "600" }} numberOfLines={1}>{playing ? "Listening…" : i > 0 ? "Paused" : "Listen to this gist"}</Text>
        <View style={{ flexDirection: "row", gap: 2, height: 5 }}>
          {segs.map((s, k) => <View key={s.key} style={{ flex: 1, borderRadius: 2, backgroundColor: k < i ? t.accent : k === i && playing ? "#fbbf24" : t.border }} />)}
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>{Math.max(1, Math.round(left))} min left</Text>
      </View>
      <Pressable accessibilityLabel="Change speed" onPress={() => { const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length]; setRate(r); if (playing) speakFrom(i, r); }} style={[btn, { width: 52, borderWidth: 1, borderColor: t.border }]}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 13 }}>{rate}×</Text>
      </Pressable>
    </View>
  );
}
