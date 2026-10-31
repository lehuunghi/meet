// Same-origin central workspace. All school operations use the authenticated agent bridge.
async function centralCourseVideos(course, title) {
  let panel = $("#course-videos");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "course-videos";
    $("#business-content").append(panel);
  }
  panel.innerHTML =
    "<h3>Bài giảng · " +
    esc(title) +
    '</h3><p>Video riêng tư được tải trực tiếp lên R2, không qua ổ đĩa trung tâm.</p><div id="lesson-list"></div><form id="lesson-upload"><div class="grid">' +
    input("title", "Tên bài học") +
    '<label>Video MP4 / WebM<input name="video" type="file" accept="video/mp4,video/webm" required></label>' +
    input(
      "duration",
      "Thời lượng (giây; tự điền khi đọc được video)",
      1,
      "number",
    ) +
    '</div><button class="primary">Tải bài giảng lên R2</button><p id="lesson-progress" role="status"></p></form>';
  const lessons = await academyRequest(
    "GET",
    "/api/academy/courses/" + course + "/lessons",
  );
  const list = $("#lesson-list");
  if (!list) return;
  const table = document.createElement("table");
  table.innerHTML =
    "<tr><th>Bài học</th><th>Thời lượng</th><th>Trạng thái</th><th></th></tr>";
  for (const lesson of lessons) {
    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" +
      esc(lesson.title) +
      "</td><td>" +
      esc(lesson.duration_seconds) +
      " giây</td><td>" +
      esc(lesson.status === "ready" ? "Đã sẵn sàng" : "Chưa tải xong") +
      "</td><td></td>";
    if (lesson.status === "ready")
      row.lastChild.append(
        button("Xem thử", async () => {
          const playback = await academyRequest(
            "POST",
            "/api/academy/lessons/" + lesson.id + "/play",
            {},
          );
          const video = document.createElement("video");
          video.controls = true;
          video.playsInline = true;
          video.style.width = "100%";
          video.src = playback.url;
          list.append(video);
        }),
      );
    table.append(row);
  }
  list.className = "table";
  list.append(table);
  const form = $("#lesson-upload");
  form.elements.namedItem("video").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const video = document.createElement("video"),
      url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration))
        form.elements.namedItem("duration").value = Math.ceil(video.duration);
      URL.revokeObjectURL(url);
    };
    video.onerror = () => URL.revokeObjectURL(url);
    video.src = url;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const submit = form.querySelector("button"),
      status = $("#lesson-progress");
    submit.disabled = true;
    try {
      const values = new FormData(form),
        file = values.get("video");
      if (!file.size) throw Error("Chọn video trước.");
      status.textContent = "Đang cấp quyền tải…";
      const mime =
        file.type || (/\.webm$/i.test(file.name) ? "video/webm" : "video/mp4");
      const upload = await academyRequest(
        "POST",
        "/api/academy/courses/" + course + "/lessons",
        {
          title: values.get("title"),
          size: file.size,
          type: mime,
          duration_seconds: Number(values.get("duration")),
        },
      );
      status.textContent = "Đang tải video trực tiếp lên R2…";
      const response = await fetch(upload.url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!response.ok)
        throw Error("Tải R2 chưa thành công; kiểm tra CORS và kết nối.");
      status.textContent = "Đang xác nhận file…";
      await academyRequest(
        "POST",
        "/api/academy/lessons/" + upload.id + "/finish",
        {},
      );
      msg("Đã tải và xác nhận bài giảng.");
      await centralCourseVideos(course, title);
    } catch (e) {
      status.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
}
async function academicPanel(kind) {
  const root = $("#panel"),
    sid = selected.id;
  root.innerHTML =
    "<h3>" +
    esc(kind === "teachers" ? "Giáo viên" : "Lớp Live, môn học và phân công") +
    '</h3><p>Quản lý tập trung tại đây, không cần bảng quản trị thứ hai.</p><button id="academic-load">Tải dữ liệu</button><p id="academic-status" role="status"></p><div id="academic-data"></div>';
  $("#academic-load").onclick = async () => {
    const btn = $("#academic-load");
    btn.disabled = true;
    $("#academic-status").textContent = "Đang lấy dữ liệu từ VPS…";
    try {
      const people = await academyRequest("GET", "/api/academy/control/people");
      if (!tab.startsWith("biz_") || selected.id !== sid) return;
      const teachers = people.filter((x) => x.role === "teacher"),
        target = $("#academic-data");
      target.innerHTML = "";
      const options = (items, label) =>
        '<option value="">' +
        esc(label) +
        "</option>" +
        items
          .map(
            (x) =>
              '<option value="' +
              esc(x.id) +
              '">' +
              esc((x.short_id ? x.short_id + " · " : "") + x.name) +
              "</option>",
          )
          .join("");
      if (kind === "teachers") {
        target.innerHTML =
          '<div class="table"><table><thead><tr><th>Mã</th><th>Giáo viên</th><th>Email</th><th>Trạng thái</th><th></th></tr></thead><tbody id="teacher-rows"></tbody></table></div><h3>Tạo / sửa giáo viên</h3><form id="teacher-form" class="grid">' +
          input("id", "ID (để trống khi tạo)") +
          input("revision", "Revision", 0, "number") +
          input("name", "Họ tên") +
          input("email", "Email", "", "email") +
          input(
            "password",
            "Mật khẩu từ 6 ký tự; để trống khi không đổi",
            "",
            "password",
          ) +
          '<button class="primary">Lưu giáo viên</button></form>';
        for (const teacher of teachers) {
          const tr = document.createElement("tr");
          tr.innerHTML =
            "<td>" +
            esc(teacher.short_id || teacher.id) +
            "</td><td>" +
            esc(teacher.name) +
            "</td><td>" +
            esc(teacher.email) +
            "</td><td>" +
            esc(teacher.state) +
            "</td><td></td>";
          tr.lastChild.append(
            button("Sửa", () => {
              for (const key of ["id", "revision", "name", "email"])
                $("#teacher-form").elements.namedItem(key).value =
                  teacher[key] || "";
              $("#teacher-form").scrollIntoView({ block: "nearest" });
            }),
          );
          $("#teacher-rows").append(tr);
        }
        $("#teacher-form").onsubmit = async (e) => {
          e.preventDefault();
          try {
            const v = Object.fromEntries(new FormData(e.target));
            v.revision = Number(v.revision);
            await academyRequest("POST", "/api/academy/control/teachers", {
              rows: [v],
            });
            msg("Đã lưu giáo viên.");
            $("#academic-load").click();
          } catch (e) {
            msg(e.message);
          }
        };
      } else {
        const [classes, courses] = await Promise.all([
          academyRequest("GET", "/api/academy/control/classes"),
          academyRequest("GET", "/api/academy/control/catalog"),
        ]);
        if (tab !== "biz_classes" || selected.id !== sid) return;
        target.innerHTML =
          '<form id="class-create" class="grid">' +
          input("name", "Tên lớp Live") +
          '<button class="primary">Tạo lớp</button></form><label>Lớp<select id="live-class">' +
          options(classes, "Chọn lớp") +
          '</select></label><div id="subject-data"></div>';
        $("#class-create").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await academyRequest(
              "POST",
              "/api/academy/control/classes",
              Object.fromEntries(new FormData(e.target)),
            );
            $("#academic-load").click();
          } catch (e) {
            msg(e.message);
          }
        };
        $("#live-class").onchange = () => {
          const classId = $("#live-class").value,
            items = courses.filter((c) => c.class_id === classId);
          $("#subject-data").innerHTML = classId
            ? '<div class="table"><table><tr><th>Mã môn</th><th>Môn</th><th>Giáo viên</th></tr>' +
              items
                .map(
                  (c) =>
                    "<tr><td>" +
                    esc(c.short_id || c.id) +
                    "</td><td>" +
                    esc(c.name) +
                    "</td><td>" +
                    esc(c.teacher_name || "Chưa phân công") +
                    "</td></tr>",
                )
                .join("") +
              '</table></div><h3>Thêm môn cho lớp</h3><form id="subject-create"><label>Mỗi môn một dòng; có thể dán cột tên từ Excel<textarea name="names" rows="4" required></textarea></label><button>Thêm các môn</button></form><h3>Phân công giảng dạy</h3><form id="teach-assign"><label>Môn<select name="course_id">' +
              options(items, "Chọn môn") +
              '</select></label><label>Giáo viên chính<select name="teacher_id">' +
              options(teachers, "Chọn giáo viên") +
              '</select></label><div id="assistants"></div><div class="toolbar" id="assist-buttons"></div><button class="primary">Lưu phân công</button></form>'
            : "";
          if (!classId) return;
          $("#subject-create").onsubmit = async (e) => {
            e.preventDefault();
            try {
              const names = new FormData(e.target)
                .get("names")
                .split(/\r?\n/)
                .map((x) => x.trim())
                .filter(Boolean);
              await academyRequest(
                "POST",
                "/api/academy/control/subjects/" + classId,
                { rows: names.map((name) => ({ name, id: "", revision: 0 })) },
              );
              $("#academic-load").click();
            } catch (e) {
              msg(e.message);
            }
          };
          $("#assist-buttons").append(
            button("+ Trợ giảng", () => {
              const row = document.createElement("div");
              row.className = "toolbar";
              row.innerHTML =
                "<select data-assistant>" +
                options(teachers, "Chọn trợ giảng") +
                "</select>";
              row.append(button("Xóa", () => row.remove()));
              $("#assistants").append(row);
            }),
          );
          $("#teach-assign").onsubmit = async (e) => {
            e.preventDefault();
            try {
              const v = Object.fromEntries(new FormData(e.target)),
                course = items.find((c) => c.id === v.course_id);
              if (!course) throw Error("Chọn môn học.");
              await academyRequest("POST", "/api/academy/control/assignments", {
                rows: [
                  {
                    ...v,
                    revision: course.revision,
                    assistant_ids: [
                      ...document.querySelectorAll("[data-assistant]"),
                    ]
                      .map((x) => x.value)
                      .filter(Boolean),
                  },
                ],
              });
              $("#academic-load").click();
            } catch (e) {
              msg(e.message);
            }
          };
        };
      }
      $("#academic-status").textContent = "Đã tải dữ liệu từ VPS.";
    } catch (e) {
      if ($("#academic-status")) $("#academic-status").textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
  if (selected.applied === selected.revision) $("#academic-load").click();
}
