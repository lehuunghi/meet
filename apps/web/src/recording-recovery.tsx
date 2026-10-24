import { useEffect, useState } from "react";
import { api } from "./api";
import {
  listJobs,
  removeJob,
  recoverRecording,
  acquireCapture,
  readRecordingRange,
  type RecordingJob,
} from "./recording-store";
export function RecordingRecovery({
  owner,
  school,
  active = "",
}: {
  owner: string;
  school: string;
  active?: string;
}) {
  const [jobs, setJobs] = useState<RecordingJob[]>([]),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = () =>
    listJobs(owner, school)
      .then(setJobs)
      .catch(() =>
        setStatus("Trình duyệt không cho phép bộ nhớ phục hồi bản ghi"),
      );
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 10000);
    return () => clearInterval(timer);
  }, [owner, school]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visible = jobs.filter((j) => j.id !== active);
  if (!visible.length) return null;
  return (
    <section className="section recording-recovery">
      <h2>Bản ghi còn trên thiết bị</h2>
      <p>
        Các đoạn đã lưu có thể tải lại sau khi mất mạng. Dùng đúng trình duyệt
        và tài khoản này; không xóa dữ liệu trình duyệt trước khi hoàn tất.
      </p>
      {status && <p role="status">{status}</p>}
      {visible.map((job) => (
        <article key={job.id}>
          <strong>{job.title}</strong>
          <p>
            {new Date(job.created).toLocaleString("vi-VN")} ·{" "}
            {Math.round(job.bytes / 1048576)} MB · {job.uploaded} phần đã tải
          </p>
          <div className="recovery-actions">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await recoverRecording(job.id, setStatus);
                })
              }
            >
              Tiếp tục tải lên R2
            </button>
            <button
              className="secondary"
              disabled={busy || !job.bytes}
              onClick={() =>
                void run(async () => {
                  const blob = await readRecordingRange(job.id, 0, job.bytes);
                  const url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = `meet-${job.id}.webm`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 60000);
                  setStatus(
                    "Đã tạo file tải xuống; kiểm tra file trước khi xóa bản trên thiết bị.",
                  );
                })
              }
            >
              Lưu file về máy
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !confirm(
                      "Hủy tải và xóa các đoạn ghi trên thiết bị? Thao tác này không thể hoàn tác.",
                    )
                  )
                    return;
                  const release = await acquireCapture(job.id);
                  try {
                    await api(
                      `/meetings/${job.meeting}/recordings/${job.id}/abort`,
                      {},
                    );
                    await removeJob(job.id);
                  } finally {
                    release();
                  }
                })
              }
            >
              Hủy bản ghi
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
