import type { CreateMemoInput, MemoVisibility } from "@flaremo/contracts";

/**
 * The single composer uses this id. Consumers that expose multiple compose
 * surfaces can supply their own ids to keep their drafts separate.
 */
export const DEFAULT_NEW_MEMO_DRAFT_ID = "new-memo";
const NEW_MEMO_DRAFT_SESSION_KEY = "flaremo-new-memo-draft-id";

const DATABASE_NAME = "flaremo-local-memo-capture";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "drafts";
const SUBMISSION_QUEUE_STORE = "submission-queue";

export type MemoCaptureInput = {
  content: string;
  visibility: MemoVisibility;
  tags: string[];
  files: File[];
  /**
   * A client-generated id sent as `payload.client_id`. Keep it when an item is
   * retried so a future idempotent create endpoint can recognize the replay.
   */
  clientId?: string;
};

export type MemoDraft = MemoCaptureInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type QueuedMemoSubmission = MemoCaptureInput & {
  id: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
};

export type QueueFlushResult = {
  submittedIds: string[];
  failedIds: string[];
  remaining: number;
};

export type QueueFlushOptions = {
  /**
   * Return true for a known terminal failure so later independent entries can
   * still be delivered. Network-like failures keep the queue strictly ordered.
   */
  shouldContinueAfterFailure?: (
    error: unknown,
    submission: QueuedMemoSubmission,
  ) => boolean;
};

type PersistedAttachment = {
  filename: string;
  contentType: string;
  size: number;
  lastModified: number;
  blob: Blob;
};

type PersistedMemoCapture = Omit<MemoCaptureInput, "files"> & {
  attachments: PersistedAttachment[];
  clientId: string;
};

type DraftRecord = PersistedMemoCapture & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

type QueuedSubmissionRecord = PersistedMemoCapture & {
  id: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
};

let databasePromise: Promise<IDBDatabase | null> | undefined;

/**
 * Generates a UUID without assuming `crypto.randomUUID` exists in every
 * browser that can run the app. It is only an idempotency key, not a secret.
 */
export function createMemoCaptureClientId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const value = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(
    12,
    16,
  )}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/**
 * Keeps concurrent browser tabs from overwriting each other's composer. The
 * id survives reloads in the same tab session, while IndexedDB still owns the
 * actual draft bytes.
 */
export function getNewMemoDraftId() {
  if (typeof sessionStorage === "undefined") {
    return DEFAULT_NEW_MEMO_DRAFT_ID;
  }

  try {
    const existing = sessionStorage.getItem(NEW_MEMO_DRAFT_SESSION_KEY);
    if (existing) return existing;

    const draftId = `${DEFAULT_NEW_MEMO_DRAFT_ID}-${createMemoCaptureClientId()}`;
    sessionStorage.setItem(NEW_MEMO_DRAFT_SESSION_KEY, draftId);
    return draftId;
  } catch {
    return DEFAULT_NEW_MEMO_DRAFT_ID;
  }
}

/**
 * Creates an immutable-ish snapshot for persistence or queueing. File bytes
 * are represented by the File objects here and converted to Blob records only
 * at the IndexedDB boundary.
 */
export function createMemoCaptureInput(
  input: MemoCaptureInput,
): MemoCaptureInput {
  return {
    content: input.content,
    visibility: input.visibility,
    tags: normalizeTags(input.tags),
    files: [...input.files],
    clientId: input.clientId ?? createMemoCaptureClientId(),
  };
}

export function isMemoCaptureEmpty(input: MemoCaptureInput) {
  return input.content.trim().length === 0 && input.files.length === 0;
}

/**
 * Builds the memo portion of a replay request. Attachments deliberately remain
 * separate because they are uploaded directly against the idempotent memo.
 */
export function toCreateMemoInput(
  input: MemoCaptureInput,
  source = "web",
): CreateMemoInput {
  const capture = createMemoCaptureInput(input);
  return {
    content: capture.content,
    visibility: capture.visibility,
    payload: {
      tags: capture.tags,
      client_id: capture.clientId,
    },
    source,
  };
}

/** Returns false instead of throwing when IndexedDB is disabled or unavailable. */
export async function isLocalMemoCaptureAvailable() {
  return Boolean(await openDatabase());
}

export async function saveMemoDraft(
  input: MemoCaptureInput,
  draftId = DEFAULT_NEW_MEMO_DRAFT_ID,
): Promise<MemoDraft | null> {
  const existing = await getRecord<DraftRecord>(DRAFT_STORE, draftId);
  const now = Date.now();
  const record: DraftRecord = {
    ...toPersistedCapture(input),
    id: draftId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (!(await putRecord(DRAFT_STORE, record))) {
    return null;
  }
  return fromDraftRecord(record);
}

export async function restoreMemoDraft(
  draftId = DEFAULT_NEW_MEMO_DRAFT_ID,
): Promise<MemoDraft | null> {
  const record = await getRecord<DraftRecord>(DRAFT_STORE, draftId);
  return record ? fromDraftRecord(record) : null;
}

export async function listMemoDrafts(): Promise<MemoDraft[]> {
  const records = await getAllRecords<DraftRecord>(DRAFT_STORE);
  return records
    .map(fromDraftRecord)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * `false` means storage was unavailable or the deletion could not be
 * confirmed. Deleting a missing draft is still a successful operation.
 */
export async function removeMemoDraft(draftId = DEFAULT_NEW_MEMO_DRAFT_ID) {
  return deleteRecord(DRAFT_STORE, draftId);
}

export async function enqueueMemoSubmission(
  input: MemoCaptureInput,
): Promise<QueuedMemoSubmission | null> {
  const now = Date.now();
  const capture = toPersistedCapture(input);
  // The client id is also the queue key. Repeated clicks and a retry after an
  // uncertain network response therefore update one durable submission rather
  // than creating duplicate queue entries.
  const existing = await getRecord<QueuedSubmissionRecord>(
    SUBMISSION_QUEUE_STORE,
    capture.clientId,
  );
  const record: QueuedSubmissionRecord = {
    ...capture,
    id: capture.clientId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attempts: existing?.attempts ?? 0,
    ...(existing?.lastAttemptAt
      ? { lastAttemptAt: existing.lastAttemptAt }
      : {}),
    ...(existing?.lastError ? { lastError: existing.lastError } : {}),
  };

  if (!(await putRecord(SUBMISSION_QUEUE_STORE, record))) {
    return null;
  }
  return fromQueuedSubmissionRecord(record);
}

export async function listQueuedMemoSubmissions(): Promise<
  QueuedMemoSubmission[]
> {
  const records = await getAllRecords<QueuedSubmissionRecord>(
    SUBMISSION_QUEUE_STORE,
  );
  return records
    .map(fromQueuedSubmissionRecord)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function removeQueuedMemoSubmission(id: string) {
  return deleteRecord(SUBMISSION_QUEUE_STORE, id);
}

/**
 * Replays queue entries in creation order. A failed item remains in the queue
 * with its attempt count and error message. Network-like failures preserve
 * ordering; known terminal failures may let later independent entries proceed.
 */
export async function flushQueuedMemoSubmissions(
  submit: (submission: QueuedMemoSubmission) => Promise<unknown>,
  options: QueueFlushOptions = {},
): Promise<QueueFlushResult> {
  const submissions = await listQueuedMemoSubmissions();
  const submittedIds: string[] = [];
  const failedIds: string[] = [];

  for (const submission of submissions) {
    try {
      await submit(submission);
      const removed = await removeQueuedMemoSubmission(submission.id);
      if (!removed) {
        return {
          submittedIds,
          failedIds: [...failedIds, submission.id],
          remaining: submissions.length - submittedIds.length,
        };
      }
      submittedIds.push(submission.id);
    } catch (error) {
      await recordQueueAttemptFailure(submission, error);
      failedIds.push(submission.id);
      if (!options.shouldContinueAfterFailure?.(error, submission)) {
        return {
          submittedIds,
          failedIds,
          remaining: submissions.length - submittedIds.length,
        };
      }
    }
  }

  return {
    submittedIds,
    failedIds,
    remaining: submissions.length - submittedIds.length,
  };
}

export function isBrowserOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function toPersistedCapture(input: MemoCaptureInput): PersistedMemoCapture {
  const capture = createMemoCaptureInput(input);
  return {
    content: capture.content,
    visibility: capture.visibility,
    tags: capture.tags,
    clientId: capture.clientId ?? createMemoCaptureClientId(),
    attachments: capture.files.map((file) => ({
      filename: file.name,
      contentType: file.type,
      size: file.size,
      lastModified: file.lastModified,
      // Blob is structured-cloneable in IndexedDB and retains selected file
      // bytes even after the original input element is reset.
      blob: file.slice(0, file.size, file.type),
    })),
  };
}

function fromDraftRecord(record: DraftRecord): MemoDraft {
  return {
    ...fromPersistedCapture(record),
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function fromQueuedSubmissionRecord(
  record: QueuedSubmissionRecord,
): QueuedMemoSubmission {
  return {
    ...fromPersistedCapture(record),
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attempts: record.attempts,
    lastAttemptAt: record.lastAttemptAt,
    lastError: record.lastError,
  };
}

function fromPersistedCapture(record: PersistedMemoCapture): MemoCaptureInput {
  return {
    content: record.content,
    visibility: record.visibility,
    tags: [...record.tags],
    files: record.attachments.map(toFile),
    clientId: record.clientId,
  };
}

function toFile(attachment: PersistedAttachment): File {
  return new File([attachment.blob], attachment.filename, {
    type: attachment.contentType,
    lastModified: attachment.lastModified,
  });
}

async function recordQueueAttemptFailure(
  submission: QueuedMemoSubmission,
  error: unknown,
) {
  const current = await getRecord<QueuedSubmissionRecord>(
    SUBMISSION_QUEUE_STORE,
    submission.id,
  );
  if (!current) return;

  const now = Date.now();
  await putRecord(SUBMISSION_QUEUE_STORE, {
    ...current,
    attempts: current.attempts + 1,
    updatedAt: now,
    lastAttemptAt: now,
    lastError: errorMessage(error),
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") return null;

  databasePromise = new Promise((resolve) => {
    let settled = false;
    const finish = (database: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(database);
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      finish(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(SUBMISSION_QUEUE_STORE)) {
        database.createObjectStore(SUBMISSION_QUEUE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      finish(database);
    };
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });

  return databasePromise;
}

async function getRecord<T>(storeName: string, key: IDBValidKey) {
  const database = await openDatabase();
  if (!database) return null;

  try {
    return await new Promise<T | null>((resolve) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () =>
        resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
      transaction.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  if (!database) return [];

  try {
    return await new Promise<T[]>((resolve) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () =>
        resolve((request.result as T[] | undefined) ?? []);
      request.onerror = () => resolve([]);
      transaction.onabort = () => resolve([]);
      transaction.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function putRecord<T extends { id: string }>(
  storeName: string,
  record: T,
) {
  const database = await openDatabase();
  if (!database) return false;

  try {
    return await new Promise<boolean>((resolve) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => resolve(false);
      transaction.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

async function deleteRecord(storeName: string, key: IDBValidKey) {
  const database = await openDatabase();
  if (!database) return false;

  try {
    return await new Promise<boolean>((resolve) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = () => resolve(false);
      transaction.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
