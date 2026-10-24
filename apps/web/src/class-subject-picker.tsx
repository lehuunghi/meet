import "./class-subject-picker.css";
export type ScopedCourse = {
  id: string;
  name: string;
  class_id: string;
  class_name: string;
  teacher: string;
};

export function ClassSubjectPicker({
  courses,
  classId,
  courseId,
  onClass,
  onCourse,
}: {
  courses: ScopedCourse[];
  classId: string;
  courseId: string;
  onClass: (id: string) => void;
  onCourse: (id: string) => void;
}) {
  const classes = [
    ...new Map(
      courses.map((c) => [c.class_id, { id: c.class_id, name: c.class_name }]),
    ).values(),
  ];
  const subjects = courses.filter((c) => c.class_id === classId),
    selected = subjects.find((c) => c.id === courseId);
  return (
    <div className="class-subject-picker">
      <div className="scope-selects">
        <label>
          Lớp học
          <select
            aria-label="Lớp học"
            value={classId}
            onChange={(e) => onClass(e.target.value)}
          >
            <option value="">Chọn lớp học</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Môn học
          <select
            aria-label="Môn học"
            value={courseId}
            disabled={!classId}
            onChange={(e) => onCourse(e.target.value)}
          >
            <option value="">Chọn môn học</option>
            {subjects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3>1. Chọn lớp học</h3>
      <div className="scope-folders" aria-label="Danh sách lớp">
        {classes.map((c) => (
          <button
            type="button"
            key={c.id}
            aria-pressed={classId === c.id}
            onClick={() => onClass(c.id)}
          >
            <span aria-hidden="true">▤</span>
            <strong>Lớp {c.name}</strong>
            <small>
              {courses.filter((s) => s.class_id === c.id).length} môn học
            </small>
          </button>
        ))}
      </div>
      {classId && (
        <>
          <h3>
            2. Chọn môn · Lớp {classes.find((c) => c.id === classId)?.name}
          </h3>
          <div className="scope-folders subjects" aria-label="Danh sách môn">
            {subjects.map((c) => (
              <button
                type="button"
                key={c.id}
                aria-label={`Môn ${c.name}`}
                aria-pressed={courseId === c.id}
                onClick={() => onCourse(c.id)}
              >
                <strong>{c.name}</strong>
                <small>Giáo viên: {c.teacher}</small>
              </button>
            ))}
          </div>
        </>
      )}
      {selected && (
        <nav className="scope-breadcrumb" aria-label="Phạm vi đang xem">
          <span>Lớp {selected.class_name}</span>
          <span aria-hidden="true">›</span>
          <strong>{selected.name}</strong>
        </nav>
      )}
    </div>
  );
}
