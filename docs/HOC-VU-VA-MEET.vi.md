> Cập nhật quản trị, 2FA, điểm danh từng buổi, R2 và sao lưu: [Hướng dẫn quản trị nâng cao](QUAN-TRI-NANG-CAO.vi.md). Hướng dẫn mới thay thế thời hạn R2 cố định 30 ngày trước đây.

# Bảng học vụ và phòng họp

Admin mở **Quản trị**, chọn **Môn học**, **Học sinh theo lớp**, **Giáo viên** hoặc **Phân công giảng dạy**. Có tìm theo ID ngắn/mã SV/tên/email. Mobile hiển thị từng dòng thành thẻ nhập liệu.

## Quy trình

Tạo lớp → nhập nhiều môn chưa teacher → nhập teacher riêng → phân công lớp/môn/teacher → thêm student theo lớp → tạo buổi học.

## ID và sửa trực tiếp

Khóa chính cũ được giữ để không làm mất liên kết điểm danh/bản ghi. Mỗi người/lớp/môn được cấp mã riêng như SV000123, GV000045, LH000008, MH000078. Registry dùng số thứ tự chung; không giả định mã SV liên tiếp. Mã giữ nguyên khi sửa và không đổi được qua bảng.

Các API mới chấp nhận ID nội bộ hoặc ID ngắn, luôn kiểm tra trường. Mỗi lượt 1–100 dòng, transaction nguyên tử: một dòng lỗi thì không dòng nào được lưu. Cập nhật cần revision của dòng; nếu người khác sửa trước, trả 409 để tải lại. Tải lại/bỏ thay đổi sẽ xóa draft chưa lưu; lưu trước khi chuyển bảng/lớp.

## Môn học

Chọn lớp, **Thêm dòng môn**, mỗi dòng một tên rồi **Lưu các môn thay đổi**. Không cần teacher lúc tạo. Sửa trực tiếp tên theo mã MH. Môn mới hiển thị **Chưa phân công**; một buổi học không bắt đầu được nếu course chưa có teacher.

## Học sinh

Thêm dòng hoặc dán CSV/tab từ Excel, đúng thứ tự:

```text
email,student_code,name,password
```

Có thể bỏ header. Tên có dấu phẩy cần nháy kép. Bấm **Đưa vào bảng để kiểm tra**, sửa từng ô rồi lưu. Mã SV 1–40 ký tự A–Z, 0–9, dấu . _ -, chuẩn hóa chữ hoa và duy nhất trong trường. Mã SV của trường độc lập với ID hệ thống SV...; đăng nhập bằng email hoặc mã SV vẫn cần mã trường/password.

Student mới được tạo và enroll lớp trong một transaction. Nếu tài khoản đã có, dùng **Gán học sinh đã có bằng ID ngắn**, không import lại email để ghi đè. Gán thêm không xóa enrollment cũ.

Mật khẩu 12–72 byte, mỗi người riêng. Dòng đã lưu có password trống: giữ nguyên nếu không nhập mới. API không trả password/hash. Sửa tài khoản làm phiên cũ hết hiệu lực.

## Giáo viên riêng

Nhập/dán ba cột:

```text
email,name,password
```

XLSX riêng cho giáo viên dùng đúng ba cột này, một sheet, 1–100 dòng, tối đa 4 MiB. Server ép role teacher; không có cột role/class. Mỗi teacher có mã GV và sửa trực tiếp trên bảng. Import hỗn hợp cũ còn để tương thích; giao diện mới dùng luồng riêng.

## Phân công

Mỗi dòng có lớp/ID lớp — môn/ID môn — teacher/ID teacher. Chọn teacher hoặc Chưa phân công rồi lưu. Teacher phải active, thuộc trường và đúng role. Không đổi phân công khi course có buổi live; kết thúc trước rồi đổi. Một teacher dạy được nhiều course/lớp; mỗi course chỉ có một teacher.

## API

Base /api, chỉ admin cùng trường:

| Method | Route | Body |
|---|---|---|
| POST | /classes/:id/courses/batch | rows: id tùy chọn, name, revision khi sửa |
| GET | /classes/:id/students | Danh sách, ID, mã SV, revision; không password |
| POST | /classes/:id/students/batch | rows: id tùy chọn, email, student_code, name, password, revision khi sửa |
| POST | /teachers/batch | rows: id tùy chọn, email, name, password, revision khi sửa |
| POST | /teachers/import | multipart file XLSX email/name/password |
| POST | /assignments | rows: course_id, teacher_id, revision |

Dùng short_id ở id/course_id/teacher_id để sửa. Teacher_id trống để bỏ phân công. Revision lấy từ GET users/catalog/danh sách lớp. Migration v3 thêm short_id, student_code, revision và teacher nullable, không thay khóa chính.

## Phòng họp

Đã có kiểm tra camera/mic trước khi vào, vào chỉ nghe khi tắt cả hai thiết bị, cấp quyền/bật thiết bị sau khi tham gia, bật/tắt mic/camera, chia sẻ màn hình thay camera, danh sách thành viên, chat và giơ/hạ tay.

Chat/giơ tay yêu cầu quyền course, buổi live và presence còn hạn. Tin nhắn tối đa 2.000 ký tự, rate limit và cursor. Đồng bộ khoảng 5 giây bằng polling. Buổi kết thúc không gửi tin mới, người còn quyền course đọc được lịch sử. Chưa có retention riêng cho chat; cần chính sách của đơn vị.

Chưa tương đương toàn bộ Google Meet: chưa có lobby duyệt khách, khách ngoài trường, nền ảo/blur, active speaker, phụ đề, moderation cưỡng chế media, screen + camera đồng thời hoặc đầy đủ reconnect/ICE refresh. Media thật vẫn phải nghiệm thu bằng Cloudflare credential. Ghi hình browser/R2 30 ngày giữ các giới hạn trong kiến trúc.

## Nâng cấp

Backup trước. Bộ cài một lệnh chạy migration trước API mới. Khi cập nhật thủ công: meet build → meet run --rm migrate → meet up -d. Không chỉ cập nhật frontend vì API mới cần schema v3; không down -v để sửa lỗi.
