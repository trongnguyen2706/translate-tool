# Nhật ký triển khai extension

Cập nhật: 2026-10-20. Đối chiếu theo [checklist](PLAN_EXTENSION_STEPS.md); chưa đánh dấu hoàn tất bước nào nếu thiếu phép thử ngoài môi trường local.

Mốc code local: commit `e4cb3f0` (`feat: add Chrome dictionary extension foundation`) đã push lên `origin/codex/ai-tags-bulk-delete`. Kiểm thử Chrome được người dùng cho phép nhưng công cụ trình duyệt chặn `chrome://extensions` theo URL policy; không thử đường vòng.

| Bước | Trạng thái | Bằng chứng / việc còn thiếu |
| --- | --- | --- |
| S00 | Đang làm | Branch `codex/ai-tags-bulk-delete`. Baseline trước code: `0c0b5b0`; lint/typecheck pass. Hiện lint, typecheck, production build pass. Staging đã đăng nhập được; chưa có DB snapshot hoặc hai tài khoản thử. |
| S01 | Code có, chưa xác minh | Overlay CC, click pause, chọn cụm và resume đã viết. Chrome URL policy từ chối mở `chrome://extensions`; cần nạp Load unpacked thủ công để thử YouTube thật. |
| S02 | Full packs đo trên Chrome page | 125.255.416 byte tải nén; IndexedDB 479.379.796 byte sau cài, median mẫu tra 0,4–0,5 ms. Dùng installer thật, Chrome messaging mock; xem report dưới. Chưa đo worker extension thật/total process RAM. |
| S03 | Local pass | MV3 0.2.0; 12 Node extension tests, nâng IndexedDB v1→v2 giữ dữ liệu, syntax/build riêng. |
| S04 | PostgreSQL local pass; staging còn mở | 006–008 được chạy trên PGlite với auth claims/RLS hai user và user bị từ chối; thử alias backfill từ dữ liệu cũ, rollback, capture replay và tiến độ. Chưa áp dụng 006–008 lên staging/snapshot thật. |
| S05 | Code và SQL local pass | Web POST/PATCH, capture và JSON/CSV import dùng writer chung save_vocabulary_item; alias theo ngôn ngữ giữ ID; xung đột mơ hồ cần chọn ID. Undo giữ mục đã có ngữ cảnh/thẻ/bộ học. |
| S06 | Google login cũ pass; refresh mock pass | Refresh đồng thời dùng chung một request; response muộn không khôi phục tài khoản đã logout. Cần xác minh nâng cấp 0.2.0 và nhiều tài khoản trên Chrome extension thật. |
| S07 | Cài full trên browser IndexedDB; R2 chuẩn bị | 3 bộ thật cài thành công trên origin fixture Chrome; installer/resume/atomic activation tests pass. Có kiểm tra quota, màn hình usage, xóa pack bằng key range, nguồn/license. R2 uploader dry-run xác minh 332 file; chưa upload theo lựa chọn user. |
| S08 | UI fixture và UI web đọc pass | Popup native selections/hover/basic/expand/delayed responses đã kiểm tra; manager source thật có data mock rõ nhãn. Chưa chạy save/enrich authenticated sau migration mới. |
| S09 | 56 UI fixture checks pass | Thêm Add context/Add flashcard, chọn nghĩa đã có, SPA navigation và bật/tắt CC giữ chữ gốc. Fullscreen vẫn mô phỏng; YouTube thật/Shorts/PiP chưa nghiệm thu bản mới. |
| S10 | Code + storage/SQL tests pass | Queue account-scoped, retry cùng ID, coalesce sync, lease qua worker module restart mô phỏng, 429 retry, saved personal cache, manager retry/remove/resolve. Chưa thử Chrome MV3 suspension/offline browser restart trên extension cài thật. |
| S11 | Hai nguồn và cache/ledger đã code | Kho từ dùng public dictionary bridge từ extension đúng origin hoặc AI; chọn field/mode, nhiều nghĩa hỏi chọn, batch/dừng. Server cache per-user/context/fields, pending/uncertain không gọi lặp, có history/reset chủ động; SQL tests pass. Cần migration 006 và E2E thật. |
| S12 | Code/UI đọc pass | Lọc trường thiếu, provenance, refresh khi focus/sync, không fallback ngôn ngữ cả hints flashcard; Add context không khóa Save và giữ tiến độ. UI web hiện tại tải được 16 mục, chưa ghi lên staging trong vòng này. |
| S13 | ZIP và restore PostgreSQL local pass | ZIP chia phần, checksum/giới hạn giải nén, dependency mỗi phần, transaction/checkpoint atomic. Restore 2.101 từ/thẻ hai lần không trùng/mất progress/ngữ cảnh; legacy JSON/CSV adapter còn. Chưa restore staging từ snapshot thật. |
| S14 | Local suites + CI, chưa staged load | Có GitHub workflow và read-only staged load script không gọi AI. Two-user RLS/transactions test trên PostgreSQL local; chưa có hai tài khoản/token staging hoặc phép đo RPS/p95 backend thật. |
| S15 | Chuẩn bị theo lựa chọn user | User chưa có domain/deploy/R2/Store; yêu cầu chỉ chuẩn bị gói và hướng dẫn. Có runbook, uploader dry-run, flags capture/AI và staging upgrade guide; chưa deploy. |
| S16 | Gói phát hành chuẩn bị | Icon PNG, ZIP whitelist source, privacy notice, hướng dẫn listing/permissions/ID/OAuth. Chưa có Store account/submission hoặc screenshot từ bản Store thật. |
| S17 | Runbook, chưa vận hành public | Allowlist giữ nguyên; chưa public enrollment. Có flags và load script. Không triển khai billing/số dư hoặc automation; hosting/Store theo user sẽ làm sau. |

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
- Extension OAuth trên Chrome thật đăng nhập staging thành công với email allowlist. Trên Wikipedia, bôi đen `example` hiện nút Tra; lần mở popup đứng ở loading do code đợi API saved-status. Đã sửa thứ tự để kết quả local hiện trước, kiểm tra saved-status chạy nền. Build mới pass nhưng chưa reload extension trong Chrome để chạy lại.
- Báo cáo thử Chrome: click nút Tra bị listener `mouseup` xử lý lại vùng chọn cũ, thay nút đang bấm trước khi sự kiện `click` chạy; click chỗ khác cũng có thể dựng lại Tra từ selection còn lưu. Đã thêm kiểm tra selection thay đổi, ẩn nút khi bắt đầu click ngoài overlay và bỏ qua `mouseup` từ overlay. Đã sửa YouTube caption hit-test theo tọa độ để tránh lớp điều khiển player che vùng click. Cần reload unpacked extension + tab để xác nhận end-to-end.
- AI: một smoke test trực tiếp với model đang cấu hình và từ công khai `hello` trả structured output hợp lệ sau 3,7 giây. Đây là phép thử provider, chưa xác nhận luồng có auth từ extension. Đã chặn bấm AI lặp, giữ trạng thái qua lần render saved-status, không auto-close khi AI pending, xử lý lỗi transport và giới hạn chờ (server gọi AI 30 giây, extension fetch 45 giây). Sửa field `examples` bị thiếu do mapping nhãn tiếng Việt và chấp nhận metadata từ điển null. 7 extension tests/build, 5 dictionary tests, lint, typegen/typecheck và diff check pass.
- Dictionary: nguồn thật dùng `translations.lang_code` thay vì chỉ `code`; đã hỗ trợ cả hai và lấy cặp Việt→Anh từ entry tiếng Việt. Builder đọc trực tiếp gzip, tách sense ID theo từ loại và xếp tên riêng sau nghĩa thông thường. Gói Simple English là gói Anh–Anh cơ bản; gói Việt→Anh hiện chỉ có các cặp dịch tường minh (4.447 khóa). Dữ liệu nguồn và gói local không commit; cách dựng lại ghi trong `extension/README.md`. Tải HTTP tất cả chunks đã đối chiếu SHA-256, byte nén/giải nén, số mục và giới hạn schema của installer.
- Theo lựa chọn của người dùng, đã mở rộng sang English extract khoảng 523 MB và Vietnamese-with-English-glosses khoảng 13 MB, tái dùng Vietnamese-edition 34 MB. Gói mới khoảng 125 MB tải xuống và có attribution kèm theo; gói Anh–Anh 1.349.433 khóa, Anh–Việt 248.073 khóa, Việt–Anh 41.411 khóa. Bổ sung synonym/antonym có sẵn, cặp dịch tường minh, liên kết dạng chia cho Anh–Việt và gloss Anh cho từ Việt. Headword flashcard Anh được gắn khi có cặp dịch hoặc khớp entry tiếng Anh; các mục khác có thể yêu cầu AI trước khi lưu flashcard.
- Đóng gói full: đã tối ưu staging SQLite có thể dựng lại và thêm index theo base cho phép nối form aliases. Trong lần chạy này, staging đã qua `quick_check` và đối chiếu 912 sense ở cuối file nguồn trước khi hoàn tất phần đóng gói. Validation phát hiện metadata bảng chia từ `no-table-tags` bị hiểu thành từ; đã loại link có tag `table-tags`, thêm regression fixture và loại 1 mục/4.147 sense metadata khỏi gói. Publisher kiểm tra mọi chunk trước khi chuyển root manifest nguyên tử; không ghi đè thư mục phiên bản có nội dung khác.
- Lỗi Anh→Việt hiện nghĩa Anh: thay prompt mô tả chung bằng chỉ dẫn tiếng Việt rõ ràng, schema ràng buộc definitionLanguage, kiểm tra các trường hợp sai ngôn ngữ rõ ràng trước khi áp dụng/lưu; dùng chung ở API extension và Kho từ. Popup giữ snapshot chế độ, đóng draft khi đổi mode và kiểm tra mode/ngôn ngữ từ API. Provider smoke test `restructured` trả "được tái cơ cấu; được tổ chức lại" ở Anh→Việt (~3,7 giây), định nghĩa Anh ở Anh→Anh (~2,6 giây); Việt→Anh trả sourceTerm `restructure` và gloss Anh (~9,7 giây). Đây chưa phải xác nhận luồng authenticated trên Chrome sau reload.
- Checks sau thay đổi full/mode: 8 extension tests và build pass, 3 language regression tests pass, 6 dictionary fixture tests pass, lint/typegen/typecheck và production build pass. Production build cần chạy ngoài sandbox để spawn worker; Next 16 tách output dev/build. Toàn bộ gói full đã được đọc lại qua HTTP localhost và đối chiếu SHA-256/kích thước/số dòng; sample `restructured` của gói Anh→Việt có glossLanguage `vi` và nghĩa tiếng Việt.
- UI YouTube: đọc DOM thật xác nhận host nằm trong `#movie_player` (stacking context z-index 0), chữ trang có thể đè popup; CC kế thừa `user-select: none`, và listener selection bỏ qua toàn bộ YouTube. Host nay nằm ở document root khi xem thường/theater, chỉ chuyển vào fullscreen element khi fullscreen; có reposition và chặn click xuyên popup xuống từ CC. CC cho phép chọn chữ, nằm trên lớp controls, có highlight xanh theo hover hoặc tọa độ. Selection trang/CC cùng hiện Tra; không mở lại từ selection cũ. CC cập nhật nội dung trên cùng segment được wrap lại theo câu mới. Chrome fixture dùng JS/CSS thật với mock Chrome/video/dictionary và duy nhất thay hostname check: 20/20 checks pass; double click văn bản trang, double click CC và kéo chọn cụm CC bằng chuột thực đều hiện đúng Tra. Fullscreen lifecycle chỉ mô phỏng; fullscreen thật bị trình duyệt báo `not granted`, chưa kết luận đã xác minh YouTube end-to-end. Cần reload unpacked extension + tab YouTube để dùng bản sửa.
- Theo yêu cầu mới, chỉ sửa hover và nhận diện từ ghép; không triển khai ngân sách/chi phí AI. CC giữ nguyên các từ có dấu nối ASCII/typographic/non-breaking và apostrophe; en/em dash vẫn tách từ. Lookup/save chuẩn hóa dấu nối, còn queryTerm/ngữ cảnh giữ chữ gốc. Double-click native trên Chrome ban đầu chọn `friendly ` với endpoint rơi vào node dấu cách; đã mở rộng về cả token và thêm regression đúng cấu trúc native này. Hover dùng nền xanh trong suốt 16%, gạch chân mảnh bo góc, giữ màu/cỡ chữ và kích thước; token đang tra có trạng thái riêng và bỏ khi đóng popup. 36 UI fixture checks (fullscreen lifecycle mô phỏng), 9 Node extension tests, lint và build extension pass; đã xác nhận double-click native chọn `eco-friendly` và hiện đúng Tra trên Chrome fixture. Gói Anh–Anh có `eco-friendly`; gói Anh–Việt đang thiếu nghĩa, dữ liệu từ điển không được đổi trong đợt sửa nhận diện/UI này. Cần reload extension + tab để xác nhận YouTube thật.

## Sửa tương tác và ngôn ngữ extension — 2026-10-20

- Đã xem bản ghi 13,2 giây do người dùng gửi qua trình phát local, không tải lên dịch vụ khác. Trường hợp được ghi là tra từ ở tiêu đề phía dưới player: popup hiện rồi mất. Code cũ gắn auto-close vào `pointerleave` và cập nhật hover bằng cách hủy/lập lại RAF mỗi lần di chuột; render loading/kết quả/trạng thái lưu có thể làm thay đổi vị trí hoặc vùng hit của popup.
- Hover đổi màu chữ sang cyan, nền nhẹ, không gạch chân; nhận diện trực tiếp từ CC cập nhật ngay trong sự kiện. Chỉ fallback hit-test theo tọa độ mới gộp một lần mỗi frame, sử dụng vị trí mới nhất.
- Auto-close tách khỏi highlight và `pointerleave`: chỉ xét chuyển động chuột thật ra ngoài cả từ lẫn popup, chừa vùng nối 12 px, chờ 300 ms rồi kiểm tra lại đúng popup hiện tại. Không tự đóng khi vừa bấm Look up mà chưa di chuột, đang tra, đang AI/lưu, hoặc đang Expand. Chọn cạnh trên/dưới một lần khi mở để các lần render không đảo vị trí; cập nhật saved-status không thay controls trong lúc Save. Chuyển giữa các từ CC giữ quyền pause, không phát video rồi lại pause.
- Đã chuyển tên/mô tả extension, toolbar, Settings, lookup, nhãn thiếu thông tin, trạng thái đăng nhập/tải từ điển/lưu, lỗi worker/network và lỗi API enrichment sang tiếng Anh. Nội dung từ điển vẫn theo chế độ chọn; không đổi ngôn ngữ dữ liệu hay tài khoản/cấu hình đang lưu.
- Chrome fixture chạy JS/CSS thật: 48/48 checks pass, thêm dữ liệu trả chậm, pointerleave do layout, timer cũ, re-entry, chuyển nghĩa, Expand, trạng thái Save trả chậm và giữ schema AI khi đổi ngôn ngữ UI. Fullscreen lifecycle vẫn là mô phỏng. Native double-click + Look up ở tiêu đề mở popup tiếng Anh; toolbar/Settings dùng source thật với storage mock rỗng hiển thị tiếng Anh và lỗi thiếu manifest bằng tiếng Anh. Không gọi model AI thật trong đợt kiểm tra này.
- `check:extension` (9 tests + build), lint, typegen/typecheck, production build và diff check pass. Build Next cần worker ngoài sandbox. Cần reload unpacked extension + F5 tab để thử lại trực tiếp YouTube, nhất là fullscreen thực; chưa đánh dấu E2E production hoàn tất.

## Cần cấu hình trước beta

- Supabase staging có thể reset, snapshot database, hai tài khoản thử và một tài khoản bị từ chối; đăng nhập hiện tại mới xác minh một tài khoản.
- Google OAuth extension client và ID ổn định; thiết lập provider theo hướng dẫn trong `extension/README.md`.
- Kaikki raw JSONL và xác nhận giấy phép/attribution; sau đó đo gói thật.
- Cloudflare R2 custom HTTPS domain, staging web/API và `CHROME_EXTENSION_IDS`.
- Chrome thật để thử Load unpacked, YouTube CC, website, offline queue và extension OAuth. Migration 004/005 đã có smoke test truy vấn qua staging app; còn cần thử các policy và luồng ghi thực tế.

## Hoàn thiện phần còn lại bản 0.2.0 — 2026-10-20

- User loại nghe phát âm khỏi phạm vi; vẫn giữ IPA. User xác nhận chưa có domain/deploy/R2/Chrome Web Store và yêu cầu chuẩn bị gói, hướng dẫn trước. Không có upload/deploy/submission trong đợt này.
- Code mới phụ thuộc migration 006, 007, 008. Các file đã chạy được trên PostgreSQL PGlite local nhưng CHƯA chạy trên Supabase staging. Migration 007 bỏ unique dựa vào nội dung nghĩa sau khi writer đã chuyển; cần snapshot và triển khai backend tương thích, không rollback về writer cũ. Hướng dẫn cụ thể ở docs/extension/UPGRADE_STAGING_VI.md.
- Bổ sung public dictionary bridge origin-checked, không chuyển token/personal cache/queue vào page; web chọn nghĩa khi đa nghĩa. AI chỉ chạy sau thao tác bấm. Cache server, request history và reset uncertain chủ động; cache local chỉ theo tài khoản/mode. Không gọi model AI thật trong đợt kiểm tra này.
- Queue manager hiển thị pending/error, retry/resolve/remove; xóa dictionary riêng không ảnh hưởng queue/personal data. Nâng IndexedDB 1→2 giữ pack và thao tác chưa sync. Token refresh/sync đồng thời coalesce; logout trong lúc refresh không bị đăng nhập lại ngoài ý muốn.
- Stable writer và language aliases giữ ID qua bổ sung nghĩa, không gộp mơ hồ. Deletion markers chặn capture có createdAt trước lần xóa, nhưng cho phép lưu mới chủ động; API delete/undo và capture cùng khóa theo từ để tuần tự hóa. Hash mặc định giữ hợp đồng capture cũ khi chưa chọn confirmed ID, timestamp intent không đổi hash retry. Add context/Add flashcard được bật cho từ cũ; cùng ngữ cảnh không lặp occurrence; tiến độ không reset. Restore ZIP giữ tiến độ hiện có và dùng checkpoint per-user/per-part trong cùng transaction; file đổi nội dung nhưng tái dùng part ID bị từ chối.
- Browser fixture source thật: 56/56 checks pass. Manager render source thật với dữ liệu sample có nhãn; web library thật hiển thị các control mới và 16 mục đã có, không chạy ghi dữ liệu staging. Fullscreen chỉ mô phỏng; chưa xác minh installed extension E2E hoặc MV3 worker bị dừng thật.
- Full dictionary benchmark trên Chrome page, installer và IndexedDB thật, mock Chrome API: en-vi 248.073 khóa / 27,442 giây / median 0,5 ms; vi-en 41.411 / 4,979 giây / 0,4 ms; en-en 1.349.433 / 187,418 giây / 0,5 ms. Tổng download 125.255.416 byte; storage tăng 479.379.796 byte. Đây là mẫu lookup 60 lần/mode trên máy này, không gồm IPC worker và không phải cam kết hiệu năng production. JS heap đo chỉ có tính tham khảo; không phải tổng RAM Chrome. Report: docs/extension/dictionary-benchmark-2026-10-20.json. Các bản dictionary dùng để benchmark ở origin fixture được dọn riêng sau đo; dữ liệu extension đang cài không bị xóa.
- PostgreSQL tests kiểm tra legacy backfill, tách nghĩa, ambiguous/confirmed ID, capture/replay/context dedupe, RLS hai user, denied user, stale revision, rollback và cache uncertain/reset. ZIP tests kiểm tra hơn 2.000 mục, checksum/path/expansion limits; restore 2.101 từ và thẻ hai lần giữ count/progress/timestamp/IPA/nguồn video.
- Có CI, script kiểm tra tải staging chỉ đọc, cờ EXTENSION_CAPTURE_ENABLED / AI_ENRICHMENT_ENABLED, toggle CC local, privacy/runbook và uploader R2. Dry-run uploader xác minh 332 file; không có credential/linked Vercel project trong workspace.

- Vòng kiểm tra cuối: 56 UI checks, 12 Node extension tests, PostgreSQL integrity/RLS/deletion tests, 3 ZIP tests (gồm round-trip 2.101 mục), 3 language tests và 6 Python dictionary tests pass; lint/typegen/typecheck, production build và diff check pass. Gói release 0.2.0 được tạo theo whitelist 20 file; chưa cài qua Store.
- ZIP release: 33,336 byte, 20 file đúng source, build lại cùng SHA-256 `a9bf0ed75e785ce4a98e85eb5c16e61b7e98bfceef2bb63eb9259abfb1fda9d3`. Chỉ gồm manifest/src/icons; không có dictionary, secret, fixture hoặc session.
# 2026-10-21 — base meanings for word forms (extension 0.2.1)

- Preserved upstream base-form links/tags in rebuilt dictionary data
  `2026.10.21.1-forms`; verified and published the immutable local version.
- Added bounded local resolution with POS/language matching, conservative
  legacy English/Vietnamese grammar-note support, cycle/missing-base handling,
  per-form/sense identity and preservation of personally filled fields.
- Popup choices display definitions; a separate grammar note identifies the
  base word. Base examples are labeled; base pronunciation is not inherited.
  Vietnamese–English retains its translation/headword.
- Capture/details and flashcards retain the base relationship without a new
  SQL migration. Existing saved definitions/progress are preserved.
- Validation: extension/storage/network tests, seven Python builder tests,
  ten full-pack term/mode checks, PostgreSQL capture/replay/progress checks,
  63 local browser interaction checks, lint, typecheck and production build.
  Live installed-extension/YouTube and staged account flows remain operator
  checks. No paid AI requests, R2 upload or Chrome Store submission.
- Activation: `docs/extension/WORD_FORMS.md`; existing migrations 001–008 are
  still prerequisites for the web writer APIs.
