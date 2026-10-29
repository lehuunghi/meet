# Ghi hình bằng VPS, trình duyệt và cụm máy Windows/Linux

## Phạm vi bản 0.34.0

Ba phương thức dùng chung SFU, quyền xem video và R2. Mặc định vẫn là **VPS**; nâng cấp không tự bật ghi trên thiết bị giáo viên hoặc máy văn phòng.

| Phương thức | Nơi xử lý | Khi giáo viên đóng trình duyệt |
|---|---|---|
| VPS | Bộ ghi đã cài trên VPS trường | Có thể tiếp tục theo vòng đời buổi học |
| Trình duyệt giáo viên | Thiết bị người điều hành nhận quyền ghi | Ngừng ghi; phần đã lưu cục bộ có thể tải lại |
| Cụm máy Windows/Linux | Máy đăng ký với website trường | Tiếp tục nếu máy ghi và kết nối vẫn hoạt động |

Không đổi hệ thống gọi sang RealtimeKit. Chưa có chế độ tự đẩy tải từ cụm về VPS: hết máy thì chờ, tránh quá tải VPS website.

## 1. Quản trị trung tâm

1. Cập nhật website trường, bộ ghi VPS nếu đang dùng, và `control/agent.py` lên cùng phiên bản tương thích.
2. Trong `admin.tn.edu.vn`, chọn đơn vị → **R2 / Backup**.
3. Chọn **VPS**, **Trình duyệt giáo viên** hoặc **Cụm máy Windows / Linux** → **Lưu & đồng bộ**.
4. Đợi tác vụ thành công. Phải dừng ghi các buổi đang diễn ra trước khi đổi phương thức.
5. Nếu chọn cụm: tại phần **Cụm máy ghi**, nhập tên máy → tạo mã đăng ký. Đợi tác vụ áp dụng thành công trước khi dùng mã; mã hết hạn 10 phút sau khi được áp dụng và chỉ dùng một lần.

Máy ghi kết nối với **domain của website trường**, ví dụ `https://va.tn.edu.vn`, không kết nối trực tiếp database và không nhập mật khẩu giáo viên. Một máy đăng ký với một trường trong bản đầu này. Có thể dùng cùng hạ tầng quản trị cho nhiều trường nhưng chưa chia sẻ động một máy giữa các trường.

Các website được quản lý bởi trung tâm từ chối việc quản lý máy ghi qua tài khoản quản trị địa phương. Bản cài độc lập có bảng quản lý máy tại mục quản trị website.

## 2. Ghi bằng trình duyệt

Khi giáo viên/người điều hành đã vào phòng, buổi học thực sự bắt đầu và bật ghi, một trình duyệt nhận quyền ghi. Các tab/người điều hành khác không tạo thêm bản ghi chính.

- Dựng hình riêng 1280 × 720, 25 fps, video mục tiêu 1,5 Mbps, âm thanh 96 kbps.
- Dùng media đang có trong phòng, không gọi chức năng quay desktop, không yêu cầu quyền camera/micro ngoài quyền cuộc gọi.
- Có màn hình chia sẻ, camera, âm thanh, bảng trắng và chú thích đúng màn hình đích; bảng trắng đang hoạt động chiếm khung hình chính.
- MediaRecorder xuất dữ liệu khoảng 5 giây/lần. Đây là khoảng mục tiêu, không phải bộ định thời chính xác.
- Lưu vào IndexedDB trước, gom thành các phần **16 MiB**, tải trực tiếp lên R2 bằng URL ký có hạn. Phần cuối được nhỏ hơn.
- R2 ghép đúng thứ tự byte của **một phiên ghi**; không phải dịch vụ dựng phim hoặc chuyển định dạng.
- Giữ bản cục bộ đến khi API xác minh việc hoàn tất trên R2. Mỗi bản giới hạn 8 GiB; còn phụ thuộc hạn mức bộ nhớ trình duyệt.

**Không đóng, tải lại trang, tắt máy, xóa dữ liệu trình duyệt hoặc chuyển sang chế độ ngủ khi đang ghi.** Khi rời lớp bằng nút trong web, hệ thống cố gắng dừng và tải phần cuối trước khi rời. Đóng cưỡng bức có thể mất phần cuối chưa được ghi xuống bộ nhớ.

Nếu tải thất bại: vào lại đúng trình duyệt, tài khoản và website, mở **Bản ghi còn trên thiết bị** → **Tiếp tục tải lên R2**. Có thể tải file về máy trước khi hủy. Phần dữ liệu chưa từng được lưu không thể khôi phục. Một lần ghi mới sau tải lại trang là bản ghi riêng, không tự nối các khoảng mất mạng thành video liền mạch.

Đầu ra là WebM. Bản trình duyệt chưa có bước chuyển MP4 hoặc chuẩn hóa duration/cues bằng FFmpeg; khả năng tua cần được nghiệm thu trên trình duyệt đích. Bản cụm có bước remux bằng FFmpeg.

## 3. Tải phần mềm máy ghi

Workflow **Recording agent packages** tạo hai gói có runtime Node, Chromium, FFmpeg và ứng dụng; không yêu cầu cài Node/Docker/Chrome thủ công:

- `meet-recorder-win32-x64.zip` cho Windows x64 còn được hỗ trợ.
- `meet-recorder-linux-x64.tar.gz` cho Ubuntu/Debian x64.

Tải artifact từ đúng repository và commit đã kiểm tra. Đối chiếu SHA256 đi kèm. Các gói hiện chưa có chứng thư ký mã thương mại; checksum không thay thế chữ ký nhà phát hành. Không có tự cập nhật bằng lệnh tải/chạy tùy ý.

### Windows

1. Giải nén gói, mở PowerShell bằng quyền Administrator.
2. Chạy `./install-windows.ps1` từ thư mục đã giải nén, theo chính sách thực thi script của tổ chức. Không tắt bảo vệ toàn hệ thống để chạy script không được kiểm tra.
3. Nhập domain website trường và mã đăng ký.
4. Bộ cài đặt chương trình tại `%ProgramData%\MeetRecorder\app`, dữ liệu tại `%ProgramData%\MeetRecorder\data`.
5. Chạy thử ghi bằng chính tài khoản nền **LocalService** qua tác vụ `MeetRecorderProbe`; kiểm tra thành công mới bật tác vụ `MeetRecorder` khởi động cùng máy.
6. Kiểm tra máy xuất hiện trong trung tâm. Thử khi khóa màn hình, đăng xuất và ngắt Remote Desktop trước khi giao lớp thật.

Ứng dụng nền không có cửa sổ phòng học và chưa có biểu tượng khay hệ thống. Dừng bằng Task Scheduler → MeetRecorder → End; đây là dừng cưỡng bức, nên dùng thu hồi/đợi hết lớp nếu đang ghi. Không đặt ngủ hoặc hibernate trong giờ nhận lớp.

### Linux

1. Giải nén gói.
2. Chạy `sudo bash ./install-linux.sh` từ thư mục đó.
3. Nhập domain và mã đăng ký. Bộ cài bổ sung thư viện hệ điều hành cần cho Chromium, nên cần Internet và kho gói hoạt động.
4. Chương trình đặt tại `/opt/meet-recorder-agent`; dữ liệu tại `/var/lib/meet-recorder-agent`, tài khoản hệ thống `meet-recorder`.
5. Dịch vụ là `meet-recorder-agent.service`. Xem nhật ký bằng `journalctl -u meet-recorder-agent`.

Chromium chạy với sandbox. Ubuntu có hạn chế user namespace sẽ dùng quyền AppArmor giới hạn theo đường dẫn binary của ứng dụng; không tự chạy với `--no-sandbox` khi lỗi. Nếu kiểm tra nền thất bại, xử lý chính sách máy trước khi nhận lớp.

## 4. Cách vận hành cụm

- Bản đầu: **một máy nhận tối đa một lớp**, không tự định công suất từ tên CPU. Máy chỉ xin việc mới khi RAM trống ít nhất 2 GiB, đĩa trống ít nhất 5 GiB và tải CPU đo giữa hai lượt kiểm tra dưới 75%. Đây là ngưỡng tiếp nhận, không phải bảo đảm chất lượng.
- Mỗi công việc và mỗi máy có khóa nhận việc 60 giây. Gia hạn định kỳ; không được gia hạn nếu khóa đã thuộc máy khác.
- Máy dừng thu khi mất liên lạc điều phối quá 45 giây hoặc quyền bị thu hồi. Máy khác có thể nhận sau khi khóa hết hạn, có thể có khoảng trống.
- Các đoạn độc lập khoảng 5 phút được remux để có duration/cues, tải R2 ở nền; chúng hiện thành các bản ghi của cùng buổi học, chưa tự ghép toàn bộ đoạn thành một MP4.
- Mỗi đoạn có file metadata và dữ liệu đệm. Khởi động lại sẽ thử tải các file còn lại; không xóa thư mục data khi còn bản ghi chưa tải.
- Bản hiện tại giới hạn tối đa ba phiên tải pending cho mỗi chủ bản ghi và thời hạn phiên tải bảy ngày. R2 lỗi kéo dài có thể làm máy tạm dừng ghi khi đạt giới hạn; cần theo dõi, không hứa lưu vô hạn.
- Kết thúc lớp hoặc tắt ghi sẽ dừng bộ ghi. Giới hạn an toàn mỗi công việc là tám giờ.
- Máy không đủ dung lượng đệm tối thiểu 1 GiB sẽ từ chối mở đoạn mới.

Để cập nhật: ngừng giao lớp, đợi lớp hiện tại kết thúc, kiểm tra hết file chờ tải, dừng dịch vụ, sao lưu identity/data, thay chương trình, chạy self-test bằng tài khoản dịch vụ rồi khởi động lại. Giữ runtime cũ để quay lại nếu lỗi.

## 5. Bảo mật

- Mỗi máy dùng token riêng; database chỉ lưu hash token. Mã đăng ký dùng một lần và có hạn.
- Bộ cài bảo vệ thư mục dữ liệu; Linux chạy bằng tài khoản riêng, Windows chạy LocalService thay vì LocalSystem.
- Máy chỉ chủ động kết nối ra ngoài; không mở cổng điều khiển hoặc remote shell trên máy văn phòng.
- API chỉ cho nhận luồng của phòng được giao, không phát media, sửa điểm danh, tài khoản hoặc điều hành phòng.
- Không phân phối khóa quản trị R2/SFU. URL tải lên chỉ áp dụng đúng file/phần được giao.
- Tác vụ trung tâm chứa mã đăng ký được mã hóa; nhật ký không trả token, khóa Cloudflare hoặc mật khẩu. Thu hồi máy chặn các yêu cầu tiếp theo.
- Người có quyền quản trị máy hoặc mã độc vẫn có thể đọc nội dung đang xử lý. Ưu tiên máy được quản lý, cập nhật bảo mật và dành riêng cho ghi.

## 6. Nghiệm thu trước khi dùng thật

Kiểm thử tự động không thay thế một lớp thật. Cần kiểm tra Windows/Linux thực tế, SFU và R2 thật, đủ hai tiếng, các trường hợp mất mạng, thu hồi máy, tải lại trang, hết dung lượng, âm thanh nhiều người và bảng trắng. Chỉ sau đó mới nâng lên 10 máy chính và 2–3 máy dự phòng.

Máy chủ, cụm máy và trình duyệt đều cần điện/mạng và bộ nhớ. SFU cùng R2 vẫn có thể phát sinh phí, dù không trả phí ghi hình theo phút của RealtimeKit.
