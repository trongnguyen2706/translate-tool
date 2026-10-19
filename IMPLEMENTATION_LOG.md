# Nhật ký triển khai extension

Cập nhật: 2026-10-19. Đối chiếu theo [checklist](PLAN_EXTENSION_STEPS.md); chưa đánh dấu hoàn tất bước nào nếu thiếu phép thử ngoài môi trường local.

Mốc code local: commit `e4cb3f0` (`feat: add Chrome dictionary extension foundation`) đã push lên `origin/codex/ai-tags-bulk-delete`. Kiểm thử Chrome được người dùng cho phép nhưng công cụ trình duyệt chặn `chrome://extensions` theo URL policy; không thử đường vòng.

| Bước | Trạng thái | Bằng chứng / việc còn thiếu |
| --- | --- | --- |
| S00 | Đang làm | Branch `codex/ai-tags-bulk-delete`. Baseline trước code: `0c0b5b0`; lint/typecheck pass. Hiện lint, typecheck, production build pass. Chưa có staging DB snapshot hoặc hai tài khoản thử. |
| S01 | Code có, chưa xác minh | Overlay CC, click pause, chọn cụm và resume đã viết. Chrome URL policy từ chối mở `chrome://extensions`; cần nạp Load unpacked thủ công để thử YouTube thật. |
| S02 | Pipeline có, dữ liệu chưa có | Builder Kaikki và fixture tests pass (4/4). Chưa tải raw dataset, tạo gói thật, kiểm tra giấy phép/attribution cuối, đo dung lượng/tốc độ/RAM trên Chrome. |
| S03 | Local pass | MV3 bundle riêng, protocol, IndexedDB và lệnh `check:extension` pass; 4/4 core tests. Chưa có kiểm tra tích hợp trên Chrome. |
| S04 | Migration viết, chưa áp dụng | Migration 004 có tables, RLS và transactional capture/upsert chỉ điền ô trống; migration 005 thêm quota reservations. Chưa chạy trên snapshot hoặc kiểm thử rollback/concurrency/RLS vì chưa có staging DB/Docker. |
| S05 | Một phần | Capture extension dùng RPC; các writer web cũ chưa chuyển sang identity service chung. |
| S06 | Code có, chưa xác minh | Google ID token → Supabase session, bearer API và allowlist có trong source. Cần extension ID/OAuth client cấu hình và thử login/refresh/logout bằng Chrome thật. |
| S07 | Một phần | Chunked download, checksum, gzip bounds và IndexedDB install đã viết. Chưa có data pack, R2 domain, progress/resume, cập nhật profile mới và đo dung lượng. |
| S08 | Code có, chưa xác minh | Website selection → nút Tra → popup/expand/save/AI có trong source. Chưa thử trên trang thực, accessibility/zoom/CSS và network. |
| S09 | Code có, chưa xác minh | YouTube overlay/pause/resume có trong source. Chưa kiểm tra CC rolling, SPA, fullscreen, user pause/play, Shorts/PiP. |
| S10 | Một phần | IndexedDB queue, lease/retry, auth scoping và RPC idempotency đã viết; `queryTerm` trong payload đã được sửa. Chưa thử offline/restart/two-account hoặc cập nhật UI web sau sync. |
| S11 | Một phần | AI chỉ gọi khi bấm; route trả trường thiếu và provenance được gửi lúc capture. Migration 005 cùng API dùng RPC đặt chỗ/ghi usage nguyên tử cho dịch, gợi ý, phân loại, tag và extension; API usage tính cả reservation đang chạy. Vẫn thiếu cache/request ledger cho enrichment và UI bổ sung nhóm trong Kho từ. RPC chưa chạy trên database thật. |
| S12 | Một phần | Flashcard API/UI không fallback nghĩa giữa ngôn ngữ; extension tạo flashcard trong capture. Chưa có UI Kho từ cho provenance/occurrences/enrichment hàng loạt, chưa kiểm thử hồi quy dữ liệu cũ. |
| S13 | Chưa bắt đầu | Chưa có backup JSON v4/cutover/restore diễn tập. |
| S14 | Chưa bắt đầu | Chưa chạy kiểm thử multi-user, concurrent, load hoặc offline dài hạn. |
| S15 | Chưa bắt đầu | Chưa có staging cloud/beta. |
| S16 | Chưa bắt đầu | Chưa chuẩn bị icon/listing hoặc gửi Chrome Web Store. |
| S17 | Chưa bắt đầu | Chưa public enrollment, billing hay vận hành nhiều người dùng. |

## Kiểm tra local đã chạy

- `npm.cmd run lint` — pass.
- `node_modules/.bin/next typegen` rồi `node_modules/.bin/tsc.cmd --noEmit --incremental false` — pass.
- `npm.cmd run check:extension` — pass; 4 core tests và build `artifacts/extension/`.
- `npm.cmd run test:dictionaries` — pass; 4 fixture tests.
- `npm.cmd run build` — pass trên Next.js 16.3.6 sau khi cho phép worker chạy ngoài sandbox.
- Sau mốc `e4cb3f0`, lint, typecheck và production build đã chạy lại sau thay đổi quota; extension tests và dictionary fixture tests vẫn pass. Migration 005 cần được kiểm thử trên Supabase staging trước khi deploy. Máy hiện không có `psql`/Supabase CLI; Docker CLI có nhưng chưa có engine.
- `git diff --check` — pass; chỉ có cảnh báo đổi LF/CRLF của Git trên Windows.

## Cần cấu hình trước beta

- Supabase staging có thể reset, snapshot database, hai tài khoản thử và một tài khoản bị từ chối.
- Google OAuth extension client và ID ổn định; thiết lập provider theo hướng dẫn trong `extension/README.md`.
- Kaikki raw JSONL và xác nhận giấy phép/attribution; sau đó đo gói thật.
- Cloudflare R2 custom HTTPS domain, staging web/API và `CHROME_EXTENSION_IDS`.
- Chrome thật để thử Load unpacked, YouTube CC, website, offline queue và OAuth. Migration 004 chưa được áp dụng ở bất kỳ database nào.
