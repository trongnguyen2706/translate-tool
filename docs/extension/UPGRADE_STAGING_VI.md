# Bật bản 0.2.0 trên staging

Code và gói extension đã được chuẩn bị. Ba migration dưới đây chưa được tự chạy lên Supabase của bạn.

1. Xuất backup dữ liệu hiện có từ Kho từ và giữ bản snapshot/dump staging có thể phục hồi. Không dùng dữ liệu production để thử migration lần đầu.
2. Trong Supabase, mở đúng **project staging → SQL Editor → New query**. Chạy toàn bộ nội dung từng file theo đúng thứ tự:
   - `supabase/migrations/006_enrichment_cache.sql`: lưu kết quả/trạng thái request AI theo tài khoản.
   - `supabase/migrations/007_stable_vocabulary_identity.sql`: dùng alias nghĩa và writer chung; giữ ID, ngữ cảnh và thẻ cũ. File này bỏ ràng buộc unique dựa trên nội dung nghĩa cũ, nên cần backup trước. Không chạy lại backend cũ sau migration này.
   - `supabase/migrations/008_resumable_backup.sql`: nhập backup theo transaction/checkpoint và bảo vệ thao tác hoàn tác.
3. Đảm bảo ứng dụng đang chạy code mới. Khi dùng local, chạy `npm run dev` nếu server chưa mở; không mở thêm một server khác trên cổng 3000.
4. Build đã tạo thư mục `artifacts/extension`. Trong `chrome://extensions`, bấm **Reload** trên Phrasebook rồi **F5** trang YouTube và web Phrasebook. Giữ cùng thư mục để không đổi ID unpacked hiện tại.
5. Trong extension → **Downloads and sync**, kiểm tra danh sách từ điển và hàng đợi. Từ đã tải trước đây được giữ qua nâng cấp IndexedDB. Không cần tải lại chỉ vì đổi mã extension.
6. Trong Kho từ, chọn **Definition mode**, **Source: Extension dictionary**, chọn trường thiếu rồi bấm **Fill missing fields**. Nếu một từ có nhiều nghĩa, chọn đúng nghĩa hoặc Skip. Nếu báo không nối được extension, kiểm tra **Phrasebook web address** là cùng origin đang mở (hiện tại `http://localhost:3000`), sau đó reload extension và trang web.
7. Thử một từ: lưu từ extension → chờ đồng bộ → quay lại Kho từ → mở flashcard. Thử thêm ngữ cảnh cho từ đã lưu và xác nhận tiến độ học cũ vẫn còn. Khi offline, phần chờ chỉ nằm trên máy cho tới khi dịch vụ phục hồi.
8. Thử **Export full ZIP** rồi nhập vào tài khoản staging thử riêng. Chạy lại cùng ZIP để kiểm tra resume; các phần hoàn tất không được ghi lại. Tiến độ đã có trong tài khoản đích được giữ, không dùng import để ghi đè tiến độ mới hơn.

Phát âm đã được loại khỏi phạm vi; IPA vẫn là thông tin dạng chữ. Hướng dẫn tạo hosting/R2 và chuẩn bị Chrome Web Store ở `RELEASE.md`. Theo lựa chọn hiện tại của bạn, chưa upload/deploy hay gửi Store.
