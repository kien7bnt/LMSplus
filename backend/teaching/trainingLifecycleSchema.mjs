/**
 * LMSPLUS Training Lifecycle Schema (SQLite Runtime) — Môn học (1.1), Khung chương trình (1.2),
 * Khởi tạo Khóa học (1.3), Thời khóa biểu 6 Ràng buộc (2.1), và Thống kê & Chốt Giờ dạy (2.2).
 *
 * Nguyên tắc: 100% Additive (CREATE TABLE IF NOT EXISTS / ADD COLUMN), bảo toàn toàn bộ dữ liệu cũ.
 */

export const TRAINING_LIFECYCLE_SEED_MARKER = 'training_lifecycle_seed_v1';

async function columnNames(db, table) {
  return await db.columnNames(table);
}

async function addColumn(db, table, column, definition) {
  await db.addColumn(table, column, definition);
}

export async function ensureTrainingLifecycleSchema(db) {
  if (db.isPg) return;
  // 1.1 Môn học (courses, lessons, learning_resources, assignment_bank_items)
  await addColumn(db, 'courses', 'outcomes_json', "TEXT NOT NULL DEFAULT '[]'");
  await addColumn(db, 'courses', 'reference_tuition_fee', 'REAL NOT NULL DEFAULT 0');
  await addColumn(db, 'courses', 'theory_periods', 'INTEGER NOT NULL DEFAULT 15');
  await addColumn(db, 'courses', 'practice_periods', 'INTEGER NOT NULL DEFAULT 15');
  await addColumn(db, 'courses', 'self_study_periods', 'INTEGER NOT NULL DEFAULT 15');
  await addColumn(db, 'courses', 'minutes_per_period', 'INTEGER NOT NULL DEFAULT 45');
  await addColumn(db, 'courses', 'required_room_type', "TEXT NOT NULL DEFAULT 'THEORY_ROOM'");
  await addColumn(db, 'courses', 'grading_scale', 'REAL NOT NULL DEFAULT 10');
  await addColumn(db, 'courses', 'pass_score', 'REAL NOT NULL DEFAULT 5');
  await addColumn(
    db,
    'courses',
    'exam_conditions_json',
    `TEXT NOT NULL DEFAULT '{"min_attendance_pct":70,"require_all_mandatory_assignments":true}'`
  );
  await addColumn(db, 'courses', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'PUBLISHED'");
  await addColumn(db, 'courses', 'version_code', "TEXT NOT NULL DEFAULT 'v2026.1'");

  await addColumn(db, 'lessons', 'theory_periods', 'REAL NOT NULL DEFAULT 1');
  await addColumn(db, 'lessons', 'practice_periods', 'REAL NOT NULL DEFAULT 0');
  await addColumn(db, 'lessons', 'self_study_periods', 'REAL NOT NULL DEFAULT 0');

  await addColumn(db, 'learning_resources', 'usage_type', "TEXT NOT NULL DEFAULT 'MANDATORY'");
  await addColumn(db, 'learning_resources', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
  await addColumn(db, 'assignment_bank_items', 'relative_due_days', 'INTEGER NULL');
  await addColumn(db, 'assignment_bank_items', 'is_mandatory', 'INTEGER NOT NULL DEFAULT 1');

  // 1.2 Khung chương trình (curricula, curriculum_subjects)
  await addColumn(db, 'curricula', 'program_type', "TEXT NOT NULL DEFAULT 'INSTRUCTOR_LED'");
  await addColumn(db, 'curricula', 'delivery_mode', "TEXT NOT NULL DEFAULT 'HYBRID'");
  await addColumn(db, 'curricula', 'standard_duration_months', 'REAL NOT NULL DEFAULT 6');
  await addColumn(db, 'curricula', 'standard_duration_text', "TEXT NOT NULL DEFAULT '6 tháng'");
  await addColumn(db, 'curricula', 'target_audience', "TEXT NOT NULL DEFAULT ''");
  await addColumn(db, 'curricula', 'entry_requirements', "TEXT NOT NULL DEFAULT ''");
  await addColumn(db, 'curricula', 'auto_tuition_fee', 'REAL NOT NULL DEFAULT 0');
  await addColumn(db, 'curricula', 'final_tuition_fee', 'REAL NOT NULL DEFAULT 0');
  await addColumn(db, 'curricula', 'is_tuition_overridden', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn(
    db,
    'curricula',
    'graduation_criteria_json',
    `TEXT NOT NULL DEFAULT '{"pass_all_mandatory":true,"min_electives_passed":0,"min_avg_score":5,"min_attendance_pct":80,"extra_requirements":[],"certificate_template_code":"CERT-STD-2026"}'`
  );
  await addColumn(db, 'curricula', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'PUBLISHED'");

  await addColumn(db, 'curriculum_subjects', 'stage_id', 'TEXT NULL');
  await addColumn(db, 'curriculum_subjects', 'prerequisite_course_ids_json', "TEXT NOT NULL DEFAULT '[]'");

  // 1.3 Khởi tạo Khóa học / Lớp học
  await addColumn(db, 'program_cohorts', 'curriculum_version_id', 'TEXT NULL');
  await addColumn(db, 'program_cohorts', 'tuition_fee_snapshot', 'REAL NOT NULL DEFAULT 0');

  await addColumn(db, 'subject_classes', 'required_room_type', "TEXT NOT NULL DEFAULT 'THEORY_ROOM'");
  await addColumn(db, 'subject_classes', 'assessment_components_json', "TEXT NOT NULL DEFAULT '[]'");
  await addColumn(db, 'subject_classes', 'planned_periods', 'REAL NOT NULL DEFAULT 30');

  await addColumn(db, 'class_assignments', 'relative_due_days', 'INTEGER NULL');
  await addColumn(db, 'class_assignments', 'anchor_lesson_id', 'TEXT NULL');
  await addColumn(db, 'class_assignments', 'is_mandatory', 'INTEGER NOT NULL DEFAULT 1');

  // 2.1 & 2.2 Mở rộng bảng sessions hiện hữu
  await addColumn(db, 'sessions', 'campus_id', 'TEXT NULL');
  await addColumn(db, 'sessions', 'classroom_id', 'TEXT NULL');
  await addColumn(db, 'sessions', 'shift_code', 'TEXT NULL');
  await addColumn(db, 'sessions', 'schedule_state', "TEXT NOT NULL DEFAULT 'PUBLISHED'");
  await addColumn(db, 'sessions', 'planned_periods', 'REAL NOT NULL DEFAULT 2');
  await addColumn(db, 'sessions', 'actual_periods', 'REAL NULL');
  await addColumn(db, 'sessions', 'hour_category', "TEXT NOT NULL DEFAULT 'THEORY'");
  await addColumn(db, 'sessions', 'merged_group_code', 'TEXT NULL');
  await addColumn(db, 'sessions', 'session_kind', "TEXT NOT NULL DEFAULT 'REGULAR'");
  await addColumn(db, 'sessions', 'rescheduled_from_session_id', 'TEXT NULL');
  await addColumn(db, 'sessions', 'actual_instructor_id', 'TEXT NULL');
  await addColumn(db, 'sessions', 'substitute_reason', 'TEXT NULL');
  await addColumn(db, 'sessions', 'timesheet_locked_id', 'TEXT NULL');

  // Tạo các bảng con & danh mục chuyên biệt
  await db.exec(`
    CREATE TABLE IF NOT EXISTS course_prerequisites (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      prerequisite_course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      note TEXT,
      created_at TEXT NOT NULL,
      CONSTRAINT uq_course_prereq UNIQUE (course_id, prerequisite_course_id)
    );
    CREATE INDEX IF NOT EXISTS idx_course_prereq_crs ON course_prerequisites(course_id);

    CREATE TABLE IF NOT EXISTS course_assessment_components (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      weight_pct REAL NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('ATTENDANCE','ASSIGNMENT','EXAM','EXAM_MATRIX','MANUAL')),
      source_config_json TEXT NOT NULL DEFAULT '{}',
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_course_assess_crs ON course_assessment_components(course_id, sort_order);

    CREATE TABLE IF NOT EXISTS curriculum_stages (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      stage_type TEXT NOT NULL DEFAULT 'SEMESTER' CHECK (stage_type IN ('SEMESTER','PHASE','CUSTOM')),
      sort_order INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_curr_stages_curr ON curriculum_stages(curriculum_id, sort_order);

    CREATE TABLE IF NOT EXISTS curriculum_service_fees (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      is_mandatory INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_curr_fees_curr ON curriculum_service_fees(curriculum_id, sort_order);

    CREATE TABLE IF NOT EXISTS session_plan_items (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL DEFAULT 'COURSE' CHECK (scope_type IN ('COURSE','CURRICULUM_SUBJECT')),
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      curriculum_id TEXT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      curriculum_subject_id TEXT NULL,
      session_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 90,
      periods_count REAL NOT NULL DEFAULT 2,
      delivery_mode TEXT NOT NULL DEFAULT 'OFFLINE',
      required_room_type TEXT NOT NULL DEFAULT 'THEORY_ROOM',
      lesson_ids_json TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_plan_lookup ON session_plan_items(scope_type, course_id, curriculum_id, session_order);

    CREATE TABLE IF NOT EXISTS curriculum_versions (
      id TEXT PRIMARY KEY,
      curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      version_label TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      changelog_note TEXT,
      published_by TEXT,
      published_by_name TEXT,
      published_at TEXT NOT NULL,
      CONSTRAINT uq_curr_ver_num UNIQUE (curriculum_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS idx_curr_versions_curr ON curriculum_versions(curriculum_id, version_number DESC);

    CREATE TABLE IF NOT EXISTS certificate_templates (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      issuer_name TEXT NOT NULL DEFAULT 'Trung tâm Đào tạo LMSPLUS',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS campuses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      open_time TEXT NOT NULL DEFAULT '07:00',
      close_time TEXT NOT NULL DEFAULT '21:30',
      travel_buffers_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id TEXT PRIMARY KEY,
      campus_id TEXT NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      room_type TEXT NOT NULL DEFAULT 'THEORY_ROOM' CHECK (room_type IN ('THEORY_ROOM','COMPUTER_LAB','ONLINE')),
      capacity INTEGER NOT NULL DEFAULT 40,
      equipment_note TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_classrooms_campus ON classrooms(campus_id, room_type);

    CREATE TABLE IF NOT EXISTS shift_presets (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      periods_count REAL NOT NULL DEFAULT 2,
      sort_order INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS academic_holidays (
      id TEXT PRIMARY KEY,
      campus_id TEXT NULL REFERENCES campuses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_recurring_yearly INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_holidays_dates ON academic_holidays(start_date, end_date);

    CREATE TABLE IF NOT EXISTS instructor_availabilities (
      id TEXT PRIMARY KEY,
      instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rule_type TEXT NOT NULL DEFAULT 'WEEKLY' CHECK (rule_type IN ('WEEKLY','DATE')),
      weekday INTEGER NULL,
      specific_date TEXT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'BUSY' CHECK (status IN ('AVAILABLE','BUSY')),
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_instr_avail_user ON instructor_availabilities(instructor_id, rule_type);

    CREATE TABLE IF NOT EXISTS session_lessons (
      session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 10,
      PRIMARY KEY (session_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS instructor_quotas (
      id TEXT PRIMARY KEY,
      instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      standard_periods REAL NOT NULL DEFAULT 40,
      standard_hours REAL NOT NULL DEFAULT 30,
      note TEXT,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_instr_quota_period UNIQUE (instructor_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS teaching_timesheets (
      id TEXT PRIMARY KEY,
      period_month TEXT NOT NULL,
      instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instructor_name TEXT NOT NULL DEFAULT '',
      department_id TEXT,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      regular_sessions INTEGER NOT NULL DEFAULT 0,
      substitute_sessions INTEGER NOT NULL DEFAULT 0,
      makeup_sessions INTEGER NOT NULL DEFAULT 0,
      cancelled_sessions INTEGER NOT NULL DEFAULT 0,
      theory_periods REAL NOT NULL DEFAULT 0,
      practice_periods REAL NOT NULL DEFAULT 0,
      online_periods REAL NOT NULL DEFAULT 0,
      total_periods REAL NOT NULL DEFAULT 0,
      total_hours REAL NOT NULL DEFAULT 0,
      quota_hours REAL NOT NULL DEFAULT 30,
      overtime_hours REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING_TEACHER'
        CHECK (status IN ('DRAFT','PENDING_TEACHER','DISPUTED','TEACHER_CONFIRMED','APPROVED','LOCKED')),
      teacher_note TEXT,
      review_note TEXT,
      teacher_confirmed_at TEXT,
      approved_by TEXT,
      approved_by_name TEXT,
      approved_at TEXT,
      locked_by TEXT,
      locked_by_name TEXT,
      locked_at TEXT,
      finance_batch_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CONSTRAINT uq_timesheet_period_instr UNIQUE (period_month, instructor_id)
    );
    CREATE INDEX IF NOT EXISTS idx_timesheets_period ON teaching_timesheets(period_month, status);

    CREATE TABLE IF NOT EXISTS teaching_timesheet_items (
      id TEXT PRIMARY KEY,
      timesheet_id TEXT NOT NULL REFERENCES teaching_timesheets(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      subject_class_id TEXT NOT NULL,
      class_code TEXT NOT NULL,
      course_code TEXT,
      course_title TEXT,
      session_title TEXT NOT NULL,
      session_date TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      hour_category TEXT NOT NULL DEFAULT 'THEORY',
      role_kind TEXT NOT NULL DEFAULT 'PRIMARY',
      periods REAL NOT NULL DEFAULT 0,
      hours REAL NOT NULL DEFAULT 0
    );
  `);
}

export async function clearTrainingLifecycleData(db) {
  await db.exec(`
    DELETE FROM teaching_timesheet_items;
    DELETE FROM teaching_timesheets;
    DELETE FROM instructor_quotas;
    DELETE FROM session_lessons;
    DELETE FROM instructor_availabilities;
    DELETE FROM academic_holidays;
    DELETE FROM shift_presets;
    DELETE FROM classrooms;
    DELETE FROM campuses;
    DELETE FROM certificate_templates;
    DELETE FROM curriculum_versions;
    DELETE FROM session_plan_items;
    DELETE FROM curriculum_service_fees;
    DELETE FROM curriculum_stages;
    DELETE FROM course_assessment_components;
    DELETE FROM course_prerequisites;
    DELETE FROM app_meta WHERE key = '${TRAINING_LIFECYCLE_SEED_MARKER}';
  `);
}

export async function seedTrainingLifecycleStarterData(db) {
  await ensureTrainingLifecycleSchema(db);
  const done = await db.prepare(`SELECT 1 FROM app_meta WHERE key = '${TRAINING_LIFECYCLE_SEED_MARKER}'`).get();
  if (done) return;

  const now = new Date().toISOString();
  await db.tx(async () => {
    // 1. Mẫu chứng chỉ / biểu mẫu (1.2.5)
    await db.prepare(
      `INSERT INTO certificate_templates (id, code, title, issuer_name, description, status)
       VALUES
       ('cert_std_2026', 'CERT-STD-2026', 'Chứng chỉ Hoàn thành Chương trình Chuẩn', 'Học viện LMSPLUS', 'Mẫu chứng nhận chuẩn cho học viên đạt đủ điều kiện tốt nghiệp khung chương trình.', 'ACTIVE'),
       ('cert_hon_2026', 'CERT-HON-2026', 'Chứng nhận Tốt nghiệp Xuất sắc', 'Học viện LMSPLUS', 'Mẫu chứng nhận danh dự dành cho học viên đạt điểm TB >= 8.5 và chuyên cần >= 90%.', 'ACTIVE') ON CONFLICT DO NOTHING`
    ).run();

    // 2. Cơ sở, Phòng học, Ca chuẩn & Ngày nghỉ lễ (2.1)
    await db.prepare(
      `INSERT INTO campuses (id, code, name, address, open_time, close_time, travel_buffers_json, is_active, created_at)
       VALUES
       ('cp_cs1', 'CS1-CG', 'Cơ sở 1 — Cầu Giấy', 'Số 18 Duy Tân, Cầu Giấy, Hà Nội', '07:00', '21:30', '{"cp_cs2":30}', 1, ?),
       ('cp_cs2', 'CS2-DD', 'Cơ sở 2 — Đống Đa', 'Số 45 Thái Hà, Đống Đa, Hà Nội', '07:00', '21:30', '{"cp_cs1":30}', 1, ?) ON CONFLICT DO NOTHING`
    ).run(now, now);

    await db.prepare(
      `INSERT INTO classrooms (id, campus_id, code, name, room_type, capacity, equipment_note, is_active, created_at)
       VALUES
       ('rm_5a1', 'cp_cs1', 'P5A1-B', 'Phòng 5A1 – Dãy B', 'THEORY_ROOM', 42, 'Máy chiếu Laser, bảng từ đôi, âm thanh phòng học', 1, ?),
       ('rm_5a2', 'cp_cs1', 'P5A2-B', 'Phòng 5A2 – Dãy B', 'THEORY_ROOM', 42, 'Máy chiếu chuẩn, điều hòa trung tâm', 1, ?),
       ('rm_lab201', 'cp_cs1', 'LAB-201', 'Phòng Máy tính 201', 'COMPUTER_LAB', 35, '36 PC cấu hình cao, mạng LAN Gigabit', 1, ?),
       ('rm_cs2_301', 'cp_cs2', 'P301-CS2', 'Phòng 301 – Cơ sở Đống Đa', 'THEORY_ROOM', 30, 'Màn hình tương tác thông minh 75 inch', 1, ?),
       ('rm_online', 'cp_cs1', 'ONLINE-ZOOM', 'Không gian Trực tuyến (Zoom/Meet)', 'ONLINE', 500, 'Phòng học trực tuyến không giới hạn chỗ vật lý', 1, ?) ON CONFLICT DO NOTHING`
    ).run(now, now, now, now, now);

    await db.prepare(
      `INSERT INTO shift_presets (id, code, title, start_time, end_time, periods_count, sort_order)
       VALUES
       ('sh_s1', 'CA1', 'Ca 1 Sáng (07:30 – 09:00)', '07:30', '09:00', 2, 10),
       ('sh_s2', 'CA2', 'Ca 2 Sáng (09:15 – 10:45)', '09:15', '10:45', 2, 20),
       ('sh_c1', 'CA3', 'Ca Chiều (14:00 – 15:30)', '14:00', '15:30', 2, 30),
       ('sh_t1', 'CA4', 'Ca Tối (18:30 – 20:30)', '18:30', '20:30', 2.5, 40) ON CONFLICT DO NOTHING`
    ).run();

    const year = new Date().getUTCFullYear();
    await db.prepare(
      `INSERT INTO academic_holidays (id, campus_id, title, start_date, end_date, is_recurring_yearly, note, created_at)
       VALUES
       ('hol_2011', NULL, 'Kỷ niệm Ngày Nhà giáo Việt Nam 20/11', '${year}-11-20', '${year}-11-20', 1, 'Nghỉ lễ toàn hệ thống trung tâm', ?),
       ('hol_newyear', NULL, 'Nghỉ Tết Dương lịch', '${year + 1}-01-01', '${year + 1}-01-01', 1, 'Nghỉ lễ theo quy định Nhà nước', ?) ON CONFLICT DO NOTHING`
    ).run(now, now);

    // 3. Môn học chuẩn hóa (1.1): Chuẩn đầu ra, học phí tham khảo, thời lượng & Đầu điểm 100%
    const toan = await db.prepare("SELECT * FROM courses WHERE id = 'crs_toan5' OR code = 'TOAN5-2026' LIMIT 1").get();
    const tv = await db.prepare("SELECT * FROM courses WHERE id = 'crs_tv5' OR code = 'TV5-K5' LIMIT 1").get();
    if (toan) {
      await db.prepare(
        `UPDATE courses SET
           outcomes_json = ?,
           reference_tuition_fee = 2400000,
           theory_periods = 24,
           practice_periods = 21,
           self_study_periods = 15,
           minutes_per_period = 45,
           required_room_type = 'THEORY_ROOM',
           grading_scale = 10,
           pass_score = 5.0,
           lifecycle_status = 'PUBLISHED',
           version_code = 'v2026.1'
         WHERE id = ?`
      ).run(
        JSON.stringify([
          { code: 'CLO1', text: 'Nhận diện, rút gọn và thực hiện thành thạo bốn phép tính với phân số và số thập phân.' },
          { code: 'CLO2', text: 'Giải quyết các bài toán thực tế về tỉ số phần trăm, chuyển động đều.' },
          { code: 'CLO3', text: 'Tính đúng chu vi, diện tích và thể tích các hình học phẳng & không gian cơ bản.' },
        ]),
        toan.id
      );

      const hasComp = await db.prepare('SELECT 1 FROM course_assessment_components WHERE course_id = ? LIMIT 1').get(toan.id);
      if (!hasComp) {
        const ins = db.prepare(
          `INSERT INTO course_assessment_components (id, course_id, code, title, weight_pct, source_type, source_config_json, is_mandatory, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        await ins.run('cac_toan_att', toan.id, 'CC', 'Chuyên cần', 10, 'ATTENDANCE', '{}', 1, 10, now, now);
        await ins.run('cac_toan_asg', toan.id, 'BT', 'Bài tập định kỳ', 30, 'ASSIGNMENT', '{}', 1, 20, now, now);
        await ins.run('cac_toan_mid', toan.id, 'GK', 'Kiểm tra giữa môn', 20, 'EXAM', '{}', 1, 30, now, now);
        await ins.run('cac_toan_fin', toan.id, 'CK', 'Đánh giá cuối môn', 40, 'EXAM_MATRIX', '{}', 1, 40, now, now);
      }

      // Chia buổi học mặc định 1 buổi = 1 bài học cho môn Toán 5 (1.2.4)
      const existingPlans = await db.prepare("SELECT 1 FROM session_plan_items WHERE scope_type = 'COURSE' AND course_id = ? LIMIT 1").get(toan.id);
      if (!existingPlans) {
        const lessons = await db
          .prepare(
            `SELECT l.id, l.title, l.duration_minutes FROM lessons l JOIN chapters ch ON ch.id = l.chapter_id
             WHERE ch.course_id = ? AND ch.status <> 'ARCHIVED' AND l.publish_status <> 'ARCHIVED'
             ORDER BY ch.sort_order, l.sort_order`
          )
          .all(toan.id);
        for (const [idx, l] of (lessons).entries()) {
          const mins = Math.max(45, Number(l.duration_minutes || 90));
          const periods = Math.round((mins / 45) * 10) / 10;
          await db.prepare(
            `INSERT INTO session_plan_items (id, scope_type, course_id, session_order, title, duration_minutes, periods_count, delivery_mode, required_room_type, lesson_ids_json, note, updated_at)
             VALUES (?, 'COURSE', ?, ?, ?, ?, ?, 'OFFLINE', 'THEORY_ROOM', ?, 'Phân bổ chuẩn 1 buổi = 1 bài học', ?)`
          ).run(`spi_toan_${idx + 1}`, toan.id, idx + 1, `Buổi ${idx + 1}: ${l.title}`, mins, periods, JSON.stringify([l.id]), now);
        }
      }
    }

    if (tv) {
      await db.prepare(
        `UPDATE courses SET
           outcomes_json = ?,
           reference_tuition_fee = 1800000,
           theory_periods = 20,
           practice_periods = 15,
           self_study_periods = 10,
           minutes_per_period = 45,
           required_room_type = 'THEORY_ROOM',
           lifecycle_status = 'PUBLISHED',
           version_code = 'v2026.1'
         WHERE id = ?`
      ).run(
        JSON.stringify([
          { code: 'CLO1', text: 'Đọc hiểu văn bản nghệ thuật, nghị luận ngắn và mở rộng vốn từ theo chủ điểm.' },
          { code: 'CLO2', text: 'Sử dụng đúng từ đồng nghĩa, câu ghép và viết đoạn văn miêu tả giàu hình ảnh.' },
        ]),
        tv.id
      );
    }

    // 4. Khung chương trình chuẩn (1.2): Giai đoạn, Dịch vụ kèm theo & Học phí, Phiên bản v2026.1
    const curr = await db.prepare("SELECT * FROM curricula WHERE id = 'curr_tieuhoc_k5' LIMIT 1").get();
    if (curr) {
      await db.prepare(
        `INSERT INTO curriculum_stages (id, curriculum_id, code, title, stage_type, sort_order, created_at)
         VALUES
         ('stg_k5_hk1', ?, 'GD1-NENTANG', 'Giai đoạn 1 — Nền tảng Trọng tâm (Học kỳ 1)', 'PHASE', 10, ?),
         ('stg_k5_hk2', ?, 'GD2-CHUYENSAU', 'Giai đoạn 2 — Vận dụng & Tổng ôn (Học kỳ 2)', 'PHASE', 20, ?) ON CONFLICT DO NOTHING`
      ).run(curr.id, now, curr.id, now);

      await db.prepare(`UPDATE curriculum_subjects SET stage_id = 'stg_k5_hk1' WHERE curriculum_id = ? AND stage_id IS NULL`).run(curr.id);

      await db.prepare(
        `INSERT INTO curriculum_service_fees (id, curriculum_id, code, title, amount, is_mandatory, note, sort_order, created_at)
         VALUES
         ('fee_k5_mat', ?, 'HOC-LIEU', 'Phí bộ học liệu in màu & tài khoản thực hành số', 350000, 1, 'Thu 1 lần đầu khóa', 10, ?),
         ('fee_k5_cert', ?, 'CHUNG-NHAN', 'Lệ phí thi cuối khóa & cấp chứng nhận hoàn thành', 150000, 1, 'Áp dụng cuối khóa', 20, ?) ON CONFLICT DO NOTHING`
      ).run(curr.id, now, curr.id, now);

      const subjFee = (toan ? 2400000 : 0) + (tv ? 1800000 : 0);
      const totalFee = subjFee + 500000;
      await db.prepare(
        `UPDATE curricula SET
           program_type = 'INSTRUCTOR_LED',
           delivery_mode = 'HYBRID',
           standard_duration_months = 9,
           standard_duration_text = '9 tháng (1 năm học)',
           target_audience = 'Học sinh khối 5 chuẩn bị chuyển cấp THCS',
           entry_requirements = 'Hoàn thành chương trình lớp 4 hoặc đạt bài kiểm tra đầu vào >= 5.0',
           auto_tuition_fee = ?,
           final_tuition_fee = ?,
           lifecycle_status = 'PUBLISHED',
           version = 'v2026.1'
         WHERE id = ?`
      ).run(totalFee, totalFee, curr.id);

      await db.prepare(
        `INSERT INTO curriculum_versions (id, curriculum_id, version_number, version_label, snapshot_json, changelog_note, published_by_name, published_at)
         VALUES ('cver_k5_v1', ?, 1, 'v2026.1', ?, 'Ban hành Khung chương trình chuẩn năm học 2026–2027', 'Quản trị Hệ thống', ?) ON CONFLICT DO NOTHING`
      ).run(
        curr.id,
        JSON.stringify({
          version_label: 'v2026.1',
          program_type: 'INSTRUCTOR_LED',
          delivery_mode: 'HYBRID',
          standard_duration_months: 9,
          final_tuition_fee: totalFee,
          subjects: [
            toan ? { course_id: toan.id, code: toan.code, title: toan.title, periods: 45 } : null,
            tv ? { course_id: tv.id, code: tv.code, title: tv.title, periods: 35 } : null,
          ].filter(Boolean),
        }),
        now
      );
    }

    // 5. Gắn phòng học & giảng viên thực tế cho các buổi học mẫu + Định mức giờ giảng (2.1 & 2.2)
    await db.prepare(
      `UPDATE sessions SET
         campus_id = COALESCE(campus_id, 'cp_cs1'),
         classroom_id = COALESCE(classroom_id, CASE WHEN delivery_mode = 'ONLINE' THEN 'rm_online' ELSE 'rm_5a1' END),
         actual_instructor_id = COALESCE(actual_instructor_id, scheduled_instructor_id),
         actual_instructor_name = COALESCE(NULLIF(actual_instructor_name, ''), scheduled_instructor_name),
         planned_periods = COALESCE(planned_periods, 2),
         hour_category = CASE WHEN delivery_mode = 'ONLINE' THEN 'ONLINE' ELSE 'THEORY' END
       WHERE campus_id IS NULL OR actual_instructor_id IS NULL`
    ).run();

    const curMonth = new Date().toISOString().slice(0, 7);
    const instructors = await db.prepare(`SELECT id, full_name FROM users WHERE roles_json LIKE '%INSTRUCTOR%'`).all();
    for (const gv of instructors) {
      await db.prepare(
        `INSERT INTO instructor_quotas (id, instructor_id, period_key, standard_periods, standard_hours, note, updated_at)
         VALUES (?, ?, ?, 40, 30, 'Định mức chuẩn giảng viên cơ hữu theo tháng', ?) ON CONFLICT DO NOTHING`
      ).run(`qta_${gv.id.slice(0, 8)}_${curMonth}`, gv.id, curMonth, now);
    }

    if (instructors[0]) {
      await db.prepare(
        `INSERT INTO instructor_availabilities (id, instructor_id, rule_type, weekday, start_time, end_time, status, note, created_at)
         VALUES ('iav_gv1_sun', ?, 'WEEKLY', 0, '07:00', '17:00', 'BUSY', 'Lịch bận họp chuyên môn Chủ nhật', ?) ON CONFLICT DO NOTHING`
      ).run(instructors[0].id, now);
    }

    await db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, '1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`).run(TRAINING_LIFECYCLE_SEED_MARKER);
  });
}
