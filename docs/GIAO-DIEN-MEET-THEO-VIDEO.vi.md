# Giao diện Meet theo video tham khảo — v0.30.0

Áp dụng chung cho phòng học của nền tảng trường học và khóa học/VIP. Video tham khảo do chủ hệ thống cung cấp ngày 29/10/2026; không đưa video hoặc ảnh trích từ video riêng vào repository.

## Các phần đã đồng bộ

- Màn hình chuẩn bị nền trắng, khung camera tối bên trái và lời mời tham gia bên phải trên máy tính; điện thoại xếp khung camera trước phần tham gia. Mic/camera nằm trong khung xem trước, chỉ bật theo lựa chọn hiện có của người dùng.
- Trong lớp dùng nền `#111111`, bảng chức năng `#202124`, nút trung tính `#333537`, chữ/icon sáng `#e3e3e3`. Mic/camera tắt nền hồng nhạt `#f9dedc`, chức năng đang dùng xanh nhạt `#a8c7fa`, nút rời lớp đỏ đậm có độ tương phản rõ.
- Thanh nút chính bo tròn ở giữa phía dưới; nhóm chức năng lớp bên phải trên máy tính và chuyển vào ba chấm trên điện thoại. Các mũi tên thiết bị mở hộp cài đặt thiết bị hiện có. Đồng hồ và mã phòng hiển thị ở góc trên; icon thông tin sao chép liên kết phòng.
- Menu ba chấm, người tham gia, trò chuyện, khảo sát và điều hành phòng dùng cùng màu tối, chữ sáng. Giữ nhãn trợ năng, chú thích khi di chuột/dùng bàn phím và trạng thái tắt/bật rõ ràng.
- Thanh bút nổi ở giữa phía dưới nội dung chia sẻ: công cụ đang chọn nền xanh nhạt, menu tối có hình dán, bút, mực biến mất, văn bản, ghi chú, hình dạng, màu, xóa, tẩy, quyền chú thích và dừng chú thích. Bút mặc định xanh lá; có nút toàn màn hình hoạt động thật.
- Khi trình bày, có chỉ báo và nút dừng trình bày; ô camera của mình có thể thu thành ô nhỏ trên nội dung đang được ghim. Bảng trắng và chú thích tiếp tục dùng cơ chế đồng bộ hiện có.

Icon dùng SVG Material Symbols Rounded của Google, đóng gói sẵn trong ứng dụng; không tải font/icon bên ngoài khi vào lớp. Nguồn: https://github.com/google/material-design-icons — bản quyền/giấy phép Apache-2.0 tại `licenses/Material-Symbols-LICENSE.txt`. Các đường nét SVG được trích vào component để đổi màu theo trạng thái.

## Giới hạn phạm vi

Đây là chỉnh giao diện và bố trí công cụ đang có. Không thay xác thực, phân quyền, SFU, lựa chọn ghi hình, R2, mốc điểm danh hoặc cơ chế nối lại của v0.29.0. Không thêm nút AI, phụ đề, hiệu ứng nền hay dịch vụ Google không có kết nối thực tế. Logo hiển thị VA Meet.

Đã bỏ khối CSS màn hình chuẩn bị cũ trong stylesheet bảng vẽ để tránh xung đột vị trí nút, và kiểm tra khung 320/390 px. Kiểm thử giao diện dùng dữ liệu mô phỏng, không truy cập thiết bị hay tạo bản ghi/điểm danh thật trên VA.
