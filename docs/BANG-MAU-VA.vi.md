# Bảng màu thương hiệu VA

Toàn website dùng chung `apps/web/public/brand-tokens.css`, gồm trang công khai, đăng ký/đăng nhập, quản trị, giáo viên, học sinh và điều khiển Meet.

| Màu gốc | Vai trò |
| --- | --- |
| `#0B4ED8` | Nút chính, liên kết, mục đang chọn, tiến độ học |
| `#00C2E8` | Điểm nhấn, trạng thái hoạt động, đường viền điều khiển đang chọn |
| `#FFAA1D` | CTA học thử/nâng cấp; đi với chữ xanh đậm |
| `#FF4D4F` | Điểm nhấn cảnh báo/xóa; nút đỏ và chữ lỗi dùng biến thể đậm để dễ đọc |
| `#FFFFFF` | Nền thẻ và vùng nội dung |

Nền trang dùng xám xanh rất nhạt, chữ dùng xanh mực và xám xanh. Các biến thể xanh đậm, cyan đậm và đỏ đậm giúp chữ thường trên nền sáng, chữ trắng trên nút đủ tương phản. Không dùng chữ trắng trên cam hoặc cyan nguyên bản. Phòng Meet giữ nền tối để video nổi bật; trạng thái mic/camera và nút rời phòng vẫn phân biệt bằng biểu tượng/nhãn, không chỉ bằng màu.

Thay đổi bảng màu tập trung ở file token; các quy tắc phân vai màu nằm trong `apps/web/src/brand-theme.css` và phần cuối `apps/web/public/academy-site.css`. Logo, ảnh do chủ website tải lên và nội dung tài khoản không bị sửa.
