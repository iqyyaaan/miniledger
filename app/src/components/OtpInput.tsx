import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/colors';

// one hidden TextInput actually catches the keystrokes — the boxes you see
// are just a rendering of `value`. this is the normal trick for a
// "digit box" OTP field on mobile, and it's worth it specifically because
// it keeps the native numeric keypad, SMS autofill, and paste behavior for
// free. six separately-focused inputs would each have to reimplement all
// of that and would get at least one of them subtly wrong.
export function OtpInput({
  length,
  value,
  onChange,
  autoFocus = true,
}: {
  length: number;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const { colors } = useTheme();
  const digits = value.padEnd(length, ' ').split('');

  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        maxLength={length}
        style={styles.hiddenInput}
      />
      <View style={styles.boxRow} pointerEvents="none">
        {digits.map((digit, index) => {
          const isCursor = index === value.length;
          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: isCursor ? colors.primary : colors.border,
                },
              ]}
            >
              <TextInput
                editable={false}
                value={digit === ' ' ? '' : digit}
                style={[styles.digitText, { color: colors.text }]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 },
  boxRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  box: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitText: { fontSize: 22, fontWeight: '700', textAlign: 'center', padding: 0 },
});
