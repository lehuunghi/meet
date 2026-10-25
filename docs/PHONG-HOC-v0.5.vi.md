# Phòng học mở rộng — v0.5.0

Bản này bổ sung các chức năng hội nghị thường dùng theo mô hình phòng học đa trường. Không nhúng iframe hoặc tài khoản Google Meet và không tuyên bố tương đương toàn bộ dịch vụ Google Meet.

## Chức năng đã triển khai

| Nhóm | Chức năng và phạm vi |
|---|---|
| Vào lớp | Khung chuẩn bị, xem trước, kiểm tra camera/mic; thiếu camera có thể dùng micro; có nút vào chỉ nghe. SFU tạo session không có body, gồm bản sửa thực tế v0.4.1. |
| Phòng chờ | Bật duyệt học sinh. Yêu cầu chờ không tạo presence và không cộng điểm danh. Duyệt, từ chối, mời ra, cho vào lại. Người đang học được giữ quyền khi mới bật phòng chờ; tắt phòng chờ giải phóng yêu cầu đang chờ. |
| Phân quyền | Admin có quyền buổi học, giáo viên chính và trợ giảng đã phân công được điều hành. Học sinh không thể tự duyệt bằng API; ngoài lớp/trường bị chặn. Không cho học sinh mời giáo viên ra. |
| Thu hồi media | Mời ra/từ chối rút publication, tắt presence và đánh dấu mọi session cũ nghỉ ngay. Worker đóng SFU và thử lại khi lỗi. Cho vào lại không hồi sinh session cũ. Không hứa ngắt tức thì khi provider/hàng đợi chậm. |
| Micro | Bật/tắt mic của mình; người điều hành yêu cầu một hoặc tất cả học sinh tắt mic. Ứng dụng tắt track khi nhận yêu cầu, người học có thể tự bật lại. Đây là yêu cầu trên client, chưa phải khóa cứng mic ở SFU. Không tự bật mic/camera của người khác. |
| Giơ tay | Giơ/hạ tay cá nhân; người điều hành hạ tất cả tay. |
| Chat | Tin nhắn trong buổi; người điều hành bật/tắt quyền gửi của học sinh. Quyền được kiểm tra lại phía máy chủ. |
| Trình bày | Camera và màn hình dùng luồng riêng, không thay camera bằng màn hình. Có thể chọn âm thanh tab/hệ thống nếu trình duyệt hỗ trợ. Dừng trình bày chỉ thu hồi session màn hình. Người điều hành tắt quyền trình bày của học sinh; các luồng màn hình đã khai báo được thu hồi. Không thể phân biệt nội dung của camera ảo do thiết bị cung cấp. |
| Bố cục | Tự động/lưới/người trình bày; ghim/bỏ ghim video, ưu tiên màn hình trình bày, toàn màn hình khi trình duyệt hỗ trợ. Khung người nói sáng lên và bố cục người trình bày chọn người nói khi có audioLevel. |
| Thiết bị | Chọn camera/micro trước hoặc trong buổi, giữ trạng thái mute khi đổi thiết bị; chọn loa/tai nghe khi hỗ trợ setSinkId. Danh sách thiết bị phụ thuộc quyền trình duyệt. |
| Liên kết | Sao chép link vào thẳng buổi. Người nhận vẫn phải đăng nhập và được cấp quyền lớp/trường; link không phải quyền truy cập. |
| Phản ứng | 👍 👏 ❤️ 😂 🎉; tối đa 5 phản ứng/10 giây/người. Redis giữ tối đa 30 phản ứng trong 30 giây, client bỏ trùng và hiển thị ngắn hạn. |
| Khảo sát | Tối đa 10 khảo sát/buổi, 2–6 lựa chọn/câu; người điều hành tạo/đóng khảo sát. Học sinh đổi lựa chọn khi còn mở; mỗi người một phiếu. API trả tổng phiếu và lựa chọn của mình, không trả phiếu gắn danh tính người khác. Không phải bài thi/chấm điểm. |
| Đã có từ trước | Tự kết nối lại, điểm danh theo buổi, XLSX tiếng Việt, ghi màn hình WebM tải R2 multipart và phục hồi tải trên thiết bị. |

## Cách sử dụng

1. Mở buổi học đã phân công. Người điều hành bắt đầu buổi, mở **Điều hành phòng** để bật phòng chờ hoặc thay quyền chat/trình bày.
2. Học sinh bấm **Xin vào lớp** nếu bật duyệt. Sau khi giáo viên cho vào, bấm vào với thiết bị đã chọn hoặc vào không dùng thiết bị. Không tự bật thiết bị ngay khi được duyệt.
3. Danh sách chờ có duyệt/từ chối. Mục quản lý học sinh đã duyệt có yêu cầu tắt mic và mời ra. Mục đã từ chối/mời ra có nút cho vào lại.
4. Trong **Thiết bị âm thanh & hình ảnh**, chọn thiết bị. Cấp quyền trước để trình duyệt hiển thị đúng tên.
5. **Chia sẻ màn hình** tạo luồng riêng; bấm lại để dừng. Sau kết nối lại, phải chọn lại nguồn chia sẻ.
6. Mở tab **Khảo sát** để tạo hoặc trả lời. Phiếu được thay thế khi đổi lựa chọn, không cộng hai lần.
7. Demo `?demo=1&role=teacher&page=overview` → Vào lớp cho xem các thao tác minh họa, không mở thiết bị hoặc gửi lên Cloudflare. Vai trò học sinh không có nút điều hành.

## Nâng cấp và dữ liệu

Phiên bản 0.5.0 dùng schema 5: thêm room_settings, room_members, room_polls và room_votes. Migration chỉ thêm bảng và ghi phiên bản, chạy lại được; không xóa lớp, tài khoản hoặc báo cáo cũ. Dùng quy trình snapshot/cập nhật/rollback, không ghi đè nguồn hay cài lại.

VPS đang được giữ nguyên theo yêu cầu không kết thúc buổi học đang live. Chỉ triển khai sau khi người dùng kết thúc buổi và CI đúng commit đạt.

## Kiểm tra trước vận hành thật

- Hai tài khoản học sinh: chờ duyệt không có điểm danh/media; chỉ người được duyệt vào. Thử API trực tiếp, khác lớp và khác trường.
- Mời ra rồi cho vào lại: session cũ bị từ chối; phiên mới hoạt động. Thử SFU lỗi khi thu hồi để xác minh retry.
- Hai người điều hành cùng sửa: dữ liệu cũ bị 409 thay vì ghi đè; bật phòng chờ không ngắt người đang học.
- Camera/màn hình cùng một người hiện hai ô; dừng màn hình không ngắt mic/camera. Thử tab audio trên browser/OS cần dùng.
- Đổi thiết bị không tự bật mic/camera đang mute. Loa/toàn màn hình/audioLevel có thể không được hỗ trợ trên một số browser.
- Đổi phiếu không tăng tổng; đóng khảo sát xong không nhận phiếu mới; kết quả không chứa ID người bỏ phiếu khác.
- Điện thoại 360/390 px không tràn trang, thanh điều khiển không che nội dung, nút chạm được.

Unit, API integration với MySQL/Redis thật và browser tests được bổ sung trong CI. Transport SFU trong integration được giả lập; camera/màn hình thật vẫn cần nghiệm thu sau triển khai.

## Các nhóm chức năng chưa triển khai

| Nhóm tiếp theo | Công việc cần làm |
|---|---|
| Phụ đề/phiên dịch nhiều người | Chọn dịch vụ nhận dạng giọng nói, credential/chi phí và chính sách xử lý audio; không âm thầm gửi audio sang dịch vụ khác. |
| Ghi hình tự động phía máy chủ | Recorder/mixing độc lập, quota, hàng đợi, giám sát, phiên dài và R2 thật; hiện vẫn capture trình duyệt. |
| Phòng thảo luận | Phân nhóm theo buổi, cách ly media/chat/điểm danh, chuyển nhóm và đưa về phòng chính. |
| Nền mờ/nền ảo | Xử lý hình trên thiết bị, kiểm tra hiệu năng desktop/mobile và giữ hiệu ứng khi đổi camera. |
| Q&A và bài kiểm tra | Duyệt/upvote/trả lời/xuất kết quả; bài kiểm tra có đáp án/điểm khác khảo sát đang có. |
| Khách ngoài trường/livestream | Chính sách danh tính, link mời có hạn, duyệt khách và quyền dữ liệu; phát trực tiếp cần cấu hình đích riêng. |
| Khóa mic ở SFU | Hàng đợi đóng đúng audio track và cách bật lại rõ ràng; không gọi yêu cầu client tắt mic là cưỡng chế media. |
| Quy mô lớn | Phân trang, realtime push thay một phần polling, benchmark người/track/room và cảnh báo quota. |

Tham chiếu: [Cloudflare SFU](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/), [MediaDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices), [Audio output selection](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId).
