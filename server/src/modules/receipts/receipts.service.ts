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

// receipt bytes go to the local filesystem, metadata to Postgres. for an
// actual deployment this would just be S3 + a presigned URL instead — only
// storageKey/writeObject/readObject would need to change. keeping bytes out
// of the DB on purpose: a 5MB photo sitting in a column bloats every backup
// and every seq scan of the table.
const UPLOAD_ROOT = resolve(process.cwd(), env.UPLOAD_DIR);

// keys are generated, never taken from the uploaded filename — something
// like "../../etc/passwd" would otherwise walk right out of the upload
// directory. sharding on the first two chars of the uuid keeps any single
// folder from ending up with tens of thousands of files in it.
function storageKeyFor(mime: SupportedImageMime): string {
  const id = randomUUID();
  return join(id.slice(0, 2), `${id}.${extensionFor(mime)}`);
}

function absolutePathFor(storageKey: string): string {
  const path = resolve(UPLOAD_ROOT, storageKey);
  // belt and braces — keys are generated so this shouldn't ever trip, but
  // never serve a path that resolved outside the upload root
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
  await writeFile(absolutePath, file.buffer, { flag: 'wx' }); // wx = refuse to overwrite an existing file

  try {
    return await withTransaction(async (client) => {
      // one receipt per loan — re-uploading replaces the row, and we clean
      // up whatever file the old row was pointing at
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
        // best effort cleanup — an orphaned file on disk is untidy, failing
        // the whole request over it would be worse
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
    // DB write failed, so don't leave the file sitting there either
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}

export async function openReceipt(userId: string, loanId: string) {
  const { rows } = await query<ReceiptRow>(
    // the user_id check IS the authorization here — nothing reads a receipt
    // without scoping to the caller first
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
    etag: `"${receipt.id}"`, // a real content hash would be more correct, but the id's stable and good enough
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
