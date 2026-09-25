# Phrasebook

Web app cá nhân để dịch văn bản hoặc chữ trong ảnh và lưu từ/cụm từ theo ngữ cảnh. Giao diện responsive cho máy tính và điện thoại. Bản này giới hạn 1–2 tài khoản Google do chủ app chỉ định.

## Đã có trong app

- Google OAuth qua Supabase; danh sách email được phép ở backend.
- Nhập/dán text, chọn ảnh PNG/JPG/WebP/BMP hoặc dán ảnh chụp màn hình vào ô nhập bằng Ctrl+V (Windows) / ⌘V (Mac). Tesseract.js đọc ảnh **trong trình duyệt**; chỉ text OCR được gửi lên backend.
- Dịch Anh → Việt, Việt → Anh, Anh → Anh bằng OpenAI Responses API.
- Lưu bản dịch theo thao tác người dùng; lịch sử ở sidebar.
- Gợi ý từ, cụm từ, collocation sau khi dịch. Chế độ duyệt cho phép xem/sửa rồi lưu; khi tắt duyệt, app tự gợi ý và lưu sau mỗi lần dịch. Có hoàn tác cho mục mới lưu.
- Nút **Học từ đoạn này** gợi ý trực tiếp từ text/OCR, không gọi API dịch. Có lựa chọn CEFR tối thiểu, IELTS Academic/General, kỹ năng, lĩnh vực và số từ. Nhãn IELTS là ước tính mức hữu ích, không phải tần suất xuất hiện trong đề thi.
- Tab **Từ vựng hôm nay** chọn ngẫu nhiên từ kho đã lưu theo ngày nhập hoặc thứ, level, mức hữu ích IELTS, kỹ năng, lĩnh vực, tag và loại mục. Bộ học cùng tiến độ được lưu theo ngày; tạo bộ không tốn lượt AI. Có thể tạo flashcard từ toàn bộ bộ từ đã chọn.
- Trên PC, bản dịch và danh sách gợi ý có vùng cuộn riêng; trên màn hình hẹp có tab chuyển giữa hai phần.
- Menu trái luôn hiện khi chuyển trang trên PC; mục đang mở có vòng xoay chờ ngay trong menu. Trong Cài đặt có thể chọn giao diện sáng/tối và tiếng Việt/English; lựa chọn được lưu trong trình duyệt.
- Hiển thị lượt dịch/gợi ý còn lại theo hạn mức app mỗi ngày và chi phí USD ước tính của từng yêu cầu OpenAI vừa chạy.
- Kho từ: thêm thủ công, sửa, xóa, tìm kiếm, sắp xếp, lọc theo ngày/tuần/tháng/thứ, level, IELTS, lĩnh vực và tag tự chọn. Từ nhập JSON/CSV được gắn tag “Đã nhập”. Có thể phân loại lại tối đa 10 từ cũ mỗi lần bằng AI; mỗi lần tính một lượt gợi ý.
- Flashcard: tạo từ từng mục trong kho hoặc từ bộ từ hôm nay, chọn thứ tự Anh–Anh/Anh–Việt/Việt–Anh, luyện đặt câu với gợi ý nghĩa, collocation và ví dụ, lưu bốn mức “Chưa thuộc”, “Sơ sơ”, “Thuộc rồi”, “Nằm lòng”.
- Xuất JSON version 3 gồm kho từ, bản dịch, bộ học theo ngày và flashcard; vẫn nhập được JSON version 1–2. CSV dành cho kho từ, có cột tag và tệp mẫu trong Kho từ.
- RLS theo người dùng, giới hạn số lượt dịch/gợi ý mỗi ngày, OpenAI key chỉ nằm trên server.

## Chạy local

Yêu cầu Node.js 20.9 trở lên và npm.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Nếu npm trên máy đang bật chế độ offline, chạy `$env:npm_config_offline='false'` trước `npm install`.

Mở `http://localhost:3000`. Khi chưa có Supabase config, app hiện trang hướng dẫn cấu hình.

## Cấu hình Supabase và Google

1. Tạo một project tại [Supabase](https://supabase.com/dashboard).
2. Trong SQL Editor, chạy lần lượt [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql), [`supabase/migrations/002_learning.sql`](supabase/migrations/002_learning.sql), rồi [`supabase/migrations/003_flashcards_tags.sql`](supabase/migrations/003_flashcards_tags.sql). Nếu database đã có các migration trước, chỉ chạy phần còn thiếu theo đúng thứ tự. SQL tạo bảng, bật Row Level Security và bảng email được phép. Sau đó thêm 1–2 email Google của bạn bằng câu lệnh sau (thay email ví dụ):

   ```sql
   insert into private.allowed_users (email)
   values ('you@example.com'), ('friend@example.com');
   ```

   Nếu chỉ dùng một người, bỏ dòng email thứ hai. Email phải viết chữ thường. Chỉ chủ project có quyền sửa bảng này.
3. Trong **Project Settings → API Keys**, lấy Project URL và publishable/anon key. Điền vào `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY` trong `.env.local`. Publishable/anon key được thiết kế để dùng ở client; không dùng `service_role` key.
4. Trong Google Cloud Console, tạo OAuth Client loại **Web application**. Authorized JavaScript origins gồm `http://localhost:3000` và URL Vercel production. Authorized redirect URI là callback URL hiển thị trong trang cấu hình Google provider của Supabase (thường có dạng `https://<project-ref>.supabase.co/auth/v1/callback`).
5. Trong Supabase **Authentication → Providers → Google**, bật provider và điền Google Client ID/Secret. Trong **Authentication → URL Configuration**, đặt Site URL của web và cho phép `http://localhost:3000/auth/callback` cùng `https://<domain-production>/auth/callback` trong Redirect URLs.
6. App đối chiếu email Google với `private.allowed_users` khi đăng nhập, ở mọi API route và trong RLS. Email cần được xác minh bởi Google. Tài khoản chưa có trong bảng sẽ bị từ chối.

Xem [hướng dẫn Google OAuth chính thức của Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google) nếu giao diện quản trị thay đổi.

## Cấu hình OpenAI

1. Tạo project/API key tại [OpenAI Platform](https://platform.openai.com/).
2. Điền `OPENAI_API_KEY` vào `.env.local`. Mặc định app dùng `gpt-5-mini`; có thể đổi bằng `OPENAI_MODEL` sang model hỗ trợ Responses API và Structured Outputs.
3. Đặt cảnh báo và **hard spend limit** trong OpenAI project. `DAILY_TRANSLATION_LIMIT` và `DAILY_SUGGESTION_LIMIT` là hạn mức riêng của app cho từng tài khoản.

Chi phí hiện trong ô dịch được tính từ token của phản hồi, theo [đơn giá chuẩn OpenAI](https://developers.openai.com/api/docs/pricing) cho `gpt-5-mini` và `gpt-6-luna`; đây là **ước tính**, không phải số dư hay hóa đơn OpenAI. Nếu đổi sang model khác, app hiện “chưa có đơn giá” cho đến khi cập nhật `src/lib/openai/pricing.ts`. Dùng liên kết **Chi phí thực tế** trong app để xem [OpenAI Usage](https://platform.openai.com/usage). Hạn mức hiển thị trong app là số lượt riêng của app, không phải quota API hoặc số dư tín dụng OpenAI.

API key chỉ dùng trong route handlers server. Không thêm `NEXT_PUBLIC_` vào tên key và không commit `.env.local`. App gọi Responses API với `store: false`. OpenAI vẫn áp dụng chính sách log giám sát lạm dụng của họ.

## Deploy Vercel

1. Đưa repo lên GitHub riêng và import project vào Vercel.
2. Thêm mọi biến trong `.env.example` vào **Vercel → Project Settings → Environment Variables**. Đặt `OPENAI_API_KEY` dạng sensitive và chỉ ở môi trường cần dùng. Các giá trị `NEXT_PUBLIC_*` cần có lúc build.
3. Deploy, lấy URL production rồi bổ sung URL đó vào Google OAuth origins và Supabase Redirect URLs/Site URL.
4. Đăng nhập thử bằng email được phép và email không được phép. Kiểm tra API không nhận request từ tài khoản ngoài danh sách.
5. Đặt giới hạn chi tiêu OpenAI trước khi dùng thường xuyên. Với gói Supabase Free, xuất JSON định kỳ vì gói này không có backup tự động.

Ảnh không được gửi lên OpenAI, Supabase hoặc Vercel: OCR chạy trong browser. Tesseract tải mã và dữ liệu ngôn ngữ để OCR khi sử dụng lần đầu; ảnh vẫn được xử lý trên thiết bị.

## Dữ liệu và hạn mức

Trong **Kho từ**, chọn **CSV mẫu** để tải tệp ví dụ, điền thêm các dòng rồi chọn **Nhập CSV**. CSV dùng dấu phẩy để ngăn cột và dòng đầu tiên là tên cột. Bắt buộc có `term`, `kind` (`word` hoặc `phrase`) và `source_language` (`en` hoặc `vi`); các cột còn lại có thể để trống. Nhiều giá trị trong `collocations`, `ielts_skills`, `topics` và `tags` ngăn bằng dấu chấm phẩy (`;`). `created_at` để trống sẽ lấy thời điểm nhập, hoặc điền ngày giờ ISO 8601 có múi giờ. CSV chỉ chứa kho từ, không chứa lịch sử dịch hoặc bộ học. Mục đã có trong kho được bỏ qua khi nhập CSV.

Các bảng `translations`, `vocabulary_items`, `user_settings`, `usage_events` có `user_id` và RLS. Chính sách RLS cũng kiểm tra email Google nằm trong `private.allowed_users`. Thao tác database dùng phiên Supabase của người dùng. Bản dịch không tự lưu; khi bật duyệt, gợi ý từ chỉ tạo khi nhấn nút. Khi tắt duyệt, gợi ý được tạo và lưu sau mỗi lần dịch.

Hạn mức app được tính theo ngày Việt Nam (UTC+7). Khi đạt giới hạn, API trả HTTP 429. Các giới hạn này phù hợp bản 1–2 người dùng; trước khi mở đăng ký công khai cần cơ chế quota chặt hơn và quản lý billing cho nhiều người.

## Lệnh kiểm tra

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

## Phạm vi chưa làm

Game và lịch ôn tập sẽ được thiết kế sau theo yêu cầu. Bản này chưa có tài khoản công khai, thanh toán hay chia sẻ bộ từ.
