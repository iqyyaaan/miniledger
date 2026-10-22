import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { DueDateField } from '@/components/DueDateField';
import { FriendSuggestions } from '@/components/FriendSuggestions';
import { ReceiptAttachField } from '@/components/ReceiptAttachField';
import { TextField } from '@/components/TextField';
import { loansApi } from '@/lib/endpoints';
import { useCreateLoan } from '@/hooks/use-loans';
import { ApiError } from '@/lib/api-types';
import { todayIso } from '@/lib/dates';
import { tryParseAmountToMinor } from '@/lib/money';
import type { PickedImage } from '@/lib/pick-image';
import { useTheme } from '@/theme/colors';

export default function AddLoanScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const createLoan = useCreateLoan();

  const [friendName, setFriendName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<PickedImage | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();

  const amountPreviewMinor = amount ? tryParseAmountToMinor(amount) : null;
  const canSubmit = friendName.trim().length > 0 && amountPreviewMinor !== null && !createLoan.isPending;

  const handleSubmit = async () => {
    setFieldErrors({});
    setFormError(undefined);

    try {
      const loan = await createLoan.mutateAsync({
        friendName: friendName.trim(),
        amount,
        dueDate,
        note: note.trim() || null,
      });

      if (receipt) {
        // The loan is created either way — a receipt upload failure here
        // shouldn't undo it, just surface a note so the user knows to retry
        // from the detail screen.
        await loansApi.uploadReceipt(loan.id, receipt).catch(() => {
          setFormError('Entry saved, but the receipt photo failed to upload. Add it from the entry screen.');
        });
      }

      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((e) => [e.field, e.message])));
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not save this entry.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <TextField
            label="Friend's name"
            placeholder="Ravi"
            value={friendName}
            onChangeText={setFriendName}
            error={fieldErrors.friendName}
            autoCapitalize="words"
          />
          <FriendSuggestions query={friendName} onPick={setFriendName} />
        </View>

        <TextField
          label="Amount"
          prefix="₹"
          placeholder="0.00"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          error={fieldErrors.amount}
        />

        <View style={styles.field}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Due date</Text>
          <DueDateField value={dueDate} onChange={setDueDate} />
          {fieldErrors.dueDate ? <Text style={[styles.errorText, { color: colors.danger }]}>{fieldErrors.dueDate}</Text> : null}
        </View>

        <TextField
          label="Note (optional)"
          placeholder="What was it for?"
          value={note}
          onChangeText={setNote}
          error={fieldErrors.note}
          multiline
          style={styles.noteInput}
        />

        <View style={styles.field}>
          <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Receipt (optional)</Text>
          <ReceiptAttachField value={receipt} onChange={setReceipt} />
        </View>

        {formError ? <Text style={[styles.errorText, { color: colors.danger }]}>{formError}</Text> : null}

        <Button label="Save entry" onPress={handleSubmit} loading={createLoan.isPending} disabled={!canSubmit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 20, gap: 18, paddingBottom: 48 },
  field: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  errorText: { fontSize: 12.5 },
  noteInput: { minHeight: 80, textAlignVertical: 'top' },
});
