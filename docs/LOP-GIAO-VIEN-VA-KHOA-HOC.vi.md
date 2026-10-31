# Lớp học, giáo viên và kết nối khóa học với Live

Phiên bản 0.16.0, schema 12. Giữ mô hình **VIP chung cho toàn bộ danh mục**, không chuyển sang mua riêng từng khóa.

## Học sinh mua rồi có xem được không?

| Trạng thái | Video khóa học đã công khai | Lớp Live |
|---|---|---|
| Chưa mua / đơn còn chờ | Theo hạn mức miễn phí hiện có | Không |
| VIP video còn hạn | Không giới hạn video toàn danh mục | Không |
| VIP có quyền Live còn hạn | Không giới hạn video toàn danh mục | Đăng ký và mở lớp đã liên kết |
| VIP hết hạn | Quay về hạn mức miễn phí hiện có | Không |

Đơn phải được quản trị duyệt hoặc nhà cung cấp thanh toán xác nhận thành công mới cấp VIP. Khóa học/bài giảng nháp không được mở bằng VIP; không truy cập nội dung của đơn vị khác. Thông tin lưu trữ R2 vẫn cần hợp lệ để phát file.

Video và Live có thời hạn riêng. Mua thêm gói chỉ video không làm mất thời hạn Live đã mua; cũng không cộng thêm ngày Live chưa thanh toán. Mỗi gói Live cộng số ngày Live của nó từ thời điểm hiện tại hoặc từ hạn Live đang còn, tùy mốc nào xa hơn. Quyền xem video vẫn gia hạn theo số ngày của mọi gói VIP. Quyền Live đang được cấp trước nâng cấp được giữ nguyên.

## Quản lý lớp học

Vào **Lớp học & giáo viên → Lớp học** (`/quan-tri/lop-hoc`). Có các thao tác:

- **Sửa lớp:** sửa tên, giữ nguyên ID và liên kết.
- **Ngưng lớp / Kích hoạt lớp:** dừng hoặc mở lại các buổi Live mới. Không xóa video khóa học và điểm danh cũ.
- **Xóa lớp:** nhập đúng tên để xác nhận. Lớp rời danh sách hoạt động, giữ dữ liệu lịch sử. Bật **Hiện lớp đã xóa để đối chiếu lịch sử** để xem lại lớp, môn và danh sách; không sửa lại lớp đã xóa.

Nếu lớp có buổi đang học, hệ thống chặn ngưng/xóa; quản trị cần kết thúc buổi trước. Không tự đóng buổi đang học. Tên và ID cũ được giữ cho đối chiếu lịch sử; khi mở lớp của năm mới nên dùng tên kèm năm học.

## Quản lý giáo viên

Trong cùng trang, chọn **Giáo viên**. Sửa trực tiếp email/họ tên/mật khẩu rồi bấm **Lưu các dòng thay đổi**. Dòng đã lưu để mật khẩu trống sẽ giữ mật khẩu.

- **Ngưng giáo viên:** thu hồi quyền đăng nhập; có thể **Kích hoạt giáo viên** lại.
- **Xóa giáo viên:** nhập đúng email; xóa tài khoản theo cơ chế bảo vệ hiện có, gỡ phân công chính/trợ giảng và giữ lịch sử học/thanh toán. Không xóa lớp hoặc các video của đơn vị.
- Ngưng/xóa tài khoản cần quyền **Quản lý tài khoản**; người chỉ có quyền Học vụ vẫn sửa bảng học vụ nhưng không được ngưng/xóa tài khoản.

Lưu hoặc bỏ các dòng đang sửa trước khi dùng thao tác ngưng/xóa để tránh mất phần nhập chưa lưu.

## Liên kết khóa học và lớp Live

1. Vào **Quản lý nội dung → Tạo & sửa khóa học**.
2. Chọn khóa học, tại **Lớp & môn trực tuyến liên kết** chọn theo tên lớp, môn và giáo viên; không cần nhập ID.
3. Bấm **Lưu khóa học**. Chọn **Chỉ video / chưa liên kết lớp Live** nếu khóa chưa có lớp trực tuyến.
4. Học sinh mở khóa học: thấy tên lớp/môn/giáo viên. Nếu VIP có Live, bấm **Đăng ký & mở lớp Live** hoặc **Mở lớp trực tuyến**; hệ thống ghi danh một lần rồi chuyển thẳng đến lịch/buổi học của môn đó.
5. Giáo viên được phân công bấm **Mở lớp giảng dạy**, không đi qua thao tác đăng ký của học sinh.
6. Trong lớp, mục **Khóa học & bài giảng** dẫn ngược về khóa học để xem video và bài tập. Bản ghi lớp vẫn được quản trị chọn đăng thành bài giảng theo quy trình riêng; không tự công khai tất cả video lớp.

Khóa chưa có liên kết sẽ được ghi rõ là khóa video. Lớp ngưng/xóa chặn đăng ký Live mới nhưng bài giảng khóa học đã công khai vẫn xem theo VIP. Ghi danh lặp lại không tạo nhiều dòng. Giáo viên chỉ mở khóa/lớp được phân công, học sinh không xem danh sách lớp khác qua liên kết.
