# Ngày giờ và đăng bài giảng từ video lớp học

Phiên bản 0.14.0, schema 10. Chức năng đăng video dành cho quản trị có quyền quản lý nội dung.

## Ngày giờ thống nhất

- Ngày: **dd/mm/yyyy**, ví dụ **03/01/2026**.
- Có giờ: **dd/mm/yyyy HH:mm**, ví dụ **03/01/2026 08:30**, hệ 24 giờ, múi giờ Việt Nam.
- Bộ lọc tháng dùng **mm/yyyy** vì không có ngày cụ thể.
- Ô nhập ngày sinh, hạn bài tập, ngày chi và thời gian điểm danh dùng định dạng trên; không nhận ngày không tồn tại.
- Excel điểm danh, học viên và tài chính xuất ngày theo định dạng Việt Nam. API/cơ sở dữ liệu vẫn dùng dạng chuẩn để tránh nhầm tháng/ngày giữa trình duyệt và máy chủ.

## Cách tổ chức hợp lý

**Khối → khóa môn học → chương/chủ đề → bài giảng.**

Ví dụ minh họa: Khối 10 → Toán → Chương 1: Hàm số → Bài 01: Khái niệm → Bài 02: Luyện tập. Tên bài cần nói rõ nội dung, không chỉ ghi ngày học. Ghi chú có thể nêu kiến thức cần chuẩn bị, bài tập nên làm và phần cần ôn lại.

Buổi học, điểm danh và bản ghi gốc thuộc lớp học. Bài giảng được chọn đăng nằm trong khóa học và có thứ tự riêng; việc đăng không sửa lịch sử lớp. Nên đặt các bài cùng chủ đề cạnh nhau theo trình tự học, không tự động lấy ngày mới nhất làm bài đầu tiên.

## Đăng từ bản ghi lớp học

1. Mở **Quản lý nội dung** (`/quan-tri/noi-dung`) → **Video lớp học → bài giảng khóa học**.
2. Chọn khóa học đích, mở mục chọn bản ghi.
3. Chọn lớp/môn nguồn và video còn hạn. Có nút trước/sau nếu nhiều hơn 50 video. Có thể xem video trước khi đăng.
4. Điền tên bài, chương/chủ đề, ghi chú cho học sinh. Thời lượng được điền từ video khi trình duyệt đọc được; kiểm tra lại trước khi gửi.
5. Chọn công khai sau sao chép hoặc giữ nháp, rồi bấm **Đăng video vào khóa học**.
6. Theo dõi trạng thái Chờ sao chép → Đang sao chép → Đã sao chép. Hệ thống tiếp tục khi đóng trình duyệt. Nếu lỗi, đọc thông báo, kiểm tra lưu trữ/hạn bản gốc và bấm thử lại.

Mỗi video chỉ tạo một bài giảng trong cùng một khóa, kể cả bấm lại. Sau khi có bài, dùng nút sửa để đổi tên/ghi chú/trạng thái, không đăng lại video để sửa chữ.

## Lưu trữ an toàn

Máy chủ yêu cầu R2 sao chép video từ vùng bản ghi sang vùng bài giảng riêng, không tải toàn bộ video về VPS. Bản gốc vẫn giữ thời hạn lưu của lớp; quy tắc 30 ngày của vùng `recordings/` không áp dụng cho bản sao tại `academy/vod/`. Giữ cấu hình R2 và các chính sách khác của bucket phù hợp với kho bài giảng.

Chỉ công khai sau khi xác minh dung lượng, định dạng và kết quả sao chép. Hệ thống lưu yêu cầu, trạng thái và bản nguồn theo đơn vị; không nhận đường dẫn lưu trữ tùy ý từ trình duyệt. Nếu tiến trình ngắt sau khi R2 đã sao chép xong, có thể xác minh và dùng lại bản sao khi xử lý tiếp. Bản ghi phải còn hạn khi bắt đầu sao chép; nếu bản gốc đã bị xóa trước lúc sao chép thì cần chọn nguồn khác.

Giới hạn: bản ghi MP4/WebM tối đa **5 GiB**, thời lượng bài **1 giây–8 giờ**. Không cắt ghép/chuyển mã tự động. Tải file mới trực tiếp vẫn theo giới hạn tải lên hiện có 1 GiB. Thay đổi cấu hình bucket/khóa trong lúc xử lý sẽ làm yêu cầu dừng để kiểm tra thay vì ghi nhầm kho.

Tham khảo tính năng sao chép và điều kiện ETag của R2: [Cloudflare S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Sửa và sắp xếp

- Bài mới được thêm cuối danh sách. Nút ↑/↓ lưu thứ tự ngay và kiểm tra danh sách chưa bị quản trị khác thay đổi.
- **Sửa bài giảng** cho phép sửa tên, chủ đề, ghi chú, thời lượng và công khai/nháp; dùng kiểm tra phiên bản để tránh ghi đè.
- Học sinh chỉ thấy bài công khai, theo thứ tự đã lưu, kèm chủ đề và ghi chú. Quyền VIP/hạn mức xem vẫn áp dụng như cũ.
- Nguồn sao chép lỗi hoặc chưa hoàn tất không được công khai. Chức năng không tự đăng bất kỳ video thực tế nào cho đến khi quản trị chọn và xác nhận nguồn/khóa đích.
