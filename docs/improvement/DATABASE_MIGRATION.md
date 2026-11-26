# DATABASE MIGRATION GUIDE — POSTGRESQL 18 & ROLLBACK STRATEGY

> **Phiên bản mục tiêu:** PostgreSQL 18.x (Local Docker `lmsplus-postgres` chạy `18.7`, Cloud Neon/Supabase qua `DATABASE_URL`).  
> **Nguyên tắc:** Không sửa chéo lên file snapshot `010_postgres18_live_schema.sql` (cố định 80 bảng, 43 index nền tảng); mọi thay đổi lược đồ sau `010` đi qua cặp file tăng dần `0XX_<ten>_up.sql` và `0XX_<ten>_down.sql` bọc trong `BEGIN; ... COMMIT;`.

---

## 1. Cấu trúc Hệ thống Migration Hiện tại

| Thành phần | Phạm vi | Ghi chú |
|---|---|---|
| `database/migrations/010_postgres18_live_schema.sql` | 80 bảng cốt lõi + 43 index | Lược đồ nền tảng tương ứng dữ liệu đã chuyển từ SQLite (`4,706` bản ghi ban đầu) |
| `database/migrations/011_security_departments_and_lms_v2_up.sql` | +3 bảng (`schema_migrations`, `departments`, `auth_refresh_tokens`) + 4 cột bảng `users` | Mở rộng tổng số lên **83 bảng**; chèn idempotent 3 đơn vị nền (`org_root`, `khoi_5`, `dept_se`) |
| `database/migrations/012_rubrics_appeals_storage_up.sql` | +1 bảng (`grade_appeals`) + `rubric_json` / `rubric_scores_json` + check constraint `storage_provider` | Mở rộng tổng số lên **84 bảng** phục vụ chấm Rubric, Phúc khảo điểm & S3/R2/Vercel Blob |
| `database/migrations/013_performance_indexes_up.sql` | +7 composite indexes | Tăng tốc truy vấn `lessons`, `sessions`, `class_enrollments`, `attendance_records`, `lesson_progress`, `class_exam_attempts`, `class_assignment_submissions` |
| `database/migrations/*_down.sql` (`011_down`, `012_down`, `013_down`) | Rollback sạch từng bước | Bảo toàn dữ liệu hiện hữu ngoài phạm vi migration |
| `scripts/migrate-sqlite-to-pg.mjs` | Đồng bộ schema (`--schema-only`) hoặc copy dữ liệu từ SQLite | Tự động chạy `010` sau đó quét theo thứ tự tăng dần toàn bộ file `011+*_up.sql` |
| `scripts/backup-restore-pg.mjs` | Sao lưu JSON toàn vẹn kèm SHA-256 (`backup`, `verify`, `restore --dry-run`, `restore`) | Hỗ trợ tùy chọn `--pgdump` nếu hệ thống có `pg_dump` |
| `2-migrate-db.bat` | Wrapper Windows (`SCHEMA`, `MIGRATE`, `BACKUP`, `DOWN [file]`) | Chế độ `DOWN` tự sao lưu rồi chạy file rollback được truyền (mặc định migration mới nhất) |

---

## 2. Quy trình Sao lưu, Kiểm tra & Thực thi An toàn

### 2.1. Tạo bản sao lưu & kiểm tra toàn vẹn trước mọi thay đổi schema

```bash
node scripts/backup-restore-pg.mjs backup --out=database/backups/pre-migration.json
node scripts/backup-restore-pg.mjs verify --file=database/backups/pre-migration.json
node scripts/backup-restore-pg.mjs restore --file=database/backups/pre-migration.json --dry-run
```

> Kết quả đã xác minh thực tế trên PostgreSQL 18.7 cục bộ: **83 bảng / 4,710 bản ghi**, checksum SHA-256 hợp lệ.

### 2.2. Áp dụng Migration mới (Không mất dữ liệu)

```bash
npm run db:schema
```

Lệnh này thực thi `node scripts/migrate-sqlite-to-pg.mjs --schema-only`, chỉ dùng `CREATE TABLE IF NOT EXISTS` và `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` nên **tuyệt đối không truncate** dữ liệu hiện hữu.

### 2.3. Rollback Migration `011` khi có sự cố

Chạy file `011_security_departments_and_lms_v2_down.sql` trên PostgreSQL hoặc chạy `2-migrate-db.bat DOWN`. Sau đó kiểm tra lại bằng bản sao lưu đã tạo ở bước 2.1.

---

## 3. Bảo mật Kết nối PostgreSQL

`backend/db/client.mjs` cấu hình `buildPgPoolConfig()`:
- Với kết nối local hoặc `sslmode=disable`: tắt TLS để tối ưu phát triển cục bộ.
- Với `sslmode=verify-full` hoặc `PGSSLMODE=verify-full`: ép bật `{ rejectUnauthorized: true }` chống tấn công MITM trên đường truyền Cloud PostgreSQL.
- Các biến môi trường nhạy cảm (`DATABASE_URL`, `LMSPLUS_JWT_SECRET`, `LMSPLUS_CREDENTIAL_KEY`) tuyệt đối không được commit lên Git.
