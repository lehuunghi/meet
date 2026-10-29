# Meet dùng chung cho trường học và VA — v0.31.2

## Bắt đầu buổi học

Trong màn hình chuẩn bị, giáo viên/quản trị có quyền điều hành thấy nút **Bắt đầu buổi học** ngay dưới **Sẵn sàng tham gia?**. Khi bắt đầu thành công, nút đổi thành **Vào lớp học**. Học sinh thấy trạng thái đang chờ đến khi giáo viên bắt đầu.

Bắt đầu/mở buổi và thực sự vào dạy là hai mốc khác nhau: ghi hình và thời gian điểm danh vẫn theo mốc giáo viên vào lớp dạy như trước. Chọn mic/camera trước khi tham gia; bấm bắt đầu không tự bật thiết bị.

## Bản cài trường học

Trường học và nền tảng khóa học/VIP dùng chung thành phần Room, bộ điều khiển, stylesheet Meet, SFU, bảng trắng, phòng nhóm và mốc ghi hình. Khác biệt ở cổng quản lý/lớp học và quyền truy cập, không có bản Meet cũ riêng để cài.

Bộ cài `deploy/install.sh` lấy nhánh `codex/multi-school-platform`. Cài từ trung tâm chọn revision đã đạt CI, rồi truyền `MEET_TARGET_SHA` cho bộ cài để API/web/recorder cùng nguồn. Bản cài trường học mới nhận giao diện tương ứng revision được duyệt. Sau khi cài, kiểm tra `/api/health` để xác nhận phiên bản/commit. Không chạy lại bộ cài trên VPS đang có dữ liệu; dùng mục nâng cấp an toàn tại trung tâm.

Các bản trường học đã cài từ trước cần nâng cấp bằng quy trình có snapshot, kiểm tra buổi live và kiểm tra sức khỏe; cấu hình trường và dữ liệu vẫn thuộc trường đó. Cài mới không tự sao chép dữ liệu, khóa SFU hoặc R2 của VA.

Kiểm thử kiểm tra cả đường vào phòng học trường học và URL phòng học khóa học/VIP, với vai trò giáo viên/học sinh và trạng thái scheduled/live. Không dùng kiểm thử giao diện mô phỏng để xác nhận cuộc gọi nhiều thiết bị thực tế.
