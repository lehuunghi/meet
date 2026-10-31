# Ghi hình tự động trên máy chủ — v0.8

## Cơ chế

Dịch vụ `meet-recorder` là một bộ nhận WebRTC riêng trên VPS, không dùng camera,
micro hoặc màn hình của trình duyệt giáo viên. Bộ ghi nhận các publication đang
hiện diện của đúng trường/buổi học, từ đúng SFU App đã gán cho buổi đó. Worker chỉ
đăng ký nhận luồng, không phát media và không giả danh tài khoản giáo viên.

Điều kiện tự ghi: buổi đang diễn ra, cho phép ghi hình, đã bật R2, có người tham
gia còn heartbeat và còn bộ ghi trống. R2 chưa bật thì không tự ghi tràn ổ đĩa.

- Giáo viên rời lớp/đóng trình duyệt: người khác tiếp tục học, bộ ghi tiếp tục.
- Giáo viên kết thúc buổi: bộ ghi hoàn tất phần cuối và tải lên R2.
- Tất cả rời phòng: sau khi hết lease hiện diện 45 giây và thêm khoảng chờ 30
  giây, bộ ghi dừng. Vào lại cùng buổi sẽ tự tiếp tục nếu chưa đạt giới hạn.
- Giới hạn tổng thời gian ghi của một buổi là 8 giờ; bộ đếm nằm trong Redis AOF.
  Không xóa Redis để “reset” giới hạn vì đây cũng là dữ liệu phiên của hệ thống.
- Nội dung trình bày được ưu tiên, có ô người đang nói; khi không trình bày thì
  ưu tiên người đang nói. Việc ghim video trên máy cá nhân không đổi bản ghi.
- Phòng hiển thị trạng thái ghi, chờ bộ ghi, lỗi hoặc chưa cấu hình. Không có
  nút quay màn hình thủ công trong phòng. Danh sách video nằm trong báo cáo buổi.

Đây là cách dùng tương tự Google Meet, không phải dịch vụ Google hay cam kết
tương đương toàn bộ tính năng, chất lượng và năng lực của hạ tầng Google.

## Lưu trữ và phục hồi

720p, tối đa 15 hình/giây, VP8/Opus; video khoảng 1,5 Mbps và audio 96 Kbps.
Mỗi đoạn tối đa khoảng 5 phút được ghi vào volume `meet-recorder_recorder_spool`.
Các chunk được đồng bộ xuống đĩa mỗi khoảng 2 giây. FFmpeg bổ sung duration/cues
để video có thể tua. Worker tải từng đoạn lên R2, kiểm tra kích thước/type, rồi
mới đánh dấu `ready` và xóa bản tạm. Tải lỗi sẽ thử lại cùng ID/object key.

Không đổi bucket/account khi còn đoạn chờ: worker giữ bản tạm và chờ cấu hình
đúng, không âm thầm tải dữ liệu sang tài khoản khác. Mất điện/kill có thể mất phần
chưa flush; không thể bảo đảm không mất một khung hình nào. File `.partial` sẽ
được thử remux sau khi khởi động lại. Giữ volume spool khi nâng cấp hoặc phục hồi;
**không chạy `docker compose down -v`** để xử lý lỗi ghi hình.

Các đoạn dùng prefix `recordings/` và thời hạn lưu cấu hình chung (mặc định 30
ngày). Bộ dọn R2/DB hiện có tiếp tục áp dụng. File tạm quá hạn cũng được xóa.
Một nút xem video buổi học mở playlist theo thứ tự thời gian, tự chuyển đoạn;
chưa ghép thành một file tải xuống duy nhất như bản ghi Google Meet.

## Cài đặt

Bộ cài mới khởi động dịch vụ ghi tự động. Với bản đã cài, cập nhật API/web lên
v0.8 bằng quy trình sao lưu/kiểm tra hiện có trước, khi không có lớp live, rồi:

```bash
cd /opt/meet
sudo bash deploy/install-recorder.sh
```

Script từ chối thay bộ ghi khi có buổi live. Nó build image gắn SHA mã nguồn rồi
chạy project Compose riêng `meet-recorder`, nối vào mạng nội bộ `meet_internal`.
Không mở cổng MySQL/Redis hoặc cổng worker ra Internet. Worker chạy UID 10001,
chỉ đọc cấu hình/secret hiện có, ghi vào spool; không đưa secret vào trang web.
Không commit `runtime-config`, `secrets`, volume hoặc file ghi hình.

Nhập R2 ở trang quản trị trung tâm, gồm account, bucket, access key, secret và
thời hạn lưu. Worker tự đọc cấu hình mới; không cần đưa khóa vào lệnh/chat.

```bash
docker compose -f deploy/recorder.compose.yaml ps
docker compose -f deploy/recorder.compose.yaml logs --tail=100
```

Nâng cấp API sẽ tạm dừng các container recorder đang chạy trước snapshot, giữ
spool, rồi khởi động lại sau khi thành công/rollback. Bản worker hiện tại dùng
schema 6; nâng bản worker bằng lại script trên khi không có lớp live. Worker
không tự thay image trong lúc đang ghi.

## Nhiều lớp đồng thời

Mặc định một worker chỉ ghi **1 lớp đồng thời**. Lớp khác vẫn gọi qua SFU nhưng
phần đầu buổi sẽ **không được ghi khi đang chờ**; hàng đợi không phát lại quá khứ.
Muốn tất cả lớp được ghi đầy đủ phải có đủ worker trước khi mở lớp.

Compose đặt mặc định 2 CPU, tối đa 1536 MiB cho một worker. Đây là giới hạn bảo
vệ, không phải số đo cam kết. VPS 4 GiB còn phải chia RAM cho MySQL, Redis, API và
hệ điều hành; không tăng concurrency tùy ý. Chỉ tăng sau đo tải với số video,
độ phân giải, chia sẻ màn hình và thời lượng thật. Nếu tăng `RECORDER_CONCURRENCY`
thì phải điều chỉnh CPU/RAM tương ứng; không tăng riêng biến concurrency.

Có thể chạy thêm worker trên mạng riêng có kết nối an toàn tới DB/Redis và cấu
hình R2/SFU, mỗi worker có spool riêng. Redis lease 90 giây, gia hạn 10 giây,
giúp các worker không cùng nhận một buổi. Không công khai DB/Redis để nối worker.
Bản này chưa có giao diện tự cấp thêm máy ghi hoặc tự mở rộng worker.

Với bitrate đặt tối đa khoảng 1,6 Mbps, dung lượng tương đương khoảng 720 MB
cho một giờ/một lớp trước overhead; nội dung thực tế có thể thấp hơn. N lớp cần
nhận N lần lưu lượng media và thêm lưu lượng tải R2. Khi trống dưới 1 GiB,
worker không mở đoạn mới, giữ file đã có và báo lỗi thay vì ghi đầy đĩa.

## Phạm vi nghiệm thu

Test compositor dùng media giả lập kiểm tra WebM, kích thước 1280×720, chia
đoạn và tiếp tục sau khi đóng trang giáo viên. Test đó không chứng minh đường
Cloudflare → worker → R2 thật. Khi R2 chưa cấu hình, phải ghi rõ chưa nghiệm thu
upload, xem lại, xóa hết hạn thực tế và số lớp ghi đồng thời trên VPS.

Tham khảo cơ chế sử dụng của Google:
https://support.google.com/meet/answer/9308681?hl=en

Giao diện cuộc gọi dùng thiết bị mặc định, không có chọn bố cục/tên lớp/live hoặc bảng chọn thiết bị. Trước khi vào lớp, mic/camera mặc định tắt; bấm biểu tượng để bật và cấp quyền. Có thể vào chỉ nghe mà không cấp quyền camera/mic.

Khi đã tham gia, tab lưu mã buổi và trạng thái mic/camera tối đa 2 giờ từ lần hoạt động gần nhất. Reload sẽ xác thực lại rồi tự vào cùng buổi; rời lớp chủ động/kết thúc/bị loại sẽ xóa ghi nhớ. Không lưu token trong ghi nhớ này. Chia sẻ màn hình cần chọn lại theo quyền của trình duyệt; nếu mic/camera không mở lại được thì vẫn thử vào chỉ nghe.
