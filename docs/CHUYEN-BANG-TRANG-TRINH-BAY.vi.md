# Chuyển bảng trắng / trình bày và nhãn công cụ — v0.25.0

## Một vùng nội dung chính cho cả lớp

- **Mở bảng trắng:** cả lớp xem bảng. Các ô màn hình chia sẻ tạm ẩn; ô camera/người tham gia vẫn có thể hiển thị. Không vẽ chồng đồng thời bảng trắng và màn hình.
- **Quay lại trình bày:** giáo viên bấm nút trên thanh công cụ bảng. Bảng được giữ nguyên và cả lớp chuyển sang màn hình đã chọn. Chuyển qua lại không xóa trang hay nét vẽ.
- **Đóng bảng:** nếu màn hình vừa dùng vẫn còn chia sẻ, hệ thống trở lại màn hình đó; nếu không, trở lại các ô người tham gia.
- **Giáo viên bắt đầu chia sẻ màn hình mới khi đang mở bảng:** sau khi trình duyệt xác nhận chia sẻ thành công, phòng tự chuyển sang trình bày. Nếu hủy hộp chọn hoặc không chia sẻ được, bảng vẫn mở.
- **Học sinh:** khi giáo viên đang mở bảng, không được tự chuyển cả lớp sang màn hình khác, kể cả người đã chia sẻ màn hình trước đó. Học sinh vẫn vẽ trên bảng khi giáo viên cấp quyền. Khi giáo viên chuyển lại trình bày, quyền chia sẻ/chú thích hiện có tiếp tục áp dụng.

Màn hình tạm ẩn không đồng nghĩa đã ngừng phát từ thiết bị. Luồng chia sẻ có thể tiếp tục để quay lại ngay, tránh phải chọn lại cửa sổ. Muốn dừng phát hẳn, bấm **Dừng trình bày**. Bảng trắng không phải một luồng chia sẻ màn hình thứ hai.

## Chú thích trực tiếp

Bấm **Chú thích** trên màn hình trình bày hoặc mở **⋮ → Viết lên màn hình chia sẻ**. Giáo viên có thể chọn màn hình cần dùng khi có nhiều người trình bày. Chỉ một màn hình được chọn làm nội dung trình bày chung; nét vẽ của từng phiên chia sẻ được giữ riêng.

**Dừng chú thích** chỉ tắt lớp viết vẽ chung, không dừng phát màn hình và không xóa nét. Mở chú thích lại trên cùng phiên sẽ thấy nét cũ. Khi dừng/chia sẻ lại bằng phiên mới, hệ thống không gắn nhầm nét cũ.

Trước khi người dùng đổi chế độ, các nét đang chờ gửi của họ được lưu trước. Nếu giáo viên khác đã đổi trang/chế độ trước, máy chủ từ chối nét gửi muộn thay vì làm xuất hiện nội dung sai trên màn hình mới.

## Menu và nhãn icon

Thanh công cụ có menu **Chọn công cụ viết vẽ**, hiển thị icon kèm tên đầy đủ như Bút, Mực biến mất, Ghi chú cố định, Hình dán, Mũi tên… Các icon nhanh vẫn dùng được bên cạnh menu.

Rê chuột hoặc đưa tiêu điểm bàn phím vào các icon Meet để thấy nhãn gợi ý ngay trong phòng, không phụ thuộc tooltip mặc định của trình duyệt. Menu công cụ hỗ trợ phím mũi tên, Home/End, Enter và Escape. Trên mobile, chạm menu để đọc tên và chọn công cụ; không cần ghi nhớ biểu tượng.

## Ghi hình và nâng cấp

Bộ dựng video dùng cùng chế độ với lớp: bảng đang mở thì ghi bảng; trình bày thì ghi màn hình được chọn. Tắt chú thích vẫn ghi đúng màn hình đó. Mic/audio tiếp tục hoạt động độc lập với việc đổi bảng/trình bày.

Cập nhật API, web và recorder cùng phiên bản khi không có buổi đang diễn ra. Không có thay đổi schema trong v0.25.0 (vẫn schema 17). Kiểm thử gồm chuyển qua lại giữ nội dung, chặn học sinh chiếm vùng bảng, đồng bộ hai người, nhãn/menu và bàn phím/mobile, cùng bộ dựng video với nhiều nguồn màn hình mô phỏng. Nghiệm thu SFU/R2 thật vẫn cần buổi gọi thực tế riêng.
