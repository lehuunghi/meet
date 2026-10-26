# VA v0.12 — Đường dẫn cố định và thao tác an toàn

Mỗi trang có đường dẫn riêng để sao chép, đánh dấu và mở lại. Khi chưa đăng nhập, hệ thống yêu cầu đăng nhập rồi quay về nội dung đã chọn. Đường dẫn không cấp thêm quyền; máy chủ vẫn kiểm tra tài khoản, trường, lớp và phân công.

| Nội dung | Đường dẫn |
|---|---|
| Không gian học tập | `/hoc` |
| Lớp | `/hoc/lop/{id}` |
| Môn: bảng tin / bài tập / buổi học / thành viên / thông tin | `/hoc/mon/{id}/bang-tin`, `bai-tap`, `buoi-hoc`, `thanh-vien`, `thong-tin` |
| Kho bài giảng / khóa học | `/hoc/khoa-hoc`, `/hoc/khoa-hoc/{id}` |
| Bài giảng / bài tập | `/hoc/bai-giang/{id}`, `/hoc/bai-tap/{id}` |
| Báo cáo | `/hoc/diem-danh` |
| Gói học / đơn của học sinh | `/hoc/goi-hoc`, `/hoc/thanh-toan/{id}` |
| Tài khoản / thông báo | `/hoc/tai-khoan`, `/hoc/thong-bao` |
| Nội dung / lớp học | `/quan-tri/noi-dung`, `/quan-tri/lop-hoc` |
| Tài khoản / học viên | `/quan-tri/tai-khoan`, `/quan-tri/hoc-vien` |
| Thanh toán / thu chi / cài đặt kinh doanh | `/quan-tri/thanh-toan`, `/quan-tri/thu-chi`, `/quan-tri/cai-dat` |
| Phòng Meet | `/{mã 6 ký tự}` hoặc `/hoc/buoi-hoc/{id}` |

Các link cũ `/hoc?course=...`, `lesson=...`, `plan=...`, `room=...`, `register=1` vẫn chuyển sang đường dẫn mới. ID tài nguyên được giữ nguyên khi đổi tên. Xóa tài nguyên hoặc thu hồi quyền sẽ báo không tìm thấy/không có quyền.

Báo cáo lưu bộ lọc trong URL: `lop`, `mon`, `thang` (YYYY-MM), `buoi`, `thong-ke`, `video`, `trang`. Ví dụ `/hoc/diem-danh?lop=ID_LOP&mon=ID_MON&thang=2026-11`. Tháng được tính theo giờ Việt Nam UTC+7 ở cả danh sách buổi và Excel. Không đưa URL ký R2 hoặc khóa truy cập vào các link này. Video vẫn yêu cầu bấm phát và kiểm tra quyền, hạn mức.

Thông báo được tạo từ lịch học, bảng tin, bài gần hạn, điểm, bài cần chấm và thanh toán theo vai trò. Trạng thái đã đọc được lưu riêng cho mỗi tài khoản. Đây là thông báo trong website, không tự gửi email/Zalo/push bên ngoài.

Khi sửa biểu mẫu, rời trang hoặc đóng tab sẽ có cảnh báo chưa lưu. Trong lúc yêu cầu lưu đang xử lý, gửi lặp cùng biểu mẫu được chặn. Nếu lưu lỗi, nội dung vẫn còn để sửa và thử lại. Cảnh báo khi đóng tab phụ thuộc hỗ trợ của trình duyệt. Nội dung chưa lưu không được ghi vào bộ nhớ lâu dài.

Cài đặt: triển khai qua bộ nâng cấp an toàn hiện có, chọn commit đã vượt qua CI. Bản này thêm hai bảng lưu trạng thái đọc và URL thanh toán, nâng schema lên 9; không đổi mật khẩu, SFU, R2, thời hạn lưu hoặc dữ liệu học tập. Bộ nâng cấp phải xác thực bản sao lưu trước khi thay phiên bản. Admin trung tâm tiếp tục chỉ quản lý hạ tầng; nghiệp vụ VA ở VA.

Kiểm tra sau cập nhật: đăng nhập, mở lớp/môn rồi F5; dùng Quay lại/Tiến tới; mở link bài tập bằng tài khoản đúng/sai lớp; mở lại đơn thanh toán; chọn lớp/môn/tháng và xuất Excel; sửa biểu mẫu rồi thử rời trang. Link đơn không tạo lại đơn, không tự cấp VIP; webhook hoặc duyệt có quyền vẫn quyết định thanh toán.
