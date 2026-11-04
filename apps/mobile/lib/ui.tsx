import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useTheme } from "./theme";

export function Button({ title, onPress, primary, disabled, style }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: primary ? t.accent : t.surface, borderColor: primary ? t.accent : t.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      <Text style={{ color: primary ? t.accentInk : t.text, fontWeight: "600", fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      {props.label && <Text style={{ color: t.text, fontWeight: "600", marginBottom: 6 }}>{props.label}</Text>}
      <TextInput placeholderTextColor={t.muted} {...props} style={[s.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }, props.style]} />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
});
