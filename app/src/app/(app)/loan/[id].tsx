import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from '@/components/Button';
import { DueDateField } from '@/components/DueDateField';
import { ReceiptAttachField } from '@/components/ReceiptAttachField';
import { StatusPill } from '@/components/StatusPill';
import { TextField } from '@/components/TextField';
import {
  useDeleteLoan,
  useDeleteReceipt,
  useLoan,
  useMarkRepaid,
  useUndoRepaid,
  useUpdateLoan,
  useUploadReceipt,
} from '@/hooks/use-loans';
import { authHeaders, absoluteApiUrl } from '@/lib/api-client';
import { ApiError } from '@/lib/api-types';
import { formatDaysUntilDue, formatIsoDate } from '@/lib/dates';
import { formatMinorAsCurrency, tryParseAmountToMinor } from '@/lib/money';
import type { PickedImage } from '@/lib/pick-image';
import { useTheme } from '@/theme/colors';

export default function LoanDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: loan, isLoading } = useLoan(id);
  const markRepaid = useMarkRepaid();
  const undoRepaid = useUndoRepaid();
  const deleteLoan = useDeleteLoan();
  const updateLoan = useUpdateLoan(id);
  const uploadReceipt = useUploadReceipt(id);
  const deleteReceipt = useDeleteReceipt(id);

  const [editing, setEditing] = useState(false);
  const [friendName, setFriendName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [editError, setEditError] = useState<string | undefined>();

  if (isLoading || !loan) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const startEditing = () => {
    setFriendName(loan.friendName);
    setAmount(loan.amount);
    setDueDate(loan.dueDate);
    setNote(loan.note ?? '');
    setEditError(undefined);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setEditError(undefined);
    try {
      await updateLoan.mutateAsync({
        friendName: friendName.trim(),
        amount,
        dueDate,
        note: note.trim() || null,
      });
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not save changes.');
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete this entry?', `${loan.friendName} — ${formatMinorAsCurrency(loan.amountMinor)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteLoan.mutate(loan.id, {
            onSuccess: () => router.back(),
            onError: () => Alert.alert('Could not delete this entry', 'Please try again.'),
          }),
      },
    ]);
  };

  const handlePickReceipt = (file: PickedImage | null) => {
    if (!file) return;
    uploadReceipt.mutate(file, {
      onError: () => Alert.alert('Upload failed', "That doesn't look like a supported image."),
    });
  };

  const handleRemoveReceipt = () => {
    Alert.alert('Remove receipt?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteReceipt.mutate() },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      {editing ? (
        <View style={styles.editForm}>
          <TextField label="Friend's name" value={friendName} onChangeText={setFriendName} autoCapitalize="words" />
          <TextField label="Amount" prefix="₹" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <View style={styles.field}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Due date</Text>
            <DueDateField value={dueDate} onChange={setDueDate} />
          </View>
          <TextField label="Note" value={note} onChangeText={setNote} multiline style={styles.noteInput} />
          {editError ? <Text style={[styles.errorText, { color: colors.danger }]}>{editError}</Text> : null}
          <View style={styles.editActions}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Save"
                onPress={handleSaveEdit}
                loading={updateLoan.isPending}
                disabled={
                  friendName.trim().length === 0 || tryParseAmountToMinor(amount) === null
                }
              />
            </View>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={[styles.friendName, { color: colors.text }]}>{loan.friendName}</Text>
              <Text style={[styles.amount, { color: colors.text }]}>
                {formatMinorAsCurrency(loan.amountMinor, loan.currency)}
              </Text>
            </View>
            <Pressable onPress={startEditing} hitSlop={10} style={styles.editButton}>
              <Ionicons name="create-outline" size={20} color={colors.primary} />
            </Pressable>
          </View>

          <View style={styles.badgeRow}>
            {loan.status === 'repaid' ? (
              <StatusPill label="Repaid" tone="success" />
            ) : loan.isOverdue ? (
              <StatusPill label={formatDaysUntilDue(loan.daysUntilDue)} tone="danger" />
            ) : (
              <StatusPill label={formatDaysUntilDue(loan.daysUntilDue)} tone="neutral" />
            )}
          </View>

          <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <DetailRow label="Due date" value={formatIsoDate(loan.dueDate)} />
            {loan.status === 'repaid' && loan.repaidAt ? (
              <DetailRow label="Repaid on" value={new Date(loan.repaidAt).toLocaleDateString()} />
            ) : null}
            <DetailRow label="Added on" value={new Date(loan.createdAt).toLocaleDateString()} />
            {loan.note ? <DetailRow label="Note" value={loan.note} multiline /> : null}
          </View>

          <View style={styles.field}>
            <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Receipt</Text>
            {loan.receipt ? (
              <View style={styles.receiptRow}>
                <Image
                  source={{ uri: absoluteApiUrl(loan.receipt.url), headers: authHeaders() }}
                  style={styles.receiptImage}
                  contentFit="cover"
                />
                <Pressable
                  onPress={handleRemoveReceipt}
                  disabled={deleteReceipt.isPending}
                  style={[styles.removeReceiptButton, { backgroundColor: colors.dangerSoft }]}
                >
                  {deleteReceipt.isPending ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <Text style={[styles.removeReceiptLabel, { color: colors.danger }]}>Remove receipt</Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <ReceiptAttachField value={null} onChange={handlePickReceipt} />
            )}
            {uploadReceipt.isPending ? (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.uploadingLabel, { color: colors.textMuted }]}>Uploading…</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actions}>
            {loan.status === 'outstanding' ? (
              <Button
                label="Mark as repaid"
                onPress={() => markRepaid.mutate(loan.id, { onSuccess: () => router.back() })}
                loading={markRepaid.isPending}
              />
            ) : (
              <Button
                label="Undo repayment"
                variant="secondary"
                onPress={() => undoRepaid.mutate(loan.id)}
                loading={undoRepaid.isPending}
              />
            )}
            <Button label="Delete entry" variant="danger" onPress={handleDelete} loading={deleteLoan.isPending} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.detailRow, multiline && styles.detailRowMultiline]}>
      <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, gap: 20, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerText: { gap: 4, flex: 1 },
  friendName: { fontSize: 22, fontWeight: '800' },
  amount: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  editButton: { padding: 6 },
  badgeRow: { flexDirection: 'row' },
  detailsCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailRowMultiline: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  detailLabel: { fontSize: 13, fontWeight: '600' },
  detailValue: { fontSize: 14.5, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  field: { gap: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  receiptRow: { gap: 10 },
  receiptImage: { width: '100%', height: 220, borderRadius: 14 },
  removeReceiptButton: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  removeReceiptLabel: { fontSize: 13, fontWeight: '700' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadingLabel: { fontSize: 13 },
  actions: { gap: 12, marginTop: 8 },
  editForm: { gap: 16 },
  editActions: { flexDirection: 'row', gap: 12 },
  errorText: { fontSize: 12.5 },
  noteInput: { minHeight: 70, textAlignVertical: 'top' },
});
