# Kế hoạch: học từ đoạn nhập và Từ vựng hôm nay

## 1. Mục tiêu và quyết định sản phẩm

- Giữ màn hình chính hiện tại. Thêm nút **Học từ đoạn này** ngay trong ô nhập, cạnh thao tác **Dịch**. Người dùng nhập/dán text hoặc dùng OCR rồi chọn Học; app gợi ý từ mà không gọi API dịch.
- Đặt khối **Từ vựng hôm nay** ở phía trên nội dung màn hình chính. Khối này lấy ngẫu nhiên từ **Kho từ đã lưu**, không gọi AI khi tạo bộ học.
- Không tạo trang gợi ý riêng. Giữ luồng **Dịch → Gợi ý từ vựng** đang có.
- Gợi ý IELTS và CEFR là nhãn tham khảo cho việc học, không phải mức band chính thức hay cam kết từ sẽ xuất hiện trong đề thi.

## 2. Hiện trạng code cần dùng lại

| Phần | Hiện có | Thay đổi dự kiến |
| --- | --- | --- |
| `src/features/translation/chat-workspace.tsx` | Ô nhập, OCR, nút Dịch, thẻ gợi ý, lưu/hoàn tác | Thêm nút Học và bộ lọc; hiển thị kết quả học khi không có bản dịch; đặt khối Từ vựng hôm nay phía trên |
| `src/app/api/suggestions/route.ts` | Chỉ gợi ý từ đoạn đã dịch, tối đa 8 mục | Nhận cả yêu cầu học trực tiếp; tạo metadata CEFR/IELTS và lý do gợi ý |
| `src/lib/validation.ts` | Schema gợi ý và mục từ | Thêm schema cho chế độ học, bộ lọc và metadata; giữ tương thích dữ liệu cũ |
| `src/app/api/vocabulary/route.ts` | Đọc toàn bộ kho, thêm/sửa/xóa, chống trùng | Đọc/lưu metadata; bổ sung thao tác phân loại lại mục cũ |
| `src/features/vocabulary/library-view.tsx` | Tìm kiếm và lọc ngày/tuần/tháng/thứ | Hiện và chỉnh nhãn CEFR/IELTS; có bộ lọc "Chưa phân loại" |
| `src/app/api/import/route.ts`, `src/app/api/export/route.ts` | JSON version 1 và CSV | Xuất metadata và bộ học; vẫn nhập được JSON version 1 |
| `supabase/migrations/001_initial.sql` | `created_at` cho mục từ, RLS theo người dùng, `usage_events` | Thêm migration mới cho metadata và bộ từ theo ngày; không sửa migration đã chạy |

## 3. Luồng Học từ đoạn nhập

1. Người dùng nhập/dán text hoặc lấy text từ OCR. Hai nút **Dịch** và **Học từ đoạn này** cùng dùng text đó. Nhãn ô nhập đổi thành "Văn bản để dịch hoặc học".
2. Trước khi bấm Học, người dùng chọn:
   - Chế độ: **Thông thường**, **IELTS Academic**, **IELTS General Training**.
   - Trình độ hiện tại: A1–C2; chỉ gợi ý mục từ ở trình độ đã chọn hoặc cao hơn.
   - Với IELTS: kỹ năng ưu tiên (Speaking, Writing, Reading, Listening hoặc tất cả) và chủ đề tùy chọn.
   - Số mục gợi ý: 5, 8 hoặc 10; mặc định 8.
3. Client gọi `/api/suggestions` trực tiếp, không gọi `/api/translate`. Request phân biệt rõ `source: "study" | "translation"`; `translation` chỉ bắt buộc cho nguồn translation.
4. Với text tiếng Anh, API lấy từ/cụm từ trong text; với text tiếng Việt ở chiều `vi-en`, API gợi ý cách diễn đạt tiếng Anh tương ứng và ghi rõ đó là bản diễn đạt được đề xuất. Loại mục trùng và các mục đã lưu khi có thể. Mỗi mục có nghĩa, ví dụ, collocation, CEFR ước tính, mức hữu ích IELTS (`high`/`medium`/`low`/`unknown`), kỹ năng phù hợp và một lý do ngắn. AI không được tự báo một tỷ lệ xuất hiện trong đề thi.
5. Kết quả nằm trong khu vực thẻ gợi ý hiện có. Người dùng sửa, lưu từng mục hoặc bỏ qua. Ở luồng Học, luôn duyệt trước khi lưu vì đây là thao tác học chủ động; cài đặt tự lưu hiện tại chỉ áp dụng cho luồng sau dịch.
6. Nếu text không có mục phù hợp với bộ lọc, hiện thông báo rõ và gợi ý đổi trình độ/chủ đề; không tạo từ không có trong ngữ cảnh rồi trình bày như thể có trong text.

### Quy tắc gợi ý IELTS

- Dùng **mức hữu ích cho IELTS** thay cho nhãn "thường xuyên xuất hiện" khi chưa có dữ liệu tần suất đáng tin cậy.
- Ưu tiên nghĩa đúng ngữ cảnh, khả năng dùng trong chủ đề và kỹ năng đã chọn, collocation tự nhiên, khả năng diễn đạt lại. Từ hiếm hoặc nghe "cao cấp" không tự động được chấm cao.
- CEFR và mức hữu ích là ước tính; UI cho phép người dùng chỉnh nhãn trước/sau khi lưu.
- Các mục từ tiếng Việt trong kho không được tính là từ tiếng Anh phù hợp IELTS.

## 4. Luồng Từ vựng hôm nay

1. Khối nằm trên cùng phần nội dung màn hình chính, trên đoạn chào/đoạn dịch. Mặc định mở bộ của ngày hiện tại theo múi giờ `Asia/Ho_Chi_Minh`.
2. Bộ lọc trước khi tạo:
   - Ngày học cần tạo/xem (mặc định hôm nay) và số lượng mục từ.
   - Thời điểm đã nhập từ: mọi ngày, **một ngày cụ thể**, hoặc **thứ trong tuần**. Thứ được tính từ `vocabulary_items.created_at` theo giờ Việt Nam, giống bộ lọc hiện có ở Kho từ.
   - CEFR: một mức hoặc khoảng A1–C2; có lựa chọn riêng **Chưa phân loại**.
   - IELTS: tất cả, hữu ích cao/vừa, ít phù hợp, chưa phân loại; có thể chọn kỹ năng khi lọc IELTS.
   - Loại mục: từ, cụm từ, hoặc cả hai; mặc định cả hai. Mặc định chỉ lấy mục tiếng Anh.
3. Sau khi bấm **Tạo bộ học**, server lọc kho từ của đúng người dùng rồi random không lặp. Nếu đã chọn CEFR/IELTS cụ thể, mục **Chưa phân loại** không lọt vào kết quả. Nếu thiếu mục đủ điều kiện, trả đúng số tìm được và báo `Tìm thấy 6/10 từ` thay vì lấy ngoài bộ lọc.
4. Lưu ngày học, bộ lọc đã dùng, số lượng yêu cầu, thứ tự item và trạng thái đã học. Tải lại trang hoặc đăng nhập lại vẫn thấy cùng bộ. Đổi bộ lọc chỉ là chỉnh bản nháp; bộ đã lưu chỉ thay đổi khi người dùng bấm **Tạo lại bộ**.
5. Có nút đánh dấu đã học/chưa học, tiến độ `x/y`, nút tạo lại và xem bộ theo ngày. Nếu một mục bị xóa khỏi Kho từ, bộ học bỏ mục đó và báo số lượng hiện còn.
6. Tạo bộ học không tiêu tốn lượt OpenAI. Chỉ thao tác **phân loại bằng AI** cho mục cũ, nếu người dùng chủ động chọn, mới tiêu tốn lượt gợi ý.

## 5. Dữ liệu và API

### Migration Supabase mới

- Thêm cột nullable vào `vocabulary_items`: `cefr_level`, `ielts_relevance`, `ielts_skills`, `learning_reason`. Dữ liệu cũ để `NULL`/rỗng và hiện là **Chưa phân loại**; không gán nhãn đoán mò.
- Thêm `daily_word_sets`: `id`, `user_id`, `study_date` (`date`), `filters` (`jsonb`), `requested_count`, `created_at`, `updated_at`; unique `(user_id, study_date)`.
- Thêm `daily_word_set_items`: `set_id`, `vocabulary_item_id`, `position`, `studied_at`; unique theo set/item. Foreign key mục từ `ON DELETE CASCADE`.
- Bật RLS và policy theo `auth.uid()` cùng điều kiện tài khoản Google được phép, tương tự các bảng hiện tại. Nếu thao tác tạo/thay bộ chạy qua Postgres function, thu hồi quyền ghi trực tiếp thích hợp để client không thể bỏ qua kiểm tra filter và transaction.
- Tạo bộ mới/thay bộ nên chạy trong một transaction hoặc Postgres function để không có bộ dở dang khi request lỗi hoặc hai request đồng thời.

### API

- Mở rộng `POST /api/suggestions` với schema discriminated union: nguồn `study` không cần `translation`; nguồn `translation` giữ request cũ tương thích trong giai đoạn chuyển đổi. Cả hai dùng hạn mức `suggestion` hiện tại và trả usage/ước tính chi phí.
- Thêm `GET /api/daily-words?date=YYYY-MM-DD`: tải bộ đã lưu cùng tiến độ và filter snapshot.
- Thêm `POST /api/daily-words`: validate ngày, số lượng và filter; tạo hoặc thay bộ theo yêu cầu. `PATCH /api/daily-words`: cập nhật trạng thái đã học cho item thuộc bộ và user hiện tại.
- Thêm thao tác phân loại mục cũ có giới hạn batch, chỉ cập nhật metadata của mục do người dùng sở hữu. Có trạng thái tiến độ và không tự phân loại toàn bộ khi mở trang.
- Cập nhật xuất JSON sang version 2, nhập được version 1 và 2; xuất CSV thêm các cột nhãn. Các bộ học theo ngày có thể được xuất/nhập cùng JSON version 2 nếu cần khôi phục đầy đủ tiến độ.

## 6. Thứ tự triển khai

1. Đọc hướng dẫn Next.js 16.3.6 liên quan trong `node_modules/next/dist/docs/` theo `AGENTS.md` trước khi sửa code.
2. Migration, schema Zod và hợp đồng API; bảo đảm RLS, timezone và JSON cũ.
3. Chỉnh `/api/suggestions` và logic lưu mục từ; nối nút Học vào `ChatWorkspace`.
4. Làm API bộ từ theo ngày và khối giao diện ở đầu màn hình chính.
5. Bổ sung hiển thị/chỉnh/sửa nhãn trong Kho từ, phân loại mục cũ, xuất/nhập dữ liệu.
6. Cập nhật README, kiểm tra lint/type/build và thử các luồng chính trên desktop/điện thoại.

## 7. Điều kiện hoàn thành

- Nhập text rồi bấm Học tạo gợi ý mà số lượt dịch không tăng; lượt gợi ý tăng đúng một lần.
- Bộ lọc trình độ và IELTS ảnh hưởng kết quả; mỗi thẻ cho biết vì sao được gợi ý. Lưu mục giữ lại metadata.
- Bộ từ hôm nay chỉ chứa mục thỏa **tất cả** filter, không lặp; tải lại vẫn giữ thứ tự và tiến độ.
- Lọc "nhập vào thứ mấy" đúng theo giờ Việt Nam kể cả khi UTC đổi ngày; ngày học cũng dùng giờ Việt Nam.
- Mục cũ chưa phân loại không biến mất: có thể tìm/lọc riêng và phân loại khi cần.
- Không thấy dữ liệu của tài khoản khác; JSON version 1 vẫn nhập được.

## 8. Quyết định mặc định nếu chưa có cấu hình cá nhân

- Chế độ Học: Thông thường; CEFR B1 trở lên, 8 gợi ý. Đây chỉ là giá trị khởi đầu và người dùng có thể đổi ngay tại ô nhập.
- Từ vựng hôm nay: 10 mục tiếng Anh, mọi ngày nhập, mọi trình độ, mọi mức IELTS, từ và cụm từ. Không tạo bộ tự động khi mở trang; người dùng bấm **Tạo bộ học** để chọn bộ đầu tiên.
