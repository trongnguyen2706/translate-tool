# Kế hoạch web dịch và học từ vựng (1–2 người dùng)

## 1. Mục tiêu và phạm vi

Web app dùng trên máy tính và điện thoại, truy cập qua một URL. Người dùng đăng nhập Google, nhập hoặc dán text, hoặc chọn ảnh để OCR ngay trong trình duyệt. App dịch nhanh theo ba chế độ Anh → Việt, Việt → Anh và Anh → Anh. Sau khi có bản dịch, người dùng có thể yêu cầu AI gợi ý từ, cụm từ và collocation để lưu học.

Bản này giới hạn **1–2 tài khoản Google được cho phép**. Không có đăng ký công khai, thanh toán, chia sẻ bộ từ hay trang quản trị nhiều người. Game và thuật toán ôn tập sẽ thiết kế sau; cấu trúc dữ liệu cần đủ để thêm chúng mà không phải làm lại kho từ.

Ảnh chỉ được xử lý trong trình duyệt và không được gửi lên backend, Supabase hoặc OpenAI. AI chỉ nhận text. Bản dịch được lưu khi người dùng chọn lưu; gợi ý từ được lưu theo chế độ duyệt hoặc tự lưu đã chọn.

## 2. Luồng sản phẩm

1. Đăng nhập Google. Backend xác nhận tài khoản nằm trong danh sách cho phép.
2. Nhập text, dán text hoặc chọn ảnh trong khung nhập kiểu chat. Chọn chiều dịch.
3. Nếu là ảnh, OCR chạy trên thiết bị. Hiện text nhận được để người dùng sửa trước khi gửi.
4. Backend gọi OpenAI và trả bản dịch nhanh. Người dùng có thể lưu bản dịch vào lịch sử.
5. Nhánh **Gợi ý từ vựng** chỉ chạy khi được yêu cầu. AI đề xuất từ đơn, cụm từ và collocation theo ngữ cảnh, không tự quyết định mức từ nâng cao thay người dùng.
6. Khi bật **Duyệt trước khi lưu**, từng gợi ý được chọn và sửa. Khi tắt, các gợi ý hợp lệ tự lưu, có thể hoàn tác. Tránh tạo bản ghi trùng.
7. Nếu ví dụ có từ mới, app đề xuất thêm từ đó tối đa một cấp; không sinh vòng lặp đề xuất vô hạn.
8. Kho từ hỗ trợ tìm kiếm, sửa, xóa, sắp xếp mới nhất/cũ nhất, lọc theo ngày, tuần, tháng và thứ trong tuần; xuất dữ liệu JSON/CSV và nhập lại bản xuất JSON.

## 3. Giao diện

Lấy bố cục và nhịp sử dụng quen thuộc của ChatGPT làm tham chiếu: thanh bên chứa phiên đã lưu, vùng nội dung rộng ở giữa, khung nhập cố định phía dưới. Dùng tên, biểu tượng và nội dung riêng của sản phẩm.

Hướng thị giác: nền trắng hoặc xám rất nhạt, chữ sans dễ đọc, đường phân cách mảnh và một màu nhấn xanh dùng tiết chế. Điểm tương tác riêng của app: chọn một từ/cụm ngay trong đoạn nguồn để mở thẻ xem nghĩa, collocation và thao tác lưu.

- **Desktop:** thanh bên có các mục Dịch mới, Lịch sử, Kho từ, Cài đặt; vùng giữa giới hạn chiều rộng để dễ đọc; câu nguồn và bản dịch là nội dung chính; gợi ý từ mở trong panel hoặc dưới bản dịch.
- **Điện thoại:** thanh bên chuyển thành drawer; khung nhập bám mép dưới và tránh bàn phím ảo; nút ảnh, chiều dịch và gửi dễ chạm; thẻ gợi ý xếp dọc.
- **Trạng thái cần thiết:** OCR đang chạy, OCR nhận sai, đang dịch, đang gợi ý, lưu thành công, lỗi mạng, hết hạn mức API.
- **Nội dung UI:** dùng nhãn rõ nghĩa như “Dịch”, “Gợi ý từ”, “Lưu bản dịch”, “Duyệt trước khi lưu”, “Kho từ”. Không dùng dữ liệu mẫu giả làm dữ liệu thật.
- **Khả năng tiếp cận:** hỗ trợ bàn phím, focus rõ, tương phản tốt, nút có nhãn, cỡ chạm phù hợp trên điện thoại.

## 4. Công nghệ và cấu trúc

| Phần | Công nghệ | Vai trò |
| --- | --- | --- |
| Web và backend | Next.js + TypeScript | Giao diện và API trong một project |
| Hosting | Vercel | URL public, triển khai từ GitHub |
| Đăng nhập và database | Supabase Auth + Postgres | Google OAuth và lưu dữ liệu |
| OCR | Tesseract.js trong browser | Trích chữ; ảnh không rời thiết bị |
| Dịch và gợi ý | OpenAI Responses API | Xử lý text ở backend; gợi ý trả về theo schema |
| Kiểm tra dữ liệu | Zod hoặc schema tương đương | Xác thực input và output AI trước khi lưu |

```text
src/
  app/
    (auth)/login/
    (app)/page.tsx                 # Màn hình dịch
    (app)/library/page.tsx        # Kho từ
    (app)/settings/page.tsx       # Cài đặt
    auth/callback/route.ts
    api/translate/route.ts
    api/suggestions/route.ts
    api/translations/route.ts
    api/vocabulary/route.ts
    api/export/route.ts
  features/
    composer/                   # Nhập text, ảnh và OCR
    translation/
    suggestions/
    vocabulary/
  lib/
    auth/
    db/
    openai/
    dates/
    validation/
supabase/migrations/
```

## 5. Dữ liệu

- `private.allowed_users`: 1–2 email Google được phép dùng app; backend và RLS đều kiểm tra bảng này. Dữ liệu của từng tài khoản vẫn gắn với Supabase user ID.
- `translations`: chủ sở hữu, text nguồn, chiều dịch, bản dịch, thời điểm tạo. Chỉ ghi khi chọn lưu.
- `vocabulary_items`: chủ sở hữu, từ hoặc cụm từ, ngôn ngữ, nghĩa Anh/Việt, ví dụ, ghi chú, loại mục, thời điểm tạo/sửa.
- `collocations`: trong bản đầu lưu thành mảng trên mục từ; có thể tách bảng khi cần quan hệ nhiều chiều.
- `suggestions`: gợi ý chờ duyệt chỉ tồn tại ở phiên trình duyệt; khi được chấp nhận hoặc ở chế độ tự lưu thì mới ghi vào `vocabulary_items`.
- `user_settings`: chiều dịch mặc định và chế độ duyệt trước khi lưu.
- `usage_events`: thời điểm, người dùng, loại lời gọi AI và số token để theo dõi chi phí. Không lưu nội dung prompt trong log này.

Mỗi bảng chứa dữ liệu người dùng có `user_id`; RLS chỉ cho chủ sở hữu đọc và sửa. Chống trùng theo dạng chuẩn hóa của từ/cụm + ngôn ngữ + nghĩa/ngữ cảnh, nhưng vẫn cho một từ có nhiều nghĩa khác nhau. Timestamp lưu UTC, hiển thị theo múi giờ Việt Nam. “Theo thứ” là bộ lọc thứ trong tuần qua nhiều tuần, khác với lọc một ngày cụ thể.

## 6. Bảo mật và kiểm soát chi phí

- Kiểm tra phiên Google và danh sách 1–2 user ID được phép ở **mọi API route**, đặc biệt là hai route gọi OpenAI.
- Bật RLS cho mọi bảng; không dùng `service_role` trong trình duyệt hoặc cho truy vấn thường ngày.
- `OPENAI_API_KEY` và các secret chỉ có trên server/Vercel; `.env.local` nằm trong `.gitignore`. Cấu hình URL OAuth cho local và production.
- OCR trong browser; không tạo endpoint upload ảnh. Giới hạn kích thước ảnh ở client, thu hồi object URL và không lưu ảnh vào localStorage, logs hay database.
- Giới hạn ký tự mỗi lượt, số lượt mỗi tài khoản/ngày, số lượt toàn app/ngày, cùng ngân sách cứng của OpenAI project. Hiện thông báo rõ khi hết hạn mức.
- Kiểm tra output AI theo schema, giới hạn số gợi ý và độ dài từng trường. Text từ OCR được xem là nội dung không tin cậy, không phải lệnh cho hệ thống.
- Gọi Responses API với `store: false`; không ghi prompt, bản dịch hoặc API key vào log ứng dụng.
- Có chức năng xuất và xóa dữ liệu. Sao lưu định kỳ vì Supabase Free không có backup tự động.

## 7. Thứ tự triển khai và điều kiện hoàn thành

### Mốc 1 — Khung web và đăng nhập

- Tạo Next.js, hệ thống giao diện responsive và các trang chính.
- Cấu hình Supabase Google OAuth, callback, danh sách 1–2 tài khoản được phép.
- Tạo migration, RLS và các biến môi trường.
- **Hoàn thành khi:** đúng tài khoản đăng nhập được; tài khoản khác không vào được dữ liệu hoặc route AI; giao diện dùng được ở màn hình điện thoại.

### Mốc 2 — Dịch text và ảnh

- Khung nhập kiểu chat, ba chiều dịch, dán text, chọn ảnh, OCR, sửa text OCR.
- API dịch text bằng OpenAI; bản dịch hiện trước nhánh từ vựng.
- Lưu bản dịch theo thao tác người dùng; sidebar hiện phiên đã lưu.
- **Hoàn thành khi:** dịch được text và chữ trong ảnh trên desktop/mobile; ảnh không xuất hiện ở request tới server hoặc trong database.

### Mốc 3 — Gợi ý và lưu từ

- AI trả về dữ liệu có cấu trúc: từ/cụm, nghĩa, ví dụ, collocation và liên hệ với câu nguồn.
- Chế độ duyệt trước khi lưu, tự lưu, sửa, bỏ qua, hoàn tác và chống trùng.
- **Hoàn thành khi:** cùng một đoạn text có thể tạo mục học hợp lý, người dùng chọn được từ nâng cao theo ý mình và không bị sinh gợi ý lặp vô hạn.

### Mốc 4 — Kho từ và dữ liệu

- Tìm kiếm, chỉnh sửa, xóa; sắp xếp mới nhất/cũ nhất; lọc ngày/tuần/tháng/thứ; xuất JSON/CSV và nhập lại JSON.
- Trang cài đặt cho chiều dịch mặc định và chế độ duyệt.
- **Hoàn thành khi:** tìm lại được mục học theo nguồn và thời gian; dữ liệu xuất ra có thể dùng để khôi phục.

### Mốc 5 — Đưa lên mạng

- Deploy Vercel, cấu hình môi trường production và OAuth redirect.
- Kiểm tra trên điện thoại thật, tài khoản thứ hai và tài khoản không được phép.
- Kiểm tra quota, lỗi mạng, chi phí API và quyền truy cập database.
- **Hoàn thành khi:** web chạy qua URL production, chỉ 1–2 tài khoản được sử dụng, dữ liệu hai tài khoản tách biệt.

## 8. Việc người sở hữu cần làm

1. Chọn 1–2 Google account được phép đăng nhập và thêm email vào `private.allowed_users` theo README.
2. Tạo tài khoản/project Supabase, Google Cloud OAuth, OpenAI API và Vercel/GitHub.
3. Nhập Google Client ID/Secret vào Supabase; nhập OpenAI API key và các biến Supabase vào môi trường server. Không gửi secret trong chat hoặc commit lên Git.
4. Đặt ngân sách cứng và cảnh báo chi phí cho OpenAI project.
5. Cung cấp một số ảnh và đoạn text thực tế để kiểm tra chất lượng OCR, bản dịch và gợi ý từ.
6. Xem và xác nhận URL production trước khi mở dùng thường xuyên.

## 9. Ngoài phạm vi phiên bản này

- Đăng ký công khai và thanh toán.
- Chia sẻ bộ từ giữa người dùng.
- Lưu ảnh hoặc đồng bộ ảnh.
- Game, chấm điểm và thuật toán ôn tập; chỉ chuẩn bị cấu trúc dữ liệu để bổ sung sau.
