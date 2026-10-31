# Kết nối lại và điều khiển ghi hình — v0.29.0

## Khi mất mạng

Buổi học vẫn tồn tại trên máy chủ; người mất mạng không cần bấm rời rồi vào lại. Mic/camera giữ trạng thái trước sự cố, không tự bật thiết bị đã tắt.

- Kiểm tra kết nối mỗi giây. Cho kết nối bị gián đoạn khoảng 1,5 giây để trình duyệt tự phục hồi, tránh dựng lại vì một lần chập chờn rất ngắn. Kết nối đã hỏng được thay ở lượt kiểm tra kế tiếp.
- Khi mạng trở lại hoặc quay về thẻ trình duyệt, bỏ thời gian chờ thử lại trước đó và kiểm tra ngay. Không thay một kết nối đang khỏe chỉ vì nhận sự kiện `online`.
- Dựng lại đường truyền rồi nhận lại các luồng ngay; các tài khoản khác kiểm tra danh sách luồng mỗi 2 giây, thay vì chờ nhịp điểm danh 15 giây. Nhịp điểm danh vẫn 15 giây.
- Giữ phiên bắt màn hình còn sống và phát lại qua đường truyền mới. Nếu người dùng/trình duyệt đã dừng bắt màn hình thì cần chia sẻ lại.
- Gộp các yêu cầu nối lại đang chạy. Lỗi liên tiếp chờ 1, 2, 4, 8 rồi tối đa 10 giây; mỗi yêu cầu media có giới hạn chờ 8 giây. Không cấp session vô hạn khi máy chủ đang mất kết nối.
- Phiên đăng nhập hết hạn, bị giáo viên loại khỏi lớp hoặc lớp kết thúc vẫn phải tuân thủ quyền truy cập; không tự vượt phòng chờ.

**1–2 giây là mục tiêu trong trường hợp đường truyền cũ tự phục hồi nhanh, không phải bảo đảm cho mọi lần mất mạng.** Đổi Wi-Fi sang 4G, DNS/TLS, trao đổi SDP/ICE, thời điểm nhận keyframe và trình duyệt bị hệ điều hành tạm ngưng có thể mất lâu hơn. Khi thiết bị hoàn toàn mất mạng, máy chủ không thể nhận hình/tiếng chưa được truyền tới; bản ghi có thể có khoảng thiếu người đó. Cần đo trên thiết bị và mạng thực tế để công bố thời gian phục hồi.

Tài liệu tham khảo: [Cloudflare: negotiation and session lifecycle](https://developers.cloudflare.com/realtime/sfu/concepts/negotiation/), [connection patterns](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/).

## Chọn ghi hình trước khi vào lớp

Giáo viên được phân công, trợ giảng và quản trị có quyền cuộc gọi mở **ba chấm → Ghi hình khi giáo viên vào lớp**. Tích để bật, bỏ tích để không ghi buổi này. Lựa chọn được lưu trên máy chủ, dùng chung cho các thiết bị và cả giao diện trường học/khóa học.

Chỉ chọn ghi ở màn hình chuẩn bị không bắt đầu ghi hoặc tính điểm danh. Bộ ghi chỉ chạy sau khi giáo viên vào dạy thành công theo cơ chế mốc giảng dạy hiện có. Cần R2 được bật và bộ ghi máy chủ hoạt động; tích chọn không thay cho cấu hình lưu trữ.

## Trong cuộc gọi

Giáo viên/quản trị có nút tròn **Bắt đầu ghi hình** hoặc **Dừng ghi hình** trên thanh cuộc gọi và thao tác tương ứng trong menu ba chấm. Icon ghi dùng vòng tròn, dừng dùng hình vuông trong vòng tròn; có chú thích và nhãn cho trình đọc màn hình. Học sinh chỉ xem chỉ báo trạng thái, không có quyền điều khiển ghi.

Nút phản ánh lựa chọn ghi, còn chỉ báo phía trên phản ánh tình trạng thực tế của bộ ghi. Đang chờ bộ ghi hoặc thiếu R2 không được hiểu là video đã lưu thành công.

- Dừng ghi không kết thúc lớp, không đổi mốc điểm danh và không xóa video đã có.
- Bộ ghi kiểm tra thay đổi và hoàn tất lưu đoạn hiện tại. Khi tác vụ cũ còn giữ khóa, bật lại bị chặn; chờ lưu xong rồi ghi tiếp. Các lần ghi tiếp tạo đoạn video mới.
- Đóng trình duyệt của giáo viên không tự dừng bộ ghi máy chủ. Chọn **Kết thúc cho tất cả** sẽ kết thúc lớp và hoàn tất ghi.
- Thử nghiệm giao diện dùng API mô phỏng; nghiệm thu nối lại và ghi video R2 thực tế cần ít nhất hai thiết bị trong một lớp thử riêng.
