# Bảng trắng và viết vẽ trong phòng học

Từ v0.23.0, phòng học của hệ thống trường học và VA Academy dùng chung công cụ viết vẽ. Không cần khóa API bổ sung. Đây là công cụ riêng của Meet, không phải dịch vụ Google hoặc Zoom được nhúng.

## Bảng trắng

1. Vào phòng học, chọn **Bảng trắng** trên thanh điều khiển. Trên điện thoại, mở **Thêm tùy chọn → Bảng trắng**.
2. Giáo viên chọn bút, đánh dấu, đường thẳng, hình chữ nhật, elip hoặc chữ; chọn màu và độ dày. Với chữ, nhập nội dung rồi chạm lên bảng, hoặc bấm **Thêm chữ ở giữa**.
3. **Thêm trang**, chuyển trang và **Xóa trang** áp dụng cho cả lớp. Có tối đa 20 trang và luôn giữ một trang.
4. Giáo viên bật **Cho học sinh cùng vẽ** khi cần làm bài chung. Mặc định học sinh chỉ xem. Học sinh được phép xóa hoặc hoàn tác nét của mình; giáo viên có thể xóa các nét trên trang.
5. **Tải ảnh PNG** lưu trang đang xem về thiết bị. **Ẩn công cụ** chỉ ẩn thanh công cụ của mình; **Đóng cho cả lớp** đóng bảng chung.

## Viết lên màn hình chia sẻ

Người trình bày chia sẻ màn hình như trước. Chọn **Thêm tùy chọn → Viết lên màn hình chia sẻ**, rồi chọn người đang trình bày. Giáo viên hoặc chủ màn hình được mở chú thích; giáo viên quyết định có cho các học sinh khác cùng vẽ hay không.

Nét vẽ nằm trên màn hình trong phòng học của website, không sửa ứng dụng hoặc tài liệu gốc của người chia sẻ. Chọn **Con trỏ** để thao tác bình thường; chọn bút để vẽ. Khi màn hình dừng hoặc được chia sẻ lại bằng phiên mới, chú thích cũ không được gắn nhầm lên phiên mới. Khi chuyển sang bảng trắng, nét vẽ trên màn hình trước đó vẫn được giữ trong phạm vi phiên chia sẻ đó.

## Đồng bộ, lưu trữ và ghi hình

- Nội dung được lưu trong MySQL theo từng buổi học và từng trường. Người đang ở phòng có quyền mới được đọc hoặc sửa; người chờ duyệt, bị mời ra hoặc thuộc trường khác không được truy cập.
- Các máy nhận thay đổi định kỳ khoảng 1,2 giây. Nét đang vẽ được gom gửi khoảng 200 ms; đường truyền chậm có thể làm tăng độ trễ. Đây không phải cơ chế đồng bộ tức thời ngang hàng.
- Làm mới hoặc kết nối lại trong buổi học sẽ tải lại bảng đã lưu. Xóa trang/nét dùng phiên bản và đánh dấu xóa để tránh nét cũ xuất hiện trở lại do yêu cầu gửi chậm.
- Giới hạn mỗi trang 800 nét, mỗi nét 1.000 điểm, tổng nội dung một buổi tối đa 1 MiB. Khi đầy, xuất PNG rồi xóa trang/nét cũ để tiếp tục. Bảng chỉ mở trong buổi đang diễn ra; hãy tải ảnh cần giữ trước khi kết thúc.
- Bộ ghi hình máy chủ v0.23.0 dựng cả bảng trắng hoặc chú thích đang mở vào video. Cần cập nhật **cả API, web và bộ ghi hình**. Bộ ghi hình cũ không có lớp viết vẽ. Việc ghi hình thực tế vẫn cần cấu hình SFU/R2 và worker hoạt động; bật bảng trắng không tự kích hoạt ghi hình.
- Điện thoại hỗ trợ chạm/vẽ và kéo ngang hàng công cụ. Có thể ẩn công cụ hoặc xoay ngang để tăng diện tích bảng. Khả năng chia sẻ màn hình trên điện thoại tùy trình duyệt/hệ điều hành.

## Nâng cấp

Chạy quy trình cập nhật an toàn thông thường khi không có buổi đang diễn ra. API tự thêm bảng `meeting_drawing_state` và schema 16; không xóa dữ liệu cũ. Dữ liệu bảng nằm trong bản sao lưu MySQL. Nếu dùng recorder riêng, dựng lại image từ cùng phiên bản theo hướng dẫn ghi hình máy chủ sau khi API đã nâng cấp xong.

Kiểm thử bao gồm phân quyền, chống phát lại nét đã xóa, giữ trạng thái trong SQL, hai trình duyệt đồng bộ và khóa/mở quyền, trang bảng, xuất PNG, chú thích màn hình trên giao diện mobile, và bộ dựng video với nguồn SFU mô phỏng. Kiểm thử này không thay thế nghiệm thu cuộc gọi Cloudflare/R2 thực tế.
