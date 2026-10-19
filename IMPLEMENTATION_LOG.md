# Nhật ký triển khai extension

Cập nhật: 2026-10-19. Đối chiếu theo [checklist](PLAN_EXTENSION_STEPS.md); chưa đánh dấu hoàn tất bước nào nếu thiếu phép thử ngoài môi trường local.

Mốc code local: commit `e4cb3f0` (`feat: add Chrome dictionary extension foundation`) đã push lên `origin/codex/ai-tags-bulk-delete`. Kiểm thử Chrome được người dùng cho phép nhưng công cụ trình duyệt chặn `chrome://extensions` theo URL policy; không thử đường vòng.

| Bước | Trạng thái | Bằng chứng / việc còn thiếu |
| --- | --- | --- |
| S00 | Đang làm | Branch `codex/ai-tags-bulk-delete`. Baseline trước code: `0c0b5b0`; lint/typecheck pass. Hiện lint, typecheck, production build pass. Staging đã đăng nhập được; chưa có DB snapshot hoặc hai tài khoản thử. |
| S01 | Code có, chưa xác minh | Overlay CC, click pause, chọn cụm và resume đã viết. Chrome URL policy từ chối mở `chrome://extensions`; cần nạp Load unpacked thủ công để thử YouTube thật. |
| S02 | Pipeline có, dữ liệu chưa có | Builder Kaikki và fixture tests pass (4/4). Chưa tải raw dataset, tạo gói thật, kiểm tra giấy phép/attribution cuối, đo dung lượng/tốc độ/RAM trên Chrome. |
| S03 | Local pass | MV3 bundle riêng, protocol, IndexedDB và lệnh `check:extension` pass; 4/4 core tests. Chưa có kiểm tra tích hợp trên Chrome. |
| S04 | Một phần, staging smoke test pass | Migration 004 có tables, RLS và transactional capture/upsert chỉ điền ô trống; migration 005 thêm quota reservations. Qua phiên đăng nhập staging, API Kho từ đọc được danh sách/ngữ cảnh rỗng và API quota đọc được hạn mức, xác nhận các schema/API này hoạt động. Chưa kiểm thử rollback, concurrency, RLS giữa hai tài khoản hoặc restore trên snapshot. |
| S05 | Một phần | Capture extension dùng RPC; các writer web cũ chưa chuyển sang identity service chung. |
| S06 | Code có, chưa xác minh | Google ID token → Supabase session, bearer API và allowlist có trong source. Cần extension ID/OAuth client cấu hình và thử login/refresh/logout bằng Chrome thật. |
| S07 | Một phần | Chunked download, checksum, gzip bounds và IndexedDB install đã viết. Chưa có data pack, R2 domain, progress/resume, cập nhật profile mới và đo dung lượng. |
| S08 | Code có, chưa xác minh | Website selection → nút Tra → popup/expand/save/AI có trong source. Chưa thử trên trang thực, accessibility/zoom/CSS và network. |
| S09 | Code có, chưa xác minh | YouTube overlay/pause/resume có trong source. Chưa kiểm tra CC rolling, SPA, fullscreen, user pause/play, Shorts/PiP. |
| S10 | Một phần | IndexedDB queue, lease/retry, auth scoping và RPC idempotency đã viết; `queryTerm` trong payload đã được sửa. Chưa thử offline/restart/two-account hoặc cập nhật UI web sau sync. |
| S11 | Một phần | AI chỉ gọi khi bấm; extension draft và Kho từ bổ sung ô trống theo mode, từng từ hoặc nhóm tối đa 100 mục/lượt, có tiến độ/dừng và optimistic revision check. Migration 005/API đặt chỗ quota nguyên tử cho dịch, gợi ý, phân loại, tag và enrichment; provenance AI được lưu. Chưa có nguồn Dictionary trong web app, cache/request ledger, hoặc kiểm thử DB thật. |
| S12 | Một phần | Flashcard API/UI không fallback nghĩa giữa ngôn ngữ; extension tạo flashcard trong capture. Kho từ hiển thị IPA/synonyms/antonyms và provenance; mỗi thẻ tải ngữ cảnh theo trang 10 mục và mở lại nguồn/video đúng timestamp. Kho từ staging tải được nhưng hiện chưa có từ/capture để kiểm thử link nguồn thật. |
| S13 | Đang làm | Export/import JSON v4 có details/provenance/revision, dictionary refs, occurrences và remap từ ID cũ sang ID hiện có; vẫn nhận v1–v3. CSV không phụ thuộc cột migration mới. JSON giới hạn 20 MB, CSV 2 MB. Staging đã đăng nhập và các API đọc schema hoạt động; chưa diễn tập export/import với dữ liệu thật, ZIP/checkpoint, hơn 2.000 mục hoặc cutover identity. |
| S14 | Chưa bắt đầu | Chưa chạy kiểm thử multi-user, concurrent, load hoặc offline dài hạn. |
| S15 | Đang làm | Staging Supabase và Google OAuth đã cấu hình; đăng nhập web staging thành công. Chưa có beta user, staging extension OAuth client/ID, dictionary pack hoặc Chrome end-to-end. |
| S16 | Chưa bắt đầu | Chưa chuẩn bị icon/listing hoặc gửi Chrome Web Store. |
| S17 | Chưa bắt đầu | Chưa public enrollment, billing hay vận hành nhiều người dùng. |

## Kiểm tra local đã chạy

- `npm.cmd run lint` — pass.
- `node_modules/.bin/next typegen` rồi `node_modules/.bin/tsc.cmd --noEmit --incremental false` — pass.
- `npm.cmd run check:extension` — pass; 4 core tests và build `artifacts/extension/`.
- `npm.cmd run test:dictionaries` — pass; 4 fixture tests.
- `npm.cmd run build` — pass trên Next.js 16.3.6 sau khi cho phép worker chạy ngoài sandbox.
- Sau mốc `e4cb3f0`, lint, typecheck và production build đã chạy lại sau thay đổi quota; extension tests và dictionary fixture tests vẫn pass. Cần kiểm thử thêm migration 005 về rollback/concurrency/RLS trên staging.
- Sau mốc quota, lint, typecheck, production build, extension tests và dictionary fixture tests chạy lại sau API/UI bổ sung Kho từ.
- `git diff --check` — pass; chỉ có cảnh báo đổi LF/CRLF của Git trên Windows.
- S13 sau thay đổi import/export: lint, `next typegen` + `tsc`, production build, `check:extension` (4/4 core tests), `test:dictionaries` (4/4 fixtures) và `git diff --check` đều pass. Build cần chạy ngoài sandbox để worker Next.js khởi tạo được.
- S12 context panel: lint, `next typegen` + `tsc`, production build và `git diff --check` pass; chưa kiểm tra URL YouTube/trang từ một capture thật vì extension chưa được cài và staging hiện chưa có từ.
- Staging: app đăng nhập Google thành công bằng project Supabase đã cấu hình; Kho từ tải được (0 từ), `GET /api/vocabulary?occurrences=<uuid>` trả danh sách ngữ cảnh rỗng, và `GET /api/usage` trả quota translation 0/60, suggestion 0/30. Đây là smoke test xác nhận phiên auth và các truy vấn bảng phục vụ migration 004/005 đọc được. Không có từ/capture để thử link nguồn hoặc round-trip restore. Không ghi secret vào repo/log.
- Export endpoint trả file download nên việc mở URL trực tiếp trong browser automation bị chặn bởi luồng tải xuống; chưa kết luận endpoint lỗi và chưa xác minh round-trip export/import.

## Cần cấu hình trước beta

- Supabase staging có thể reset, snapshot database, hai tài khoản thử và một tài khoản bị từ chối; đăng nhập hiện tại mới xác minh một tài khoản.
- Google OAuth extension client và ID ổn định; thiết lập provider theo hướng dẫn trong `extension/README.md`.
- Kaikki raw JSONL và xác nhận giấy phép/attribution; sau đó đo gói thật.
- Cloudflare R2 custom HTTPS domain, staging web/API và `CHROME_EXTENSION_IDS`.
- Chrome thật để thử Load unpacked, YouTube CC, website, offline queue và extension OAuth. Migration 004/005 đã có smoke test truy vấn qua staging app; còn cần thử các policy và luồng ghi thực tế.
