import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { OtpInput } from '@/components/OtpInput';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api-types';
import { useTheme } from '@/theme/colors';

export default function VerifyScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { verifyOtp, requestOtp } = useAuth();
  const params = useLocalSearchParams<{
    phone: string;
    devCode?: string;
    otpLength?: string;
    expiresInSeconds?: string;
  }>();

  const otpLength = Number(params.otpLength) || 6;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Number(params.expiresInSeconds) || 30);
  const submittedRef = useRef(false);

  // Runs once; the functional setState form always reads the latest value,
  // so resending (which resets secondsLeft) doesn't need a new interval.
  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleVerify = async (candidate: string) => {
    if (submitting || submittedRef.current) return;
    submittedRef.current = true;
    setError(undefined);
    setSubmitting(true);
    try {
      await verifyOtp(params.phone, candidate);
      // No navigation call needed: the root Stack.Protected guard flips to
      // the signed-in group the instant useAuth's session state updates.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setCode('');
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (next: string) => {
    setCode(next);
    if (next.length === otpLength) void handleVerify(next);
  };

  const handleResend = async () => {
    setResending(true);
    setError(undefined);
    try {
      const result = await requestOtp(params.phone);
      setSecondsLeft(result.expiresInSeconds);
      setCode('');
      submittedRef.current = false;
      if (result.devCode) router.setParams({ devCode: result.devCode });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend the code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
    >
      <View style={styles.container}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Text style={[styles.backLabel, { color: colors.primary }]}>‹ Back</Text>
        </Pressable>

        <Text style={[styles.title, { color: colors.text }]}>Enter the code</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>Sent to {params.phone}</Text>

        <View style={styles.otpWrap}>
          <OtpInput length={otpLength} value={code} onChange={handleChange} />
        </View>

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        {params.devCode ? (
          <Pressable
            onPress={() => handleChange(params.devCode!)}
            style={[styles.devBanner, { backgroundColor: colors.warningSoft }]}
          >
            <Text style={[styles.devBannerText, { color: colors.warning }]}>
              Dev mode — code is {params.devCode}. Tap to autofill (it&rsquo;s printed in the server log too).
            </Text>
          </Pressable>
        ) : null}

        <Button
          label="Verify"
          onPress={() => handleVerify(code)}
          loading={submitting}
          disabled={code.length !== otpLength}
        />

        <Pressable onPress={handleResend} disabled={secondsLeft > 0 || resending} style={styles.resendWrap}>
          <Text style={[styles.resendLabel, { color: secondsLeft > 0 ? colors.textFaint : colors.primary }]}>
            {resending
              ? 'Sending a new code…'
              : secondsLeft > 0
                ? `Resend code in ${secondsLeft}s`
                : 'Resend code'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, padding: 28, gap: 14, justifyContent: 'center' },
  back: { position: 'absolute', top: 60, left: 20 },
  backLabel: { fontSize: 16, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 14.5 },
  otpWrap: { marginVertical: 20 },
  error: { fontSize: 13.5, textAlign: 'center' },
  devBanner: { borderRadius: 12, padding: 12 },
  devBannerText: { fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  resendWrap: { alignItems: 'center', paddingVertical: 12 },
  resendLabel: { fontSize: 14, fontWeight: '600' },
});
