import React, { useState } from 'react';
import {
  CurriculumChapterNode,
  CurriculumLessonNode,
  DiscoverableCourse,
  EnrollmentPolicy,
  UserRole,
  WikiTermPopoverData,
} from '../../types/elearning';
import {
  AuthenticatedUser,
  apiCreateChapter,
  apiCreateCourse,
  apiCreateLesson,
  apiCreateWikiTerm,
  apiDeleteChapter,
  apiDeleteCourse,
  apiDeleteLesson,
  apiDeleteUser,
  apiDeleteWikiTerm,
  apiAdminCreateUser,
  apiUpdateChapter,
  apiUpdateCourse,
  apiUpdateLesson,
  apiUpdateUser,
  apiUpdateWikiTerm,
} from '../../api/elearningClient';
import { Badge, Button, SurfacePanel } from '../ui/Primitives';
import { ROLE_DISPLAY_LABELS } from './AuthPage';

interface CrudManagementViewProps {
  currentRole: UserRole;
  courses: DiscoverableCourse[];
  onCoursesChange: React.Dispatch<React.SetStateAction<DiscoverableCourse[]>>;
  chapters: CurriculumChapterNode[];
  onChaptersChange: React.Dispatch<React.SetStateAction<CurriculumChapterNode[]>>;
  wikiTerms: Record<string, WikiTermPopoverData>;
  onWikiTermsChange: React.Dispatch<React.SetStateAction<Record<string, WikiTermPopoverData>>>;
  usersList: AuthenticatedUser[];
  onUsersListChange: React.Dispatch<React.SetStateAction<AuthenticatedUser[]>>;
  onNotify: (message: string, detail?: string) => void;
}

type CrudTab = 'COURSES' | 'CURRICULUM' | 'WIKI' | 'USERS';

const POLICY_LABELS: Record<EnrollmentPolicy, string> = {
  ASSIGNED_ONLY: 'Phân lớp chính khóa',
  REQUEST_APPROVAL: 'Xét duyệt đăng ký',
  SELF_ENROLL: 'Mở ghi danh tự do',
};

const LESSON_STATUS_LABELS: Record<'COMPLETED' | 'IN_PROGRESS' | 'LOCKED', string> = {
  COMPLETED: 'Đã hoàn thành',
  IN_PROGRESS: 'Đang mở học',
  LOCKED: 'Đang khóa điều kiện',
};

export const CrudManagementView: React.FC<CrudManagementViewProps> = ({
  currentRole,
  courses,
  onCoursesChange,
  chapters,
  onChaptersChange,
  wikiTerms,
  onWikiTermsChange,
  usersList,
  onUsersListChange,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<CrudTab>('COURSES');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  // =========================================================================
  // 1. COURSES CRUD STATE
  // =========================================================================
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [showCourseForm, setShowCourseForm] = useState<boolean>(false);
  const [courseCode, setCourseCode] = useState<string>('');
  const [courseTitle, setCourseTitle] = useState<string>('');
  const [courseInstructor, setCourseInstructor] = useState<string>('TS. Lê Hoàng Nam');
  const [courseDepartment, setCourseDepartment] = useState<string>('Khoa Công nghệ Phần mềm');
  const [courseChaptersCount, setCourseChaptersCount] = useState<number>(6);
  const [courseLessonsCount, setCourseLessonsCount] = useState<number>(24);
  const [coursePolicy, setCoursePolicy] = useState<EnrollmentPolicy>('ASSIGNED_ONLY');
  const [courseAssigned, setCourseAssigned] = useState<boolean>(true);

  const openCreateCourseForm = () => {
    setEditingCourseId(null);
    setCourseCode(`SE-${Math.floor(200 + Math.random() * 700)}`);
    setCourseTitle('');
    setCourseInstructor('TS. Lê Hoàng Nam');
    setCourseDepartment('Khoa Công nghệ Phần mềm');
    setCourseChaptersCount(6);
    setCourseLessonsCount(24);
    setCoursePolicy('ASSIGNED_ONLY');
    setCourseAssigned(true);
    setShowCourseForm(true);
  };

  const openEditCourseForm = (c: DiscoverableCourse) => {
    setEditingCourseId(c.id);
    setCourseCode(c.code);
    setCourseTitle(c.title);
    setCourseInstructor(c.instructor_name);
    setCourseDepartment(c.department_name);
    setCourseChaptersCount(c.chapters_count);
    setCourseLessonsCount(c.lessons_count);
    setCoursePolicy(c.enrollment_policy);
    setCourseAssigned(c.is_assigned_to_student);
    setShowCourseForm(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseTitle.trim() || !courseCode.trim()) return;

    const payload: Partial<DiscoverableCourse> = {
      code: courseCode.trim().toUpperCase(),
      title: courseTitle.trim(),
      instructor_name: courseInstructor.trim(),
      department_name: courseDepartment.trim(),
      chapters_count: Number(courseChaptersCount) || 1,
      lessons_count: Number(courseLessonsCount) || 1,
      enrollment_policy: coursePolicy,
      is_assigned_to_student: courseAssigned,
    };

    if (editingCourseId) {
      onCoursesChange((prev) =>
        prev.map((item) => (item.id === editingCourseId ? { ...item, ...payload } : item))
      );
      void apiUpdateCourse(editingCourseId, payload, currentRole).catch(() => null);
      onNotify(
        `Đã cập nhật khóa học "${payload.title}"`,
        `Mã học phần: ${payload.code} • Chính sách: ${POLICY_LABELS[coursePolicy]}`
      );
    } else {
      const tempId = `crs_${Date.now()}`;
      const optimisticCourse: DiscoverableCourse = {
        id: tempId,
        code: payload.code!,
        title: payload.title!,
        instructor_name: payload.instructor_name!,
        department_name: payload.department_name!,
        chapters_count: payload.chapters_count!,
        lessons_count: payload.lessons_count!,
        progress_pct: 0,
        enrollment_policy: coursePolicy,
        enrollment_status: courseAssigned ? 'ENROLLED' : 'NOT_ENROLLED',
        is_assigned_to_student: courseAssigned,
      };
      onCoursesChange((prev) => [optimisticCourse, ...prev]);
      void apiCreateCourse(payload, currentRole)
        .then((created) => {
          onCoursesChange((prev) => prev.map((c) => (c.id === tempId ? created : c)));
        })
        .catch(() => null);
      onNotify(
        `Đã thêm khóa học mới "${payload.title}"`,
        `Khóa học đã được lưu vào danh mục đào tạo với mã ${payload.code}.`
      );
    }
    setShowCourseForm(false);
    setEditingCourseId(null);
  };

  const handleDeleteCourse = (course: DiscoverableCourse) => {
    onCoursesChange((prev) => prev.filter((item) => item.id !== course.id));
    void apiDeleteCourse(course.id, currentRole).catch(() => null);
    onNotify(`Đã xóa khóa học "${course.title}"`, `Mã học phần ${course.code} đã được gỡ bỏ.`);
  };

  // =========================================================================
  // 2. CHAPTERS & LESSONS CRUD STATE
  // =========================================================================
  const [newChapterCode, setNewChapterCode] = useState<string>('');
  const [newChapterTitle, setNewChapterTitle] = useState<string>('');
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);

  const [showLessonFormForChapter, setShowLessonFormForChapter] = useState<string | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonCode, setLessonCode] = useState<string>('');
  const [lessonTitle, setLessonTitle] = useState<string>('');
  const [lessonDuration, setLessonDuration] = useState<number>(20);
  const [lessonStatus, setLessonStatus] = useState<'COMPLETED' | 'IN_PROGRESS' | 'LOCKED'>('IN_PROGRESS');
  const [lessonUnlockText, setLessonUnlockText] = useState<string>('');

  const handleSaveChapter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterCode.trim() || !newChapterTitle.trim()) return;

    if (editingChapterId) {
      onChaptersChange((prev) =>
        prev.map((ch) =>
          ch.id === editingChapterId
            ? { ...ch, code: newChapterCode.trim(), title: newChapterTitle.trim() }
            : ch
        )
      );
      void apiUpdateChapter(
        editingChapterId,
        { code: newChapterCode.trim(), title: newChapterTitle.trim() },
        currentRole
      ).catch(() => null);
      onNotify(`Đã cập nhật ${newChapterCode}: ${newChapterTitle}`);
      setEditingChapterId(null);
    } else {
      const tempId = `ch_${Date.now()}`;
      const newChapter: CurriculumChapterNode = {
        id: tempId,
        code: newChapterCode.trim(),
        title: newChapterTitle.trim(),
        progress_pct: 0,
        lessons: [],
      };
      onChaptersChange((prev) => [...prev, newChapter]);
      void apiCreateChapter(
        { course_id: courses[0]?.id, code: newChapter.code, title: newChapter.title },
        currentRole
      )
        .then((created) => {
          onChaptersChange((prev) =>
            prev.map((ch) => (ch.id === tempId ? { ...created, lessons: [] } : ch))
          );
        })
        .catch(() => null);
      onNotify(`Đã tạo mới ${newChapter.code}: ${newChapter.title}`);
    }
    setNewChapterCode('');
    setNewChapterTitle('');
  };

  const handleDeleteChapter = (ch: CurriculumChapterNode) => {
    onChaptersChange((prev) => prev.filter((item) => item.id !== ch.id));
    void apiDeleteChapter(ch.id, currentRole).catch(() => null);
    onNotify(`Đã xóa ${ch.code}: ${ch.title}`);
  };

  const openCreateLesson = (chapterId: string, nextIndex: number) => {
    setShowLessonFormForChapter(chapterId);
    setEditingLessonId(null);
    setLessonCode(`3.${nextIndex}`);
    setLessonTitle('');
    setLessonDuration(20);
    setLessonStatus('IN_PROGRESS');
    setLessonUnlockText('Hoàn thành tối thiểu 85% video và câu hỏi kiểm tra nhanh');
  };

  const openEditLesson = (chapterId: string, lesson: CurriculumLessonNode) => {
    setShowLessonFormForChapter(chapterId);
    setEditingLessonId(lesson.id);
    setLessonCode(lesson.code);
    setLessonTitle(lesson.title);
    setLessonDuration(lesson.duration_minutes);
    setLessonStatus(lesson.status);
    setLessonUnlockText(lesson.unlock_condition_text || '');
  };

  const handleSaveLesson = (e: React.FormEvent, chapterId: string) => {
    e.preventDefault();
    if (!lessonTitle.trim() || !lessonCode.trim()) return;

    if (editingLessonId) {
      onChaptersChange((prev) =>
        prev.map((ch) =>
          ch.id !== chapterId
            ? ch
            : {
                ...ch,
                lessons: ch.lessons.map((l) =>
                  l.id === editingLessonId
                    ? {
                        ...l,
                        code: lessonCode.trim(),
                        title: lessonTitle.trim(),
                        duration_minutes: Number(lessonDuration) || 15,
                        status: lessonStatus,
                        unlock_condition_text: lessonUnlockText.trim() || undefined,
                      }
                    : l
                ),
              }
        )
      );
      void apiUpdateLesson(
        editingLessonId,
        {
          code: lessonCode.trim(),
          title: lessonTitle.trim(),
          duration_minutes: Number(lessonDuration) || 15,
          status: lessonStatus,
          unlock_condition_text: lessonUnlockText.trim() || undefined,
        },
        currentRole
      ).catch(() => null);
      onNotify(`Đã cập nhật bài giảng ${lessonCode}: ${lessonTitle}`);
    } else {
      const tempId = `les_${Date.now()}`;
      const newLesson: CurriculumLessonNode = {
        id: tempId,
        code: lessonCode.trim(),
        title: lessonTitle.trim(),
        duration_minutes: Number(lessonDuration) || 15,
        status: lessonStatus,
        unlock_condition_text: lessonUnlockText.trim() || undefined,
        last_video_position_sec: 0,
        total_video_seconds: (Number(lessonDuration) || 15) * 60,
      };
      onChaptersChange((prev) =>
        prev.map((ch) =>
          ch.id === chapterId ? { ...ch, lessons: [...ch.lessons, newLesson] } : ch
        )
      );
      void apiCreateLesson(
        {
          chapter_id: chapterId,
          code: newLesson.code,
          title: newLesson.title,
          duration_minutes: newLesson.duration_minutes,
          status: newLesson.status,
          unlock_condition_text: newLesson.unlock_condition_text,
        },
        currentRole
      )
        .then((created) => {
          onChaptersChange((prev) =>
            prev.map((ch) =>
              ch.id !== chapterId
                ? ch
                : {
                    ...ch,
                    lessons: ch.lessons.map((l) => (l.id === tempId ? created : l)),
                  }
            )
          );
        })
        .catch(() => null);
      onNotify(`Đã thêm bài giảng mới ${newLesson.code}: ${newLesson.title}`);
    }
    setShowLessonFormForChapter(null);
    setEditingLessonId(null);
  };

  const handleDeleteLesson = (chapterId: string, lesson: CurriculumLessonNode) => {
    onChaptersChange((prev) =>
      prev.map((ch) =>
        ch.id !== chapterId
          ? ch
          : { ...ch, lessons: ch.lessons.filter((l) => l.id !== lesson.id) }
      )
    );
    void apiDeleteLesson(lesson.id, currentRole).catch(() => null);
    onNotify(`Đã xóa bài giảng ${lesson.code}: ${lesson.title}`);
  };

  // =========================================================================
  // 3. WIKI TERMS CRUD STATE
  // =========================================================================
  const [editingWikiId, setEditingWikiId] = useState<string | null>(null);
  const [showWikiForm, setShowWikiForm] = useState<boolean>(false);
  const [wikiName, setWikiName] = useState<string>('');
  const [wikiAliases, setWikiAliases] = useState<string>('');
  const [wikiSubject, setWikiSubject] = useState<string>('Thiết kế Hệ thống Phân tán (SE302)');
  const [wikiDefinition, setWikiDefinition] = useState<string>('');
  const [wikiFormula, setWikiFormula] = useState<string>('');

  const openCreateWiki = () => {
    setEditingWikiId(null);
    setWikiName('');
    setWikiAliases('');
    setWikiSubject('Thiết kế Hệ thống Phân tán (SE302)');
    setWikiDefinition('');
    setWikiFormula('');
    setShowWikiForm(true);
  };

  const openEditWiki = (wt: WikiTermPopoverData) => {
    setEditingWikiId(wt.id);
    setWikiName(wt.canonical_name);
    setWikiAliases(wt.aliases.join(', '));
    setWikiSubject(wt.subject_context);
    setWikiDefinition(wt.short_definition);
    setWikiFormula(wt.formula_or_example || '');
    setShowWikiForm(true);
  };

  const handleSaveWiki = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wikiName.trim() || !wikiDefinition.trim()) return;
    const parsedAliases = wikiAliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (editingWikiId) {
      const updatedTerm: WikiTermPopoverData = {
        id: editingWikiId,
        canonical_name: wikiName.trim(),
        aliases: parsedAliases,
        subject_context: wikiSubject.trim(),
        short_definition: wikiDefinition.trim(),
        formula_or_example: wikiFormula.trim() || undefined,
      };
      onWikiTermsChange((prev) => ({ ...prev, [editingWikiId]: updatedTerm }));
      void apiUpdateWikiTerm(editingWikiId, updatedTerm, currentRole).catch(() => null);
      onNotify(`Đã cập nhật thuật ngữ "${updatedTerm.canonical_name}"`);
    } else {
      const tempId = `wt_${Date.now()}`;
      const newTerm: WikiTermPopoverData = {
        id: tempId,
        canonical_name: wikiName.trim(),
        aliases: parsedAliases,
        subject_context: wikiSubject.trim(),
        short_definition: wikiDefinition.trim(),
        formula_or_example: wikiFormula.trim() || undefined,
      };
      onWikiTermsChange((prev) => ({ ...prev, [tempId]: newTerm }));
      void apiCreateWikiTerm(
        {
          canonical_name: newTerm.canonical_name,
          aliases: newTerm.aliases,
          subject_context: newTerm.subject_context,
          short_definition: newTerm.short_definition,
          formula_or_example: newTerm.formula_or_example,
        },
        currentRole
      )
        .then((created) => {
          onWikiTermsChange((prev) => {
            const copy = { ...prev };
            delete copy[tempId];
            copy[created.id] = created;
            return copy;
          });
        })
        .catch(() => null);
      onNotify(`Đã thêm thuật ngữ mới "${newTerm.canonical_name}" vào Từ điển học thuật`);
    }
    setShowWikiForm(false);
    setEditingWikiId(null);
  };

  const handleDeleteWiki = (wt: WikiTermPopoverData) => {
    onWikiTermsChange((prev) => {
      const copy = { ...prev };
      delete copy[wt.id];
      return copy;
    });
    void apiDeleteWikiTerm(wt.id, currentRole).catch(() => null);
    onNotify(`Đã xóa thuật ngữ "${wt.canonical_name}"`);
  };

  // =========================================================================
  // 4. USERS CRUD STATE
  // =========================================================================
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState<boolean>(false);
  const [usrFullName, setUsrFullName] = useState<string>('');
  const [usrEmail, setUsrEmail] = useState<string>('');
  const [usrCode, setUsrCode] = useState<string>('');
  const [usrRole, setUsrRole] = useState<UserRole>('STUDENT');
  const [usrPassword, setUsrPassword] = useState<string>('123456');

  const openCreateUser = () => {
    setEditingUserId(null);
    setUsrFullName('');
    setUsrEmail('');
    setUsrCode(`SV${Math.floor(2026100 + Math.random() * 899)}`);
    setUsrRole('STUDENT');
    setUsrPassword('123456');
    setShowUserForm(true);
  };

  const openEditUser = (u: AuthenticatedUser) => {
    setEditingUserId(u.id);
    setUsrFullName(u.full_name);
    setUsrEmail(u.email);
    setUsrCode(u.code);
    setUsrRole((u.roles?.[0] || 'STUDENT') as UserRole);
    setShowUserForm(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usrFullName.trim() || !usrEmail.trim()) return;

    if (editingUserId) {
      onUsersListChange((prev) =>
        prev.map((u) =>
          u.id === editingUserId
            ? {
                ...u,
                full_name: usrFullName.trim(),
                email: usrEmail.trim().toLowerCase(),
                code: usrCode.trim().toUpperCase(),
                roles: [usrRole],
              }
            : u
        )
      );
      void apiUpdateUser(
        editingUserId,
        {
          full_name: usrFullName.trim(),
          email: usrEmail.trim().toLowerCase(),
          code: usrCode.trim().toUpperCase(),
          role: usrRole,
        },
        currentRole
      ).catch(() => null);
      onNotify(
        `Đã cập nhật tài khoản "${usrFullName}"`,
        `Vai trò hiện tại: ${ROLE_DISPLAY_LABELS[usrRole]}`
      );
    } else {
      try {
        const created = await apiAdminCreateUser({
          full_name: usrFullName.trim(),
          email: usrEmail.trim(),
          code: usrCode.trim() || undefined,
          role: usrRole,
          password: usrPassword || '123456',
        });
        onUsersListChange((prev) => [...prev, created]);
        onNotify(
          `Đã tạo tài khoản "${created.full_name}"`,
          `Mã số: ${created.code} • ${ROLE_DISPLAY_LABELS[usrRole]}`
        );
      } catch (err: any) {
        onNotify('Không thể tạo tài khoản', err?.message || 'Vui lòng kiểm tra lại thông tin.');
        return;
      }
    }
    setShowUserForm(false);
    setEditingUserId(null);
  };

  const handleDeleteUser = (u: AuthenticatedUser) => {
    onUsersListChange((prev) => prev.filter((item) => item.id !== u.id));
    void apiDeleteUser(u.id, currentRole).catch(() => null);
    onNotify(`Đã xóa tài khoản "${u.full_name}" (${u.code})`);
  };

  const filteredCourses = courses.filter(
    (c) =>
      !searchKeyword.trim() ||
      c.title.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      c.code.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      c.instructor_name.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const wikiList = Object.values(wikiTerms).filter(
    (w) =>
      !searchKeyword.trim() ||
      w.canonical_name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      w.short_definition.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  const filteredUsers = usersList.filter(
    (u) =>
      !searchKeyword.trim() ||
      u.full_name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      u.email.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      u.code.toLowerCase().includes(searchKeyword.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* TOP SUMMARY & SUB-NAVIGATION */}
      <SurfacePanel>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <Badge tone="learning">QUẢN LÝ HỌC VỤ</Badge>
            <h1 style={{ fontSize: 'var(--text-h2)', margin: '8px 0 4px 0' }}>
              Trung tâm Quản lý Học vụ & Nội dung Đào tạo
            </h1>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)' }}>
              Thêm mới, chỉnh sửa và quản lý trọn vẹn Khóa học, Chương mục bài giảng, Từ điển thuật ngữ và Tài khoản người dùng.
            </p>
          </div>

          {/* Search Input */}
          <div style={{ flex: '1 1 260px', minWidth: 0, maxWidth: '380px' }}>
            <input
              type="search"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="🔍 Tìm nhanh theo tên, mã học phần, giảng viên..."
              style={{
                width: '100%',
                minHeight: '44px',
                padding: '0 16px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface-subtle)',
                color: 'var(--text-primary)',
                fontSize: '13px',
              }}
            />
          </div>
        </div>

        {/* Category Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <Button
            variant={activeTab === 'COURSES' ? 'primary' : 'subtle'}
            size="sm"
            onClick={() => setActiveTab('COURSES')}
          >
            📚 Quản lý Khóa học ({courses.length})
          </Button>
          <Button
            variant={activeTab === 'CURRICULUM' ? 'primary' : 'subtle'}
            size="sm"
            onClick={() => setActiveTab('CURRICULUM')}
          >
            📑 Quản lý Chương & Bài giảng ({chapters.reduce((acc, c) => acc + c.lessons.length, 0)} bài)
          </Button>
          <Button
            variant={activeTab === 'WIKI' ? 'primary' : 'subtle'}
            size="sm"
            onClick={() => setActiveTab('WIKI')}
          >
            📖 Từ điển Thuật ngữ ({Object.keys(wikiTerms).length})
          </Button>
          {currentRole === 'ADMIN' && (
            <Button
              variant={activeTab === 'USERS' ? 'primary' : 'subtle'}
              size="sm"
              onClick={() => setActiveTab('USERS')}
            >
              👥 Tài khoản ({usersList.length})
            </Button>
          )}
        </div>
      </SurfacePanel>

      {/* =====================================================================
          TAB 1: COURSES CRUD
          ===================================================================== */}
      {activeTab === 'COURSES' && (
        <SurfacePanel>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '20px',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Danh mục Khóa học Đào tạo</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Cấu hình thông tin môn học, giảng viên phụ trách và phương thức tham gia cho học viên.
              </p>
            </div>
            <Button variant="primary" size="md" onClick={openCreateCourseForm}>
              + Thêm khóa học mới
            </Button>
          </div>

          {showCourseForm && (
            <form
              onSubmit={handleSaveCourse}
              style={{
                backgroundColor: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-md)',
                padding: '20px',
                marginBottom: '24px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '16px',
              }}
            >
              <div style={{ gridColumn: '1 / -1' }}>
                <strong style={{ fontSize: '15px' }}>
                  {editingCourseId ? 'Chỉnh sửa thông tin khóa học' : 'Tạo khóa học mới'}
                </strong>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 600 }}>
                <span>Mã học phần *</span>
                <input
                  type="text"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  required
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <span>Tên khóa học *</span>
                <input
                  type="text"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="Nhập tên khóa học..."
                  required
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Giảng viên phụ trách</span>
                <input
                  type="text"
                  value={courseInstructor}
                  onChange={(e) => setCourseInstructor(e.target.value)}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Khoa / Đơn vị quản lý</span>
                <input
                  type="text"
                  value={courseDepartment}
                  onChange={(e) => setCourseDepartment(e.target.value)}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Phương thức tham gia</span>
                <select
                  value={coursePolicy}
                  onChange={(e) => setCoursePolicy(e.target.value as EnrollmentPolicy)}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  <option value="ASSIGNED_ONLY">Phân lớp chính khóa (Mặc định)</option>
                  <option value="REQUEST_APPROVAL">Xét duyệt đăng ký (Môn tự chọn)</option>
                  <option value="SELF_ENROLL">Mở ghi danh tự do (Khóa kỹ năng chung)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Số chương học</span>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={courseChaptersCount}
                  onChange={(e) => setCourseChaptersCount(Number(e.target.value))}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Tổng số bài giảng</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={courseLessonsCount}
                  onChange={(e) => setCourseLessonsCount(Number(e.target.value))}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '13px',
                  fontWeight: 600,
                  paddingTop: '22px',
                }}
              >
                <input
                  type="checkbox"
                  checked={courseAssigned}
                  onChange={(e) => setCourseAssigned(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <span>Đã phân công vào danh sách lớp của Học viên</span>
              </label>

              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                }}
              >
                <Button variant="subtle" size="sm" onClick={() => setShowCourseForm(false)}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  {editingCourseId ? 'Lưu cập nhật' : 'Tạo khóa học'}
                </Button>
              </div>
            </form>
          )}

          {/* Courses Table / List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredCourses.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '16px',
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ flex: '1 1 360px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <Badge tone="neutral">{c.code}</Badge>
                    <Badge
                      tone={
                        c.enrollment_policy === 'ASSIGNED_ONLY'
                          ? 'learning'
                          : c.enrollment_policy === 'REQUEST_APPROVAL'
                            ? 'warning'
                            : 'success'
                      }
                    >
                      {POLICY_LABELS[c.enrollment_policy]}
                    </Badge>
                    {!c.is_assigned_to_student && c.enrollment_policy === 'ASSIGNED_ONLY' && (
                      <Badge tone="danger">Ẩn với học viên ngoài lớp</Badge>
                    )}
                  </div>
                  <h3 style={{ margin: '8px 0 4px 0', fontSize: '16px' }}>{c.title}</h3>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Giảng viên: <strong>{c.instructor_name}</strong> • Đơn vị: {c.department_name} •{' '}
                    <span className="tabular-nums">
                      {c.chapters_count} chương ({c.lessons_count} bài học)
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <Button variant="secondary" size="sm" onClick={() => openEditCourseForm(c)}>
                    Chỉnh sửa
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDeleteCourse(c)}>
                    Xóa
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SurfacePanel>
      )}

      {/* =====================================================================
          TAB 2: CHAPTERS & LESSONS CRUD
          ===================================================================== */}
      {activeTab === 'CURRICULUM' && (
        <SurfacePanel>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Quản lý Cấu trúc Chương & Bài giảng</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Thêm chương mới, cập nhật bài giảng và cấu hình điều kiện hoàn thành để mở khóa bài tiếp theo.
            </p>
          </div>

          {/* Add / Update Chapter Bar */}
          <form
            onSubmit={handleSaveChapter}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-strong)',
              marginBottom: '20px',
            }}
          >
            <input
              type="text"
              value={newChapterCode}
              onChange={(e) => setNewChapterCode(e.target.value)}
              placeholder="Số hiệu chương (VD: Chương 4)"
              required
              style={{
                flex: '1 1 160px',
                minWidth: 0,
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
            <input
              type="text"
              value={newChapterTitle}
              onChange={(e) => setNewChapterTitle(e.target.value)}
              placeholder="Nhập tên chương học..."
              required
              style={{
                flex: '2 1 240px',
                minWidth: 0,
                minHeight: '44px',
                padding: '0 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-strong)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
            <Button type="submit" variant="primary" size="md">
              {editingChapterId ? 'Lưu tên Chương' : '+ Thêm Chương mới'}
            </Button>
            {editingChapterId && (
              <Button
                variant="subtle"
                size="md"
                onClick={() => {
                  setEditingChapterId(null);
                  setNewChapterCode('');
                  setNewChapterTitle('');
                }}
              >
                Hủy
              </Button>
            )}
          </form>

          {/* Chapters List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {chapters.map((ch) => (
              <div
                key={ch.id}
                style={{
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-surface)',
                  overflow: 'hidden',
                }}
              >
                {/* Chapter Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '14px 18px',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <Badge tone="learning">{ch.code}</Badge>
                    <strong style={{ fontSize: '16px', marginLeft: '10px' }}>{ch.title}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openCreateLesson(ch.id, ch.lessons.length + 1)}
                    >
                      + Thêm bài giảng
                    </Button>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => {
                        setEditingChapterId(ch.id);
                        setNewChapterCode(ch.code);
                        setNewChapterTitle(ch.title);
                      }}
                    >
                      Đổi tên chương
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDeleteChapter(ch)}>
                      Xóa chương
                    </Button>
                  </div>
                </div>

                {/* Inline Lesson Form */}
                {showLessonFormForChapter === ch.id && (
                  <form
                    onSubmit={(e) => handleSaveLesson(e, ch.id)}
                    style={{
                      padding: '16px',
                      backgroundColor: 'var(--bg-surface-subtle)',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
                      gap: '12px',
                    }}
                  >
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
                      <span>Thứ tự bài *</span>
                      <input
                        type="text"
                        value={lessonCode}
                        onChange={(e) => setLessonCode(e.target.value)}
                        required
                        style={{
                          minHeight: '44px',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </label>

                    <label
                      style={{
                        gridColumn: '1 / -1',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <span>Tiêu đề bài giảng *</span>
                      <input
                        type="text"
                        value={lessonTitle}
                        onChange={(e) => setLessonTitle(e.target.value)}
                        required
                        style={{
                          minHeight: '44px',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
                      <span>Thời lượng (phút)</span>
                      <input
                        type="number"
                        min={5}
                        max={180}
                        value={lessonDuration}
                        onChange={(e) => setLessonDuration(Number(e.target.value))}
                        style={{
                          minHeight: '44px',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 600 }}>
                      <span>Trạng thái mở khóa</span>
                      <select
                        value={lessonStatus}
                        onChange={(e) =>
                          setLessonStatus(e.target.value as 'COMPLETED' | 'IN_PROGRESS' | 'LOCKED')
                        }
                        style={{
                          minHeight: '44px',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <option value="IN_PROGRESS">Đang mở học</option>
                        <option value="COMPLETED">Đã hoàn thành</option>
                        <option value="LOCKED">Đang khóa điều kiện</option>
                      </select>
                    </label>

                    <label
                      style={{
                        gridColumn: '1 / -1',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <span>Mô tả điều kiện mở khóa (nếu khóa)</span>
                      <input
                        type="text"
                        value={lessonUnlockText}
                        onChange={(e) => setLessonUnlockText(e.target.value)}
                        style={{
                          minHeight: '44px',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-strong)',
                          backgroundColor: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </label>

                    <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => setShowLessonFormForChapter(null)}
                      >
                        Đóng
                      </Button>
                      <Button type="submit" variant="primary" size="sm">
                        {editingLessonId ? 'Cập nhật bài giảng' : 'Lưu bài giảng mới'}
                      </Button>
                    </div>
                  </form>
                )}

                {/* Lessons Rows */}
                <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {ch.lessons.map((les) => (
                    <div
                      key={les.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <strong className="tabular-nums">Bài {les.code}:</strong>
                          <strong>{les.title}</strong>
                          <Badge
                            tone={
                              les.status === 'COMPLETED'
                                ? 'success'
                                : les.status === 'IN_PROGRESS'
                                  ? 'learning'
                                  : 'warning'
                            }
                          >
                            {LESSON_STATUS_LABELS[les.status]}
                          </Badge>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Thời lượng: <strong className="tabular-nums">{les.duration_minutes} phút</strong>
                          {les.unlock_condition_text ? ` • Điều kiện: ${les.unlock_condition_text}` : ''}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditLesson(ch.id, les)}
                        >
                          Sửa bài
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteLesson(ch.id, les)}
                        >
                          Xóa
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SurfacePanel>
      )}

      {/* =====================================================================
          TAB 3: WIKI TERMS CRUD
          ===================================================================== */}
      {activeTab === 'WIKI' && (
        <SurfacePanel>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '20px',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Từ điển Thuật ngữ Chuyên ngành</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Các thuật ngữ tại đây được liên kết trực tiếp với cửa sổ giải nghĩa nhanh trong bài giảng.
              </p>
            </div>
            <Button variant="primary" size="md" onClick={openCreateWiki}>
              + Thêm thuật ngữ mới
            </Button>
          </div>

          {showWikiForm && (
            <form
              onSubmit={handleSaveWiki}
              style={{
                backgroundColor: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-md)',
                padding: '20px',
                marginBottom: '24px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '16px',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Tên thuật ngữ chuẩn *</span>
                <input
                  type="text"
                  value={wikiName}
                  onChange={(e) => setWikiName(e.target.value)}
                  required
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Tên gọi tương đương (cách nhau dấu phẩy)</span>
                <input
                  type="text"
                  value={wikiAliases}
                  onChange={(e) => setWikiAliases(e.target.value)}
                  placeholder="VD: Raft Consensus, Majority Quorum"
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Môn học áp dụng</span>
                <input
                  type="text"
                  value={wikiSubject}
                  onChange={(e) => setWikiSubject(e.target.value)}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Công thức hoặc Ví dụ minh họa</span>
                <input
                  type="text"
                  value={wikiFormula}
                  onChange={(e) => setWikiFormula(e.target.value)}
                  placeholder="VD: Q = floor(N/2) + 1"
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <span>Định nghĩa học thuật ngắn gọn *</span>
                <textarea
                  rows={3}
                  value={wikiDefinition}
                  onChange={(e) => setWikiDefinition(e.target.value)}
                  required
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                  }}
                />
              </label>

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <Button variant="subtle" size="sm" onClick={() => setShowWikiForm(false)}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Lưu thuật ngữ
                </Button>
              </div>
            </form>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '16px' }}>
            {wikiList.map((wt) => (
              <div
                key={wt.id}
                style={{
                  padding: '18px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <Badge tone="learning">{wt.subject_context}</Badge>
                  <h3 style={{ margin: '10px 0 4px 0', fontSize: '16px' }}>{wt.canonical_name}</h3>
                  {wt.aliases.length > 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Tên gọi khác: {wt.aliases.join(' • ')}
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.55 }}>{wt.short_definition}</p>
                  {wt.formula_or_example && (
                    <div
                      style={{
                        marginTop: '10px',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                      }}
                    >
                      {wt.formula_or_example}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <Button variant="secondary" size="sm" onClick={() => openEditWiki(wt)}>
                    Chỉnh sửa
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDeleteWiki(wt)}>
                    Xóa
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SurfacePanel>
      )}

      {/* =====================================================================
          TAB 4: USERS & ROLES CRUD
          ===================================================================== */}
      {activeTab === 'USERS' && currentRole === 'ADMIN' && (
        <SurfacePanel>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '20px',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Danh sách Tài khoản & Phân quyền</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Quản lý thông tin định danh học viên, giảng viên, trợ giảng và cán bộ quản lý đào tạo.
              </p>
            </div>
            <Button variant="primary" size="md" onClick={openCreateUser}>
              + Tạo tài khoản mới
            </Button>
          </div>

          {showUserForm && (
            <form
              onSubmit={handleSaveUser}
              style={{
                backgroundColor: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-md)',
                padding: '20px',
                marginBottom: '24px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: '16px',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Họ và tên *</span>
                <input
                  type="text"
                  value={usrFullName}
                  onChange={(e) => setUsrFullName(e.target.value)}
                  required
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Email học thuật *</span>
                <input
                  type="email"
                  value={usrEmail}
                  onChange={(e) => setUsrEmail(e.target.value)}
                  required
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Mã định danh *</span>
                <input
                  type="text"
                  value={usrCode}
                  onChange={(e) => setUsrCode(e.target.value)}
                  required
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                <span>Vai trò hệ thống</span>
                <select
                  value={usrRole}
                  onChange={(e) => setUsrRole(e.target.value as UserRole)}
                  style={{
                    minHeight: '44px',
                    padding: '0 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  <option value="STUDENT">Học viên</option>
                  <option value="INSTRUCTOR">Giảng viên</option>
                  <option value="TEACHING_ASSISTANT">Trợ giảng</option>
                  <option value="ACADEMIC_STAFF">Giáo vụ Khoa</option>
                  <option value="ADMIN">Quản trị viên</option>
                </select>
              </label>

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <Button variant="subtle" size="sm" onClick={() => setShowUserForm(false)}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  {editingUserId ? 'Cập nhật tài khoản' : 'Tạo tài khoản'}
                </Button>
              </div>
            </form>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredUsers.map((u) => {
              const role = (u.roles?.[0] || 'STUDENT') as UserRole;
              return (
                <div
                  key={u.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '15px' }}>{u.full_name}</strong>
                      <Badge tone="learning">{ROLE_DISPLAY_LABELS[role]}</Badge>
                      <Badge tone="neutral">{u.code}</Badge>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Email: {u.email}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="secondary" size="sm" onClick={() => openEditUser(u)}>
                      Sửa thông tin
                    </Button>
                    {role !== 'ADMIN' && (
                      <Button variant="danger" size="sm" onClick={() => handleDeleteUser(u)}>
                        Xóa
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SurfacePanel>
      )}
    </div>
  );
};
