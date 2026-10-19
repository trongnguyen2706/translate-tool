# Checklist triển khai Chrome extension và từ điển nội bộ

Cập nhật ngày 19 tháng 10 năm 2026. Trạng thái: đang triển khai; chỉ đánh dấu hoàn thành khi có bằng chứng kiểm tra tương ứng.

Thiết kế và phân tích ảnh hưởng nằm trong [PLAN_EXTENSION.md](PLAN_EXTENSION.md). Checklist này quy định thứ tự làm, những gì phải kiểm tra và đầu ra của từng bước. Đọc cả hai trước khi triển khai. Các ô dưới đây là công việc tương lai, không phải kết quả đã đạt.

## Cách sử dụng checklist

- Thực hiện theo S00 đến S17. Bước sau chỉ dùng kết quả đã kiểm tra của bước trước; các nhóm test độc lập có thể chạy đồng thời khi không ghi chồng dữ liệu.
- Mỗi bước ghi commit/bản build hoặc phiên bản dữ liệu, môi trường thử, cách kiểm tra, kết quả và lỗi còn lại. Không dùng nhãn Pass nếu chỉ đọc code mà chưa thực hiện kiểm tra tương ứng.
- Trước khi sửa Next.js đọc guide liên quan trong `node_modules/next/dist/docs/` theo AGENTS.md. Dùng đúng phiên bản dependency đã kiểm tra, không nâng framework cùng tính năng này.
- Code/migration được kiểm tra trên local hoặc staging trước. Trong giai đoạn lập plan không tạo tài khoản cloud, upload dữ liệu, sửa database hoặc submit Store.
- Quyết định mặc định: beta dùng allowlist hiện có; public chỉ mở ở S17 khi chính sách truy cập, quota và vận hành đạt điều kiện. Không tự chuyển thành đăng ký công khai khi mới thêm extension.

| Nơi lưu | Nội dung | Khi nào cập nhật |
| --- | --- | --- |
| Chrome Web Store | Gói mã extension đã build, icon và listing | Khi phát hành mã hoặc thay quyền/capability |
| Cloudflare R2 với custom domain/CDN | Manifest và các gói dữ liệu từ điển công khai | Khi bộ từ điển có phiên bản mới |
| Vercel | Web Next.js và API | Khi phát hành backend/giao diện web |
| Supabase | Phiên đăng nhập, kho từ riêng, flashcard, occurrence và operation ledger | Khi user lưu/học hoặc migration được áp dụng |
| IndexedDB trong extension | Dictionary, cache cá nhân, hàng đợi và trạng thái cài | Sau lần tải đầu, lưu local và đồng bộ |

## S00 Xác nhận phạm vi và chuẩn bị baseline

Đầu vào: plan được người dùng duyệt. Không coi yêu cầu viết plan là cho phép implement.

**Thực hiện**

- [x] Xác nhận plan và flow đã chốt trong phiên; user yêu cầu triển khai theo checklist và commit các mốc phù hợp.
- [x] Ghi `git status`, branch và commit hiện tại; giữ các thay đổi người dùng. Bắt đầu trên nhánh hiện tại `codex/ai-tags-bulk-delete`.
- [x] Chạy `npm.cmd run lint`, `./node_modules/.bin/tsc.cmd --noEmit --incremental false` và `npm.cmd run build` tại repo trên PowerShell. Ghi rõ lỗi có sẵn thay vì sửa lẫn vào tính năng mới.
- [ ] Chuẩn bị môi trường local/staging, hai tài khoản thử độc lập và một tài khoản không được phép; không chép secret vào chat/repo.
- [ ] Chuẩn bị snapshot thử có từ Anh/Việt, thiếu một nghĩa, cùng chữ khác nghĩa, flashcard có tiến độ, bộ học ngày và backup cũ.

**Kiểm tra**

- [ ] Có thể mở web app, đăng nhập, dịch, lưu từ, tạo thẻ và xuất dữ liệu trước thay đổi.
- [ ] Có bản sao database dùng để diễn tập migration; kiểm tra đọc được bản sao đó, không chỉ có tên file.
- [ ] Tách backend URL, Supabase project, dictionary channel và extension ID giữa thử nghiệm với production.

**Kết quả hiện tại:** branch `codex/ai-tags-bulk-delete`, HEAD `0c0b5b0`. Lint và typecheck pass. `next build` compile pass nhưng kết thúc `spawn EPERM` tại bước kiểm tra TypeScript. Chưa xác nhận staging/database snapshot/tài khoản kiểm thử; bước S00 còn mở đến khi các đầu vào đó sẵn sàng.

**Hoàn thành khi:** baseline tái lập được và các đầu vào thử đã sẵn sàng. Đầu ra là báo cáo baseline kèm danh sách cấu hình chủ dự án cần cung cấp; không yêu cầu cung cấp secret trong tài liệu.

## S01 Kiểm chứng lớp tương tác trên CC thật

Đầu vào: S00. Dùng một extension prototype tối thiểu cài Load unpacked sau khi plan được duyệt.

**Thực hiện**

- [ ] Xác định vùng CC đang render, video element đang phát và cách theo dõi thay text/vị trí.
- [ ] Dựng lớp chữ thử đè lên CC; observer chỉ đọc vùng gốc và bỏ qua vùng của extension.
- [ ] Thử click từ để pause, giữ snapshot câu và đóng để resume theo quyền tạm dừng của extension.
- [ ] Thử chuyển trang watch trong cùng tab, fullscreen, tắt CC và tắt extension; khôi phục CC gốc khi không còn overlay.

**Kiểm tra**

- [ ] Thử video có CC thủ công, auto-caption cập nhật từng phần, không có CC và video có nhiều dòng.
- [ ] Trỏ chỉ highlight; click không truyền thành một lần toggle player thứ hai.
- [ ] Video đã pause sẵn không tự chạy sau khi đóng; chuyển video không phát nhầm video mới.
- [ ] Khi adapter không tìm thấy CC thì hiển thị giới hạn và để nguyên player, không gọi YouTube API để bù.

**Hoàn thành khi:** có kết quả thử trên YouTube thật và ghi lại giới hạn cụ thể. Nếu một flow bắt buộc không khả thi thì điều chỉnh plan với người dùng trước bước phụ thuộc, không âm thầm bỏ flow.

## S02 Chuẩn bị và đo gói từ điển

Đầu vào: S00 và các câu/từ thực tế thu được ở S01.

**Thực hiện**

- [ ] Chốt raw snapshot Wiktionary/Kaikki, nguồn giấy phép và attribution; tạo script chuyển đổi tái lập.
- [ ] Tạo schema thống nhất theo từng nghĩa; tách định nghĩa, ví dụ, từ loại, IPA, synonym và audio nếu nguồn có.
- [ ] Tạo gói Anh–Anh và dữ liệu song ngữ dùng hai chỉ mục Anh–Việt/Việt–Anh. Chỉ lấy cặp dịch rõ ràng cho hướng Việt–Anh.
- [ ] Lọc raw dump thành gói lõi; không đưa audio hàng loạt hoặc mục không cần thiết vào gói tải mặc định.
- [ ] Tạo manifest gồm package ID, phiên bản schema, phiên bản dữ liệu, checksum, dung lượng và nguồn license.

**Kiểm tra**

- [ ] Bộ mẫu có từ thường, cụm, biến thể, đa nghĩa, tên riêng, chữ viết tắt và trường thiếu ở cả ba chiều.
- [ ] Không coi `US` và `us` là một nghĩa, không mất dấu tiếng Việt hoặc gán nghĩa ngân hàng cho bờ sông khi đổi nghĩa.
- [ ] Đo trên profile mới: byte tải nén bằng Network, dung lượng đã cài gồm index bằng Application/Storage và `navigator.storage.estimate()`, thời gian tạo index/tra bằng Performance, RAM tăng khi idle/tra bằng Memory/Chrome Task Manager.
- [ ] Đo tra lặp trong nhiều tab: các tab dùng chung dictionary qua background, không mỗi tab giữ một bản toàn kho trong RAM.
- [ ] Nêu độ phủ và lỗi theo bộ mẫu; nếu chưa có ngân sách dung lượng phù hợp thì chia gói/cắt trường rồi đo lại.

**Hoàn thành khi:** có gói đầu tiên thực sự dùng được, báo cáo đo và ngân sách dung lượng đã được chốt cho thiết bị thử. Mục tiêu tra warmed local p95 dưới 100 ms là tiêu chí cần đo, không phải kết quả mặc định của IndexedDB. Không hứa mọi từ có đủ IPA/audio.

## S03 Tách build và chốt hợp đồng dữ liệu

Đầu vào: S01 và S02.

**Thực hiện**

- [ ] Tạo thư mục extension, shared lookup core và build/typecheck riêng. Giữ Next.js web hiện tại.
- [ ] Loại source/output extension khỏi phạm vi typecheck của web; cấu hình ESLint cho browser/background/shared và bỏ output sinh tự động.
- [ ] Chốt schema lookup, selected sense, capture, occurrence, missing fields, enrichment draft/item và trạng thái hàng đợi.
- [ ] Có protocol/schema version cho message và payload; chốt giới hạn kích thước, danh sách field được ghi và định dạng lỗi.
- [ ] Khóa phiên bản dependency cần thêm và tạo lệnh build tái lập cho hai phần.

**Kiểm tra**

- [ ] Web lint/typecheck/build pass khi extension chưa chạy; extension build được độc lập.
- [ ] Bundle extension/shared không chứa module cookie, OpenAI key, Supabase service-role hoặc code server của Next.
- [ ] Payload không hợp lệ, message không biết phiên bản và URL tùy ý đều bị từ chối rõ ràng.

**Hoàn thành khi:** cấu hình build và hợp đồng có thể được dùng nhất quán ở các bước sau; không cần tắt kiểm tra TypeScript để build được.

## S04 Migration bổ sung và transaction

Đầu vào: S03 và bản sao database thử.

**Thực hiện**

- [ ] Thêm migration mới cho chi tiết nghĩa, provenance, revision, identity refs, occurrences, capture operations và enrichment requests theo thiết kế.
- [ ] Backfill provenance/alias legacy, giữ nguyên item ID, ngày thêm, flashcard status và quan hệ bộ học. Chưa bỏ unique nghĩa cũ.
- [ ] Tạo RPC capture dùng `auth.uid()`; transaction bao gồm mục từ, occurrence, flashcard và kết quả operation.
- [ ] Tạo unique/FK theo user và identity đã xác nhận; bảo vệ mọi bảng/RPC bằng cùng chính sách truy cập.
- [ ] Thiết kế khóa đồng thời, fingerprint ngữ cảnh, operation payload hash và trạng thái mục đã xóa.

**Kiểm tra**

- [ ] Áp dụng migration lên snapshot cũ, so sánh số lượng/ID và tiến độ trước sau.
- [ ] Cố ý làm lỗi giữa transaction: không được còn từ hoặc thẻ dở dang từ operation đó.
- [ ] Gửi cùng operation nhiều lần, gửi hai operation cùng nghĩa đồng thời và gửi cùng ID với payload khác.
- [ ] Tài khoản B không đọc/sửa data A qua REST hoặc RPC; user không được phép không thể bỏ qua bằng gọi Supabase trực tiếp.
- [ ] Không tự gộp hai nghĩa chưa xác định, không cập nhật status của thẻ đã có khi chỉ thêm occurrence.

**Hoàn thành khi:** migration và test transaction/RLS pass trên môi trường thử, có đường quay lại bản app tương thích mà không xóa dữ liệu mới.

## S05 Chuyển các luồng ghi sang service dùng chung

Đầu vào: S04.

**Thực hiện**

- [ ] Chuyển POST/PATCH kho từ, lưu gợi ý, adapter import cũ và capture mới sang cơ chế identity thống nhất.
- [ ] Giữ hình dạng response cần cho client hiện tại như `already_existed`; bổ sung alias để tìm lại mục sau khi sửa/bổ sung nghĩa.
- [ ] Dừng dùng nội dung định nghĩa như danh tính duy nhất, vẫn hỗ trợ đối chiếu legacy có kiểm tra mơ hồ.
- [ ] Cập nhật revision/provenance khi sửa tay; bảo vệ hoàn tác lưu gợi ý khỏi xóa mục đã được extension dùng thêm.
- [ ] Thêm saved-status theo tập tham chiếu nghĩa nhỏ và occurrences có phân trang.

**Kiểm tra**

- [ ] Cùng nghĩa qua hai chế độ trả về cùng item khi đã đối chiếu; khác nghĩa vẫn lưu riêng.
- [ ] Bổ sung nghĩa Anh vào mục trước chỉ có Việt không đổi item ID hoặc làm mất liên kết.
- [ ] Tab web cũ vẫn gửi request hợp lệ; retry sau user xóa từ không làm sống lại từ.
- [ ] Import v1–3, sửa tay và hoàn tác hoạt động qua adapter; không có writer bị bỏ sót còn tự tính identity mới theo khóa cũ.

**Hoàn thành khi:** có một nơi quyết định identity/capture và danh sách writer đã được chuyển; unique cũ vẫn chưa bỏ trước lần cutover S13.

## S06 Đăng nhập extension và quyền tài khoản

Đầu vào: S03 và S05.

**Thực hiện**

- [ ] Cố định extension ID cho môi trường thử; chốt callback Chrome Identity, Supabase OAuth/PKCE và allowlist redirect.
- [ ] Background quản lý session/refresh; API extension xác minh Supabase bearer và cùng whitelist/RLS với web.
- [ ] Giữ cookie auth web, xử lý bearer lỗi mà không fallback sang user cookie khác.
- [ ] Giới hạn quyền host; dùng quyền website tùy chọn. Thêm nút đăng nhập/đăng xuất rõ ràng và khóa hàng đợi theo user.
- [ ] Chuẩn bị adapter chính sách truy cập dùng chung cho giai đoạn nhiều người; chưa bật public enrollment.

**Kiểm tra**

- [ ] Đăng nhập đúng user, hủy đăng nhập, callback lỗi, refresh sau hết hạn và logout.
- [ ] Không có token trong DOM, page message, log hay bundle public; trang không thể yêu cầu worker fetch URL bất kỳ.
- [ ] Hai tài khoản dùng cùng profile lần lượt không đọc cache cá nhân hoặc gửi hàng đợi của nhau.
- [ ] User ngoài whitelist bị từ chối ở backend và RLS, kể cả khi cài được extension.

**Hoàn thành khi:** web và extension có thể dùng cùng tài khoản dữ liệu nhưng cách truyền phiên độc lập; quyền và callback đều được thử bằng Chrome thật.

## S07 R2 và bộ cài dictionary trên máy

Đầu vào: S02, S03 và cấu hình domain/bucket do chủ dự án quản lý.

**Thực hiện**

- [ ] Tạo cấu hình upload dữ liệu theo kênh beta/stable, custom domain, cache và CORS cho web cần tải gói. Credential upload chỉ ở môi trường build/quản trị.
- [ ] Upload gói theo URL bất biến; kiểm tra đủ gói trước khi publish manifest. Dùng TTL ngắn/ETag cho manifest, cache dài cho gói có version.
- [ ] Cài dictionary theo batch vào IndexedDB trong background; có tiến độ, retry và checkpoint, không parse toàn raw dump trên main thread.
- [ ] Chỉ chuyển active version sau khi schema/checksum/count hợp lệ; cài lỗi giữ bản cũ. Kiểm tra dung lượng trước khi cần giữ hai phiên bản tạm thời.
- [ ] Tải gói cho chế độ đang chọn; không tải lại theo từng tab, từng phiên tra hoặc từng ngày nếu version không đổi.
- [ ] Có màn hình dung lượng và xóa riêng dữ liệu dictionary; tuyệt đối không xóa hàng đợi cá nhân khi dọn cache từ điển.
- [ ] Đánh giá persistence/quota của extension storage bằng dữ liệu đo; chỉ thêm quyền lưu trữ rộng hơn khi có nhu cầu thực và ghi lý do quyền đó. Xử lý lỗi hết dung lượng thay vì coi IndexedDB là vô hạn.

**Kiểm tra**

- [ ] Profile mới tải đúng gói; sau khi tắt mạng vẫn tra được. Gói chưa tải thì báo cần tải, không báo Không có từ.
- [ ] Mất mạng giữa tải/cài, file sai checksum, hết dung lượng, schema không hỗ trợ và browser tắt giữa cài.
- [ ] Update từ version cũ, rollback manifest và hai tab cùng yêu cầu cài; không kích hoạt database nửa cũ nửa mới.
- [ ] Quan sát network/CDN: một lần tra không tải gói hoặc gọi database; R2 chỉ phục vụ dữ liệu, không có JS/WASM thực thi tải từ xa.
- [ ] Đo lại disk/RAM và tốc độ với gói production như S02; kiểm tra license được xem từ extension.

**Hoàn thành khi:** có chu trình tải, cài, tra offline, update và phục hồi thật; không dùng `r2.dev` làm endpoint production mặc định.

## S08 Popup và tra từ trên website

Đầu vào: S06 và S07.

**Thực hiện**

- [ ] Bôi đen hiện nút Tra; bấm mới mở popup nhỏ. Giữ ngữ cảnh ngắn quanh vùng chọn, không gửi toàn trang.
- [ ] Hiện nghĩa đúng chế độ, trạng thái đang tra/không có gói/không có từ và danh sách nghĩa có thể chọn.
- [ ] Mở rộng popup tại chỗ để xem các trường sẵn có; chỉ hiện phát âm/IPA theo nguồn có thật.
- [ ] Xử lý hover vùng từ và popup, timer khoảng 300 ms, vùng expanded giữ mở, X/Esc/bấm ngoài và bàn phím.
- [ ] Cô lập CSS và giới hạn vị trí trong viewport; vô hiệu hóa trong password/editor và chính Phrasebook.

**Kiểm tra**

- [ ] Thử trang có CSS mạnh, trang dài phải scroll, sát bốn mép cửa sổ, zoom và nhiều tab.
- [ ] Chuột đi từ vùng chọn sang popup không làm popup biến mất; Mở rộng không đóng khi rời chuột.
- [ ] Đổi từ hoặc chiều tra khi request cũ chưa xong không hiển thị kết quả sai từ.
- [ ] Network chứng minh chưa bấm AI thì có 0 request AI, kể cả khi mở rộng hoặc phát âm bằng giọng thiết bị.

**Hoàn thành khi:** luồng website có thể dùng độc lập với YouTube, popup truy cập được bằng bàn phím và dữ liệu thiếu hiển thị rõ.

## S09 Hoàn thiện luồng YouTube

Đầu vào: S01, S07 và S08.

**Thực hiện**

- [ ] Gắn popup dùng chung vào overlay CC; chỉ ẩn CC gốc sau khi lớp thay thế sẵn sàng.
- [ ] Click từ hoặc chọn cụm mới giữ quyền pause; lưu snapshot câu và thời điểm đang xem.
- [ ] Theo dõi CC rolling, vị trí, kích thước, tốc độ, fullscreen và thay player/video trong SPA.
- [ ] Khi đóng toàn bộ popup, resume đúng video nếu extension đã pause và user không đổi trạng thái. Nếu `play()` lỗi thì hiện nút phát tiếp.
- [ ] Dọn listener/observer/timer và khôi phục CC gốc khi tắt extension, adapter lỗi hoặc rời video.

**Kiểm tra**

- [ ] Tất cả tình huống S01, thêm trường hợp đang mở expanded rồi tua/chuyển video/thoát fullscreen.
- [ ] Click không double-toggle, caption cập nhật không làm mất từ đang chọn; thông tin popup không nhảy sang câu mới.
- [ ] Video đã pause sẵn hoặc user tự pause/play không bị auto-resume ngoài ý muốn.
- [ ] Thử một phiên xem dài, đổi nhiều video; không nhân listener, tăng RAM liên tục hoặc tăng request AI.

**Hoàn thành khi:** hoàn tất trải nghiệm theo ảnh tham chiếu và flow đã chốt trên Chrome thật. Ghi rõ chưa hỗ trợ Shorts/PiP/video nhúng nếu chưa kiểm chứng, không ghi Supported cho các dạng chưa thử.

## S10 Capture và đồng bộ offline

Đầu vào: S05, S06 và popup S08/S09.

**Thực hiện**

- [ ] Ghi operation và snapshot vào IndexedDB trước khi hiển thị Đã lưu trên máy; sau đó mới gửi backend.
- [ ] Hiện Lưu, Đã lưu, Thêm ngữ cảnh và Thêm flashcard theo nghĩa được chọn và trạng thái server/cache đã biết.
- [ ] Thực hiện các trạng thái queue, lease, retry có khoảng nghỉ và thông báo failed/needs_auth/needs_resolution.
- [ ] Sau xác nhận transaction, cập nhật item ID/card ID và saved-status. Không báo đã đồng bộ trước khi server xác nhận.
- [ ] Chốt cửa sổ retry tối đa phù hợp thời gian giữ operation/tombstone trên server. Mục quá cũ giữ để giải quyết, không âm thầm gửi lại sau khi server đã hết dữ liệu chống trùng.
- [ ] Có nút mở kho và flashcard web. Làm mới dữ liệu khi web quay lại focus để thấy từ extension vừa đồng bộ, không bắt user tải lại toàn trang.

**Kiểm tra**

- [ ] Bấm lặp, hai tab cùng lưu, hai thiết bị cùng nghĩa, cùng từ khác nghĩa và cùng đoạn được lưu lại.
- [ ] Tắt mạng trước gửi, giữa gửi và sau server commit nhưng trước nhận phản hồi; tắt worker/browser lúc syncing rồi mở lại.
- [ ] Token hết hạn, user bị thu hồi quyền, Supabase lỗi tạm thời, item đã xóa và operation cũ hết thời gian retry tự động.
- [ ] Thẻ đã học giữ nguyên status; không thêm thẻ bị nửa chừng; gỡ cache dictionary không mất queue.
- [ ] Thông báo rõ gỡ extension/profile làm mất phần chỉ còn trên máy, còn update cùng extension ID phải giữ được queue.

**Hoàn thành khi:** dữ liệu đã bấm Lưu tồn tại sau restart và chỉ chuyển sang Đã đồng bộ khi có xác nhận, không trùng và không gửi nhầm tài khoản.

## S11 Bổ sung dữ liệu và quota AI

Đầu vào: S04, S05, S07 và S10.

**Thực hiện**

- [ ] Hỗ trợ target là mục kho hoặc draft đang tra; draft được bổ sung không tự tạo từ/thẻ.
- [ ] Cho chọn trường thiếu và nguồn dictionary/AI; dictionary thiếu không tự fallback AI.
- [ ] Có request ID, cache riêng theo nghĩa/chiều/ngữ cảnh/trường, kết quả có thể đọc lại và trạng thái chưa xác định nếu mất khả năng biết kết quả gọi AI.
- [ ] Backend kiểm tra owner, schema, phiên bản và field còn trống tại lúc ghi. Sửa tay cập nhật provenance và được ưu tiên.
- [ ] Quota suggestion dùng chung web/extension bằng đặt chỗ nguyên tử; giới hạn đồng thời, token đầu vào/đầu ra và ngân sách tổng. Phân biệt chưa gọi, gọi thất bại, kết quả cache và đã gọi nhưng chưa rõ kết quả.
- [ ] Chạy nhóm nhỏ có tiến độ và Dừng sau lô; không cần tab/worker giữ sống một job rất dài.

**Kiểm tra**

- [ ] Một field đã sửa trong lúc chạy không bị ghi đè; đề xuất cho nghĩa khác bị bỏ qua hoặc yêu cầu chọn lại.
- [ ] Request AI nhấn lặp không tự tạo cuộc gọi thứ hai khi request đầu đang chạy hoặc đã có kết quả.
- [ ] Cache hit vẫn đọc được khi đã hết lượt AI; chỉ reserve quota cho yêu cầu thật sự cần gửi ra ngoài.
- [ ] Hai nguồn web/extension dùng cùng user vượt hạn mức thì server từ chối đúng; user khác không dùng được reservation/cache đó.
- [ ] Kiểm tra AI rỗng/sai schema/timeout, hết hạn mức, đóng tab, Dừng và lỗi một lô sau khi các lô trước đã lưu.
- [ ] Quan sát payload thực chỉ có từ, nghĩa đã biết và ngữ cảnh cần thiết; không có toàn video/trang hoặc secret trong logs.

**Hoàn thành khi:** chỉ bổ sung ô trống sau thao tác rõ ràng, tính quota cho request thật và không âm thầm retry cuộc gọi ngoài có thể đã tốn phí.

## S12 Kho từ và flashcard dùng dữ liệu mới

Đầu vào: S10 và S11.

**Thực hiện**

- [ ] Thêm vùng Nội dung còn thiếu, lọc theo field và thao tác bổ sung từng từ/nhóm trong UI kho hiện tại.
- [ ] Hiện nguồn/provenance cho mọi trường dữ liệu.
- [x] Danh sách ngữ cảnh có phân trang 10 mục và link quay lại nguồn/video tại thời điểm lưu. (Code; cần kiểm tra trên dữ liệu staging.)
- [ ] Mặt thẻ hiển thị đúng chế độ; thiếu nghĩa thì báo và mở bổ sung, không fallback sang ngôn ngữ khác hoặc chấm nhớ khi thiếu mặt thẻ.
- [ ] Với lookup Việt–Anh mới, chọn ứng viên Anh làm `term`; câu Việt gốc ở source_text/occurrence. Chỉ dùng câu tiếng Anh phù hợp làm ví dụ Anh, không gắn nhãn câu Việt là English example.
- [ ] Giữ mục Việt legacy, ngày thêm, tag/CEFR/IELTS và liên kết bộ học; hiển thị nhãn ngôn ngữ chính xác khi chưa đủ dữ liệu để luyện thẻ Anh.
- [ ] Giữ chế độ tự lưu gợi ý web hiện tại tách khỏi việc AI của extension chỉ chạy khi bấm.

**Kiểm tra**

- [ ] EN–EN chỉ có nghĩa Anh, EN–VI chỉ có nghĩa Việt, VI–EN có nhiều ứng viên; đổi mode không tự gọi AI.
- [ ] Từ có nhiều nghĩa, nhiều nguồn, thiếu IPA/audio hoặc tất cả field phụ vẫn xem/sửa được.
- [ ] Flashcard có sẵn giữ progress sau enrichment và capture; bộ học ngày vẫn lấy đúng mục nguồn Anh và giữ filter.
- [ ] Chọn nhiều, dừng, sửa tay và xóa trong lúc enrichment trả về đều không làm UI ghi đè dữ liệu mới hơn.

**Hoàn thành khi:** dùng được cả dữ liệu cũ và mới, học đúng chế độ và xem lại nguồn mà không tạo lại thẻ.

## S13 Backup version 4 và cutover identity

Đầu vào: S05 đến S12 đã ổn định trên staging; mọi writer đã được kiểm kê.

**Thực hiện**

- [x] Thêm JSON version 4, đầy đủ metadata/refs/occurrences và mapping ID cho flashcard/bộ học; giữ adapter v1–3 và CSV mẫu cũ. (Code; cần kiểm thử round-trip trên DB.)
- [ ] Tạo ZIP manifest và phần JSON có giới hạn cho backup lớn; import có checkpoint, giới hạn giải nén và ghi kết quả từng phần.
- [ ] Diễn tập restore trên database trống và database đã có dữ liệu; định nghĩa rõ restore tiến độ từ file so với nhập bỏ qua mục đã có.
- [ ] Quét lại mọi `onConflict` và writer dùng normalized meaning. Chỉ bỏ unique cũ khi không còn đường ghi phụ thuộc vào nó.
- [ ] Chụp snapshot trước cutover, áp dụng migration cutover và kiểm tra alias/constraint/FK; giữ bản app rollback tương thích schema mới.

**Kiểm tra**

- [ ] Export rồi import hai lần; so sánh item ID đã remap, số từ/nghĩa/occurrence, thẻ, tiến độ và ngày thêm.
- [ ] Thử hơn 2.000 mục và dữ liệu vượt 2 MB; không sinh backup xuất được nhưng không nhập được.
- [ ] Backup từ tài khoản khác không ghi xuyên user; refs mơ hồ hoặc thiếu item báo lỗi, không gộp/xóa tự động.
- [ ] Restore lỗi giữa các phần có báo phần hoàn tất và tiếp tục không nhân bản. ZIP bất thường vượt giới hạn bị từ chối.
- [ ] Tab web bản cũ còn mở, retry queue trước cutover và legacy item sau bổ sung nghĩa đều không lỗi identity.

**Hoàn thành khi:** round-trip và cutover được diễn tập thành công; có quy trình rollback bằng bản app tương thích, không khôi phục mù unique cũ đã không còn phù hợp.

## S14 Kiểm thử hồi quy và khả năng phục vụ nhiều người

Đầu vào: S01 đến S13.

**Thực hiện**

- [ ] Chạy lint/typecheck/build cho web và extension; ghi tên các script được thêm ở S03 và dùng chúng trong CI.
- [ ] Chạy test tự động cho identity/transaction, queue retry, pause ownership, bảo vệ ô đã sửa, quota và backup round-trip.
- [ ] Thử thủ công toàn bộ flow trên Chrome: YouTube, website, ba mode, mở rộng, lưu, offline, đồng bộ và học trên web.
- [ ] Thử lại OCR, dịch, lịch sử, gợi ý, duyệt/tự lưu/hoàn tác, CRUD kho, tag AI, phân loại, daily words, settings VI/EN và mobile web hiện tại.
- [ ] Load test trên staging với dataset đại diện và AI được mock/tắt để không phát sinh chi phí. Ghi số user đồng thời, RPS, độ trễ, lỗi, connection và tác động quota; chốt kịch bản tải mục tiêu trước chạy.
- [ ] Đo dung lượng/RAM/cold start, độ trễ tra local và số request dictionary thực; kiểm tra những trang không bật extension không bị quét.

**Kiểm tra**

- [ ] Cùng user nhiều tab và khác user nhiều phiên không làm tràn hạn mức hoặc trộn dữ liệu.
- [ ] Tài khoản bị đình chỉ không gọi AI/capture hoặc truy cập RPC trực tiếp được; thao tác thất bại không mất queue.
- [ ] Dữ liệu thử cũ trước migration so với sau có số lượng, ID và tiến độ khớp mong đợi.
- [ ] Không có lỗi nghiêm trọng chưa giải quyết; các giới hạn còn lại được ghi trong hướng dẫn, không tuyên bố hỗ trợ tải vượt mức đã đo.

**Hoàn thành khi:** có bảng kết quả Pass/Fail theo môi trường và build; mọi lỗi chặn mất dữ liệu, sai quyền, sai nghĩa hoặc phát video sai đã được xử lý.

## S15 Rollout staging và beta có kiểm soát

Đầu vào: S14 pass và bản release cụ thể được cho phép đưa lên môi trường tương ứng.

**Thực hiện**

- [ ] Chuẩn bị cấu hình Vercel/Supabase/R2 production, domain HTTPS, OAuth redirect và callback đúng extension ID.
- [ ] Đưa schema bổ sung, backend tương thích và dictionary version đã kiểm tra lên theo thứ tự; chưa bật capture trước khi đủ dependency.
- [ ] Mở beta cho các tài khoản trong allowlist. Có feature flag tắt AI/capture/overlay riêng khi cần, không chặn đọc kho cũ.
- [ ] Hướng dẫn cài, tải gói, xem quota/dung lượng/queue, mở flashcard và cách báo lỗi không lộ nội dung cá nhân.
- [ ] Tạo báo cáo beta và runbook rollback: lùi manifest dữ liệu, tắt feature mới, rollback app tương thích, giữ ledger và queue.

**Kiểm tra**

- [ ] Profile sạch đi hết onboarding đến học thẻ thật; không phụ thuộc session DevTools hoặc dictionary đã cài từ máy phát triển.
- [ ] Thử mất mạng rồi phục hồi trong beta; web sau deploy vẫn đọc được dữ liệu cũ.
- [ ] Tắt cờ tính năng trong diễn tập không xóa queue hay dữ liệu; phiên bản cũ vẫn dùng đường API được hỗ trợ.
- [ ] Có thông báo/cảnh báo vận hành cho lỗi và ngân sách theo cấu hình, không tạo automation hay gửi thông báo ngoài khi chưa được yêu cầu.

**Hoàn thành khi:** beta dùng trọn luồng ổn định, ghi nhận lỗi thực tế và đã xác minh phương án quay lui.

## S16 Chuẩn bị và phát hành Chrome Web Store

Đầu vào: S15; tài khoản developer và quyền phát hành do chủ dự án quản lý. Có thể chuẩn bị gói/listing trước, chỉ submit/publish bản cụ thể khi đã được cho phép.

**Thực hiện**

- [ ] Build ZIP reproducible, manifest version đúng, icon/screenshot thật, mô tả mục đích và hướng dẫn test.
- [ ] Chuẩn bị privacy policy, khai báo dữ liệu và lý do từng quyền: chỉ gửi text chọn/ngữ cảnh cần thiết khi lưu hoặc bấm AI, không thu toàn bộ lịch sử duyệt web.
- [ ] Rà bundle không có remote executable code; R2 chỉ phát dữ liệu. Gói đầy đủ mã chạy, không phụ thuộc CDN JS bị chặn bởi CSP.
- [ ] Chọn private/trusted testers hoặc unlisted cho beta Store; hiểu unlisted không khóa backend. Giữ chính sách truy cập server đã thử.
- [ ] Có Store extension ID cố định; cập nhật host/OAuth callback trước lần test Store và giữ ID đó cho các bản cập nhật.
- [ ] Chuẩn bị submission để review và phát hành theo thời điểm đã duyệt; ghi rõ review phụ thuộc Google, không hứa thời gian duyệt.

**Kiểm tra**

- [ ] Cài từ Store bằng profile sạch: đăng nhập, tải dictionary, YouTube, lưu và học đều hoạt động, không cần Developer mode.
- [ ] Nâng cấp từ bản Store trước lên bản mới: giữ queue, settings, dictionary và session theo cơ chế thiết kế; migration IndexedDB xử lý tab cũ đang mở.
- [ ] Content script cũ còn trong tab sau auto-update nhận lỗi phiên bản có hướng dẫn reload, không gửi payload không hiểu rồi làm mất thao tác.
- [ ] Listing, quyền và privacy khớp request thực tế; không có secret hoặc account thật trong screenshot/gói.

**Hoàn thành khi:** gói/listing sẵn sàng và được duyệt phát hành; nếu bước publish được cho phép thì có bản Store cài được cùng kết quả test. Nếu đang chờ review thì báo đúng trạng thái, không gọi đó là đã public.

## S17 Vận hành và mở rộng người dùng

Đầu vào: S15/S16, kết quả tải ở S14 và quyết định mở rộng phạm vi tài khoản.

**Thực hiện**

- [ ] Theo dõi lỗi lookup/install dictionary, tuổi queue, tỷ lệ sync lỗi, p95 API, RAM/CPU mẫu thử, dung lượng R2 và số request tải gói.
- [ ] Theo dõi AI per-user và toàn hệ thống: request thật, token, quota/reservation và ngân sách; có cách tắt AI khi vượt giới hạn mà tra local vẫn hoạt động.
- [ ] Chỉ bật nhận user mới sau khi auth/RLS/RPC/callback cùng dùng một access policy, kiểm tra email/provider và active/suspended; public enrollment mặc định tắt.
- [ ] Mở theo nhóm được chốt, kiểm tra tải và chi phí sau mỗi nhóm; không suy ra khả năng phục vụ hàng nghìn user từ thử nghiệm vài tài khoản.
- [ ] Dictionary update độc lập với extension: staging gói mới, kiểm tra dữ liệu/độ lớn, publish manifest sau cùng, giữ phiên bản cũ để phục hồi.
- [ ] Code update qua Store: tăng version, test storage/message compatibility và giữ backend hỗ trợ phiên bản client trong khoảng chuyển tiếp đã công bố.
- [ ] Có backup định kỳ, diễn tập restore, thời gian lưu ledger/cache và cách xóa dữ liệu tài khoản. Việc lên lịch tự động chỉ thiết lập khi chủ dự án yêu cầu.

**Kiểm tra**

- [ ] Cài mới, update dictionary và code không làm reset tiến độ hoặc ghi đè nghĩa sửa tay.
- [ ] Domain/CDN gói lỗi, Supabase tạm ngắt hoặc AI bị tắt vẫn cho tra local; queue giữ và báo đúng trạng thái.
- [ ] Khóa một user không ảnh hưởng dữ liệu user khác. Xóa tài khoản xử lý các bảng riêng và lần đăng nhập tiếp theo theo chính sách đã chốt.
- [ ] Có ngưỡng tải/ngân sách đo được để dừng nhận thêm user và có người phụ trách xử lý lỗi.

**Hoàn thành khi:** có runbook phát hành/vận hành và phạm vi số người dùng đã được kiểm chứng. Đây là việc tiếp tục sau release; không tự tạo monitor hoặc cam kết theo dõi nền từ cuộc chat lập plan.

## Những việc chủ dự án cần chuẩn bị

| Thời điểm | Cần chuẩn bị | Không cần đưa vào chat |
| --- | --- | --- |
| Trước S00/S04 | Supabase staging hoặc môi trường Postgres/Auth thử tương đương, snapshot và tài khoản test | Mật khẩu database, service-role key |
| Trước S06 | Quyền cấu hình Google OAuth/Supabase redirect và extension ID | OAuth secret, refresh token |
| Trước S07 | Tài khoản Cloudflare, R2, domain cho dữ liệu và quyền upload phù hợp | R2 secret/API token |
| Trước S15 | Vercel/Supabase production, domain app, cấu hình quota và ngân sách | Biến môi trường server và key AI |
| Trước S16 | Chrome Web Store developer account, thông tin publisher/privacy/support và tài khoản reviewer nếu cần | Mật khẩu tài khoản thật của người dùng |
| Trước S17 | Chính sách nhận user, mức tải mục tiêu, ngân sách tối đa và đầu mối vận hành | Không cần mở đăng ký công khai chỉ để thử extension |

## Mẫu ghi kết quả mỗi bước

| Trường | Nội dung cần ghi |
| --- | --- |
| Bước và trạng thái | Ví dụ S10, đang làm hoặc hoàn thành |
| Bản thử | Commit/build, extension ID/version, dictionary version và schema database |
| Môi trường | Local/staging/beta/production, Chrome version và profile thử |
| Kiểm tra thực tế | Tên test/lệnh hoặc các thao tác đã chạy |
| Kết quả | Pass/Fail, số liệu đo, log đã bỏ dữ liệu nhạy cảm hoặc ảnh cần thiết |
| Lỗi còn lại | Mức ảnh hưởng, cách tái hiện, có chặn bước sau không |
| Quyết định | Chuyển bước hoặc sửa và chạy lại; lý do cụ thể |

## Điều kiện hoàn thành toàn bộ

- [ ] Người mới cài được extension theo kênh đã phát hành, đăng nhập và tải gói đúng chế độ.
- [ ] Nhấn từ trên CC gốc mở nghĩa nhanh; mở rộng/đóng đúng flow và video tiếp tục đúng trạng thái.
- [ ] Tra/lưu/mở rộng không gọi AI ngầm; AI chỉ chạy khi bấm và hạn mức hoạt động từ server.
- [ ] Lưu tạo từ/ngữ cảnh/thẻ đúng nghĩa; trùng được dùng lại, tiến độ cũ không đổi.
- [ ] Mất mạng rồi đóng/mở trình duyệt vẫn giữ queue, phục hồi không tạo trùng và không gửi nhầm user.
- [ ] Bổ sung từng mục/theo nhóm chỉ điền trường trống, dừng/tiếp tục và xung đột chỉnh tay được xử lý.
- [ ] Backup cũ và mới đọc được; dữ liệu/ngữ cảnh/tiến độ round-trip trên database thử không bị mất.
- [ ] Có package, migration, nguồn/license dictionary, báo cáo kiểm thử và hướng dẫn vận hành; trạng thái Store và quyền production được báo đúng thực tế.
