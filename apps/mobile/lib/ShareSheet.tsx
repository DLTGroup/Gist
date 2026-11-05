import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { captureRef } from "react-native-view-shot";
import { formatMinutes, formatMoney, shareLinks, shareMessage, type Gist } from "@gist/core";
import { api, type ShareInfo } from "./api";
import { useTheme } from "./theme";

const INK = "#0d1710", PAPER = "#f3f7f3", TEAL = "#5fd38a", DOT = "#f59e0b", MUTE = "#9fb2a4";

/** The branded card, laid out at 360×360 and captured at 3× (1080×1080) for posts and previews. */
function Card({ gist }: { gist: Gist }) {
  const s = gist.summary!;
  return (
    <View style={{ width: 360, height: 360, backgroundColor: INK, padding: 34, justifyContent: "space-between" }}>
      <View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 22, height: 22, borderRadius: 5, backgroundColor: "#166534" }} />
          <Text style={{ color: PAPER, fontWeight: "800", fontSize: 17 }}>Gist</Text>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: DOT, marginLeft: -24, marginTop: -16 }} />
        </View>
        <Text style={{ color: PAPER, fontWeight: "800", fontSize: 22, lineHeight: 25, marginTop: 22 }} numberOfLines={3}>{s.title}</Text>
        <Text style={{ color: "rgba(244,246,245,.78)", fontSize: 11.5, lineHeight: 16, marginTop: 8 }} numberOfLines={3}>{s.tldr}</Text>
        {s.sections.flatMap((x) => x.items).slice(0, 2).map((it, k) => (
          <View key={k} style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: TEAL, marginTop: 5 }} />
            <Text style={{ color: PAPER, fontSize: 10.5, lineHeight: 14.5, flex: 1 }} numberOfLines={2}>{it.text}</Text>
          </View>
        ))}
      </View>
      <View>
        {gist.savings && (
          <Text style={{ alignSelf: "flex-start", color: TEAL, backgroundColor: "rgba(95,211,138,.15)", fontWeight: "700", fontSize: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, overflow: "hidden" }}>
            Saved {formatMinutes(gist.savings.minutesSaved)} · {formatMoney(gist.savings.moneySaved, gist.savings.currency)} of time
          </Text>
        )}
        <Text style={{ color: MUTE, fontSize: 8.5, marginTop: 8 }} numberOfLines={1}>Source: {gist.source.author || gist.source.title}</Text>
      </View>
    </View>
  );
}

export function ShareSheet({ gist, visible, onClose }: { gist: Gist; visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const card = useRef<any>(null);
  const [message, setMessage] = useState(() => shareMessage(gist));
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) api.getShare(gist.id).then((r) => setShare(r.share), () => {}); }, [visible, gist.id]);

  const links = shareLinks(message, share?.url ?? null, gist.summary?.title);
  const capture = (result: "tmpfile" | "data-uri") => captureRef(card, { format: "png", width: 1080, height: 1080, result });

  const createLink = async () => {
    setBusy(true);
    try {
      setShare((await api.createShare(gist.id, await capture("data-uri"))).share);
    } catch (e) {
      Alert.alert("Couldn't create the link", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shareImage = async () => {
    try {
      const uri = await capture("tmpfile");
      await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share this gist" });
    } catch (e) {
      Alert.alert("Couldn't share the image", (e as Error).message);
    }
  };
  const open = (href: string | null, name: string) => (href ? Linking.openURL(href) : Alert.alert(`${name} needs a share link`, "Create a share link first."));

  const B = ({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flexBasis: "48%", flexGrow: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: primary ? t.text : t.border, backgroundColor: primary ? t.text : t.surface, alignItems: "center" }}>
      <Text style={{ color: primary ? t.bg : t.text, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: "800" }}>Share this gist</Text>
          <Text onPress={onClose} style={{ color: t.accent, fontWeight: "700", fontSize: 16 }}>Done</Text>
        </View>
        <View style={{ alignItems: "center" }}>
          <View ref={card} collapsable={false} style={{ borderRadius: 12, overflow: "hidden" }}><Card gist={gist} /></View>
        </View>
        {share ? (
          <View style={{ gap: 8 }}>
            <Text selectable style={{ color: t.text, borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 10 }}>{share.url}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <B label="Copy link" onPress={() => Clipboard.setStringAsync(share.url).then(() => Alert.alert("Link copied"))} />
              <B label="Stop sharing" onPress={async () => { await api.deleteShare(gist.id); setShare(null); }} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ color: t.muted }}>A share link lets anyone read this gist and shows this card as the preview on X, Facebook and WhatsApp.</Text>
            <B label={busy ? "Creating…" : "Create share link"} onPress={createLink} primary />
          </View>
        )}
        <TextInput multiline value={message} onChangeText={setMessage} style={{ color: t.text, borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 10, minHeight: 110, textAlignVertical: "top" }} accessibilityLabel="Message" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <B label="X" onPress={() => open(links.x, "X")} />
          <B label="Reddit" onPress={() => { if (!share) Clipboard.setStringAsync(message); open(links.reddit, "Reddit"); }} />
          <B label="WhatsApp" onPress={() => open(links.whatsapp, "WhatsApp")} />
          <B label="Facebook" onPress={() => open(links.facebook, "Facebook")} />
          <B label="LinkedIn" onPress={() => open(links.linkedin, "LinkedIn")} />
          <B label="Instagram" onPress={shareImage} />
          <B label="More…" onPress={() => Share.share({ title: gist.summary?.title, message: share ? `${message}\n\n${share.url}` : message })} />
        </View>
        <Text style={{ color: t.muted, fontSize: 13 }}>Instagram shares the card as an image: pick Instagram, then Feed or Stories.</Text>
      </ScrollView>
    </Modal>
  );
}
