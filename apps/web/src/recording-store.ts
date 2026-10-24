import { api } from "./api";
export const PART_SIZE = 16 * 1024 * 1024;
export const MAX_RECORDING_SIZE = 8 * 1024 * 1024 * 1024;
export type RecordingJob = {
  id: string;
  owner: string;
  school: string;
  meeting: string;
  title: string;
  bytes: number;
  chunks: number;
  uploaded: number;
  stopped: boolean;
  created: number;
};
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("meet-recording-recovery", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("jobs", { keyPath: "id" });
      r.result.createObjectStore("chunks", { keyPath: ["job", "index"] });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(new Error("Đóng các tab Meet cũ để mở bộ nhớ bản ghi"));
  });
}
async function read<T>(store: string, key: IDBValidKey): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store);
    const r = tx.objectStore(store).get(key);
    tx.oncomplete = () => {
      db.close();
      resolve(r.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function saveJob(job: RecordingJob) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("jobs", "readwrite");
    tx.objectStore("jobs").put(job);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("Không lưu được bản ghi trên thiết bị"));
    };
  });
}
export const getJob = (id: string) => read<RecordingJob>("jobs", id);
export async function listJobs(owner: string, school: string) {
  const db = await open();
  return new Promise<RecordingJob[]>((resolve, reject) => {
    const tx = db.transaction("jobs"),
      r = tx.objectStore("jobs").getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(
        r.result.filter(
          (j: RecordingJob) => j.owner === owner && j.school === school,
        ),
      );
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function appendChunk(id: string, blob: Blob) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["jobs", "chunks"], "readwrite"),
      jobs = tx.objectStore("jobs"),
      r = jobs.get(id);
    r.onsuccess = () => {
      const job = r.result as RecordingJob;
      if (!job || job.bytes + blob.size > MAX_RECORDING_SIZE) {
        tx.abort();
        return;
      }
      tx.objectStore("chunks").put({ job: id, index: job.chunks, blob });
      job.chunks++;
      job.bytes += blob.size;
      jobs.put(job);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ||
          new Error("Không lưu được đoạn ghi: hết dung lượng hoặc vượt 8 GiB"),
      );
    };
  });
}
export async function readRecordingRange(
  id: string,
  start: number,
  length: number,
): Promise<Blob> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("chunks"),
      r = tx
        .objectStore("chunks")
        .openCursor(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    const chunks: Blob[] = [];
    let offset = 0;
    let bytes = 0;
    r.onsuccess = () => {
      const c = r.result;
      if (!c || bytes >= length) return;
      const blob = c.value.blob as Blob;
      if (offset + blob.size > start) {
        const piece = blob.slice(
          Math.max(0, start - offset),
          Math.min(blob.size, start + length - offset),
        );
        chunks.push(piece);
        bytes += piece.size;
      }
      offset += blob.size;
      c.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve(new Blob(chunks, { type: "video/webm" }));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function removeJob(id: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["jobs", "chunks"], "readwrite");
    tx.objectStore("jobs").delete(id);
    tx.objectStore("chunks").delete(
      IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
// Update only upload metadata: append transactions may be saving new chunks concurrently.
async function markUploaded(id: string, uploaded: number) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("jobs", "readwrite"),
      store = tx.objectStore("jobs"),
      r = store.get(id);
    r.onsuccess = () => {
      if (r.result) store.put({ ...r.result, uploaded });
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
const uploading = new Map<string, Promise<void>>();
export async function acquireCapture(id: string): Promise<() => void> {
  if (!navigator.locks)
    throw new Error("Trình duyệt chưa hỗ trợ khóa ghi an toàn giữa các tab");
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request("meet-capture:" + id, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error("Bản ghi đang được sử dụng trong tab khác"));
          return;
        }
        await new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
export async function recoverRecording(
  id: string,
  onStatus: (text: string) => void,
) {
  const release = await acquireCapture(id);
  try {
    await stopJob(id);
    await uploadRecording(id, onStatus);
    await uploadRecording(id, onStatus);
  } finally {
    release();
  }
}
export function uploadRecording(
  id: string,
  onStatus: (text: string) => void = () => {},
): Promise<void> {
  const existing = uploading.get(id);
  if (existing) return existing;
  const run = async () => {
    let job = await getJob(id);
    if (!job) return;
    const base = `/meetings/${job.meeting}/recordings/${id}`;
    while (job) {
      const available = job.bytes - job.uploaded * PART_SIZE;
      if (available <= 0 || (!job.stopped && available < PART_SIZE)) break;
      const part = job.uploaded + 1;
      const blob = await readRecordingRange(
        id,
        job.uploaded * PART_SIZE,
        Math.min(PART_SIZE, available),
      );
      if (!blob.size) throw new Error("Thiếu đoạn ghi trên thiết bị");
      onStatus(
        `Đang tải phần ${part} · ${Math.round(job.bytes / 1048576)} MB đã ghi`,
      );
      const signed = await api<{ url: string }>(`${base}/parts/${part}`, {
        size: blob.size,
      });
      const res = await fetch(signed.url, {
        method: "PUT",
        body: blob,
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok)
        throw new Error(
          "Tải bị gián đoạn; các đoạn ghi được giữ trên thiết bị để thử lại",
        );
      await markUploaded(id, part);
      job = await getJob(id);
    }
    if (
      job?.stopped &&
      job.bytes > 0 &&
      job.uploaded === Math.ceil(job.bytes / PART_SIZE)
    ) {
      onStatus("Đang xác minh bản ghi trên R2…");
      await api(`${base}/finish`, { parts: job.uploaded });
      await removeJob(id);
      onStatus("Đã lưu bản ghi vào R2");
    }
  };
  const work = (async () => {
    if (navigator.locks)
      await navigator.locks.request("meet-upload:" + id, run);
    else await run();
  })().finally(() => uploading.delete(id));
  uploading.set(id, work);
  return work;
}
export async function stopJob(id: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("jobs", "readwrite"),
      store = tx.objectStore("jobs"),
      r = store.get(id);
    r.onsuccess = () => {
      if (r.result) store.put({ ...r.result, stopped: true });
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
