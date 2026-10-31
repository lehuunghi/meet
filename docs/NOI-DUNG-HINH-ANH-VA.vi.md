# Nội dung và hình ảnh VA — v0.18

Bộ nội dung gồm trang chủ, giới thiệu, ảnh minh họa, hồ sơ giáo viên mẫu, cảm nhận mẫu, câu hỏi thường gặp, bài viết và phần giới thiệu 15 khóa thuộc khối 10–12. Dữ liệu biên tập tham khảo nằm tại `content/va-website-starter.vi.json`.

## Thay nội dung sau khi bàn giao

Mở **Quản trị website** trên VA:

- **Trang chủ & giới thiệu**: sửa thông điệp, phần giới thiệu và URL ảnh banner/ảnh giới thiệu.
- **Giáo viên**: thay ảnh, tên, môn, giới thiệu và trạng thái công khai. Chỉ bỏ nhãn **Hồ sơ mẫu / ảnh AI minh họa** khi đã thay bằng thông tin và ảnh phù hợp.
- **Cảm nhận**: thay tên hiển thị, nội dung và ảnh. Các thẻ mẫu được gắn nhãn rõ, không hiển thị điểm đánh giá dù có nhập điểm. Khi thay bằng đánh giá thật đã được đồng ý công khai, cập nhật ảnh rồi bỏ nhãn mẫu.
- **Bài viết**: mỗi bài có ảnh đại diện, tiêu đề, tóm tắt, nội dung, đường dẫn và trạng thái công khai. Ảnh xuất hiện ở cả danh sách và trang đọc bài.
- **Câu hỏi thường gặp**: thêm, sửa, xóa tối đa 30 câu hỏi và câu trả lời. Các câu đang lưu hiển thị trên trang chủ.
- **Trang khóa học**: sửa đối tượng, mục tiêu, chương trình giới thiệu và lịch học. Lộ trình mẫu là gợi ý biên tập, không khẳng định toàn bộ video hoặc lớp Live đã sẵn sàng.

Mô tả ngắn trên thẻ khóa học được sửa tại **Quản lý nội dung → chọn khóa → Mô tả**. Tên khóa, lớp liên kết và thông tin giáo viên trong dữ liệu học vụ không bị tự gán bởi bộ nội dung mẫu.

## Ảnh

13 ảnh được tạo bằng công cụ `image_gen` tích hợp, sau đó xuất WebP để giảm dung lượng; bản PNG gốc vẫn giữ nguyên. Mọi ảnh chân dung là người hư cấu do AI tạo, không đại diện cho giáo viên, học sinh hoặc phụ huynh có thật của VA. Website gắn nhãn các thẻ mẫu và ảnh banner minh họa. Không dựng thành tích, bằng cấp, số học viên hoặc đánh giá có sao để quảng bá.

Tệp ảnh nằm tại `apps/web/public/images/`. Tên nguồn và bộ prompt được ghi tại [VA-IMAGE-PROMPTS.json](VA-IMAGE-PROMPTS.json). Ảnh banner dùng `va-online-learning-v1.webp`, ảnh giới thiệu dùng `va-study-desk-v1.webp`; nhóm `teacher-*`, `review-*`, `article-*` dùng cho các mục tương ứng.

Để thay ảnh, nhập URL ảnh HTTPS công khai hoặc đường dẫn `/images/ten-anh.webp`. Không dán khóa truy cập, URL riêng có token hoặc liên kết chỉ có hiệu lực ngắn. Đường dẫn `javascript:`, ảnh nhúng `data:` và liên kết HTTP không được chấp nhận.

## Dữ liệu được giữ

Không tự đổi giá, thời hạn, quyền Live/VIP, tài khoản, email/điện thoại liên hệ, chính sách hay phân công lớp. Các video và điểm danh đã xóa vẫn trống. Các bài viết và hồ sơ trước đó được giữ; thêm nội dung mẫu không tạo tài khoản giáo viên/học sinh thật.
