import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { pickReceiptImage, type PickedImage } from '@/lib/pick-image';
import { useTheme } from '@/theme/colors';

/** Used on the "Add entry" form, where there's no loan id yet to upload against. */
export function ReceiptAttachField({
  value,
  onChange,
}: {
  value: PickedImage | null;
  onChange: (file: PickedImage | null) => void;
}) {
  const { colors } = useTheme();

  const handlePick = async (source: 'camera' | 'library') => {
    const picked = await pickReceiptImage(source);
    if (picked) onChange(picked);
  };

  if (value) {
    return (
      <View style={styles.previewRow}>
        <Image source={{ uri: value.uri }} style={styles.thumbnail} contentFit="cover" />
        <View style={styles.previewMeta}>
          <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
            Receipt attached
          </Text>
          <Text style={[styles.hint, { color: colors.textMuted }]} numberOfLines={1}>
            {value.name}
          </Text>
        </View>
        <Pressable onPress={() => onChange(null)} hitSlop={10}>
          <Ionicons name="close-circle" size={22} color={colors.textFaint} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => handlePick('camera')}
        style={[styles.pickButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      >
        <Ionicons name="camera-outline" size={18} color={colors.textMuted} />
        <Text style={[styles.pickLabel, { color: colors.textMuted }]}>Camera</Text>
      </Pressable>
      <Pressable
        onPress={() => handlePick('library')}
        style={[styles.pickButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      >
        <Ionicons name="image-outline" size={18} color={colors.textMuted} />
        <Text style={[styles.pickLabel, { color: colors.textMuted }]}>Photo library</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  pickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  pickLabel: { fontSize: 13.5, fontWeight: '600' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 52, height: 52, borderRadius: 10 },
  previewMeta: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12 },
});
