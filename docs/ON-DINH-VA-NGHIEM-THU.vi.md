# Ổn định, phục hồi và nghiệm thu — v0.4.0

## Đã triển khai trong đợt này

| Phần               | Hành vi                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kết nối phòng học  | Các thao tác media đi qua một hàng đợi, không chồng offer/answer. Khi peer lỗi, mất mạng kéo dài hoặc kết nối quá 45 phút, tạo phiên mới và lấy TURN mới; giữ trạng thái bật/tắt của mic/camera. Thử lại có thời gian chờ tăng dần tối đa 60 giây. Chia sẻ màn hình cần chọn lại sau phục hồi.                                                                                                                                              |
| Thu hồi media      | Phiên cũ bị đánh dấu nghỉ, không nhận thương lượng mới. Worker quét tuần tự 100 phiên mỗi lượt, mỗi chu kỳ 15 giây, xử lý buổi đã kết thúc, tài khoản bị khóa, phiên đăng nhập cũ và presence hết hạn. Đọc MID từ Cloudflare rồi force-close cả phát và nhận. Lỗi giữ nguyên SQL để thử lại; sau khoảng yên 60 giây mới kiểm tra lại và xóa phiên đã đóng. Không cam kết ngắt tức thì hoặc thời gian cố định khi provider lỗi/hàng đợi lớn. |
| Giới hạn phiên     | Tối đa 8 phiên chưa nghỉ và 32 phiên gồm phiên chờ dọn cho mỗi người/buổi, để kết nối lại không chạm giới hạn tích lũy 8 phiên như trước.                                                                                                                                                                                                                                                                                                   |
| Ghi hình           | Lưu các đoạn vào IndexedDB trên thiết bị; ghép phần tải 16 MiB, multipart trực tiếp vào R2, tối đa 8 GiB/bản ghi. Không gom toàn buổi trong RAM khi đang ghi. Video vẫn là màn hình/âm thanh do trình duyệt cho phép, chưa phải recorder phía máy chủ.                                                                                                                                                                                      |
| Phục hồi bản ghi   | Dùng cùng trình duyệt, origin và tài khoản, mở mục **Bản ghi còn trên thiết bị**. Có tiếp tục tải, lưu file về máy hoặc hủy. Đổi mạng/tải lại trang giữ các đoạn đã ghi thành công. Chưa thể tiếp tục thu hình sau đóng tab; có thể hoàn tất phần đã lưu. Các tab dùng khóa trình duyệt để tránh cùng sửa một bản ghi.                                                                                                                      |
| Xác minh R2        | Máy chủ lấy danh sách part/ETag từ R2, kiểm tra số/thứ tự/kích thước, hoàn tất và HEAD trước khi đánh dấu ready. Thử lại an toàn khi phản hồi hoàn tất bị mất. Không nhận bucket/key/upload ID từ client. Tối đa 3 bản chờ mới trong 7 ngày/người.                                                                                                                                                                                          |
| Hạn tải            | Phiên tải từng phần có hạn 7 ngày; rule R2 hủy multipart dang dở sau 7 ngày khi lưu lại cấu hình. Thời hạn lưu video hoàn chỉnh vẫn theo cấu hình, mặc định 30 ngày. Người vận hành cần kiểm tra rule khác không hủy part sớm hơn.                                                                                                                                                                                                          |
| Khôi phục mật khẩu | Admin có quyền tài khoản cấp liên kết cho tài khoản đang hoạt động trong trường; không cấp cho bản thân/quản trị gốc. Link nằm ở URL fragment, dùng một lần trong 30 phút, cấp mới hủy link cũ. Không gửi tự động qua email. Đổi mật khẩu yêu cầu TOTP nếu tài khoản đã bật; ghi audit cùng giao dịch và vô hiệu hóa phiên cũ.                                                                                                              |
| Nhật ký            | Menu Nhật ký chỉ dành admin có quyền audit, lọc đúng tên thao tác và phân trang 50 dòng theo mốc ID. Chỉ hiển thị dữ liệu trường hiện tại.                                                                                                                                                                                                                                                                                                  |
| Kiểm thử           | Unit media/force-close, API tích hợp MySQL/Redis với provider giả lập, trình duyệt desktop/mobile và phục hồi IndexedDB/multipart được đưa vào CI.                                                                                                                                                                                                                                                                                          |

## Cách cập nhật và sử dụng

1. Đợi toàn bộ CI của đúng commit đạt. Thực hiện cập nhật từ `/setup` theo [hướng dẫn cập nhật an toàn](CAP-NHAT-AN-TOAN.vi.md); không dùng bộ cài mới để ghi đè cài đặt cũ.
2. Trong cấu hình R2, lưu lại để áp dụng/xác minh lifecycle có hủy multipart dang dở. Giữ nguyên bucket/account khi còn bản đang tải.
3. Giáo viên chọn **Ghi màn hình vào R2**, chọn nguồn màn hình và âm thanh trình duyệt. Theo dõi thông báo lưu trên thiết bị/tải part. Dừng và đợi xác minh ready trước khi xóa dữ liệu trình duyệt.
4. Nếu upload lỗi, mở lại cùng site và tài khoản, chọn tiếp tục tải trong mục phục hồi. Không mở chế độ riêng tư, đổi origin, xóa IndexedDB hoặc dùng ứng dụng dọn dữ liệu trước khi hoàn tất. Trình duyệt có thể thu hồi dung lượng; lưu tạm trên thiết bị không thay thế backup.
5. File tải về thủ công có thể lớn, thao tác này có thể dùng nhiều bộ nhớ. Đóng tab đột ngột có thể mất đoạn cuối chưa kịp lưu, và file cần kiểm tra phát lại trước khi xóa bản gốc.
6. Admin cấp liên kết đặt lại mật khẩu ở bảng tài khoản, kiểm tra đúng người nhận và giao qua kênh riêng. Mất cả 2FA cần quy trình xác minh bởi người vận hành; liên kết này không tắt 2FA.

## Nghiệm thu thực tế còn bắt buộc

Các kiểm thử transport giả lập không xác nhận Cloudflare thật. Dùng staging, dữ liệu thử và secret nhập tại `/setup`, không gửi secret trong chat/Git.

| Kịch bản                                          | Điều kiện đạt                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lớp kéo dài hơn một giờ                           | Âm thanh/video phục hồi khi lấy TURN mới; có trạng thái kết nối, mic đang tắt không tự bật lại.                                                                                   |
| Đổi Wi-Fi/4G; ngắt mạng 30–90 giây                | Tự nối lại, không cộng thời gian điểm danh khoảng mất mạng, không nhân đôi ô/video/âm thanh.                                                                                      |
| Kết thúc buổi, khóa tài khoản, đăng nhập nơi khác | Thiết bị cũ dừng media; worker đóng upstream và dọn phiên sau xác minh. Thử provider 5xx rồi phục hồi để kiểm tra retry.                                                          |
| Ghi hình và mất mạng                              | Part đã thành công không tải lại; đoạn cục bộ còn sau reload; hoàn tất video phát đủ âm thanh/hình. Thử disk-full, quyền màn hình bị thu hồi và hết hạn upload.                   |
| R2 retention                                      | Video hết hạn bị chặn qua API; object và multipart dang dở được dọn theo rule thực tế.                                                                                            |
| Backup/restore                                    | Tạo backup thật lên R2; phục hồi trên VPS thử mới bằng khóa giữ riêng; kiểm tra tài khoản, 2FA, cấu hình, dữ liệu và mã nguồn. Video là object riêng, không nằm trong dump MySQL. |
| Nâng cấp/rollback                                 | Nâng đúng SHA; thử lỗi migration/health trên staging; xác minh database và cấu hình cũ trở lại, không mất dữ liệu ngoài khung bảo trì.                                            |

## Các phần tiếp tục trong lộ trình

- Lịch sử enrollment và bản chụp danh sách/chính sách theo từng buổi, thống kê học kỳ.
- Lobby, mời ra, moderation, ghim người trình bày; camera và màn hình đồng thời.
- Bắt đổi mật khẩu lần đầu, mời tài khoản, mã khôi phục 2FA được lưu bền vững.
- Phân trang/tìm kiếm toàn bộ học vụ phía máy chủ, import nền nhiều nghìn dòng.
- Quota theo trường, dashboard/cảnh báo vận hành, audit giao dịch cho toàn bộ mutation.
- Kiểm thử tải theo số lớp/người học thống nhất; kênh phát hành ổn định sau nghiệm thu.

Tài liệu này ghi rõ phần đã làm và phần chưa hoàn tất; v0.4.0 chưa phải tuyên bố đã nghiệm thu production.
