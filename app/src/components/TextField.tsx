import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/colors';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  prefix?: string;
  hint?: string;
}

// RN 0.88's TextInput ref type is `TextInputInstance`, not the `TextInput`
// component type itself — see TextInput.d.ts's `$$TextInput` default export.
export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, error, prefix, hint, style, ...inputProps },
  ref,
) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      >
        {prefix ? <Text style={[styles.prefix, { color: colors.textMuted }]}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          style={[styles.input, { color: colors.text }, style]}
          {...inputProps}
        />
      </View>
      {error ? (
        <Text style={[styles.message, { color: colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.message, { color: colors.textFaint }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  prefix: { fontSize: 16, marginRight: 4, fontWeight: '600' },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  message: { fontSize: 12, marginTop: 2 },
});
