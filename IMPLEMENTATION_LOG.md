# Nhật ký triển khai extension

Cập nhật: 2026-10-19. Theo dõi các bước trong [checklist](PLAN_EXTENSION_STEPS.md); chỉ ghi Pass khi đã chạy phép kiểm tra tương ứng.

| Bước | Trạng thái | Bằng chứng / ghi chú |
| --- | --- | --- |
| S00 | Đang làm | Branch `codex/ai-tags-bulk-delete`, baseline `0c0b5b0`. `npm.cmd run lint` pass; `./node_modules/.bin/tsc.cmd --noEmit --incremental false` pass. `npm.cmd run build` compile pass nhưng Next kết thúc `spawn EPERM` ở bước TypeScript. Chưa có xác nhận staging DB, snapshot và tài khoản test. |
| S01 | Chưa bắt đầu | Cần prototype và kiểm tra trên YouTube thật. |
| S02 | Chưa bắt đầu | Cần nguồn dữ liệu Kaikki, script build và đo gói trên Chrome. |
| S03–S17 | Chưa bắt đầu | Chưa triển khai. |

## Cấu hình cần có trước các bước cloud

- Supabase staging có thể reset, snapshot database và hai tài khoản thử độc lập.
- Google OAuth redirect/extension ID cho thử đăng nhập extension.
- Cloudflare R2 cùng domain HTTPS để thử tải gói dữ liệu.
- Môi trường staging của web/API; production và Chrome Web Store chỉ xử lý theo bước phát hành đã chốt.
