# HƯỚNG DẪN VẬN HÀNH, MIGRATION & KIỂM THỬ HỆ THỐNG LMSPLUS E-LEARNING (PHASE 5)

Tài liệu này hướng dẫn chi tiết cách khởi chạy cơ sở dữ liệu, chạy migration `UP` / `DOWN`, khởi động Backend API (FastAPI / SQLite / PostgreSQL), khởi động Frontend (Vite + React + TypeScript), và chạy bộ kiểm thử tích hợp tự động.

---

## 1. Cấu trúc Lưu trữ & Cơ sở dữ liệu Thực thi

Theo xác nhận **Phương án B** (dự án độc lập hoàn chỉnh, tự quản lý `users`, `roles`, `JWT`, `RBAC` và schema E-Learning):

1. **Cơ sở dữ liệu SQL chạy trực tiếp (Zero-Config SQLite Relational DB):**
   - File DB: [`database/lmsplus_elearning.sqlite`](../../../database/lmsplus_elearning.sqlite)
   - Dữ liệu Seed gốc: [`database/lmsplus_elearning_seed.json`](../../../database/lmsplus_elearning_seed.json)
   - Được chia sẻ đồng bộ giữa **Python FastAPI** ([`backend/app/db/sql_repository.py`](../../../backend/app/db/sql_repository.py)) và **Node.js SQL Server** ([`backend/server_fallback.mjs`](../../../backend/server_fallback.mjs) sử dụng module `node:sqlite` tích hợp sẵn trong Node.js v24).
   - Bật ràng buộc khóa ngoại thực tế (`PRAGMA foreign_keys = ON`) và kiểm tra toàn vẹn `CHECK` / `UNIQUE`.

2. **Cơ sở dữ liệu PostgreSQL 16 + Redis 7 (Docker Compose Production/Staging):**
   - File cấu hình: [`docker-compose.yml`](../../../docker-compose.yml)
   - Thư mục SQL Migrations (`UP` & `DOWN`): [`database/migrations/`](../../../database/migrations/)
     - `000_lmsplus_core_prereq_up.sql` / `000_lmsplus_core_prereq_down.sql`
     - `001_elearning_core_up.sql` / `001_elearning_core_down.sql`
     - `002_blocks_versioning_and_wiki_up.sql` / `002_blocks_versioning_and_wiki_down.sql`
     - `003_progress_and_unlock_rules_up.sql` / `003_progress_and_unlock_rules_down.sql`
     - `004_forum_attendance_and_24h_teaching_logs_up.sql` / `004_forum_attendance_and_24h_teaching_logs_down.sql`
     - `005_assessment_and_assignment_bridges_up.sql` / `005_assessment_and_assignment_bridges_down.sql`

---

## 2. Quy trình Chạy PostgreSQL Migration bằng Docker

Nếu máy trạm hoặc Ubuntu VPS có cài đặt Docker:

```powershell
# 1. Khởi tạo container PostgreSQL 16 (lmsplus-postgres) và Redis 7 (lmsplus-redis)
docker compose up -d postgres redis

# 2. Thực thi toàn bộ Migration UP (000 -> 005)
.\2-migrate-db.bat UP

# 3. Kiểm thử Rollback Migration DOWN (005 -> 000)
.\2-migrate-db.bat DOWN

# 4. Chạy lại Migration UP để đưa schema về trạng thái sẵn sàng
.\2-migrate-db.bat UP
```

> **Lưu ý trung thực:** Script [`2-migrate-db.bat`](../../../2-migrate-db.bat) tự động phát hiện `psql` nội bộ hoặc container `lmsplus-postgres`. Nếu cả hai đều chưa bật trên máy host, script sẽ dừng với mã thoát `EXIT /B 2` (`STATIC CHECK ONLY`) và ghi rõ vào `logs/migration.log` thay vì báo `[PASS]` giả.

---

## 3. Khởi động Toàn bộ Hệ thống (Backend + Frontend + Live Log)

### Cách 1: Chạy 1-Click bằng Batch Script trên Windows (Khuyên dùng)
Chạy trực tiếp file [`start-all.bat`](../../../start-all.bat) từ Windows Explorer hoặc cửa sổ Command Prompt / PowerShell ngoài Sandbox:

```powershell
.\start-all.bat
```

Script sẽ:
1. Kiểm tra tính toàn vẹn của 12 file SQL Migration và UI/UX Design Standard (`0 lỗi P0/P1`).
2. Khởi chạy **Backend API** tại `http://localhost:8000` (kèm `/health` và `/api/v1/elearning/workspace/bootstrap`).
3. Khởi chạy **Frontend Vite** tại `http://localhost:5173`.
4. Tự động mở trình duyệt và hiển thị luồng log thời gian thực (`logs/backend.log`, `logs/frontend.log`, `logs/system-check.log`).

### Cách 2: Khởi chạy từng dịch vụ độc lập

**Khởi chạy Backend (Node.js SQLite Server hoặc Python FastAPI):**
```powershell
# Phương án 1: Node.js v24 built-in SQLite Server (Không cần cài thêm thư viện ngoài)
node backend/server_fallback.mjs

# Phương án 2: Python FastAPI + Uvicorn (Nếu môi trường đã cài đặt Python >= 3.10 & FastAPI)
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

**Khởi chạy Frontend (React 18 + TypeScript + Vite + Tailwind CSS):**
```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

---

## 4. Chạy Bộ Kiểm thử Tích hợp Tự động & Kiểm định UI/UX

### 4.1. Kiểm thử Tích hợp SQL, JWT Auth, RBAC & Nghiệp vụ (24 Test Cases)
```powershell
node tests/elearning_full_test_suite.mjs
```
Kiểm tra tự động:
- Xác thực JWT (`HS256`) cho 5 vai trò (`STUDENT`, `INSTRUCTOR`, `TEACHING_ASSISTANT`, `ACADEMIC_STAFF`, `ADMIN`) và chặn token giả mạo (`401 INVALID_OR_EXPIRED_JWT`).
- Chính sách khám phá khóa học lai (`ASSIGNED_ONLY` ẩn và chặn `403` đối với học viên không thuộc lớp; `REQUEST_APPROVAL` tạo yêu cầu chờ Giáo vụ duyệt; `SELF_ENROLL` chỉ cho phép `ADMIN` bật, trả về `403 SELF_ENROLL_REQUIRES_ADMIN` nếu Giáo vụ tự bật).
- Điều kiện hoàn thành bài học đa tiêu chí (`422 COMPLETION_CRITERIA_NOT_MET` khi video `< 85%` hoặc chưa vượt qua Quick Check; mở khóa bài `3.3` ngay khi đạt đủ tiêu chí).
- Trình soạn thảo Block Editor chuẩn Notion (kiểm soát xung đột `409 REVISION_CONFLICT`, phân quyền Trợ giảng chỉ được lưu nháp `200`, cấm xuất bản `403 PUBLISH_REQUIRES_INSTRUCTOR`, Giảng viên xuất bản snapshot bất biến `v2 -> v3`).
- Quy tắc 24 giờ xác nhận nhật ký giảng dạy (chuyển sang `OVERDUE_UNCONFIRMED` sau 24 giờ, **không khóa** quyền xác nhận muộn của Giảng viên `CONFIRMED_LATE`, và chặn các vai trò khác ký thay `403 TEACHING_LOG_CONFIRM_FORBIDDEN`).

### 4.2. Kiểm định Chuẩn Giao diện Impeccable × UI/UX Pro Max × Airbnb DLS
```powershell
node .agents/skills/ui-ux-standard/scripts/impeccable_audit.mjs frontend/src
```
Đảm bảo `0 lỗi P0/P1` trên toàn bộ mã nguồn giao diện.
