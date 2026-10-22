import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api-types';
import { DEFAULT_COUNTRY_CODE } from '@/lib/config';
import { useTheme } from '@/theme/colors';

export default function LoginScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { requestOtp } = useAuth();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await requestOtp(phone);
      router.push({
        pathname: '/verify',
        params: {
          phone: result.phone,
          devCode: result.devCode ?? '',
          otpLength: String(result.otpLength),
          expiresInSeconds: String(result.expiresInSeconds),
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.fieldError('phone') ?? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.logo, { backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.logoGlyph, { color: colors.primary }]}>₹</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>MiniLedger</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Track money you&rsquo;ve lent to friends — who owes you, how much, and since when.
        </Text>

        <View style={styles.form}>
          <TextField
            label="Phone number"
            prefix={DEFAULT_COUNTRY_CODE}
            placeholder="98765 43210"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            value={phone}
            onChangeText={setPhone}
            error={error}
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
          />
          <Button label="Send code" onPress={handleSubmit} loading={submitting} disabled={phone.trim().length < 6} />
        </View>

        <Text style={[styles.disclaimer, { color: colors.textFaint }]}>
          We&rsquo;ll text you a one-time code. No password needed.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 8 },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logoGlyph: { fontSize: 30, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14.5, lineHeight: 21, marginTop: 6, marginBottom: 24 },
  form: { gap: 16 },
  disclaimer: { fontSize: 12.5, textAlign: 'center', marginTop: 20 },
});
