# AGENTS.md — Quy tắc Kỹ thuật, Nghiệp vụ & UI/UX cho Dự án LMSPLUS (LMS E-Learning)

> Tài liệu hướng dẫn hợp nhất dành cho AI Agent, coding assistant và thành viên kỹ thuật khi đọc, phân tích, thiết kế, sửa đổi hoặc phát triển dự án **LMSPLUS (LMS E-Learning)**.
>
> - **Nguyên tắc ưu tiên:** Đọc mã nguồn và cấu trúc hiện tại trước khi kết luận. Không tự giả định kiến trúc, không tạo hệ thống song song và không phá vỡ chức năng đang hoạt động.
> - **Active Design Standard:** `UI/UX Pro Max` + `Impeccable` + `Airbnb DLS` + `Multi-Theme Token System`

---

## 1. Mục tiêu và phạm vi

LMSPLUS là hệ thống quản lý học tập (LMS). Agent có thể được yêu cầu thực hiện các công việc liên quan đến:

- Quản lý người dùng, vai trò, quyền và phạm vi dữ liệu.
- Quản lý môn học, khóa học, lớp học và hoạt động giảng dạy.
- Quản lý nội dung học tập, chương, bài học và tài nguyên.
- Ngân hàng câu hỏi, bài tập, đề thi, tổ chức thi và chấm điểm.
- Điểm danh, lịch học, kết quả học tập và báo cáo.
- Tích hợp các tính năng E-learning và trải nghiệm học tập trực tuyến.
- Tối ưu giao diện, hiệu năng, bảo mật, khả năng bảo trì và vận hành.

Không mặc định rằng tất cả các module trên đã tồn tại hoặc đã hoàn thiện. Phải kiểm tra mã nguồn, cơ sở dữ liệu, API và tài liệu thực tế trước khi triển khai.

---

## 2. Thư mục làm việc

- Thư mục dự án và workspace: `D:\LMS elearning`.
- Luôn bắt đầu bằng việc kiểm tra nội dung thư mục này và xác định chính xác repository root.
- Tự nhận diện các thư mục frontend, backend, migrations, tests, scripts, deployment và docs.
- Không sử dụng hoặc tham chiếu đường dẫn workspace cũ.
- Không tự ý di chuyển, đổi tên hoặc tái cấu trúc thư mục gốc.

Nếu môi trường Agent không truy cập được đường dẫn Windows nói trên, hãy yêu cầu người dùng mở đúng workspace hoặc cung cấp đường dẫn thực tế của môi trường hiện tại. Không được giả vờ đã đọc mã nguồn.

---

## 3. Quy trình bắt buộc trước khi sửa code

### 3.1. Khảo sát hệ thống

Trước khi thay đổi bất kỳ thành phần nào:

1. Xác định repository root và cấu trúc thư mục.
2. Đọc README, hướng dẫn chạy dự án, file cấu hình và tài liệu kỹ thuật liên quan.
3. Xác định framework, phiên bản runtime, package manager và lệnh build/test.
4. Xác định cách frontend gọi backend, cơ chế xác thực và xử lý lỗi.
5. Xác định schema database, migration hiện có, quan hệ khóa ngoại và quy ước đặt tên.
6. Tìm module, component, API, service và bảng dữ liệu có chức năng tương tự yêu cầu.
7. Kiểm tra RBAC, Data Scope, audit log và các quy tắc nghiệp vụ đang áp dụng.
8. Kiểm tra trạng thái Git, nhánh hiện tại và các thay đổi chưa commit.

### 3.2. Quy trình bắt buộc khi làm việc với Frontend / UI/UX (UI/UX Pro Max Workflow)

Khi tạo mới, chỉnh sửa hoặc đánh giá bất kỳ giao diện (Frontend/UI/UX) nào trong dự án, **BẮT BUỘC** thực hiện thêm các bước sau:

1. **Đọc Design Blueprint:**
   - Luôn đọc [`design-system/lms-elearning/MASTER.md`](./design-system/lms-elearning/MASTER.md) để nắm bộ token, lưới không gian và quy tắc component.
   - Nếu đang làm việc trên một trang cụ thể, kiểm tra file ghi đè trong `design-system/lms-elearning/pages/<page-name>.md`.
2. **Kích hoạt Skill Chuyên biệt:**
   - Khi thực hiện thiết kế mới, tối ưu giao diện hoặc chạy các lệnh `/impeccable` (`critique`, `audit`, `polish`, `typeset`, `colorize`, `animate`, `distill`, `bolder`, `quieter`), hãy đọc và làm theo hướng dẫn trong [`.agents/skills/ui-ux-standard/SKILL.md`](./.agents/skills/ui-ux-standard/SKILL.md).
3. **Sử dụng Theme Tokens:**
   - Tuyệt đối không hardcode mã màu Hex rải rác trong component. Luôn dùng biến CSS từ [`theme/tokens.css`](./theme/tokens.css) hoặc class cấu hình trong [`theme/tailwind.preset.js`](./theme/tailwind.preset.js).

### 3.3. Lập kế hoạch thay đổi

Trước khi triển khai một yêu cầu có phạm vi vừa hoặc lớn, hãy trình bày ngắn gọn:

- Hiện trạng tìm thấy trong source.
- Những thành phần có thể tái sử dụng.
- Các file/module dự kiến thay đổi.
- Thay đổi database/API/UI/quyền (nếu có).
- Rủi ro tương thích và cách kiểm thử.
- Những điểm chưa đủ thông tin cần xác nhận.

Với yêu cầu nhỏ, có thể triển khai trực tiếp sau khi đã kiểm tra đúng vị trí và phạm vi ảnh hưởng.

### 3.4. Triển khai và xác minh

- Thực hiện thay đổi theo từng phần nhỏ, có thể kiểm tra độc lập.
- Chạy các kiểm tra phù hợp: lint, typecheck, unit test, integration test, UI/UX audit, build hoặc migration validation.
- Đọc kết quả thực tế; không tuyên bố thành công nếu chưa chạy hoặc chưa xác minh.
- Kiểm tra các luồng cũ có nguy cơ bị ảnh hưởng.
- Tổng kết file đã sửa, hành vi thay đổi, lệnh kiểm thử và kết quả.

---

## 4. Nguyên tắc kiến trúc

### 4.1. Ưu tiên kiến trúc hiện có

Không tự ý thay framework, ngôn ngữ, database, ORM, kiến trúc triển khai hoặc quy ước dự án.

Thông tin kỹ thuật đã được ghi nhận từ quá trình làm việc trước đây có thể bao gồm:

- Frontend React, TypeScript và Vite.
- Backend Python và API bất đồng bộ (cùng các module Node/ESM phục vụ runtime tương ứng của dự án).
- PostgreSQL, Redis, JWT và Docker.

Đây là thông tin định hướng ban đầu, **không phải bằng chứng về trạng thái hiện tại**. Phải xác minh trực tiếp trong source và file cấu hình trước khi sử dụng.

### 4.2. Không tạo hệ thống trùng lặp

- Tái sử dụng module, bảng dữ liệu, API, service và component đang có nếu phù hợp.
- Không tạo bảng người dùng, vai trò, quyền, môn học, lớp học, khóa học, bài tập, bài thi hoặc điểm danh thứ hai khi hệ thống đã có chức năng tương ứng.
- Không tạo API mới nếu API hiện tại có thể mở rộng an toàn.
- Không xây dựng một LMS độc lập bên cạnh LMSPLUS.
- Nếu cần thay đổi mô hình hiện tại, phải giải thích lý do và phương án tương thích.

### 4.3. Phân tách trách nhiệm

- UI component tập trung vào hiển thị và tương tác.
- Business logic đặt trong lớp service hoặc cấu trúc tương đương đang được dự án sử dụng.
- API/controller xử lý giao tiếp, xác thực đầu vào và trả kết quả theo chuẩn hiện tại.
- Database access tuân theo cách truy cập dữ liệu hiện có.
- Không đưa quy tắc nghiệp vụ quan trọng chỉ vào frontend.
- Không nhân bản cùng một quy tắc nghiệp vụ ở nhiều nơi nếu có thể dùng chung.

---

## 5. Quy tắc database và migration

1. Đọc schema hiện tại trước khi đề xuất bảng hoặc cột mới.
2. Tôn trọng kiểu dữ liệu, naming convention, quan hệ và quy tắc soft-delete hiện có.
3. Mọi thay đổi schema phải có migration theo công cụ hiện tại của dự án.
4. Migration phải có thứ tự rõ ràng, có thể kiểm tra và không phá hủy dữ liệu ngoài phạm vi yêu cầu.
5. Không tự ý xóa bảng, cột, index hoặc dữ liệu đang sử dụng.
6. Tránh migration gây khóa bảng lớn hoặc gián đoạn hệ thống khi không cần thiết.
7. Tạo index dựa trên truy vấn thực tế và kế hoạch truy vấn; không thêm index tùy tiện.
8. Có khóa ngoại, unique constraint, check constraint phù hợp với nghiệp vụ.
9. Xem xét transaction cho các thao tác cập nhật nhiều bản ghi có liên quan.
10. Không chạy migration trên production nếu chưa được người dùng cho phép và chưa có phương án backup/rollback.

Trước migration quan trọng, cần nêu rõ:
- Schema trước và sau.
- Dữ liệu hiện có bị ảnh hưởng như thế nào.
- Cách backup.
- Cách triển khai.
- Cách rollback hoặc khôi phục.

---

## 6. Quy tắc API và tích hợp

- Tuân thủ cấu trúc route, response, error handling và naming convention hiện tại.
- Xác thực dữ liệu ở backend, không tin dữ liệu do frontend gửi lên.
- Kiểm tra quyền trên từng thao tác và từng đối tượng dữ liệu.
- Phân trang, lọc, sắp xếp ở backend đối với danh sách lớn.
- Tránh N+1 query và truy vấn không có giới hạn.
- Có timeout, retry có kiểm soát và xử lý lỗi cho tích hợp bên ngoài.
- Không trả stack trace, secret, token hoặc thông tin nội bộ cho client.
- Không để lộ dữ liệu của lớp, khoa, đơn vị hoặc người dùng khác do thiếu kiểm tra scope.
- Không thay đổi contract API đang được frontend hoặc hệ thống khác sử dụng mà không đánh giá tương thích.

---

## 7. Quy tắc xác thực, RBAC và Data Scope

Đây là yêu cầu bắt buộc đối với mọi tính năng có dữ liệu người dùng hoặc dữ liệu học tập.

- Tái sử dụng hệ thống đăng nhập, JWT, người dùng, vai trò và quyền hiện có.
- Không tạo cơ chế đăng nhập hoặc phân quyền song song.
- Kiểm tra quyền ở backend; ẩn nút trên UI không được xem là biện pháp bảo mật.
- Phân biệt quyền thực hiện hành động và phạm vi dữ liệu được phép truy cập.
- Kiểm tra quyền ở cả thao tác đọc, tạo, sửa, xóa, duyệt, xuất dữ liệu và xem chi tiết.
- Với giảng viên, chỉ cho phép truy cập lớp học, khóa học, học viên và kết quả thuộc phạm vi được cấp.
- Với học viên, chỉ cho phép truy cập dữ liệu học tập được gán hoặc được phép tham gia.
- Quyền quản trị phải tuân theo cơ chế cấp quyền hiện có, không mặc định mọi tài khoản quản trị đều có toàn quyền.
- Ghi audit log cho các thao tác nhạy cảm theo chuẩn hiện tại.

---

## 8. Quy tắc nghiệp vụ E-learning

Khi phát triển hoặc sửa các chức năng E-learning, áp dụng các nguyên tắc sau nếu yêu cầu không chỉ rõ khác đi.

### 8.1. Phân biệt khóa học và lớp học

- **Khóa học (Course):** cấu trúc chương trình và nội dung học tập có thể tái sử dụng.
- **Lớp học (Class):** nhóm học viên thực tế, có giảng viên, danh sách học viên, lịch học và các buổi học.
- Không mặc định khóa học và lớp học là một đối tượng.
- Một khóa học có thể được sử dụng cho nhiều lớp nếu kiến trúc và quy tắc hiện tại hỗ trợ.
- Không tạo quan hệ một-một cứng nhắc nếu nghiệp vụ cần hỗ trợ tái sử dụng khóa học.

### 8.2. Chế độ tham gia khóa học

Duy trì ba chế độ nghiệp vụ đã thống nhất:

- `ASSIGNED_ONLY`: mặc định cho chương trình/môn học chính thức; học viên chỉ tham gia khi được đơn vị có thẩm quyền phân công.
- `REQUEST_APPROVAL`: dành cho khóa học tự chọn hoặc kỹ năng; học viên gửi yêu cầu và người có thẩm quyền phê duyệt hoặc từ chối.
- `SELF_ENROLL`: chỉ bật khi quản trị viên chủ động cho phép đối với khóa học cụ thể; không dùng làm mặc định.

Mọi chế độ phải tuân thủ phân quyền, phạm vi dữ liệu và quy tắc lớp học hiện có. Không để việc tự đăng ký vượt qua điều kiện ghi danh hoặc điều kiện dự thi.

### 8.3. Nội dung bài học

- Tổ chức nội dung theo cấu trúc khóa học → chương → bài học, nếu phù hợp với mô hình hiện tại.
- Ưu tiên cấu trúc nội dung có schema rõ ràng, có versioning khi cần.
- Nội dung có thể gồm văn bản, hình ảnh, tài liệu, video, liên kết, công thức, mã nguồn, câu hỏi hoặc bài tập.
- Không lưu nội dung tùy ý mà không có kiểm tra schema và kiểm soát quyền.
- Có trạng thái bản nháp/xuất bản nếu quy trình biên soạn yêu cầu.
- Không đánh dấu hoàn thành bài học chỉ dựa trên việc mở trang nếu nghiệp vụ yêu cầu điều kiện khác.

### 8.4. Nhúng video YouTube

Khi hỗ trợ YouTube trong nội dung bài học:

- Chỉ chấp nhận URL từ các domain YouTube được cho phép.
- Hỗ trợ các dạng URL phổ biến như `youtube.com/watch`, `youtu.be`, `youtube.com/shorts` và URL embed hợp lệ.
- Phân tích Video ID và tạo embed URL từ ID đã xác thực; không nhúng trực tiếp URL tùy ý.
- Hiển thị responsive, ưu tiên tỷ lệ 16:9 đối với video thông thường.
- Xử lý trường hợp video bị xóa, đặt riêng tư, giới hạn khu vực hoặc tắt tính năng nhúng.
- Không tải xuống hoặc sao chép video từ YouTube.
- Không khẳng định mọi video đều có thể nhúng thành công.

### 8.5. Điểm danh

Ưu tiên quy trình điểm danh nhanh, rõ ràng và có thể kiểm tra:

- Điểm danh theo buổi học cụ thể.
- Có danh sách học viên thuộc lớp/buổi học.
- Hỗ trợ trạng thái: `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, `NOT_MARKED` hoặc mapping tương ứng với enum hiện có.
- Hỗ trợ đánh dấu hàng loạt và chỉnh sửa từng học viên.
- Có ghi chú khi cần.
- Hỗ trợ lưu hàng loạt và cảnh báo dữ liệu chưa lưu.
- Ngăn tạo bản ghi điểm danh trùng cho cùng học viên và buổi học.
- Có lịch sử thay đổi và người thực hiện đối với thao tác quan trọng.
- Thống kê chuyên cần phải tính theo quy tắc nghiệp vụ đã xác định.
- Chỉ triển khai QR động khi được yêu cầu; QR phải có thời hạn, gắn với buổi học và có xác thực. Không dùng QR tĩnh như một cơ chế bảo mật.

### 8.6. Nhật ký giảng dạy

Quy tắc đã thống nhất:

- Giảng viên có 24 giờ kể từ thời điểm kết thúc buổi học để xác nhận nhật ký giảng dạy.
- Sau thời hạn này, trạng thái chuyển thành `OVERDUE_UNCONFIRMED` hoặc trạng thái tương đương theo enum hiện có.
- Quá hạn không đồng nghĩa với khóa quyền xác nhận; giảng viên vẫn có thể xác nhận muộn.
- Lưu thời điểm kết thúc thực tế, thời điểm xác nhận và lịch sử trạng thái.
- Bộ phận đào tạo/quản trị được phép theo dõi và nhắc việc theo phân quyền.

---

## 9. Quy tắc UI/UX & Chuẩn Thiết kế (UI/UX Pro Max × Impeccable × Airbnb DLS)

### 9.1. Nguyên tắc UX và luồng thao tác chung

- Ưu tiên giao diện nhất quán với design system và component hiện tại.
- Không tạo một hệ thống design mới nếu dự án đã có design system.
- Thiết kế responsive cho desktop, tablet và mobile.
- Ưu tiên luồng công việc thực tế, giảm số lần nhấp và tránh biểu mẫu quá dài.
- Danh sách lớn cần tìm kiếm, lọc, phân trang và trạng thái rỗng rõ ràng.
- Có loading, error, empty, success và disabled state phù hợp.
- Có xác nhận trước thao tác phá hủy hoặc ảnh hưởng diện rộng.
- Có cảnh báo khi người dùng rời trang nếu còn dữ liệu chưa lưu.
- Giữ khả năng truy cập: nhãn input rõ ràng, điều hướng bàn phím và tương phản phù hợp.
- Không dùng dữ liệu giả để thay thế API thật trong tính năng được yêu cầu hoàn thiện.
- Không hiển thị nút hoặc chức năng chưa hoạt động như thể đã hoàn thiện.
- Không để lộ mã key nội bộ, enum kỹ thuật thô hoặc mã đặc tả nội bộ ra giao diện người dùng cuối.

### 9.2. Trải nghiệm giảng viên

Khi tối ưu nghiệp vụ giảng viên, ưu tiên:
- Dashboard thể hiện lớp sắp diễn ra, công việc cần xử lý và thông báo quan trọng.
- Truy cập nhanh khóa học, lớp học, nội dung, điểm danh và kết quả.
- Tách rõ quản lý nội dung khóa học với vận hành lớp học.
- Điểm danh trên một màn hình, hạn chế chuyển trang và thao tác lặp.
- Hiển thị trạng thái lưu và kết quả thao tác rõ ràng.

### 9.3. Luật Cấm "AI Slop" Tuyệt đối (Impeccable Deterministic Rules)

Không bao giờ sinh ra các mẫu giao diện "công nghiệp AI" sau đây:

- **CẤM `purple-gradient` / `neon-slop`:** Không dùng nền hoặc nút bấm gradient tím-xanh-hồng (`from-indigo-500 via-purple-500 to-pink-500`).
- **CẤM `gradient-text`:** Không dùng `background-clip: text` với màu chữ chuyển sắc cho tiêu đề. Dùng màu mực chuẩn `var(--text-primary)` (`#222222` ở Light mode, `#F5F5F7` ở Dark mode).
- **CẤM `overused-font`:** Không để mặc định `Arial`, `Roboto` hoặc `Inter` chưa tinh chỉnh. Sử dụng bộ font quy chuẩn: **`Plus Jakarta Sans`** (UI & Headings), **`Source Serif 4`** (Long-form Reading), và **`JetBrains Mono`** (Code, Duration & Tabular Numbers).
- **CẤM `side-tab`:** Không dùng `border-left: 4px solid` cho hộp thông báo/ghi chú. Dùng card bo góc `12px` (`var(--radius-md)`), nền ngữ nghĩa dịu nhẹ và viền `1px solid var(--border-subtle)`.
- **CẤM `dark-glow`:** Trong chế độ tối (`[data-theme="cinema-dark"]`), không dùng đổ bóng phát sáng neon (`0 0 20px rgba(...)`). Phân tách lớp bề mặt bằng độ sáng nền (`--bg-canvas` `#121214` → `--bg-surface` `#1A1A1E` → `--bg-surface-subtle` `#222228`) và viền `1px solid rgba(255,255,255,0.08)`.
- **CẤM `cards-in-cards` & `heavy-chrome`:** Theo tinh thần **Airbnb DLS**, thẻ khóa học (Course Card) trên lưới khám phá không có khung viền hay bóng đổ bao quanh toàn thẻ; chính ảnh bìa bo góc `16px` (`var(--radius-lg)`) định hình thẻ, bên dưới là chữ phân cấp tinh gọn.
- **CẤM `bounce-easing`:** Không dùng hiệu ứng nảy đàn hồi lò xo quá mức. Chỉ dùng đường cong chuẩn `cubic-bezier(0.2, 0, 0, 1)` (`150ms–300ms`).

### 9.4. Các Chỉ số Kỹ thuật UI Bắt buộc (Hard Metrics)

- **Lưới không gian (Spatial Grid):** Mọi khoảng cách (`padding`, `margin`, `gap`) phải chia hết cho `4px` (`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80px`).
- **Độ tương phản (WCAG AA):** Tỷ lệ tương phản chữ thường `>= 4.5:1`, chữ lớn `>= 3:1`. Không đặt chữ xám (`#717171`) lên nền màu hoặc trực tiếp lên ảnh nếu không có lớp phủ tối (`scrim`).
- **Vùng chạm (Touch Target):** Mọi phần tử tương tác (nút bấm, icon wishlist, tab danh mục, câu trả lời quiz) phải có kích thước tối thiểu **`44x44px`**.
- **Độ dài dòng đọc (Measure):** Nội dung bài đọc, mô tả khóa học và phụ đề bài giảng phải giới hạn `max-width: 65ch–75ch` (tối đa `80ch`).
- **Định dạng số (Tabular Numerals):** Bắt buộc gắn `font-variant-numeric: tabular-nums` cho giá tiền, đánh giá (`★ 4.95`), thời lượng (`14:20`), và phần trăm tiến độ (`85%`).
- **Chống nhảy bố cục (Zero CLS):** Mọi ảnh bìa khóa học và khung video phải khai báo `aspect-ratio` rõ ràng (`16 / 9`, `16 / 10`, hoặc `4 / 3`).

---

## 10. Quy tắc frontend

- Dùng TypeScript đúng kiểu; tránh `any` nếu có thể xác định kiểu.
- Tái sử dụng component, hook, API client và form pattern hiện có.
- Không gọi API trực tiếp rải rác nếu dự án đã có service/API layer.
- Xử lý loading, lỗi, retry và trạng thái rỗng.
- Không lưu secret trong frontend.
- Không dựa vào dữ liệu frontend để quyết định quyền.
- Tránh render lại không cần thiết và tải dữ liệu lặp.
- Làm rõ kiểu dữ liệu giữa frontend và backend.
- Không tự ý thay đổi package hoặc nâng phiên bản dependency lớn nếu không cần thiết.

---

## 11. Quy tắc hiệu năng

- Đo hoặc xác định nguyên nhân trước khi tối ưu.
- Dùng pagination/filter phía server cho dữ liệu lớn.
- Tối ưu truy vấn và index dựa trên workload thực tế.
- Tránh tải toàn bộ danh sách học viên, câu hỏi hoặc bài làm vào một lần.
- Dùng cache có chiến lược invalidation rõ ràng.
- Không cache dữ liệu nhạy cảm hoặc dữ liệu phân quyền theo cách có thể làm rò rỉ giữa người dùng.
- Xem xét background job cho tác vụ nặng, nhưng phải tái sử dụng hạ tầng hiện có nếu phù hợp.
- Không triển khai tác vụ nền hoặc WebSocket mới chỉ vì tiện lợi nếu chưa chứng minh cần thiết.

---

## 12. Quy tắc bảo mật

- Không commit `.env`, API key, mật khẩu, private key, token hoặc thông tin xác thực.
- Không ghi secret hoặc dữ liệu cá nhân nhạy cảm vào log.
- Kiểm tra input và output ở ranh giới hệ thống.
- Chống SQL injection bằng parameterized query hoặc cơ chế tương đương.
- Chống XSS khi hiển thị nội dung do người dùng nhập.
- Kiểm tra quyền truy cập tài nguyên theo từng đối tượng.
- Giới hạn upload theo loại file, dung lượng và quyền.
- Không render HTML/iframe tùy ý từ nội dung người dùng.
- Không dùng `dangerouslySetInnerHTML` hoặc cơ chế tương đương nếu chưa sanitize đúng cách.
- Không trả thông tin nội bộ trong lỗi production.
- Không tắt kiểm tra bảo mật để làm cho tính năng chạy được.

---

## 13. Quy tắc Git và thay đổi file

- Kiểm tra `git status` trước khi sửa.
- Không ghi đè hoặc xóa thay đổi chưa commit của người dùng.
- Không reset, rebase, force push, xóa branch hoặc commit thay người dùng nếu chưa được yêu cầu rõ ràng.
- Không sửa file sinh tự động nếu phải sửa file nguồn tương ứng.
- Giữ diff tập trung vào yêu cầu.
- Không format hoặc refactor hàng loạt file không liên quan.
- Không tự ý đổi tên public API, route hoặc database column đang được sử dụng.
- Nếu phát hiện thay đổi có sẵn của người dùng, phải bảo toàn.

---

## 14. Quy tắc kiểm thử & Kiểm định tự động trước khi bàn giao

Chọn test theo phạm vi thay đổi và không tuyên bố test pass nếu chưa chạy test hoặc chưa có bằng chứng:

### 14.1. Frontend
- Typecheck.
- Lint.
- Unit/component test nếu dự án có.
- Build production.
- Kiểm tra loading, error, empty và success state.
- Kiểm tra quyền hiển thị và các luồng thao tác chính.

### 14.2. Kiểm định UI/UX tự động bắt buộc (Pre-Delivery Verification)
Sau khi viết hoặc cập nhật code giao diện, **BẮT BUỘC** chạy script kiểm định Impeccable + UI/UX Pro Max:

```powershell
node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs <duong-dan-file-hoac-thu-muc>
```

Nếu phát hiện bất kỳ lỗi **P0 (Critical)** hoặc **P1 (High)** nào, phải sửa triệt để trước khi báo cáo hoàn thành cho người dùng.

### 14.3. Backend
- Unit test cho business logic.
- API test cho success/error/validation.
- Kiểm tra authentication, RBAC và Data Scope.
- Kiểm tra transaction, dữ liệu trùng và tình huống đồng thời nếu có.
- Kiểm tra tương thích với API/client hiện tại.

### 14.4. Database
- Kiểm tra migration trên môi trường an toàn (kèm script xác minh hệ thống & SQL như `node .agents/skills/ui-ux-standard/scripts/verify_system_and_sql.mjs` nếu có thay đổi migration).
- Kiểm tra constraint, index và rollback.
- Kiểm tra dữ liệu cũ sau migration.
- Không thử nghiệm phá hủy trên production.

### 14.5. Nghiệp vụ E-learning
Tùy tính năng, tối thiểu cần kiểm tra:
- Giảng viên không thể truy cập lớp ngoài phạm vi.
- Học viên không thể tự tham gia khóa học `ASSIGNED_ONLY`.
- Yêu cầu tham gia `REQUEST_APPROVAL` phải qua phê duyệt.
- `SELF_ENROLL` chỉ hoạt động khi được bật.
- Video URL không thuộc domain cho phép bị từ chối.
- Không thể điểm danh học viên không thuộc lớp/buổi học.
- Không thể tạo điểm danh trùng.
- Nhật ký giảng dạy vẫn cho phép xác nhận muộn theo quy tắc 24 giờ.

---

## 15. Các hành động không được tự ý thực hiện

Nếu chưa có yêu cầu/ủy quyền rõ ràng, Agent không được:

- Xóa dữ liệu hoặc bảng database.
- Chạy migration phá hủy hoặc migration trên production.
- Import dữ liệu hàng loạt vào môi trường thật.
- Thay đổi tài khoản, quyền quản trị hoặc cấu hình bảo mật production.
- Xóa file, thư mục hoặc tài liệu do người dùng tạo.
- Thay đổi cấu hình domain, DNS, reverse proxy, firewall hoặc SSL.
- Restart hoặc deploy dịch vụ production.
- Thay đổi secret, credential hoặc biến môi trường production.
- Commit, push, merge hoặc phát hành phiên bản.
- Thực hiện thao tác không thể hoàn tác mà chưa thông báo rủi ro.

---

## 16. Cách xử lý khi thiếu thông tin

- Không bịa tên bảng, tên cột, endpoint, component, service hoặc enum.
- Không suy diễn rằng một tính năng đã tồn tại chỉ vì tài liệu mô tả mong muốn.
- Tìm bằng chứng trong source, migration, API và test.
- Nếu chưa xác minh được, ghi rõ `Chưa xác minh`.
- Nếu có nhiều phương án, nêu ưu/nhược điểm và chọn phương án ít rủi ro nhất.
- Chỉ hỏi người dùng khi thông tin thiếu làm thay đổi đáng kể thiết kế hoặc có nguy cơ gây tác động không mong muốn.
- Không hỏi lại thông tin đã được xác định trong tài liệu này nếu không có mâu thuẫn mới.

---

## 17. Chuẩn đầu ra khi hoàn thành công việc

Mỗi nhiệm vụ nên kết thúc bằng báo cáo ngắn gọn theo cấu trúc:

### 1. Đã thực hiện
- Mô tả chức năng hoặc lỗi đã xử lý.
- Nêu hành vi trước và sau nếu cần.

### 2. File đã thay đổi
- Liệt kê đường dẫn tương đối và mục đích thay đổi.

### 3. Database/API
- Nêu migration, bảng, cột, index, endpoint hoặc contract đã thay đổi.
- Ghi rõ nếu không có thay đổi.

### 4. Kiểm thử
- Liệt kê lệnh đã chạy.
- Nêu kết quả thực tế.
- Ghi rõ phần chưa kiểm thử và lý do.

### 5. Rủi ro và việc còn lại
- Nêu vấn đề còn tồn tại, giả định hoặc bước cần người dùng phê duyệt.

Không viết báo cáo chung chung như “đã hoàn thành tất cả” khi chưa xác minh.

---

## 18. Thứ tự ưu tiên khi có xung đột

Khi các yêu cầu mâu thuẫn, áp dụng thứ tự sau:

1. An toàn dữ liệu, bảo mật và quyền truy cập.
2. Yêu cầu trực tiếp mới nhất của người dùng.
3. Quy tắc nghiệp vụ đã được người dùng xác nhận.
4. Kiến trúc, schema và quy ước thực tế của source hiện tại.
5. Tài liệu thiết kế và đề xuất trước đây (`design-system/lms-elearning/MASTER.md`, `docs/elearning/...`).
6. Suy luận hoặc thông lệ chung của Agent.

Nếu yêu cầu mới mâu thuẫn với quyết định nghiệp vụ đã thống nhất, hãy chỉ ra mâu thuẫn trước khi thực hiện thay đổi có ảnh hưởng lớn.

---

## 19. Checklist nhanh cho mọi nhiệm vụ

- [ ] Đã xác định đúng workspace (`D:\LMS elearning`) và repository root.
- [ ] Đã đọc code/schema liên quan và `design-system/lms-elearning/MASTER.md` (nếu sửa UI/UX).
- [ ] Đã kiểm tra chức năng tương tự để tái sử dụng.
- [ ] Không tạo bảng/API/module trùng lặp.
- [ ] Đã xem xét RBAC và Data Scope ở backend.
- [ ] Đã tuân thủ Theme Tokens (`theme/tokens.css`), cấm AI Slop và đạt các Hard Metrics UI (`4px` grid, WCAG AA, `>= 44x44px` touch target, `tabular-nums`, `aspect-ratio`).
- [ ] Đã đánh giá ảnh hưởng tới dữ liệu và chức năng cũ.
- [ ] Đã giữ nguyên thay đổi chưa commit của người dùng.
- [ ] Đã chạy kiểm tra phù hợp (bao gồm `impeccable_audit.mjs` với lỗi P0/P1 = `0` khi sửa giao diện) hoặc nêu rõ lý do chưa chạy.
- [ ] Không thực hiện thao tác production ngoài phạm vi cho phép.
- [ ] Đã báo cáo chính xác những gì thực sự hoàn thành.

**Thông điệp cốt lõi:** Hãy hành động như một kỹ sư đang tiếp quản một hệ thống LMS đang vận hành: khảo sát trước, tái sử dụng tối đa, thiết kế chỉn chu theo chuẩn Design System, thay đổi có kiểm soát, bảo vệ dữ liệu và xác minh kết quả.
