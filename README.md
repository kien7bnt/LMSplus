# LMSPLUS — Hệ thống Quản lý Học tập & Giảng dạy (LMS E-Learning)

Nền tảng quản lý khóa học, lớp học, **Lesson Studio** (soạn giáo án & Video Quiz tương tác gắn mốc thời gian), điểm danh và theo dõi tiến độ học tập dành cho Quản trị viên, Giảng viên và Học viên.

## Tính năng chính
- **Quản lý Khóa học & Lớp học:** Phân tách chương trình gốc (Course) và lớp vận hành thực tế (Class), hỗ trợ 3 chế độ ghi danh (`ASSIGNED_ONLY`, `REQUEST_APPROVAL`, `SELF_ENROLL`).
- **Lesson Studio & Interactive Video Quiz:** Soạn giáo án đa khối (Chế độ A cho khóa học, Chế độ B tùy biến theo lớp), tải video theo mảnh (Chunked Upload), nhúng YouTube chuẩn EME/Referer và gắn câu hỏi tương tác theo mốc thời gian trên thanh phát video.
- **Điểm danh & Nhật ký giảng dạy 24 giờ:** Điểm danh nhanh trên một màn hình, mã QR động có thời hạn, lịch sử kiểm toán và xác nhận nhật ký giảng dạy.
- **Chuẩn thiết kế:** Multi-Theme Token System (`airbnb-light`, `nordic-calm`, `cinema-dark`) đạt chuẩn tương phản WCAG AA.

## Chạy trên máy cục bộ (Windows)
- Yêu cầu **Node.js >= 22.5** (khuyến nghị **Node.js 24 LTS**).
- Chạy file `3-start-all.bat` để khởi động đồng thời Backend (`http://localhost:8000`) và Frontend (`http://localhost:5173`).

### Tài khoản trải nghiệm mặc định
| Vai trò | Email / Mã số | Mật khẩu |
| --- | --- | --- |
| Quản trị viên | `admin@lmsplus.edu.vn` (`AD00001`) | `123456` |
| Giảng viên | `thuha.gv@lmsplus.edu.vn` (`GV5001`) | `123456` |
| Học viên | `minhanh.hs@lmsplus.edu.vn` (`HS50101`) | `123456` |

## Triển khai lên Vercel
Dự án đã cấu hình sẵn `vercel.json` và Serverless API (`api/index.mjs`) dùng Node.js 24 (`node:sqlite` khởi tạo trên `/tmp` từ dữ liệu mẫu `database/lmsplus_elearning_seed.json`):
1. Kết nối kho mã nguồn GitHub `kien7bnt/LMSplus` tại [vercel.com/new](https://vercel.com/new).
2. Giữ **Root Directory** là `.` (thư mục gốc dự án) và bấm **Deploy**.
3. Khuyến nghị đặt biến môi trường `LMSPLUS_JWT_SECRET` trên Vercel Project Settings cho môi trường vận hành chính thức.
