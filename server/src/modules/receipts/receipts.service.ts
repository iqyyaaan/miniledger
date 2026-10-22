import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../../config/env.js';
import { query, withTransaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { detectImageMime, extensionFor, type SupportedImageMime } from '../../lib/image-type.js';
import { logger } from '../../lib/logger.js';

export interface ReceiptRow {
  id: string;
  loan_id: string;
  user_id: string;
  storage_key: string;
  mime_type: SupportedImageMime;
  size_bytes: number;
  original_name: string | null;
  created_at: Date;
}

/**
 * Receipts are written to the local filesystem and their metadata to Postgres.
 *
 * For a deployed app this would be S3 (or any object store) with a presigned
 * URL — but only `storageKey`, `writeObject` and `readObject` would change.
 * The database never stores the bytes: a 5 MB photo in a column bloats every
 * backup and every sequential scan of the table.
 */
const UPLOAD_ROOT = resolve(process.cwd(), env.UPLOAD_DIR);

/**
 * Keys are generated, never derived from the uploaded filename. A name like
 * `../../etc/passwd` or `../index.js` would otherwise escape the upload
 * directory. Sharding by the first two characters keeps any one directory
 * from accumulating tens of thousands of entries.
 */
function storageKeyFor(mime: SupportedImageMime): string {
  const id = randomUUID();
  return join(id.slice(0, 2), `${id}.${extensionFor(mime)}`);
}

function absolutePathFor(storageKey: string): string {
  const path = resolve(UPLOAD_ROOT, storageKey);
  // Belt and braces: even though keys are generated, never serve a path that
  // resolved outside the upload root.
  if (!path.startsWith(UPLOAD_ROOT)) throw badRequest('Invalid receipt path.');
  return path;
}

export async function attachReceipt(
  userId: string,
  loanId: string,
  file: { buffer: Buffer; originalname?: string; size: number },
): Promise<{ id: string; mimeType: string; sizeBytes: number; url: string }> {
  const mime = detectImageMime(file.buffer);
  if (!mime) {
    throw badRequest('That file is not a supported image. Use a JPEG, PNG, WebP or HEIC photo.');
  }

  const owns = await query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM loans WHERE id = $1::uuid AND user_id = $2) AS exists',
    [loanId, userId],
  );
  if (!owns.rows[0]?.exists) throw notFound('Loan');

  const storageKey = storageKeyFor(mime);
  const absolutePath = absolutePathFor(storageKey);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.buffer, { flag: 'wx' }); // 'wx' => never clobber.

  try {
    return await withTransaction(async (client) => {
      // One receipt per loan. Re-uploading replaces the row and we clean up
      // the file the old row pointed at.
      const previous = await client.query<{ storage_key: string }>(
        'SELECT storage_key FROM receipts WHERE loan_id = $1::uuid',
        [loanId],
      );

      const { rows } = await client.query<ReceiptRow>(
        `INSERT INTO receipts (loan_id, user_id, storage_key, mime_type, size_bytes, original_name)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)
         ON CONFLICT (loan_id) DO UPDATE
           SET storage_key   = EXCLUDED.storage_key,
               user_id       = EXCLUDED.user_id,
               mime_type     = EXCLUDED.mime_type,
               size_bytes    = EXCLUDED.size_bytes,
               original_name = EXCLUDED.original_name,
               created_at    = now()
         RETURNING id, loan_id, user_id, storage_key, mime_type, size_bytes, original_name, created_at`,
        [
          loanId,
          userId,
          storageKey,
          mime,
          file.size,
          file.originalname ? file.originalname.slice(0, 120) : null,
        ],
      );

      const old = previous.rows[0]?.storage_key;
      if (old && old !== storageKey) {
        // Best effort: an orphaned file is untidy, a failed request is worse.
        void unlink(absolutePathFor(old)).catch((error) =>
          logger.warn({ err: error, storageKey: old }, 'Could not remove replaced receipt'),
        );
      }

      const receipt = rows[0]!;
      logger.info({ userId, loanId, receiptId: receipt.id, mime }, 'Receipt attached');

      return {
        id: receipt.id,
        mimeType: receipt.mime_type,
        sizeBytes: receipt.size_bytes,
        url: `/api/loans/${loanId}/receipt`,
      };
    });
  } catch (error) {
    // The row never landed, so don't leave the bytes behind either.
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}

export async function openReceipt(userId: string, loanId: string) {
  const { rows } = await query<ReceiptRow>(
    // The `user_id` predicate is the authorisation check: there is no code
    // path that reads a receipt without scoping to the caller.
    'SELECT * FROM receipts WHERE loan_id = $1::uuid AND user_id = $2',
    [loanId, userId],
  );

  const receipt = rows[0];
  if (!receipt) throw notFound('Receipt');

  const absolutePath = absolutePathFor(receipt.storage_key);

  try {
    await stat(absolutePath);
  } catch {
    logger.error({ storageKey: receipt.storage_key }, 'Receipt row exists but file is missing');
    throw notFound('Receipt');
  }

  return {
    stream: createReadStream(absolutePath),
    mimeType: receipt.mime_type,
    sizeBytes: receipt.size_bytes,
    /** Content hash would be better; the id is stable and good enough here. */
    etag: `"${receipt.id}"`,
  };
}

export async function deleteReceipt(userId: string, loanId: string): Promise<void> {
  const { rows } = await query<{ storage_key: string }>(
    'DELETE FROM receipts WHERE loan_id = $1::uuid AND user_id = $2 RETURNING storage_key',
    [loanId, userId],
  );
  const key = rows[0]?.storage_key;
  if (!key) throw notFound('Receipt');

  await unlink(absolutePathFor(key)).catch((error) =>
    logger.warn({ err: error, storageKey: key }, 'Receipt row deleted but file remained'),
  );
}

export async function ensureUploadRoot(): Promise<void> {
  await mkdir(UPLOAD_ROOT, { recursive: true });
}
