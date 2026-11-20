import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiHttpError } from '../../api/elearningClient';
import {
  BlockDisplayConfig,
  BlockType,
  CompletionRule,
  LessonBlock,
  LessonEditorData,
  LessonVersionItem,
  OutlineChapter,
  QuestionSpec,
  QuizKind,
  Resource,
  StudioClassData,
  StudioClassLessonData,
  StudioCourseData,
  VideoQuizMarker,
  WikiPageItem,
  saveBlob,
  teachingApi,
} from '../api';
import {
  BlockList,
  CALLOUT_TITLES,
  QUIZ_KIND_LABELS,
  SUBMISSION_TYPE_LABELS,
} from '../BlockRenderer';
import { WikiAnnotatedText, WikiReaderProvider, WikiTermTrigger, findMatchedWikiTerms } from '../WikiText';
import {
  Badge,
  Btn,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  ImageUrlInput,
  Loading,
  Modal,
  Tone,
  errMsg,
  fmtBytes,
  fmtDateTime,
  useToast,
  useUnsavedWarning,
} from '../ui';
import { QuestionBankModal, QuestionForm, createDefaultQuestionSpec } from './QuestionEditorFields';
import {
  BlockTypeIcon,
  IconAlertTriangle,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDatabase,
  IconEdit,
  IconEye,
  IconGlobe,
  IconGripVertical,
  IconHistory,
  IconLibrary,
  IconMonitor,
  IconMoreHorizontal,
  IconPlay,
  IconPlus,
  IconRedo,
  IconSearch,
  IconSidebarLeft,
  IconSidebarRight,
  IconSliders,
  IconSmartphone,
  IconTools,
  IconTrash,
  IconUndo,
  IconUpload,
  IconX,
} from './StudioIcons';
import { extractLocalVideoMetadata, formatTimestamp } from './videoAdapter';
import { VideoQuizTimelineEditor } from './VideoQuizTimelineEditor';

type SaveStatus = 'SAVED' | 'DIRTY' | 'SAVING' | 'ERROR' | 'CONFLICT';

const SAVE_STATUS_LABELS: Record<SaveStatus, { text: string; tone: 'success' | 'warning' | 'info' | 'danger' }> = {
  SAVED: { text: 'Đã lưu bản nháp', tone: 'success' },
  DIRTY: { text: 'Có thay đổi chưa lưu', tone: 'warning' },
  SAVING: { text: 'Đang lưu…', tone: 'info' },
  ERROR: { text: 'Lưu chưa thành công', tone: 'danger' },
  CONFLICT: { text: 'Có phiên bản mới hơn từ tab khác', tone: 'danger' },
};

const BLOCK_TYPE_NAMES: Record<string, string> = {
  heading: 'Tiêu đề mục',
  paragraph: 'Đoạn văn bản',
  image: 'Hình ảnh minh họa',
  video: 'Video & Câu hỏi tương tác',
  youtube: 'Video YouTube',
  pdf: 'Tài liệu PDF trực tuyến',
  file: 'Tệp đính kèm',
  table: 'Bảng dữ liệu',
  math: 'Công thức Toán học',
  code: 'Khối mã nguồn',
  code_block: 'Khối mã nguồn',
  quote: 'Trích dẫn',
  callout: 'Hộp ghi chú sư phạm',
  link: 'Liên kết tham khảo',
  quiz: 'Bài kiểm tra (Quiz độc lập)',
  review_question: 'Câu hỏi ôn tập nhanh',
  inline_mcq: 'Câu hỏi trắc nghiệm nhanh',
  assignment: 'Bài tập thực hành',
  assignment_link: 'Liên kết bài tập',
  step_by_step_solution: 'Lời giải từng bước',
  embed: 'Học liệu nhúng an toàn',
};

const BLOCK_PALETTE_GROUPS: Array<{
  group: string;
  items: Array<{ type: BlockType; label: string; quick?: boolean }>;
}> = [
  {
    group: 'Văn bản & Trình bày',
    items: [
      { type: 'paragraph', label: 'Đoạn văn bản', quick: true },
      { type: 'heading', label: 'Tiêu đề mục' },
      { type: 'callout', label: 'Hộp ghi chú' },
      { type: 'quote', label: 'Trích dẫn' },
      { type: 'table', label: 'Bảng dữ liệu' },
      { type: 'math', label: 'Công thức Toán' },
      { type: 'code', label: 'Khối mã nguồn' },
    ],
  },
  {
    group: 'Video & Học liệu số',
    items: [
      { type: 'video', label: 'Video & Quiz', quick: true },
      { type: 'image', label: 'Hình ảnh', quick: true },
      { type: 'pdf', label: 'Tài liệu PDF', quick: true },
      { type: 'file', label: 'Tệp đính kèm' },
      { type: 'link', label: 'Liên kết ngoài' },
      { type: 'embed', label: 'Nhúng mô phỏng' },
    ],
  },
  {
    group: 'Kiểm tra & Bài tập',
    items: [
      { type: 'quiz', label: 'Bài kiểm tra', quick: true },
      { type: 'assignment', label: 'Bài tập nộp' },
    ],
  },
];

const QUICK_PALETTE_ITEMS = BLOCK_PALETTE_GROUPS.flatMap((g) => g.items).filter((it) => it.quick);

function formatChapterHeading(index: number, rawTitle: string): string {
  const title = (rawTitle || '').trim();
  if (!title) return `Chương ${index + 1}`;
  if (/^chương\s+\d+/i.test(title)) return title;
  return `Chương ${index + 1}. ${title}`;
}

function formatLessonHeading(chapterIdx: number, lessonIdx: number, rawTitle: string): string {
  const title = (rawTitle || '').trim();
  if (!title) return `${chapterIdx + 1}.${lessonIdx + 1}. Bài học mới`;
  if (/^(\d+(\.\d+)?[\s.:-]|bài\s+\d+)/i.test(title)) return title;
  return `${chapterIdx + 1}.${lessonIdx + 1}. ${title}`;
}

function getBlockSummary(block: LessonBlock, markerCount: number): string {
  const c = block.content || {};
  switch (block.block_type) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return String(c.text || '').trim().slice(0, 72) || 'Chưa nhập nội dung';
    case 'callout':
      return String(c.title || c.text || '').trim().slice(0, 72) || 'Ghi chú sư phạm';
    case 'video':
    case 'youtube': {
      const title = String(c.title || '').trim() || (c.video_id ? `YouTube (${c.video_id})` : 'Chưa gắn nguồn video');
      return markerCount > 0 ? `${title} · ${markerCount} mốc câu hỏi` : title;
    }
    case 'image':
      return String(c.caption || c.alt || (c.url ? 'Đã gắn hình ảnh' : 'Chưa gắn hình ảnh')).slice(0, 72);
    case 'pdf':
    case 'file':
      return String(c.title || (c.resource_id ? 'Đã đính kèm tệp' : 'Chưa chọn tệp')).slice(0, 72);
    case 'quiz': {
      const qs = Array.isArray(c.questions) ? c.questions.length : 0;
      return `${String(c.title || 'Bài kiểm tra').slice(0, 48)} · ${qs} câu hỏi`;
    }
    case 'assignment':
      return String(c.title || 'Bài tập thực hành').slice(0, 72);
    case 'link':
    case 'embed':
      return String(c.title || c.url || c.embed_url || 'Chưa gắn liên kết').slice(0, 72);
    case 'code':
    case 'code_block':
      return `${c.language || 'code'} · ${String(c.code || '').split('\n')[0]?.slice(0, 52) || ''}`;
    case 'math':
      return String(c.latex || 'Công thức').slice(0, 64);
    case 'table': {
      const rows = Array.isArray(c.rows) ? c.rows.length : 0;
      return `Bảng ${rows} dòng`;
    }
    default:
      return String(c.title || c.prompt || '').slice(0, 72);
  }
}

const ALLOWED_EMBED_HOST_HINTS = [
  { name: 'GeoGebra', example: 'https://www.geogebra.org/material/iframe/id/...' },
  { name: 'PhET Interactive', example: 'https://phet.colorado.edu/sims/html/...' },
  { name: 'Desmos', example: 'https://www.desmos.com/calculator/...' },
  { name: 'YouTube Nocookie', example: 'https://www.youtube-nocookie.com/embed/...' },
];

function makeNewBlock(type: BlockType, resources: Resource[]): LessonBlock {
  const id = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const firstVideo = resources.find((r) => r.resource_type === 'VIDEO');
  const firstPdf = resources.find((r) => r.resource_type === 'PDF' || r.mime_type === 'application/pdf');
  const firstFile = resources[0];

  switch (type) {
    case 'heading':
      return { id, block_type: 'heading', content: { text: 'Tiêu đề phần mới', level: 2 } };
    case 'paragraph':
      return { id, block_type: 'paragraph', content: { text: '' } };
    case 'callout':
      return { id, block_type: 'callout', content: { variant: 'remember', title: 'Ghi nhớ trọng tâm', text: '' } };
    case 'quote':
      return { id, block_type: 'quote', content: { text: '', cite: '' } };
    case 'table':
      return {
        id,
        block_type: 'table',
        content: {
          has_header: true,
          rows: [
            ['Cột 1', 'Cột 2'],
            ['Nội dung 1', 'Nội dung 2'],
          ],
        },
      };
    case 'math':
      return { id, block_type: 'math', content: { latex: '\\frac{a}{b} + \\frac{c}{b} = \\frac{a + c}{b}' } };
    case 'code':
      return { id, block_type: 'code', content: { language: 'python', code: '# Nhập đoạn mã minh họa\n' } };
    case 'image':
      return { id, block_type: 'image', content: { url: '', alt: '', caption: '' } };
    case 'video':
      return {
        id,
        block_type: 'video',
        content: {
          source_type: firstVideo ? 'UPLOAD' : 'YOUTUBE',
          resource_id: firstVideo?.id || '',
          video_id: '',
          direct_url: '',
          title: firstVideo?.title || 'Video bài giảng',
          description: '',
          duration_seconds: firstVideo?.duration_seconds || 0,
          start_seconds: 0,
          allow_seeking_ahead: true,
          thumbnail_url: firstVideo?.thumbnail_url || '',
        },
      };
    case 'pdf':
      return {
        id,
        block_type: 'pdf',
        content: {
          resource_id: firstPdf?.id || '',
          title: firstPdf?.title || 'Tài liệu bài giảng PDF',
          description: '',
          allow_download: true,
        },
      };
    case 'file':
      return {
        id,
        block_type: 'file',
        content: {
          resource_id: firstFile?.id || '',
          title: firstFile?.title || 'Tài liệu học tập',
          description: '',
        },
      };
    case 'link':
      return { id, block_type: 'link', content: { url: 'https://', label: 'Tài liệu tham khảo thêm', description: '' } };
    case 'embed':
      return {
        id,
        block_type: 'embed',
        content: {
          provider: 'GeoGebra',
          embed_url: 'https://www.geogebra.org/classic',
          title: 'Mô phỏng trực quan GeoGebra',
          caption: '',
          height: 420,
        },
      };
    case 'quiz':
      return {
        id,
        block_type: 'quiz',
        content: {
          quiz_kind: 'QUICK_CHECK',
          title: 'Kiểm tra nhanh kiến thức',
          description: 'Hoàn thành các câu hỏi dưới đây để củng cố bài học.',
          pass_score_pct: 60,
          max_attempts: 3,
          is_required: false,
          show_answer_after_submit: true,
          show_explanation: true,
          questions: [createDefaultQuestionSpec('SINGLE_CHOICE')],
        },
      };
    case 'assignment':
      return {
        id,
        block_type: 'assignment',
        content: {
          title: 'Bài tập vận dụng cuối bài',
          description: '',
          instructions: 'Trình bày lời giải chi tiết hoặc đính kèm tệp bài làm.',
          due_at: '',
          max_score: 10,
          submission_type: 'BOTH',
          url: '',
        },
      };
    default:
      return { id, block_type: 'paragraph', content: { text: '' } };
  }
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Không đọc được tệp từ thiết bị.'));
    r.readAsDataURL(file);
  });

export const LessonStudioPage: React.FC<{ mode?: 'COURSE' | 'CLASS' }> = ({ mode: propMode }) => {
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const studioMode: 'COURSE' | 'CLASS' = propMode || (params.classId ? 'CLASS' : 'COURSE');
  const routeCourseId = params.courseId || '';
  const routeLessonId = params.lessonId || '';
  const routeClassId = params.classId || '';

  // Studio Tree & Shell state
  const [courseShell, setCourseShell] = useState<StudioCourseData | null>(null);
  const [classShell, setClassShell] = useState<StudioClassData | null>(null);
  const [shellLoading, setShellLoading] = useState<boolean>(true);
  const [shellError, setShellError] = useState<unknown>(null);

  const [activeLessonId, setActiveLessonId] = useState<string>('');
  const [lessonLoading, setLessonLoading] = useState<boolean>(false);
  const [lessonError, setLessonError] = useState<unknown>(null);

  // Active Lesson Data (Mode A or Mode B)
  const [courseLesson, setCourseLesson] = useState<LessonEditorData | null>(null);
  const [classLesson, setClassLesson] = useState<StudioClassLessonData | null>(null);

  // Editable Draft States
  const [lessonMeta, setLessonMeta] = useState<{
    title: string;
    description: string;
    objectives: string;
    duration_minutes: number;
    completion_rule: CompletionRule;
    min_video_watch_pct: number;
    require_video_quizzes: boolean;
  }>({
    title: '',
    description: '',
    objectives: '',
    duration_minutes: 25,
    completion_rule: 'MANUAL',
    min_video_watch_pct: 80,
    require_video_quizzes: false,
  });

  const [classNoteMeta, setClassNoteMeta] = useState<{
    instructor_note: string;
    custom_objectives: string;
  }>({ instructor_note: '', custom_objectives: '' });

  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [markers, setMarkers] = useState<VideoQuizMarker[]>([]);
  const [revision, setRevision] = useState<number>(1);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('SAVED');
  const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null);

  // Undo / Redo Stack for blocks & markers
  const historyRef = useRef<Array<{ blocks: LessonBlock[]; markers: VideoQuizMarker[] }>>([]);
  const historyIdxRef = useRef<number>(-1);
  const [historyTick, setHistoryTick] = useState<number>(0);

  // UI Panes & Modals
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [leftPaneOpen, setLeftPaneOpen] = useState<boolean>(true);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [inspectorTab, setInspectorTab] = useState<'block' | 'lesson'>('lesson');
  const [mobilePane, setMobilePane] = useState<'tree' | 'canvas' | 'inspector'>('canvas');
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const [expandedInheritedVideoId, setExpandedInheritedVideoId] = useState<string | null>(null);
  const [toolsMenuOpen, setToolsMenuOpen] = useState<boolean>(false);
  const [treeSearch, setTreeSearch] = useState<string>('');
  const [treeMenuKey, setTreeMenuKey] = useState<string | null>(null);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});
  const [videoSetupOpen, setVideoSetupOpen] = useState<Record<string, boolean>>({});
  const [inserterAt, setInserterAt] = useState<number | null>(null);
  const [inserterQuery, setInserterQuery] = useState<string>('');
  const [showAllBottomPalette, setShowAllBottomPalette] = useState<boolean>(false);
  const [dragBlockIdx, setDragBlockIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setToolsMenuOpen(false);
        setTreeMenuKey(null);
        setInserterAt(null);
      }
    };
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target?.closest('[data-ls-popover]')) {
        setToolsMenuOpen(false);
        setTreeMenuKey(null);
        setInserterAt(null);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  // Left tree inline forms
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [addingLessonChapterId, setAddingLessonChapterId] = useState<string | null>(null);
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [renamingChapter, setRenamingChapter] = useState<{ id: string; title: string } | null>(null);
  const [treeConfirm, setTreeConfirm] = useState<null | {
    title: string;
    message: string;
    label: string;
    danger?: boolean;
    run: () => Promise<void>;
  }>(null);

  // Modals: Preview, Question Bank, Versions, Multi-class Publish
  const [previewModal, setPreviewModal] = useState<null | { scope: 'LESSON' | 'VIDEO'; viewport: 'DESKTOP' | 'MOBILE' }>(null);
  const [bankModalOpen, setBankModalOpen] = useState<boolean>(false);
  const [bankForQuizBlockId, setBankForQuizBlockId] = useState<string | null>(null);
  const [versionsModalOpen, setVersionsModalOpen] = useState<boolean>(false);
  const [versionsList, setVersionsList] = useState<LessonVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState<boolean>(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState<boolean>(false);
  const [publishChangeNote, setPublishChangeNote] = useState<string>('');
  const [publishing, setPublishing] = useState<boolean>(false);

  // Active upload state per block (supports cancel via AbortController)
  const uploadAbortRef = useRef<Record<string, AbortController>>({});
  const [uploadingBlockState, setUploadingBlockState] = useState<
    Record<string, { pct: number; fileName: string; kind: 'VIDEO' | 'PDF' | 'FILE' }>
  >({});
  const [linkCheckingId, setLinkCheckingId] = useState<string | null>(null);

  useUnsavedWarning(saveStatus === 'DIRTY' || saveStatus === 'ERROR');

  const resolvedCourseId =
    studioMode === 'COURSE'
      ? courseShell?.course.id || courseLesson?.course.id || routeCourseId
      : classShell?.course.id || '';

  const resources = useMemo<Resource[]>(
    () => (studioMode === 'COURSE' ? courseShell?.resources || [] : classShell?.resources || []),
    [studioMode, courseShell, classShell]
  );

  const wikiPages = useMemo<WikiPageItem[]>(
    () => (studioMode === 'COURSE' ? courseShell?.wiki_pages || [] : classShell?.wiki_pages || []),
    [studioMode, courseShell, classShell]
  );

  const resourceMap = useMemo(() => {
    const m: Record<string, Resource & { available: boolean }> = {};
    resources.forEach((r) => {
      m[r.id] = { ...r, available: r.available !== false };
    });
    return m;
  }, [resources]);

  const canEdit =
    studioMode === 'COURSE'
      ? Boolean(courseLesson?.capabilities.can_edit ?? courseShell?.capabilities.can_edit_draft)
      : Boolean(classLesson?.capabilities.can_edit ?? classShell?.capabilities.can_edit_class_content);

  const canPublish =
    studioMode === 'COURSE'
      ? Boolean(courseLesson?.capabilities.can_publish ?? courseShell?.capabilities.can_publish)
      : Boolean(classLesson?.capabilities.can_publish ?? classShell?.capabilities.can_publish_class_content);

  const canManageTree = studioMode === 'COURSE' && Boolean(courseShell?.capabilities.can_manage);

  // Push snapshot to Undo/Redo stack
  const recordHistory = useCallback((nextBlocks: LessonBlock[], nextMarkers: VideoQuizMarker[]) => {
    const snap = {
      blocks: JSON.parse(JSON.stringify(nextBlocks)),
      markers: JSON.parse(JSON.stringify(nextMarkers)),
    };
    const truncated = historyRef.current.slice(0, historyIdxRef.current + 1);
    truncated.push(snap);
    if (truncated.length > 35) truncated.shift();
    historyRef.current = truncated;
    historyIdxRef.current = truncated.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);

  const applyBlocksAndMarkers = useCallback(
    (nextBlocks: LessonBlock[], nextMarkers: VideoQuizMarker[], markDirty = true) => {
      setBlocks(nextBlocks);
      setMarkers(nextMarkers);
      recordHistory(nextBlocks, nextMarkers);
      if (markDirty) {
        setSaveStatus('DIRTY');
        setSaveErrorDetail(null);
      }
    },
    [recordHistory]
  );

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current >= 0 && historyIdxRef.current < historyRef.current.length - 1;
  // silence unused tick lint while keeping reactivity
  void historyTick;

  const handleUndo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const snap = historyRef.current[historyIdxRef.current];
    setBlocks(JSON.parse(JSON.stringify(snap.blocks)));
    setMarkers(JSON.parse(JSON.stringify(snap.markers)));
    setSaveStatus('DIRTY');
    setHistoryTick((t) => t + 1);
  }, []);

  const handleRedo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const snap = historyRef.current[historyIdxRef.current];
    setBlocks(JSON.parse(JSON.stringify(snap.blocks)));
    setMarkers(JSON.parse(JSON.stringify(snap.markers)));
    setSaveStatus('DIRTY');
    setHistoryTick((t) => t + 1);
  }, []);

  // Load Shell (Course Studio or Class Studio)
  const loadStudioShell = useCallback(
    async (preferredLessonId?: string) => {
      setShellLoading(true);
      setShellError(null);
      try {
        if (studioMode === 'COURSE') {
          let cId = routeCourseId;
          let targetLessonId = preferredLessonId || sp.get('lesson') || routeLessonId || '';
          if (!cId && routeLessonId) {
            const les = await teachingApi.lesson(routeLessonId);
            cId = les.course.id;
            targetLessonId = les.id;
          }
          const data = await teachingApi.studioCourse(cId);
          setCourseShell(data);
          const allLessons = data.outline.flatMap((ch) => ch.lessons);
          const chosen =
            allLessons.find((l) => l.id === targetLessonId)?.id || allLessons[0]?.id || '';
          setActiveLessonId(chosen);
        } else {
          const data = await teachingApi.studioClass(routeClassId);
          setClassShell(data);
          const targetLessonId = preferredLessonId || sp.get('lesson') || '';
          const allLessons = data.outline.flatMap((ch) => ch.lessons);
          const chosen =
            allLessons.find((l) => l.id === targetLessonId)?.id || allLessons[0]?.id || '';
          setActiveLessonId(chosen);
        }
      } catch (err) {
        setShellError(err);
      } finally {
        setShellLoading(false);
      }
    },
    [studioMode, routeCourseId, routeLessonId, routeClassId, sp]
  );

  useEffect(() => {
    void loadStudioShell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode, routeCourseId, routeLessonId, routeClassId]);

  // Load Active Lesson Details
  const loadActiveLesson = useCallback(
    async (lessonId: string) => {
      if (!lessonId) {
        setCourseLesson(null);
        setClassLesson(null);
        return;
      }
      setLessonLoading(true);
      setLessonError(null);
      try {
        if (studioMode === 'COURSE') {
          const data = await teachingApi.lesson(lessonId);
          setCourseLesson(data);
          setLessonMeta({
            title: data.title,
            description: data.description || '',
            objectives: data.objectives || '',
            duration_minutes: data.duration_minutes || 25,
            completion_rule: data.completion_rule || 'MANUAL',
            min_video_watch_pct: data.min_video_watch_pct ?? 80,
            require_video_quizzes: Boolean(data.require_video_quizzes),
          });
          setBlocks(data.blocks || []);
          setMarkers(data.video_markers || []);
          setRevision(data.revision);
          historyRef.current = [
            {
              blocks: JSON.parse(JSON.stringify(data.blocks || [])),
              markers: JSON.parse(JSON.stringify(data.video_markers || [])),
            },
          ];
          historyIdxRef.current = 0;
          setHistoryTick((t) => t + 1);
          setSelectedBlockId(data.blocks?.[0]?.id || null);
          setInspectorTab(data.blocks?.[0] ? 'block' : 'lesson');
          setSaveStatus('SAVED');
          setSaveErrorDetail(null);
        } else {
          const data = await teachingApi.studioClassLesson(routeClassId, lessonId);
          setClassLesson(data);
          setClassNoteMeta({
            instructor_note: data.custom.instructor_note || '',
            custom_objectives: data.custom.custom_objectives || '',
          });
          setBlocks(data.custom_blocks || []);
          setMarkers(data.custom_markers || []);
          setRevision(data.custom.revision || 1);
          historyRef.current = [
            {
              blocks: JSON.parse(JSON.stringify(data.custom_blocks || [])),
              markers: JSON.parse(JSON.stringify(data.custom_markers || [])),
            },
          ];
          historyIdxRef.current = 0;
          setHistoryTick((t) => t + 1);
          setSelectedBlockId(data.custom_blocks?.[0]?.id || null);
          setExpandedInheritedVideoId(null);
          setSaveStatus('SAVED');
          setSaveErrorDetail(null);
        }
      } catch (err) {
        setLessonError(err);
      } finally {
        setLessonLoading(false);
      }
    },
    [studioMode, routeClassId]
  );

  useEffect(() => {
    if (activeLessonId) {
      void loadActiveLesson(activeLessonId);
    }
  }, [activeLessonId, loadActiveLesson]);

  // Save Draft Function (Mode A & Mode B)
  const saveDraftNow = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!activeLessonId || !canEdit) return false;
      setSaveStatus('SAVING');
      setSaveErrorDetail(null);
      try {
        if (studioMode === 'COURSE') {
          await teachingApi.updateLesson(activeLessonId, {
            title: lessonMeta.title.trim() || 'Bài học chưa đặt tên',
            description: lessonMeta.description,
            objectives: lessonMeta.objectives,
            duration_minutes: Math.max(1, Number(lessonMeta.duration_minutes) || 15),
            completion_rule: lessonMeta.completion_rule,
            min_video_watch_pct: Math.max(0, Math.min(100, Number(lessonMeta.min_video_watch_pct) || 0)),
            require_video_quizzes: Boolean(lessonMeta.require_video_quizzes),
          });
          const res = await teachingApi.saveLessonContent(activeLessonId, revision, blocks);
          setRevision(res.revision);
          setBlocks(res.blocks);

          // Persist video quiz markers for valid video/youtube blocks
          const validVideoIds = new Set(
            res.blocks
              .filter((b) => b.block_type === 'video' || b.block_type === 'youtube')
              .map((b) => b.id)
          );
          const validMarkers = markers.filter((m) => validVideoIds.has(m.block_id));
          const mRes = await teachingApi.saveLessonVideoMarkers(activeLessonId, validMarkers);
          setMarkers(mRes.items);
          const refreshedShell = await teachingApi.studioCourse(resolvedCourseId);
          setCourseShell(refreshedShell);
        } else {
          const res = await teachingApi.saveStudioClassLesson(routeClassId, activeLessonId, {
            base_revision: revision,
            instructor_note: classNoteMeta.instructor_note,
            custom_objectives: classNoteMeta.custom_objectives,
            custom_blocks: blocks,
          });
          setRevision(res.revision);
          setBlocks(res.custom_blocks);
          const mRes = await teachingApi.saveStudioClassMarkers(routeClassId, activeLessonId, markers);
          setMarkers(mRes.items);
          const refreshedShell = await teachingApi.studioClass(routeClassId);
          setClassShell(refreshedShell);
        }

        setSaveStatus('SAVED');
        if (!silent) {
          toast({ tone: 'success', title: 'Đã lưu bản nháp giáo án' });
        }
        return true;
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          setSaveStatus('CONFLICT');
          setSaveErrorDetail('Giáo án vừa được cập nhật từ một phiên làm việc khác.');
        } else {
          setSaveStatus('ERROR');
          setSaveErrorDetail(errMsg(err));
          if (!silent) {
            toast({ tone: 'error', title: 'Không lưu được bản nháp', detail: errMsg(err) });
          }
        }
        return false;
      }
    },
    [
      activeLessonId,
      canEdit,
      studioMode,
      lessonMeta,
      revision,
      blocks,
      markers,
      resolvedCourseId,
      routeClassId,
      classNoteMeta,
      toast,
    ]
  );

  // Debounced Autosave (every 3.5s after idle when DIRTY)
  useEffect(() => {
    if (saveStatus !== 'DIRTY' || !canEdit || !activeLessonId) return undefined;
    const timer = window.setTimeout(() => {
      void saveDraftNow(true);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [saveStatus, canEdit, activeLessonId, saveDraftNow]);

  // Keyboard shortcuts: Ctrl+S (Save), Ctrl+Z / Ctrl+Y (Undo/Redo outside text inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveDraftNow(false);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveDraftNow, handleUndo, handleRedo]);

  const handlePublishConfirm = async () => {
    if (!activeLessonId) return;
    setPublishing(true);
    try {
      const saved = await saveDraftNow(true);
      if (!saved) {
        setPublishing(false);
        return;
      }
      if (studioMode === 'COURSE') {
        const res = await teachingApi.publishLesson(activeLessonId, publishChangeNote.trim() || undefined);
        toast({
          tone: 'success',
          title: `Đã xuất bản phiên bản v${res.published_version}`,
          detail: 'Học viên các lớp sử dụng khóa học đã có thể xem nội dung mới.',
        });
        setPublishChangeNote('');
        setPublishDialogOpen(false);
        await loadStudioShell(activeLessonId);
        await loadActiveLesson(activeLessonId);
      } else {
        await teachingApi.publishStudioClassLesson(routeClassId, activeLessonId);
        toast({
          tone: 'success',
          title: 'Đã xuất bản nội dung bổ sung riêng cho lớp',
          detail: 'Chỉ học viên của lớp học này nhìn thấy phần nội dung tùy biến.',
        });
        setPublishDialogOpen(false);
        await loadStudioShell(activeLessonId);
        await loadActiveLesson(activeLessonId);
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Không thể xuất bản giáo án', detail: errMsg(err) });
    } finally {
      setPublishing(false);
    }
  };

  const openVersionHistory = async () => {
    if (!activeLessonId || studioMode !== 'COURSE') return;
    setVersionsModalOpen(true);
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const res = await teachingApi.lessonVersions(activeLessonId);
      setVersionsList(res.items || []);
    } catch (err) {
      const m = errMsg(err);
      setVersionsError(m);
      toast({ tone: 'error', title: 'Không tải được lịch sử phiên bản', detail: m });
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleRestoreVersion = async (vNum: number) => {
    if (!activeLessonId) return;
    try {
      const res = await teachingApi.restoreLessonVersion(activeLessonId, vNum);
      setRevision(res.revision);
      setBlocks(res.blocks);
      setMarkers(res.video_markers);
      recordHistory(res.blocks, res.video_markers);
      setSaveStatus('SAVED');
      setVersionsModalOpen(false);
      toast({
        tone: 'success',
        title: `Đã khôi phục phiên bản v${vNum} về bản nháp`,
        detail: 'Kiểm tra lại nội dung và bấm Xuất bản khi sẵn sàng.',
      });
      await loadStudioShell(activeLessonId);
    } catch (err) {
      toast({ tone: 'error', title: 'Không khôi phục được phiên bản', detail: errMsg(err) });
    }
  };

  // Block CRUD Helpers
  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedBlockId) || null,
    [blocks, selectedBlockId]
  );

  const insertBlock = (type: BlockType, insertAfterIndex?: number) => {
    const nb = makeNewBlock(type, resources);
    if (studioMode === 'CLASS') {
      nb.origin = 'CLASS_CUSTOM';
      nb.anchor_block_id = null;
    }
    const next = [...blocks];
    if (typeof insertAfterIndex === 'number') {
      const targetPos = Math.max(0, Math.min(next.length, insertAfterIndex + 1));
      next.splice(targetPos, 0, nb);
    } else {
      const idx = selectedBlockId ? blocks.findIndex((b) => b.id === selectedBlockId) : -1;
      if (idx >= 0) next.splice(idx + 1, 0, nb);
      else next.push(nb);
    }
    applyBlocksAndMarkers(next, markers, true);
    setSelectedBlockId(nb.id);
    setInspectorTab('block');
    setInserterAt(null);
    setInserterQuery('');
    if (type === 'video') {
      setVideoSetupOpen((p) => ({ ...p, [nb.id]: true }));
    }
  };

  const reorderBlock = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= blocks.length || toIndex >= blocks.length) {
      return;
    }
    const next = [...blocks];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    applyBlocksAndMarkers(next, markers, true);
  };

  const updateBlockContent = (blockId: string, patch: Record<string, any>) => {
    const next = blocks.map((b) =>
      b.id === blockId ? { ...b, content: { ...b.content, ...patch } } : b
    );
    applyBlocksAndMarkers(next, markers, true);
  };

  const updateBlockAnchor = (blockId: string, anchorId: string | null) => {
    const next = blocks.map((b) => (b.id === blockId ? { ...b, anchor_block_id: anchorId } : b));
    applyBlocksAndMarkers(next, markers, true);
  };

  const moveBlock = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    applyBlocksAndMarkers(next, markers, true);
  };

  const duplicateBlock = (block: LessonBlock, index: number) => {
    const newId = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const cloned: LessonBlock = {
      ...JSON.parse(JSON.stringify(block)),
      id: newId,
    };
    const clonedMarkers = markers
      .filter((m) => m.block_id === block.id)
      .map((m) => ({
        ...JSON.parse(JSON.stringify(m)),
        id: `vqm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        block_id: newId,
      }));
    const nextBlocks = [...blocks];
    nextBlocks.splice(index + 1, 0, cloned);
    applyBlocksAndMarkers(nextBlocks, [...markers, ...clonedMarkers], true);
    setSelectedBlockId(newId);
  };

  const removeBlock = (blockId: string) => {
    const nextBlocks = blocks.filter((b) => b.id !== blockId);
    const nextMarkers = markers.filter((m) => m.block_id !== blockId);
    applyBlocksAndMarkers(nextBlocks, nextMarkers, true);
    if (selectedBlockId === blockId) {
      setSelectedBlockId(nextBlocks[0]?.id || null);
    }
  };

  const updateBlockMarkers = (blockId: string, blockMarkers: VideoQuizMarker[]) => {
    const otherMarkers = markers.filter((m) => m.block_id !== blockId);
    const normalized = blockMarkers.map((m, i) => ({
      ...m,
      block_id: blockId,
      sort_order: i,
    }));
    applyBlocksAndMarkers(blocks, [...otherMarkers, ...normalized], true);
  };

  // Upload Handlers (Chunked Video Upload + Cancel, PDF Upload, Attachment Upload)
  const handleVideoFileChosen = async (blockId: string, file: File) => {
    if (!/\.(mp4|webm|m4v|mov)$/i.test(file.name)) {
      toast({
        tone: 'error',
        title: 'Định dạng video không hỗ trợ',
        detail: 'Vui lòng chọn tệp video .mp4, .webm, .m4v hoặc .mov.',
      });
      return;
    }
    const controller = new AbortController();
    uploadAbortRef.current[blockId] = controller;
    setUploadingBlockState((prev) => ({
      ...prev,
      [blockId]: { pct: 1, fileName: file.name, kind: 'VIDEO' },
    }));

    try {
      const meta = await extractLocalVideoMetadata(file);
      const uploaded = await teachingApi.uploadVideoFile({
        file,
        courseId: resolvedCourseId,
        classId: studioMode === 'CLASS' ? routeClassId : null,
        title: file.name.replace(/\.[^.]+$/, ''),
        durationSeconds: meta.durationSeconds,
        thumbnailDataUrl: meta.thumbnailDataUrl,
        signal: controller.signal,
        onProgress: (pct) => {
          setUploadingBlockState((prev) => ({
            ...prev,
            [blockId]: { pct, fileName: file.name, kind: 'VIDEO' },
          }));
        },
      });

      // Refresh shell resources so stream_url is available immediately
      if (studioMode === 'COURSE') {
        const s = await teachingApi.studioCourse(resolvedCourseId);
        setCourseShell(s);
      } else {
        const s = await teachingApi.studioClass(routeClassId);
        setClassShell(s);
      }

      updateBlockContent(blockId, {
        source_type: 'UPLOAD',
        resource_id: uploaded.id,
        title: uploaded.title,
        duration_seconds: uploaded.duration_seconds || meta.durationSeconds || 0,
        thumbnail_url: uploaded.thumbnail_url?.startsWith('https://') ? uploaded.thumbnail_url : '',
        stream_url: uploaded.stream_url || undefined,
      });

      toast({ tone: 'success', title: 'Tải lên video hoàn tất', detail: uploaded.file_name || uploaded.title });
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        toast({ tone: 'info', title: 'Đã hủy tải lên video và dọn tệp tạm' });
      } else {
        toast({ tone: 'error', title: 'Tải lên video thất bại', detail: errMsg(err) });
      }
    } finally {
      delete uploadAbortRef.current[blockId];
      setUploadingBlockState((prev) => {
        const copy = { ...prev };
        delete copy[blockId];
        return copy;
      });
    }
  };

  const handleCancelVideoUpload = (blockId: string) => {
    const ctrl = uploadAbortRef.current[blockId];
    if (ctrl) ctrl.abort();
  };

  const handlePdfFileChosen = async (blockId: string, file: File) => {
    if (!/\.pdf$/i.test(file.name)) {
      toast({ tone: 'error', title: 'Vui lòng chọn tệp định dạng .pdf' });
      return;
    }
    setUploadingBlockState((prev) => ({
      ...prev,
      [blockId]: { pct: 50, fileName: file.name, kind: 'PDF' },
    }));
    try {
      const uploaded = await teachingApi.uploadPdfFile({
        file,
        courseId: resolvedCourseId,
        classId: studioMode === 'CLASS' ? routeClassId : null,
        title: file.name.replace(/\.pdf$/i, ''),
      });
      if (studioMode === 'COURSE') {
        setCourseShell(await teachingApi.studioCourse(resolvedCourseId));
      } else {
        setClassShell(await teachingApi.studioClass(routeClassId));
      }
      updateBlockContent(blockId, {
        resource_id: uploaded.id,
        title: uploaded.title,
        stream_url: uploaded.stream_url || undefined,
      });
      toast({ tone: 'success', title: 'Đã tải lên tài liệu PDF' });
    } catch (err) {
      toast({ tone: 'error', title: 'Không tải lên được PDF', detail: errMsg(err) });
    } finally {
      setUploadingBlockState((prev) => {
        const copy = { ...prev };
        delete copy[blockId];
        return copy;
      });
    }
  };

  const handleAttachmentFileChosen = async (blockId: string, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({ tone: 'error', title: 'Tệp đính kèm vượt quá giới hạn 10 MB' });
      return;
    }
    setUploadingBlockState((prev) => ({
      ...prev,
      [blockId]: { pct: 50, fileName: file.name, kind: 'FILE' },
    }));
    try {
      const b64 = await fileToBase64(file);
      const created = await teachingApi.addResource(resolvedCourseId, {
        title: file.name.replace(/\.[^.]+$/, ''),
        resource_type: 'FILE',
        file_name: file.name,
        data_base64: b64,
      });
      if (studioMode === 'COURSE') {
        setCourseShell(await teachingApi.studioCourse(resolvedCourseId));
      } else {
        setClassShell(await teachingApi.studioClass(routeClassId));
      }
      updateBlockContent(blockId, {
        resource_id: created.id,
        title: file.name.replace(/\.[^.]+$/, ''),
      });
      toast({ tone: 'success', title: 'Đã tải lên tệp đính kèm' });
    } catch (err) {
      toast({ tone: 'error', title: 'Không tải lên được tệp', detail: errMsg(err) });
    } finally {
      setUploadingBlockState((prev) => {
        const copy = { ...prev };
        delete copy[blockId];
        return copy;
      });
    }
  };

  const handleValidateVideoUrl = async (blockId: string, rawUrl: string) => {
    if (!rawUrl.trim()) return;
    setLinkCheckingId(blockId);
    try {
      const check = await teachingApi.validateVideoLink(rawUrl.trim());
      if (check.source_type === 'YOUTUBE') {
        updateBlockContent(blockId, {
          source_type: 'YOUTUBE',
          video_id: check.video_id || '',
          start_seconds: check.start_seconds || 0,
          title: check.title || 'Video bài giảng YouTube',
          thumbnail_url: check.thumbnail_url || '',
        });
      } else {
        updateBlockContent(blockId, {
          source_type: 'DIRECT_URL',
          direct_url: check.direct_url || rawUrl.trim(),
          title: check.title || 'Video trực tuyến',
        });
      }
      if (check.embeddable === false) {
        toast({
          tone: 'error',
          title: 'Video này bị chủ sở hữu hạn chế phát nhúng ngoài YouTube',
          detail:
            check.check_message ||
            'Các MV bản quyền (VEVO/YG) thường chặn phát trong khung trang web khác. Bạn nên chọn video bài giảng cho phép nhúng hoặc tải tệp MP4 lên.',
        });
      } else {
        toast({ tone: 'success', title: 'Liên kết video hợp lệ', detail: check.check_message });
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Liên kết video không hợp lệ', detail: errMsg(err) });
    } finally {
      setLinkCheckingId(null);
    }
  };

  // Outline Tree Operations (Mode A)
  const outline: OutlineChapter[] =
    studioMode === 'COURSE' ? courseShell?.outline || [] : classShell?.outline || [];

  const selectLessonFromTree = async (lessonId: string) => {
    setMobilePane('canvas');
    if (lessonId === activeLessonId) return;
    if (saveStatus === 'DIRTY') {
      await saveDraftNow(true);
    }
    setActiveLessonId(lessonId);
    const nextParams = new URLSearchParams(sp);
    nextParams.set('lesson', lessonId);
    setSp(nextParams, { replace: true });
  };

  const handleAddChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChapterTitle.trim() || !resolvedCourseId) return;
    try {
      await teachingApi.createChapter(resolvedCourseId, { title: newChapterTitle.trim() });
      setNewChapterTitle('');
      await loadStudioShell(activeLessonId);
      toast({ tone: 'success', title: 'Đã tạo chương mới' });
    } catch (err) {
      toast({ tone: 'error', title: 'Không tạo được chương', detail: errMsg(err) });
    }
  };

  const handleAddLesson = async (e: React.FormEvent, chapterId: string) => {
    e.preventDefault();
    if (!newLessonTitle.trim()) return;
    try {
      const created = await teachingApi.createLesson(chapterId, { title: newLessonTitle.trim() });
      setNewLessonTitle('');
      setAddingLessonChapterId(null);
      await loadStudioShell(created.id);
      setActiveLessonId(created.id);
      toast({ tone: 'success', title: 'Đã tạo bài học mới' });
    } catch (err) {
      toast({ tone: 'error', title: 'Không tạo được bài học', detail: errMsg(err) });
    }
  };

  const moveOutlineChapter = async (idx: number, delta: number) => {
    if (!courseShell) return;
    const to = idx + delta;
    if (to < 0 || to >= outline.length) return;
    const next = [...outline];
    const [moved] = next.splice(idx, 1);
    next.splice(to, 0, moved);
    try {
      const res = await teachingApi.saveOutline(
        courseShell.course.id,
        next.map((c) => ({ id: c.id, lesson_ids: c.lessons.map((l) => l.id) }))
      );
      setCourseShell({ ...courseShell, outline: res.outline });
    } catch (err) {
      toast({ tone: 'error', title: 'Không đổi được thứ tự chương', detail: errMsg(err) });
    }
  };

  const moveOutlineLesson = async (chapterIdx: number, lessonIdx: number, delta: number) => {
    if (!courseShell) return;
    const ch = outline[chapterIdx];
    if (!ch) return;
    const to = lessonIdx + delta;
    if (to < 0 || to >= ch.lessons.length) return;
    const next = outline.map((c, ci) => {
      if (ci !== chapterIdx) return c;
      const ls = [...c.lessons];
      const [m] = ls.splice(lessonIdx, 1);
      ls.splice(to, 0, m);
      return { ...c, lessons: ls };
    });
    try {
      const res = await teachingApi.saveOutline(
        courseShell.course.id,
        next.map((c) => ({ id: c.id, lesson_ids: c.lessons.map((l) => l.id) }))
      );
      setCourseShell({ ...courseShell, outline: res.outline });
    } catch (err) {
      toast({ tone: 'error', title: 'Không đổi được thứ tự bài học', detail: errMsg(err) });
    }
  };

  // Merge preview blocks & markers for Preview Modal
  const previewPayload = useMemo(() => {
    if (studioMode === 'COURSE') {
      const videoOnly = previewModal?.scope === 'VIDEO';
      return {
        title: lessonMeta.title || 'Bài học',
        objectives: lessonMeta.objectives,
        blocks: videoOnly
          ? blocks.filter((b) => b.block_type === 'video' || b.block_type === 'youtube')
          : blocks,
        markers,
      };
    }
    // Mode B: merge inherited blocks + custom_blocks anchored right after their anchor_block_id (or at end)
    const inh = classLesson?.inherited_blocks || [];
    const merged: LessonBlock[] = [];
    const byAnchor = new Map<string, LessonBlock[]>();
    const unanchored: LessonBlock[] = [];
    blocks.forEach((cb) => {
      const bWithOrigin = { ...cb, origin: 'CLASS_CUSTOM' as const };
      if (cb.anchor_block_id && inh.some((x) => x.id === cb.anchor_block_id)) {
        const arr = byAnchor.get(cb.anchor_block_id) || [];
        arr.push(bWithOrigin);
        byAnchor.set(cb.anchor_block_id, arr);
      } else {
        unanchored.push(bWithOrigin);
      }
    });
    inh.forEach((ib) => {
      merged.push(ib);
      const after = byAnchor.get(ib.id);
      if (after) merged.push(...after);
    });
    merged.push(...unanchored);

    const allMarkers = [...(classLesson?.inherited_markers || []), ...markers];
    const videoOnly = previewModal?.scope === 'VIDEO';
    return {
      title: classLesson?.lesson.title || 'Bài học lớp',
      objectives: classNoteMeta.custom_objectives || classLesson?.lesson.objectives || '',
      instructorNote: classNoteMeta.instructor_note,
      blocks: videoOnly
        ? merged.filter((b) => b.block_type === 'video' || b.block_type === 'youtube')
        : merged,
      markers: allMarkers,
    };
  }, [studioMode, previewModal, lessonMeta, blocks, markers, classLesson, classNoteMeta]);

  if (shellLoading) {
    return (
      <div style={{ padding: 32 }}>
        <Loading label="Đang khởi tạo không gian Lesson Studio…" rows={5} />
      </div>
    );
  }
  if (shellError) {
    return (
      <div style={{ padding: 32 }}>
        <ErrorState error={shellError} onRetry={() => loadStudioShell()} />
      </div>
    );
  }

  const activeOutlineLesson = outline.flatMap((c) => c.lessons).find((l) => l.id === activeLessonId);
  const saveBadge = SAVE_STATUS_LABELS[saveStatus];
  const backUrl =
    studioMode === 'COURSE'
      ? `/teaching/courses/${resolvedCourseId}?section=content`
      : `/teaching/classes/${routeClassId}?tab=content`;

  const classesUsing = courseShell?.classes_using || [];

  const selectedDisplayCfg: BlockDisplayConfig =
    selectedBlock && typeof selectedBlock.content?.display === 'object' && selectedBlock.content?.display !== null
      ? (selectedBlock.content.display as BlockDisplayConfig)
      : {};

  const setSelectedDisplayPatch = (patch: Partial<BlockDisplayConfig>) => {
    if (!selectedBlock) return;
    updateBlockContent(selectedBlock.id, {
      display: { ...selectedDisplayCfg, ...patch },
    });
  };

  const totalLessonsCount = outline.reduce((sum, ch) => sum + ch.lessons.length, 0);
  const normalizedTreeSearch = treeSearch.trim().toLowerCase();
  const filteredOutline = normalizedTreeSearch
    ? outline
        .map((ch, ci) => {
          const chMatches = ch.title.toLowerCase().includes(normalizedTreeSearch);
          const matchingLessons = ch.lessons
            .map((l, li) => ({ l, li }))
            .filter(({ l }) => chMatches || l.title.toLowerCase().includes(normalizedTreeSearch));
          return { ch, ci, lessons: matchingLessons };
        })
        .filter((entry) => entry.lessons.length > 0 || entry.ch.title.toLowerCase().includes(normalizedTreeSearch))
    : outline.map((ch, ci) => ({ ch, ci, lessons: ch.lessons.map((l, li) => ({ l, li })) }));

  const filteredPaletteGroups = (() => {
    const q = inserterQuery.trim().toLowerCase();
    if (!q) return BLOCK_PALETTE_GROUPS;
    return BLOCK_PALETTE_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          g.group.toLowerCase().includes(q)
      ),
    })).filter((g) => g.items.length > 0);
  })();

  const renderInlineInserter = (afterIndex: number) => {
    if (!canEdit) return null;
    const isOpen = inserterAt === afterIndex;
    return (
      <div className={`ls-inserter ${isOpen ? 'is-open' : ''}`} data-ls-popover>
        <div className="ls-inserter__line" aria-hidden="true" />
        <button
          type="button"
          className="ls-inserter__trigger"
          aria-expanded={isOpen}
          aria-label="Chèn khối nội dung tại vị trí này"
          onClick={(ev) => {
            ev.stopPropagation();
            setInserterAt(isOpen ? null : afterIndex);
            setInserterQuery('');
          }}
        >
          <IconPlus size={14} />
          <span>Chèn khối</span>
        </button>
        <div className="ls-inserter__line" aria-hidden="true" />

        {isOpen && (
          <div className="ls-inserter-popover" role="dialog" aria-label="Chọn khối nội dung để chèn">
            <div className="ls-inserter-popover__search">
              <IconSearch size={15} />
              <input
                type="search"
                className="ls-inserter-popover__input"
                autoFocus
                value={inserterQuery}
                onChange={(e) => setInserterQuery(e.target.value)}
                placeholder="Tìm nhanh: video, văn bản, hình ảnh, PDF, bài kiểm tra…"
                aria-label="Tìm loại khối nội dung"
              />
              {inserterQuery && (
                <button
                  type="button"
                  className="ls-inline-clear"
                  onClick={() => setInserterQuery('')}
                  aria-label="Xóa từ khóa"
                >
                  <IconX size={14} />
                </button>
              )}
            </div>

            {filteredPaletteGroups.length === 0 ? (
              <p className="t-sub" style={{ padding: '12px 8px', margin: 0 }}>
                Không tìm thấy thành phần phù hợp với “{inserterQuery}”.
              </p>
            ) : (
              <div className="ls-inserter-popover__groups">
                {filteredPaletteGroups.map((grp) => (
                  <div key={grp.group} className="ls-inserter-popover__group">
                    <span className="ls-palette-group__title">{grp.group}</span>
                    <div className="ls-inserter-popover__grid">
                      {grp.items.map((it) => (
                        <button
                          key={it.type}
                          type="button"
                          className="ls-palette-btn"
                          onClick={() => insertBlock(it.type, afterIndex)}
                        >
                          <span className="ls-palette-btn__icon">
                            <BlockTypeIcon type={it.type} size={15} />
                          </span>
                          <span>{it.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ls-shell">
      {/* =================================================================
          TOP STUDIO TOOLBAR
      ================================================================= */}
      <div className="ls-topbar">
        <div className="ls-topbar__left">
          <Link to={backUrl} className="t-btn t-btn--small t-btn--ghost ls-back-link">
            <IconArrowLeft size={15} />
            <span>{studioMode === 'COURSE' ? 'Môn học' : 'Lớp học'}</span>
          </Link>

          <button
            type="button"
            className={`t-icon-btn ls-pane-toggle ${leftPaneOpen ? 'is-active' : ''}`}
            onClick={() => {
              setLeftPaneOpen((v) => {
                const next = !v;
                if (next) setMobilePane('tree');
                else if (mobilePane === 'tree') setMobilePane('canvas');
                return next;
              });
            }}
            aria-pressed={leftPaneOpen}
            title={leftPaneOpen ? 'Thu gọn cây chương bài' : 'Mở cây chương bài'}
            aria-label={leftPaneOpen ? 'Thu gọn cây chương bài' : 'Mở cây chương bài'}
          >
            <IconSidebarLeft size={16} />
          </button>

          <div className="ls-topbar__titles">
            <div className="ls-topbar__title-row">
              <strong className="ls-topbar__heading">
                {studioMode === 'COURSE' ? courseShell?.course.title : classShell?.class.title}
              </strong>
              <Tone tone={studioMode === 'COURSE' ? 'neutral' : 'success'}>
                {studioMode === 'COURSE' ? 'Giáo án chuẩn' : `Lớp ${classShell?.class.code}`}
              </Tone>
              <span className={`ls-save-pill is-${saveStatus.toLowerCase()}`} role="status" aria-live="polite">
                <span className="ls-save-pill__dot" aria-hidden="true" />
                <span>{saveBadge.text}</span>
              </span>
            </div>
            {saveErrorDetail && (
              <span className="t-field__error" style={{ fontSize: 12 }}>
                {saveErrorDetail}
              </span>
            )}
          </div>
        </div>

        <div className="ls-topbar__right">
          {canEdit && (
            <div className="ls-history-group" role="group" aria-label="Hoàn tác và làm lại">
              <button
                type="button"
                className="ls-history-btn"
                disabled={!canUndo}
                onClick={handleUndo}
                title="Hoàn tác (Ctrl+Z)"
                aria-label="Hoàn tác"
              >
                <IconUndo size={15} />
              </button>
              <button
                type="button"
                className="ls-history-btn"
                disabled={!canRedo}
                onClick={handleRedo}
                title="Làm lại (Ctrl+Y)"
                aria-label="Làm lại"
              >
                <IconRedo size={15} />
              </button>
            </div>
          )}

          {(resolvedCourseId || (studioMode === 'COURSE' && activeLessonId)) && (
            <div className="ls-popover-anchor" data-ls-popover>
              <button
                type="button"
                className={`t-btn t-btn--small t-btn--quiet ${toolsMenuOpen ? 'is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={toolsMenuOpen}
                onClick={() => setToolsMenuOpen((v) => !v)}
              >
                <IconTools size={15} />
                <span>Công cụ</span>
                <IconChevronDown size={14} />
              </button>

              {toolsMenuOpen && (
                <div className="ls-dropdown-menu" role="menu">
                  {resolvedCourseId && (
                    <button
                      type="button"
                      role="menuitem"
                      className="ls-dropdown-item"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        setBankForQuizBlockId(null);
                        setBankModalOpen(true);
                      }}
                    >
                      <IconDatabase size={15} />
                      <div>
                        <strong>Ngân hàng câu hỏi</strong>
                        <span>Tìm, soạn và gắn nhanh câu hỏi cho bài học</span>
                      </div>
                    </button>
                  )}
                  {studioMode === 'COURSE' && activeLessonId && (
                    <button
                      type="button"
                      role="menuitem"
                      className="ls-dropdown-item"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        void openVersionHistory();
                      }}
                    >
                      <IconHistory size={15} />
                      <div>
                        <strong>Lịch sử phiên bản</strong>
                        <span>Xem các mốc xuất bản & khôi phục bản cũ</span>
                      </div>
                    </button>
                  )}
                  {resolvedCourseId && (
                    <Link
                      to={`/teaching/courses/${resolvedCourseId}?section=wiki`}
                      role="menuitem"
                      className="ls-dropdown-item"
                      onClick={() => setToolsMenuOpen(false)}
                    >
                      <IconLibrary size={15} />
                      <div>
                        <strong>Wiki môn học ({wikiPages.length})</strong>
                        <span>Quản lý thẻ từ khóa tự động hiện trích dẫn kiểu Wikipedia</span>
                      </div>
                    </Link>
                  )}
                  {resolvedCourseId && (
                    <Link
                      to={`/teaching/banks?course_id=${resolvedCourseId}`}
                      role="menuitem"
                      className="ls-dropdown-item"
                      onClick={() => setToolsMenuOpen(false)}
                    >
                      <IconLibrary size={15} />
                      <div>
                        <strong>Thư viện Học liệu</strong>
                        <span>Quản lý câu hỏi, bài tập & tài nguyên của môn</span>
                      </div>
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          <Btn
            small
            variant="secondary"
            disabled={!activeLessonId}
            onClick={() => setPreviewModal({ scope: 'LESSON', viewport: 'DESKTOP' })}
          >
            <IconEye size={15} />
            <span>Xem trước</span>
          </Btn>

          {canEdit && activeLessonId && (
            <Btn
              small
              variant={saveStatus === 'DIRTY' ? 'secondary' : 'quiet'}
              loading={saveStatus === 'SAVING'}
              onClick={() => saveDraftNow(false)}
              title="Lưu bản nháp (Ctrl+S)"
            >
              Lưu nháp
            </Btn>
          )}

          {canPublish && activeLessonId && (
            <Btn
              small
              variant="primary"
              onClick={() => setPublishDialogOpen(true)}
            >
              Xuất bản
            </Btn>
          )}

          <button
            type="button"
            className={`t-icon-btn ls-pane-toggle ${inspectorOpen ? 'is-active' : ''}`}
            onClick={() => {
              setInspectorOpen((v) => {
                const next = !v;
                if (next) setMobilePane('inspector');
                else if (mobilePane === 'inspector') setMobilePane('canvas');
                return next;
              });
            }}
            aria-pressed={inspectorOpen}
            title={inspectorOpen ? 'Thu gọn thanh thuộc tính phải' : 'Mở thanh thuộc tính phải'}
            aria-label={inspectorOpen ? 'Thu gọn thanh thuộc tính' : 'Mở thanh thuộc tính'}
          >
            <IconSidebarRight size={16} />
          </button>
        </div>
      </div>

      {saveStatus === 'CONFLICT' && (
        <div className="ls-conflict-bar" role="alert">
          <span>
            <strong>Phát hiện xung đột phiên bản:</strong> Giáo án vừa được lưu từ một cửa sổ khác. Tải lại phiên bản mới nhất để tránh ghi đè ngoài ý muốn.
          </span>
          <Btn small variant="primary" onClick={() => loadActiveLesson(activeLessonId)}>
            Tải lại bản mới nhất
          </Btn>
        </div>
      )}

      <div className="ls-mobile-panes" role="tablist" aria-label="Chuyển vùng làm việc">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'tree'}
          onClick={() => {
            setLeftPaneOpen(true);
            setMobilePane('tree');
          }}
        >
          Chương & Bài (<span className="tabular-nums">{totalLessonsCount}</span>)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'canvas'}
          onClick={() => setMobilePane('canvas')}
        >
          Soạn giáo án
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'inspector'}
          onClick={() => {
            setInspectorOpen(true);
            setMobilePane('inspector');
          }}
        >
          Thuộc tính
        </button>
      </div>

      {/* =================================================================
          3-PANE WORKSPACE (LEFT TREE / CENTER CANVAS / RIGHT INSPECTOR)
      ================================================================= */}
      <div
        className={`ls-workspace ${leftPaneOpen ? '' : 'is-tree-closed'} ${
          inspectorOpen ? '' : 'is-inspector-closed'
        }`}
        data-mobile-pane={mobilePane}
      >
        {/* ----------------- LEFT PANE: CURRICULUM TREE ----------------- */}
        {leftPaneOpen && (
          <aside className="ls-left-pane" aria-label="Cấu trúc chương và bài học">
            <div className="ls-pane-head">
              <strong>Cấu trúc chương bài</strong>
              <span className="t-sub tabular-nums">
                {outline.length} chương · {totalLessonsCount} bài
              </span>
            </div>

            {totalLessonsCount >= 3 && (
              <div className="ls-tree-search">
                <IconSearch size={14} />
                <input
                  type="search"
                  className="ls-tree-search__input"
                  value={treeSearch}
                  onChange={(e) => setTreeSearch(e.target.value)}
                  placeholder="Tìm chương hoặc bài học…"
                  aria-label="Tìm chương hoặc bài học"
                />
                {treeSearch && (
                  <button
                    type="button"
                    className="ls-inline-clear"
                    onClick={() => setTreeSearch('')}
                    aria-label="Xóa tìm kiếm"
                  >
                    <IconX size={13} />
                  </button>
                )}
              </div>
            )}

            {studioMode === 'COURSE' && classesUsing.length > 1 && (
              <div className="ls-tree-notice">
                Đang dùng chung cho <strong className="tabular-nums">{classesUsing.length} lớp</strong>. Khi cần nội dung riêng từng lớp, mở Studio từ trang lớp học.
              </div>
            )}

            {studioMode === 'CLASS' && classShell && (
              <div className="ls-tree-notice">
                Kế thừa từ môn <strong>{classShell.course.title}</strong>. Mọi chỉnh sửa tại đây chỉ áp dụng cho lớp <strong>{classShell.class.code}</strong>.
                {classShell.capabilities.can_open_canonical_course && (
                  <div style={{ marginTop: 6 }}>
                    <Link
                      to={`/teaching/courses/${classShell.course.id}/studio${activeLessonId ? `?lesson=${activeLessonId}` : ''}`}
                      className="t-row-link"
                    >
                      Mở Giáo án chuẩn gốc ↗
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div className="ls-tree-scroll">
              {outline.length === 0 ? (
                <EmptyState title="Chưa có chương nào" text="Tạo chương đầu tiên ở khung bên dưới để bắt đầu soạn bài." />
              ) : filteredOutline.length === 0 ? (
                <p className="t-sub" style={{ padding: '12px 8px', margin: 0 }}>
                  Không có chương/bài nào khớp “{treeSearch}”.
                </p>
              ) : (
                filteredOutline.map(({ ch, ci, lessons }) => {
                  const isCollapsed = !normalizedTreeSearch && Boolean(collapsedChapters[ch.id]);
                  const chMenuId = `ch_${ch.id}`;
                  return (
                    <div key={ch.id} className="ls-tree-chapter">
                      <div className="ls-tree-chapter__head">
                        <button
                          type="button"
                          className="ls-tree-collapse-btn"
                          onClick={() => setCollapsedChapters((p) => ({ ...p, [ch.id]: !isCollapsed }))}
                          aria-expanded={!isCollapsed}
                          aria-label={`Thu gọn hoặc mở rộng chương ${ci + 1}`}
                        >
                          {isCollapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                        </button>

                        {renamingChapter?.id === ch.id ? (
                          <form
                            style={{ display: 'flex', gap: 6, flex: '1 1 160px', minWidth: 0 }}
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (!renamingChapter.title.trim()) return;
                              try {
                                await teachingApi.updateChapter(ch.id, { title: renamingChapter.title.trim() });
                                setRenamingChapter(null);
                                await loadStudioShell(activeLessonId);
                              } catch (err) {
                                toast({ tone: 'error', title: 'Không đổi được tên chương', detail: errMsg(err) });
                              }
                            }}
                          >
                            <input
                              className="t-input"
                              style={{ minWidth: 0, flex: 1 }}
                              value={renamingChapter.title}
                              autoFocus
                              onChange={(e) => setRenamingChapter({ id: ch.id, title: e.target.value })}
                              aria-label="Tên chương"
                            />
                            <Btn small type="submit" variant="primary">Lưu</Btn>
                          </form>
                        ) : (
                          <strong
                            className="ls-tree-chapter__title"
                            title={formatChapterHeading(ci, ch.title)}
                          >
                            {formatChapterHeading(ci, ch.title)}
                          </strong>
                        )}

                        {canManageTree && renamingChapter?.id !== ch.id && (
                          <div className="ls-popover-anchor" data-ls-popover>
                            <button
                              type="button"
                              className="ls-mini-btn ls-row-more-btn"
                              aria-haspopup="menu"
                              aria-expanded={treeMenuKey === chMenuId}
                              aria-label="Tùy chọn chương"
                              title="Tùy chọn chương"
                              onClick={() => setTreeMenuKey(treeMenuKey === chMenuId ? null : chMenuId)}
                            >
                              <IconMoreHorizontal size={15} />
                            </button>

                            {treeMenuKey === chMenuId && (
                              <div className="ls-row-menu" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="ls-row-menu__item"
                                  onClick={() => {
                                    setTreeMenuKey(null);
                                    setRenamingChapter({ id: ch.id, title: ch.title });
                                  }}
                                >
                                  <IconEdit size={14} /> Đổi tên chương
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="ls-row-menu__item"
                                  disabled={ci === 0}
                                  onClick={() => {
                                    setTreeMenuKey(null);
                                    void moveOutlineChapter(ci, -1);
                                  }}
                                >
                                  <IconArrowUp size={14} /> Chuyển lên
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="ls-row-menu__item"
                                  disabled={ci === outline.length - 1}
                                  onClick={() => {
                                    setTreeMenuKey(null);
                                    void moveOutlineChapter(ci, 1);
                                  }}
                                >
                                  <IconArrowDown size={14} /> Chuyển xuống
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="ls-row-menu__item"
                                  onClick={async () => {
                                    setTreeMenuKey(null);
                                    try {
                                      await teachingApi.duplicateChapter(ch.id);
                                      await loadStudioShell(activeLessonId);
                                      toast({ tone: 'success', title: 'Đã nhân bản chương' });
                                    } catch (err) {
                                      toast({ tone: 'error', title: 'Không nhân bản được chương', detail: errMsg(err) });
                                    }
                                  }}
                                >
                                  <IconCopy size={14} /> Nhân bản chương
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {!isCollapsed && (
                        <div className="ls-tree-lessons">
                          {lessons.map(({ l, li }) => {
                            const isCurrent = l.id === activeLessonId;
                            const hasWarnings = (l.warnings?.length || 0) > 0;
                            const lsMenuId = `ls_${l.id}`;
                            const formattedName = formatLessonHeading(ci, li, l.title);
                            return (
                              <div
                                key={l.id}
                                className={`ls-tree-lesson ${isCurrent ? 'is-active' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="ls-tree-lesson__select"
                                  onClick={() => selectLessonFromTree(l.id)}
                                  title={formattedName}
                                >
                                  {studioMode === 'COURSE' && (
                                    <span
                                      className={`ls-dot ${
                                        l.publish_status === 'PUBLISHED' ? 'ls-dot--published' : 'ls-dot--draft'
                                      }`}
                                      title={l.publish_status === 'PUBLISHED' ? 'Đã xuất bản' : 'Bản nháp'}
                                    />
                                  )}
                                  <span className="ls-tree-lesson__content">
                                    <span className="ls-tree-lesson__name">{formattedName}</span>
                                    {(l.has_unpublished_changes ||
                                      hasWarnings ||
                                      (studioMode === 'CLASS' && l.class_publish_status)) && (
                                      <span className="ls-tree-lesson__badges">
                                        {studioMode === 'COURSE' ? (
                                          <>
                                            {l.has_unpublished_changes && (
                                              <span className="ls-mini-tag">Sửa nháp</span>
                                            )}
                                            {hasWarnings && (
                                              <span
                                                className="ls-mini-warn"
                                                title={l.warnings?.join(' • ')}
                                                aria-label="Bài học còn mục cần hoàn thiện"
                                              >
                                                <IconAlertTriangle size={12} />
                                              </span>
                                            )}
                                          </>
                                        ) : (
                                          <>
                                            {l.class_publish_status === 'PUBLISHED' && (
                                              <span className="ls-mini-tag">Đã tùy biến</span>
                                            )}
                                            {l.class_publish_status === 'DRAFT' && (
                                              <span className="ls-mini-warn">Nháp lớp</span>
                                            )}
                                          </>
                                        )}
                                      </span>
                                    )}
                                  </span>
                                </button>

                                {canManageTree && (
                                  <div className="ls-popover-anchor" data-ls-popover>
                                    <button
                                      type="button"
                                      className="ls-mini-btn ls-row-more-btn"
                                      aria-haspopup="menu"
                                      aria-expanded={treeMenuKey === lsMenuId}
                                      aria-label={`Tùy chọn bài học ${formattedName}`}
                                      title="Tùy chọn bài học"
                                      onClick={() => setTreeMenuKey(treeMenuKey === lsMenuId ? null : lsMenuId)}
                                    >
                                      <IconMoreHorizontal size={15} />
                                    </button>

                                    {treeMenuKey === lsMenuId && (
                                      <div className="ls-row-menu" role="menu">
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="ls-row-menu__item"
                                          disabled={li === 0}
                                          onClick={() => {
                                            setTreeMenuKey(null);
                                            void moveOutlineLesson(ci, li, -1);
                                          }}
                                        >
                                          <IconArrowUp size={14} /> Chuyển bài lên
                                        </button>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="ls-row-menu__item"
                                          disabled={li === ch.lessons.length - 1}
                                          onClick={() => {
                                            setTreeMenuKey(null);
                                            void moveOutlineLesson(ci, li, 1);
                                          }}
                                        >
                                          <IconArrowDown size={14} /> Chuyển bài xuống
                                        </button>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="ls-row-menu__item"
                                          onClick={async () => {
                                            setTreeMenuKey(null);
                                            try {
                                              const dup = await teachingApi.duplicateLesson(l.id);
                                              await loadStudioShell(dup.id);
                                              setActiveLessonId(dup.id);
                                              toast({ tone: 'success', title: 'Đã nhân bản bài học' });
                                            } catch (err) {
                                              toast({ tone: 'error', title: 'Không nhân bản được bài học', detail: errMsg(err) });
                                            }
                                          }}
                                        >
                                          <IconCopy size={14} /> Nhân bản bài học
                                        </button>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="ls-row-menu__item is-danger"
                                          onClick={() => {
                                            setTreeMenuKey(null);
                                            setTreeConfirm({
                                              title: l.published_version > 0 ? 'Lưu trữ bài học?' : 'Xóa bài học nháp?',
                                              message:
                                                l.published_version > 0
                                                  ? 'Bài học đã từng xuất bản nên hệ thống sẽ lưu trữ an toàn để giữ lịch sử học tập của học viên.'
                                                  : 'Bài học bản nháp này sẽ bị xóa vĩnh viễn.',
                                              label: l.published_version > 0 ? 'Lưu trữ' : 'Xóa bài',
                                              danger: true,
                                              run: async () => {
                                                if (l.published_version > 0) await teachingApi.archiveLesson(l.id);
                                                else await teachingApi.deleteLesson(l.id);
                                                await loadStudioShell();
                                              },
                                            });
                                          }}
                                        >
                                          <IconTrash size={14} /> {l.published_version > 0 ? 'Lưu trữ bài học' : 'Xóa bài học'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {canManageTree && (
                            addingLessonChapterId === ch.id ? (
                              <form
                                onSubmit={(e) => handleAddLesson(e, ch.id)}
                                style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 4px' }}
                              >
                                <input
                                  className="t-input"
                                  value={newLessonTitle}
                                  autoFocus
                                  onChange={(e) => setNewLessonTitle(e.target.value)}
                                  placeholder="Nhập tên bài học mới…"
                                  aria-label="Tên bài học mới"
                                />
                                <div className="t-actions">
                                  <Btn small type="submit" variant="primary" disabled={!newLessonTitle.trim()}>
                                    Tạo bài học
                                  </Btn>
                                  <Btn small variant="ghost" onClick={() => setAddingLessonChapterId(null)}>
                                    Hủy
                                  </Btn>
                                </div>
                              </form>
                            ) : (
                              <button
                                type="button"
                                className="ls-add-lesson-btn"
                                onClick={() => {
                                  setAddingLessonChapterId(ch.id);
                                  setNewLessonTitle('');
                                }}
                              >
                                <IconPlus size={14} />
                                <span>Thêm bài học</span>
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {canManageTree && (
              <form className="ls-tree-foot" onSubmit={handleAddChapter}>
                <input
                  className="t-input"
                  value={newChapterTitle}
                  onChange={(e) => setNewChapterTitle(e.target.value)}
                  placeholder="Tên chương mới…"
                  aria-label="Tên chương mới"
                />
                <Btn small type="submit" variant="secondary" disabled={!newChapterTitle.trim()}>
                  <IconPlus size={14} /> Chương
                </Btn>
              </form>
            )}
          </aside>
        )}

        {/* ----------------- CENTER PANE: BLOCK CANVAS ----------------- */}
        <section className="ls-center-pane" aria-label="Vùng soạn thảo nội dung bài học">
          {!activeLessonId ? (
            <div style={{ padding: 32 }}>
              <EmptyState
                title="Chọn hoặc tạo một bài học ở cột bên trái"
                text="Mọi thành phần văn bản, video tải lên, câu hỏi tương tác theo giây và tài liệu PDF sẽ hiển thị tại đây."
              />
            </div>
          ) : lessonLoading ? (
            <div style={{ padding: 32 }}>
              <Loading label="Đang tải nội dung bài học…" rows={5} />
            </div>
          ) : lessonError ? (
            <div style={{ padding: 32 }}>
              <ErrorState error={lessonError} onRetry={() => loadActiveLesson(activeLessonId)} />
            </div>
          ) : (
            <div className="ls-canvas-inner">
              {/* Lesson Header Card — Clean Editorial Surface */}
              <div className="ls-lesson-hero">
                {studioMode === 'COURSE' ? (
                  <>
                    <div className="ls-lesson-hero__meta">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="t-sub">{courseLesson?.chapter.title}</span>
                        <span className="t-sub" aria-hidden="true">·</span>
                        <span className="t-sub tabular-nums">{blocks.length} khối nội dung</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Badge kind="lesson" value={courseLesson?.publish_status} />
                        {(courseLesson?.published_version || 0) > 0 && (
                          <Tone tone="neutral">
                            <span className="tabular-nums">v{courseLesson?.published_version}</span>
                          </Tone>
                        )}
                      </div>
                    </div>
                    <input
                      type="text"
                      className="ls-title-input"
                      disabled={!canEdit}
                      value={lessonMeta.title}
                      onChange={(e) => {
                        setLessonMeta((m) => ({ ...m, title: e.target.value }));
                        setSaveStatus('DIRTY');
                      }}
                      placeholder="Nhập tiêu đề bài học…"
                      aria-label="Tiêu đề bài học"
                    />
                    <textarea
                      className="ls-desc-input"
                      rows={2}
                      disabled={!canEdit}
                      value={lessonMeta.description}
                      onChange={(e) => {
                        setLessonMeta((m) => ({ ...m, description: e.target.value }));
                        setSaveStatus('DIRTY');
                      }}
                      placeholder="Thêm mô tả ngắn gọn để học viên nắm nhanh mục tiêu bài học…"
                      aria-label="Mô tả ngắn bài học"
                    />
                  </>
                ) : (
                  <>
                    <div className="ls-lesson-hero__meta">
                      <span className="t-sub">{classLesson?.chapter.title}</span>
                      <Tone tone={classLesson?.custom.publish_status === 'PUBLISHED' ? 'success' : 'warning'}>
                        {classLesson?.custom.publish_status === 'PUBLISHED'
                          ? 'Bổ sung lớp: Đã xuất bản'
                          : 'Bổ sung lớp: Bản nháp'}
                      </Tone>
                    </div>
                    <h1 className="ls-hero-static-title">{classLesson?.lesson.title}</h1>
                    <div className="t-form-grid">
                      <Field label="Ghi chú dặn dò riêng cho học viên lớp này">
                        <textarea
                          className="t-input"
                          rows={2}
                          disabled={!canEdit}
                          value={classNoteMeta.instructor_note}
                          onChange={(e) => {
                            setClassNoteMeta((m) => ({ ...m, instructor_note: e.target.value }));
                            setSaveStatus('DIRTY');
                          }}
                          placeholder="Ví dụ: Lớp 5A1 chú ý xem kỹ ví dụ tại phút 02:15 trước buổi học thứ Năm…"
                        />
                      </Field>
                      <Field label="Mục tiêu trọng tâm bổ sung cho lớp">
                        <textarea
                          className="t-input"
                          rows={2}
                          disabled={!canEdit}
                          value={classNoteMeta.custom_objectives}
                          onChange={(e) => {
                            setClassNoteMeta((m) => ({ ...m, custom_objectives: e.target.value }));
                            setSaveStatus('DIRTY');
                          }}
                          placeholder="Mục tiêu mở rộng hoặc phụ đạo riêng của lớp…"
                        />
                      </Field>
                    </div>
                  </>
                )}

                {(activeOutlineLesson?.warnings?.length || 0) > 0 && studioMode === 'COURSE' && (
                  <div className="t-notice t-notice--warning" style={{ marginTop: 12 }}>
                    <strong>Lưu ý hoàn thiện trước khi xuất bản:</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                      {activeOutlineLesson!.warnings!.map((w, wi) => (
                        <li key={wi}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Mode B: Inherited Canonical Course Blocks (Read-only + 1-click Class Video Quiz!) */}
              {studioMode === 'CLASS' && (classLesson?.inherited_blocks.length || 0) > 0 && (
                <div className="ls-inherited-section">
                  <div className="ls-inherited-section__head">
                    <div>
                      <strong>Nội dung gốc kế thừa từ khóa học ({classLesson?.inherited_blocks.length} khối)</strong>
                      <span className="t-sub" style={{ display: 'block' }}>
                        Phần này được đồng bộ từ khóa học chuẩn. Bạn có thể gắn thêm câu hỏi tương tác riêng của lớp lên bất kỳ video gốc nào!
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(classLesson?.inherited_blocks || []).map((ib, idx) => {
                      const isVid = ib.block_type === 'video' || ib.block_type === 'youtube';
                      const isExpanded = expandedInheritedVideoId === ib.id;
                      const customMarkersOnThisVid = markers.filter((m) => m.block_id === ib.id);
                      const inheritedMarkersOnThisVid = (classLesson?.inherited_markers || []).filter(
                        (m) => m.block_id === ib.id
                      );
                      const ic = ib.content || {};
                      const res = ic.resource_id ? resourceMap[ic.resource_id] : undefined;

                      return (
                        <div key={ib.id} className="ls-inherited-card">
                          <div className="ls-inherited-card__bar">
                            <span className="t-sub">
                              Khối gốc #{idx + 1} · <strong>{BLOCK_TYPE_NAMES[ib.block_type] || ib.block_type}</strong>
                            </span>
                            <div className="t-actions">
                              {isVid && (
                                <Btn
                                  small
                                  variant={isExpanded ? 'secondary' : 'quiet'}
                                  onClick={() => setExpandedInheritedVideoId(isExpanded ? null : ib.id)}
                                >
                                  <BlockTypeIcon type="video" size={14} />
                                  <span>Mốc câu hỏi riêng của lớp (<span className="tabular-nums">{customMarkersOnThisVid.length}</span>)</span>
                                </Btn>
                              )}
                              <Tone tone="neutral">Kế thừa</Tone>
                            </div>
                          </div>

                          {isVid && isExpanded ? (
                            <VideoQuizTimelineEditor
                              blockId={ib.id}
                              sourceType={
                                ib.block_type === 'youtube'
                                  ? 'YOUTUBE'
                                  : (ic.source_type as 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL') || 'YOUTUBE'
                              }
                              streamUrl={ic.stream_url || res?.stream_url || null}
                              videoId={ic.video_id}
                              directUrl={ic.direct_url}
                              thumbnailUrl={ic.thumbnail_url || res?.thumbnail_url}
                              videoTitle={ic.title || res?.title}
                              startSeconds={ic.start_seconds || 0}
                              fallbackDuration={Number(ic.duration_seconds || res?.duration_seconds || 0)}
                              courseId={resolvedCourseId}
                              canEdit={canEdit}
                              studioMode="CLASS"
                              markers={customMarkersOnThisVid}
                              inheritedMarkers={inheritedMarkersOnThisVid}
                              onChangeMarkers={(nextM) => updateBlockMarkers(ib.id, nextM)}
                              onSaveMarkersNow={async () => {
                                await saveDraftNow(false);
                              }}
                            />
                          ) : (
                            <div className="ls-inherited-preview">
                              <BlockList
                                blocks={[ib]}
                                ctx={{
                                  resources: resourceMap,
                                  wikiPages,
                                  previewMode: true,
                                  videoMarkers: [...inheritedMarkersOnThisVid, ...customMarkersOnThisVid],
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Editable Blocks Section */}
              <div className="ls-blocks-section">
                {studioMode === 'CLASS' && (
                  <div style={{ marginBottom: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>
                      Các khối nội dung bổ sung riêng cho lớp {classShell?.class.code}
                    </h2>
                    <span className="t-sub">
                      Thêm video chữa bài, tài liệu PDF, bài tập hoặc ghi chú chỉ dành riêng cho học viên lớp này.
                    </span>
                  </div>
                )}

                {blocks.length === 0 ? (
                  <div className="ls-empty-blocks">
                    <strong>
                      {studioMode === 'COURSE'
                        ? 'Bài học chưa có khối nội dung nào'
                        : 'Chưa có khối nội dung bổ sung riêng cho lớp'}
                    </strong>
                    <p className="t-sub">
                      Chọn nhanh một thành phần học tập bên dưới để bắt đầu biên soạn bài giảng.
                    </p>
                  </div>
                ) : (
                  <>
                    {renderInlineInserter(-1)}
                    {blocks.map((b, bi) => {
                      const isSelected = b.id === selectedBlockId;
                      const isBlockCollapsed = Boolean(collapsedBlocks[b.id]);
                      const c = b.content || {};
                      const disp: BlockDisplayConfig =
                        typeof c.display === 'object' && c.display !== null ? c.display : {};
                      const blockUpload = uploadingBlockState[b.id];
                      const videoResources = resources.filter((r) => r.resource_type === 'VIDEO');
                      const pdfResources = resources.filter(
                        (r) => r.resource_type === 'PDF' || r.mime_type === 'application/pdf'
                      );
                      const pickedRes = c.resource_id ? resourceMap[c.resource_id] : undefined;
                      const blockMarkersCount = markers.filter((m) => m.block_id === b.id).length;
                      const videoSourceType =
                        b.block_type === 'youtube'
                          ? 'YOUTUBE'
                          : ((c.source_type || 'YOUTUBE') as 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL');
                      const hasConfiguredVideo =
                        (videoSourceType === 'UPLOAD' && Boolean(c.stream_url || pickedRes?.stream_url)) ||
                        (videoSourceType === 'YOUTUBE' && Boolean(c.video_id)) ||
                        (videoSourceType === 'DIRECT_URL' && Boolean(c.direct_url));
                      const showVideoSetupForm = !hasConfiguredVideo || Boolean(videoSetupOpen[b.id]);

                      return (
                        <React.Fragment key={b.id}>
                          <article
                            className={`ls-block-card ${isSelected ? 'is-selected' : ''} ${
                              disp.hidden ? 'is-hidden' : ''
                            } ${isBlockCollapsed ? 'is-collapsed' : ''} ${
                              dragBlockIdx === bi ? 'is-dragging' : ''
                            } ${dragOverIdx === bi && dragBlockIdx !== bi ? 'is-drag-over' : ''}`}
                            onDragOver={(ev) => {
                              if (!canEdit || dragBlockIdx === null) return;
                              ev.preventDefault();
                              if (dragOverIdx !== bi) setDragOverIdx(bi);
                            }}
                            onDragLeave={() => {
                              if (dragOverIdx === bi) setDragOverIdx(null);
                            }}
                            onDrop={(ev) => {
                              if (!canEdit || dragBlockIdx === null) return;
                              ev.preventDefault();
                              reorderBlock(dragBlockIdx, bi);
                              setDragBlockIdx(null);
                              setDragOverIdx(null);
                            }}
                            onClick={() => {
                              setSelectedBlockId(b.id);
                              setInspectorTab('block');
                            }}
                          >
                            <header className="ls-block-card__head">
                              <div className="ls-block-card__title-group">
                                {canEdit && (
                                  <span
                                    className="ls-drag-handle"
                                    draggable
                                    onDragStart={(ev) => {
                                      setDragBlockIdx(bi);
                                      ev.dataTransfer.effectAllowed = 'move';
                                      ev.dataTransfer.setData('text/plain', b.id);
                                    }}
                                    onDragEnd={() => {
                                      setDragBlockIdx(null);
                                      setDragOverIdx(null);
                                    }}
                                    title="Kéo thả để sắp xếp lại thứ tự khối"
                                    aria-label="Kéo thả sắp xếp khối"
                                    onClick={(ev) => ev.stopPropagation()}
                                  >
                                    <IconGripVertical size={15} />
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="ls-block-fold-btn"
                                  aria-expanded={!isBlockCollapsed}
                                  aria-label={isBlockCollapsed ? 'Mở rộng khối' : 'Thu gọn khối'}
                                  title={isBlockCollapsed ? 'Mở rộng khối' : 'Thu gọn khối để xem gọn'}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setCollapsedBlocks((p) => ({ ...p, [b.id]: !isBlockCollapsed }));
                                  }}
                                >
                                  {isBlockCollapsed ? <IconChevronRight size={15} /> : <IconChevronDown size={15} />}
                                </button>
                                <span className="ls-block-index tabular-nums">#{bi + 1}</span>
                                <span className="ls-block-type-icon">
                                  <BlockTypeIcon type={b.block_type} size={15} />
                                </span>
                                <strong className="ls-block-type-name">
                                  {BLOCK_TYPE_NAMES[b.block_type] || b.block_type}
                                </strong>
                                {isBlockCollapsed && (
                                  <span className="ls-block-summary">
                                    {getBlockSummary(b, blockMarkersCount)}
                                  </span>
                                )}
                                {studioMode === 'CLASS' && <Tone tone="info">Riêng lớp</Tone>}
                                {disp.hidden && <Tone tone="muted">Đang ẩn</Tone>}
                                {disp.highlight && <Tone tone="warning">Nổi bật</Tone>}
                                {disp.collapsible && <Tone tone="neutral">Thu gọn</Tone>}
                              </div>

                              {canEdit && (
                                <div className="ls-block-actions" onClick={(ev) => ev.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="t-icon-btn"
                                    disabled={bi === 0}
                                    onClick={() => moveBlock(bi, -1)}
                                    aria-label="Di chuyển khối lên"
                                    title="Di chuyển lên"
                                  >
                                    <IconArrowUp size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="t-icon-btn"
                                    disabled={bi === blocks.length - 1}
                                    onClick={() => moveBlock(bi, 1)}
                                    aria-label="Di chuyển khối xuống"
                                    title="Di chuyển xuống"
                                  >
                                    <IconArrowDown size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="t-icon-btn"
                                    onClick={() => duplicateBlock(b, bi)}
                                    aria-label="Nhân bản khối"
                                    title="Nhân bản khối"
                                  >
                                    <IconCopy size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="t-icon-btn ls-icon-btn-danger"
                                    onClick={() => {
                                      const hasAttachedQuiz =
                                        markers.some((m) => m.block_id === b.id) ||
                                        (b.block_type === 'quiz' && Array.isArray(c.questions) && c.questions.length > 0);
                                      if (hasAttachedQuiz) {
                                        setTreeConfirm({
                                          title: 'Xóa khối nội dung này?',
                                          message:
                                            'Khối này đang chứa câu hỏi tương tác hoặc mốc thời gian trên video. Bạn có chắc chắn muốn xóa khỏi bài học?',
                                          label: 'Xóa khối',
                                          danger: true,
                                          run: async () => removeBlock(b.id),
                                        });
                                      } else {
                                        removeBlock(b.id);
                                      }
                                    }}
                                    aria-label="Xóa khối"
                                    title="Xóa khối"
                                  >
                                    <IconTrash size={15} />
                                  </button>
                                </div>
                              )}
                            </header>

                            {!isBlockCollapsed && (
                              <div className="ls-block-card__body">
                          {/* 1. HEADING */}
                          {b.block_type === 'heading' && (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <select
                                className="t-input"
                                style={{ width: 150 }}
                                disabled={!canEdit}
                                value={c.level || 2}
                                onChange={(e) => updateBlockContent(b.id, { level: Number(e.target.value) })}
                                aria-label="Cấp tiêu đề"
                              >
                                <option value={2}>Tiêu đề lớn (H2)</option>
                                <option value={3}>Tiêu đề mục (H3)</option>
                              </select>
                              <input
                                className="t-input"
                                style={{ flex: '1 1 200px', minWidth: 0, fontWeight: 700, fontSize: 16 }}
                                disabled={!canEdit}
                                value={c.text || ''}
                                onChange={(e) => updateBlockContent(b.id, { text: e.target.value })}
                                placeholder="Nhập nội dung tiêu đề…"
                                aria-label="Nội dung tiêu đề"
                              />
                            </div>
                          )}

                          {/* 2. PARAGRAPH */}
                          {b.block_type === 'paragraph' && (() => {
                            const detectedWiki = findMatchedWikiTerms(String(c.text || ''), wikiPages);
                            return (
                              <>
                                <textarea
                                  className="t-input"
                                  rows={4}
                                  disabled={!canEdit}
                                  value={c.text || ''}
                                  onChange={(e) => updateBlockContent(b.id, { text: e.target.value })}
                                  placeholder="Nhập nội dung kiến thức bài giảng… (từ khóa trùng thẻ Wiki sẽ tự động hiển thị thẻ trích dẫn kiểu Wikipedia)"
                                  aria-label="Nội dung đoạn văn"
                                />
                                {detectedWiki.length > 0 && (
                                  <WikiReaderProvider wikiPages={wikiPages}>
                                    <div className="ls-wiki-detected">
                                      <span className="ls-wiki-detected__label">
                                        Thẻ Wiki tự động gắn (<span className="tabular-nums">{detectedWiki.length}</span>):
                                      </span>
                                      <div className="ls-wiki-detected__chips">
                                        {detectedWiki.map((m) => (
                                          <WikiTermTrigger
                                            key={`${m.page.id}_${m.matchedKey}`}
                                            variant="chip"
                                            label={m.matchedText}
                                            matchedKey={m.matchedKey}
                                            page={m.page}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  </WikiReaderProvider>
                                )}
                              </>
                            );
                          })()}

                          {/* 3. IMAGE */}
                          {b.block_type === 'image' && (
                            <div className="t-form-grid">
                              <Field
                                label="Hình ảnh bài học"
                                required
                                wide
                                hint="Hỗ trợ dán link từ Google/Bing Images, Google Drive, Dropbox, link ảnh trực tiếp hoặc chọn ảnh từ máy"
                              >
                                <ImageUrlInput
                                  value={c.url || ''}
                                  disabled={!canEdit}
                                  variant="content"
                                  onChange={(nextUrl) => updateBlockContent(b.id, { url: nextUrl })}
                                  ariaLabel="Đường dẫn hình ảnh bài học"
                                />
                              </Field>
                              <Field label="Mô tả thay thế (Alt)">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.alt || ''}
                                  onChange={(e) => updateBlockContent(b.id, { alt: e.target.value })}
                                />
                              </Field>
                              <Field label="Chú thích dưới ảnh">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.caption || ''}
                                  onChange={(e) => updateBlockContent(b.id, { caption: e.target.value })}
                                />
                              </Field>
                            </div>
                          )}

                          {/* 4. VIDEO & INTERACTIVE TIMESTAMP VIDEO QUIZ */}
                          {(b.block_type === 'video' || b.block_type === 'youtube') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              {!showVideoSetupForm ? (
                                <div className="ls-video-summary-bar">
                                  <div className="ls-video-summary-bar__info">
                                    <span className="ls-video-source-chip">
                                      {videoSourceType === 'UPLOAD' ? (
                                        <><IconUpload size={13} /> Tệp video</>
                                      ) : videoSourceType === 'DIRECT_URL' ? (
                                        <><IconGlobe size={13} /> HTTPS</>
                                      ) : (
                                        <><IconPlay size={13} /> YouTube</>
                                      )}
                                    </span>
                                    <div style={{ minWidth: 0 }}>
                                      <strong className="ls-video-summary-bar__title">
                                        {c.title || pickedRes?.title || (c.video_id ? `YouTube · ${c.video_id}` : 'Video bài giảng')}
                                      </strong>
                                      {c.description && (
                                        <span className="ls-video-summary-bar__note">{c.description}</span>
                                      )}
                                    </div>
                                  </div>
                                  {canEdit && (
                                    <Btn
                                      small
                                      variant="quiet"
                                      onClick={() => setVideoSetupOpen((p) => ({ ...p, [b.id]: true }))}
                                    >
                                      <IconSliders size={14} /> Đổi nguồn & tiêu đề
                                    </Btn>
                                  )}
                                </div>
                              ) : (
                                <div className="ls-video-setup-panel">
                                  <div className="ls-video-setup-panel__top">
                                    {b.block_type === 'video' && canEdit && (
                                      <div className="ls-seg-pills" role="tablist" aria-label="Chọn nguồn video">
                                        {(
                                          [
                                            { id: 'UPLOAD', label: 'Tải tệp Video', icon: <IconUpload size={14} /> },
                                            { id: 'YOUTUBE', label: 'Liên kết YouTube', icon: <IconPlay size={14} /> },
                                            { id: 'DIRECT_URL', label: 'Nguồn HTTPS', icon: <IconGlobe size={14} /> },
                                          ] as const
                                        ).map((tab) => {
                                          const curSource = c.source_type || 'YOUTUBE';
                                          return (
                                            <button
                                              key={tab.id}
                                              type="button"
                                              role="tab"
                                              aria-selected={curSource === tab.id}
                                              className={`ls-seg-pill ${curSource === tab.id ? 'is-active' : ''}`}
                                              onClick={() => updateBlockContent(b.id, { source_type: tab.id })}
                                            >
                                              {tab.icon}
                                              <span>{tab.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {hasConfiguredVideo && (
                                      <Btn
                                        small
                                        variant="ghost"
                                        onClick={() => setVideoSetupOpen((p) => ({ ...p, [b.id]: false }))}
                                      >
                                        Thu gọn
                                      </Btn>
                                    )}
                                  </div>

                                  {/* Source A: Chunked Video Upload + Library Reuse */}
                                  {b.block_type === 'video' && (c.source_type || 'YOUTUBE') === 'UPLOAD' && (
                                    <div className="ls-upload-zone">
                                      {blockUpload ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <strong style={{ overflowWrap: 'anywhere', minWidth: 0 }}>Đang tải lên: {blockUpload.fileName}</strong>
                                            <span className="tabular-nums">{blockUpload.pct}%</span>
                                          </div>
                                          <div className="t-meter__bar">
                                            <span style={{ width: `${blockUpload.pct}%` }} />
                                          </div>
                                          <div>
                                            <Btn small variant="danger" onClick={() => handleCancelVideoUpload(b.id)}>
                                              Hủy tải lên
                                            </Btn>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                          <div style={{ minWidth: 0 }}>
                                            <strong style={{ overflowWrap: 'anywhere' }}>
                                              {pickedRes
                                                ? `Đã gắn tệp: ${pickedRes.title} (${fmtBytes(pickedRes.file_size_bytes)})`
                                                : 'Tải tệp video từ máy tính (.mp4, .webm, .m4v, .mov)'}
                                            </strong>
                                            <span className="t-sub" style={{ display: 'block' }}>
                                              Hỗ trợ tải lên theo mảnh dung lượng lớn, tự động trích xuất thời lượng và phát tua qua HTTP Range.
                                            </span>
                                          </div>
                                          {canEdit && (
                                            <div className="t-actions">
                                              <label className="t-btn t-btn--secondary t-btn--small" style={{ cursor: 'pointer' }}>
                                                <IconUpload size={14} />
                                                <span>{pickedRes ? 'Thay thế video khác' : 'Chọn tệp Video'}</span>
                                                <input
                                                  type="file"
                                                  accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.m4v,.mov"
                                                  style={{ display: 'none' }}
                                                  onChange={(e) => {
                                                    const f = e.target.files?.[0];
                                                    if (f) void handleVideoFileChosen(b.id, f);
                                                    e.currentTarget.value = '';
                                                  }}
                                                />
                                              </label>
                                              {videoResources.length > 0 && (
                                                <select
                                                  className="t-input"
                                                  style={{ flex: '1 1 200px', minWidth: 0, maxWidth: '100%' }}
                                                  value={c.resource_id || ''}
                                                  onChange={(e) => {
                                                    const r = resourceMap[e.target.value];
                                                    if (r) {
                                                      updateBlockContent(b.id, {
                                                        source_type: 'UPLOAD',
                                                        resource_id: r.id,
                                                        title: c.title || r.title,
                                                        duration_seconds: r.duration_seconds || 0,
                                                        thumbnail_url: r.thumbnail_url?.startsWith('https://') ? r.thumbnail_url : '',
                                                        stream_url: r.stream_url || undefined,
                                                      });
                                                    }
                                                  }}
                                                  aria-label="Chọn từ thư viện video đã tải lên"
                                                >
                                                  <option value="">— Hoặc chọn từ thư viện video —</option>
                                                  {videoResources.map((vr) => (
                                                    <option key={vr.id} value={vr.id}>
                                                      {vr.title} ({vr.duration_seconds ? formatTimestamp(vr.duration_seconds) : fmtBytes(vr.file_size_bytes)})
                                                    </option>
                                                  ))}
                                                </select>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Source B: YouTube Link */}
                                  {(b.block_type === 'youtube' || (c.source_type || 'YOUTUBE') === 'YOUTUBE') && (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <input
                                        className="t-input"
                                        style={{ flex: '1 1 280px' }}
                                        disabled={!canEdit}
                                        defaultValue={c.video_id ? `https://www.youtube.com/watch?v=${c.video_id}` : ''}
                                        placeholder="Dán liên kết YouTube (https://www.youtube.com/watch?v=...)"
                                        aria-label="Liên kết YouTube"
                                        onBlur={(e) => {
                                          if (e.target.value.trim() && canEdit) {
                                            void handleValidateVideoUrl(b.id, e.target.value);
                                          }
                                        }}
                                      />
                                      {canEdit && (
                                        <Btn
                                          small
                                          variant="secondary"
                                          loading={linkCheckingId === b.id}
                                          onClick={(ev) => {
                                            const input = ev.currentTarget.previousElementSibling as HTMLInputElement | null;
                                            if (input?.value) void handleValidateVideoUrl(b.id, input.value);
                                          }}
                                        >
                                          Kiểm tra link
                                        </Btn>
                                      )}
                                    </div>
                                  )}

                                  {/* Source C: Direct HTTPS Video URL */}
                                  {b.block_type === 'video' && c.source_type === 'DIRECT_URL' && (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <input
                                        className="t-input"
                                        style={{ flex: '1 1 280px' }}
                                        disabled={!canEdit}
                                        value={c.direct_url || ''}
                                        onChange={(e) => updateBlockContent(b.id, { direct_url: e.target.value })}
                                        placeholder="https://commondatastorage.googleapis.com/.../video.mp4"
                                        aria-label="Đường dẫn tệp video HTTPS trực tiếp"
                                      />
                                      {canEdit && (
                                        <Btn
                                          small
                                          variant="secondary"
                                          loading={linkCheckingId === b.id}
                                          onClick={() => handleValidateVideoUrl(b.id, c.direct_url || '')}
                                        >
                                          Kiểm tra nguồn
                                        </Btn>
                                      )}
                                    </div>
                                  )}

                                  <div className="t-form-grid">
                                    <Field label="Tiêu đề video">
                                      <input
                                        className="t-input"
                                        disabled={!canEdit}
                                        value={c.title || ''}
                                        onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                        placeholder="Tên video bài giảng…"
                                      />
                                    </Field>
                                    <Field label="Ghi chú hướng dẫn dưới video">
                                      <input
                                        className="t-input"
                                        disabled={!canEdit}
                                        value={c.description || ''}
                                        onChange={(e) => updateBlockContent(b.id, { description: e.target.value })}
                                        placeholder="Lưu ý cho học viên khi xem…"
                                      />
                                    </Field>
                                  </div>
                                </div>
                              )}

                              {/* Inline Interactive Video Quiz Timeline Editor */}
                              <VideoQuizTimelineEditor
                                blockId={b.id}
                                sourceType={
                                  b.block_type === 'youtube'
                                    ? 'YOUTUBE'
                                    : ((c.source_type || 'YOUTUBE') as 'UPLOAD' | 'YOUTUBE' | 'DIRECT_URL')
                                }
                                streamUrl={c.stream_url || pickedRes?.stream_url || null}
                                videoId={c.video_id}
                                directUrl={c.direct_url}
                                thumbnailUrl={c.thumbnail_url || pickedRes?.thumbnail_url}
                                videoTitle={c.title || pickedRes?.title}
                                startSeconds={c.start_seconds || 0}
                                fallbackDuration={Number(c.duration_seconds || pickedRes?.duration_seconds || 0)}
                                allowSeekingAhead={c.allow_seeking_ahead !== false}
                                courseId={resolvedCourseId}
                                canEdit={canEdit}
                                studioMode={studioMode}
                                markers={markers.filter((m) => m.block_id === b.id)}
                                onChangeMarkers={(nextBlockMarkers) => updateBlockMarkers(b.id, nextBlockMarkers)}
                                onSaveMarkersNow={async () => {
                                  await saveDraftNow(false);
                                }}
                                savingMarkers={saveStatus === 'SAVING'}
                              />
                            </div>
                          )}

                          {/* 5. PDF VIEWER BLOCK */}
                          {b.block_type === 'pdf' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div className="ls-upload-zone">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                  <div>
                                    <strong>
                                      {pickedRes
                                        ? `Tệp PDF: ${pickedRes.title} (${fmtBytes(pickedRes.file_size_bytes)})`
                                        : 'Chọn hoặc tải lên tài liệu PDF hiển thị trực tiếp trong bài'}
                                    </strong>
                                  </div>
                                  {canEdit && (
                                    <div className="t-actions">
                                      <label className="t-btn t-btn--primary t-btn--small" style={{ cursor: 'pointer' }}>
                                        {blockUpload ? 'Đang tải PDF…' : '+ Tải tệp PDF lên'}
                                        <input
                                          type="file"
                                          accept="application/pdf,.pdf"
                                          style={{ display: 'none' }}
                                          onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) void handlePdfFileChosen(b.id, f);
                                            e.currentTarget.value = '';
                                          }}
                                        />
                                      </label>
                                      {pdfResources.length > 0 && (
                                        <select
                                          className="t-input"
                                          style={{ width: 'auto' }}
                                          value={c.resource_id || ''}
                                          onChange={(e) => {
                                            const r = resourceMap[e.target.value];
                                            if (r) {
                                              updateBlockContent(b.id, {
                                                resource_id: r.id,
                                                title: c.title || r.title,
                                                stream_url: r.stream_url || undefined,
                                              });
                                            }
                                          }}
                                          aria-label="Chọn PDF có sẵn"
                                        >
                                          <option value="">— Chọn PDF có sẵn —</option>
                                          {pdfResources.map((pr) => (
                                            <option key={pr.id} value={pr.id}>
                                              {pr.title}
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="t-form-grid">
                                <Field label="Tiêu đề tài liệu PDF">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.title || ''}
                                    onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                  />
                                </Field>
                                <Field label="Mô tả / Hướng dẫn đọc">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.description || ''}
                                    onChange={(e) => updateBlockContent(b.id, { description: e.target.value })}
                                  />
                                </Field>
                              </div>
                              {(c.stream_url || pickedRes?.stream_url) && (
                                <iframe
                                  src={c.stream_url || pickedRes?.stream_url || ''}
                                  title={c.title || 'Xem trước PDF'}
                                  className="ls-pdf-frame"
                                />
                              )}
                            </div>
                          )}

                          {/* 6. FILE ATTACHMENT */}
                          {b.block_type === 'file' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <select
                                  className="t-input"
                                  style={{ flex: '1 1 240px' }}
                                  disabled={!canEdit}
                                  value={c.resource_id || ''}
                                  onChange={(e) => {
                                    const r = resourceMap[e.target.value];
                                    updateBlockContent(b.id, {
                                      resource_id: e.target.value,
                                      title: r?.title || c.title,
                                    });
                                  }}
                                  aria-label="Chọn tệp đính kèm"
                                >
                                  <option value="">— Chọn tệp từ kho tài liệu —</option>
                                  {resources.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.title} {r.file_name ? `(${r.file_name})` : ''}
                                    </option>
                                  ))}
                                </select>
                                {canEdit && (
                                  <label className="t-btn t-btn--small t-btn--primary" style={{ cursor: 'pointer' }}>
                                    {blockUpload ? 'Đang tải…' : '+ Tải tệp mới (≤ 10 MB)'}
                                    <input
                                      type="file"
                                      style={{ display: 'none' }}
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) void handleAttachmentFileChosen(b.id, f);
                                        e.currentTarget.value = '';
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                              <div className="t-form-grid">
                                <Field label="Nhãn hiển thị">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.title || ''}
                                    onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                  />
                                </Field>
                                <Field label="Ghi chú kèm theo">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.description || ''}
                                    onChange={(e) => updateBlockContent(b.id, { description: e.target.value })}
                                  />
                                </Field>
                              </div>
                            </div>
                          )}

                          {/* 7. TABLE */}
                          {b.block_type === 'table' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div className="t-table-wrap">
                                <table className="t-table">
                                  <tbody>
                                    {(c.rows || []).map((row: string[], ri: number) => (
                                      <tr key={ri}>
                                        {row.map((cell, ci) => (
                                          <td key={ci} style={{ padding: 4 }}>
                                            <input
                                              className="t-input"
                                              style={{ minWidth: 112, fontWeight: c.has_header && ri === 0 ? 700 : 400 }}
                                              disabled={!canEdit}
                                              value={cell}
                                              aria-label={`Hàng ${ri + 1} cột ${ci + 1}`}
                                              onChange={(e) => {
                                                const rows = (c.rows || []).map((r: string[], rIdx: number) =>
                                                  rIdx === ri
                                                    ? r.map((v, cIdx) => (cIdx === ci ? e.target.value : v))
                                                    : r
                                                );
                                                updateBlockContent(b.id, { rows });
                                              }}
                                            />
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {canEdit && (
                                <div className="t-actions">
                                  <Btn
                                    small
                                    variant="quiet"
                                    onClick={() =>
                                      updateBlockContent(b.id, {
                                        rows: [...(c.rows || []), Array((c.rows?.[0] || ['']).length).fill('')],
                                      })
                                    }
                                  >
                                    + Thêm dòng
                                  </Btn>
                                  <Btn
                                    small
                                    variant="quiet"
                                    onClick={() =>
                                      updateBlockContent(b.id, {
                                        rows: (c.rows || []).map((r: string[]) => [...r, '']),
                                      })
                                    }
                                  >
                                    + Thêm cột
                                  </Btn>
                                  <label className="ls-check-row">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(c.has_header)}
                                      onChange={(e) => updateBlockContent(b.id, { has_header: e.target.checked })}
                                    />
                                    <span>Dòng đầu là tiêu đề cột</span>
                                  </label>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 8. MATH */}
                          {b.block_type === 'math' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <Field label="Biểu thức công thức Toán (ký pháp LaTeX)">
                                <input
                                  className="t-input"
                                  style={{ fontFamily: 'var(--font-mono)' }}
                                  disabled={!canEdit}
                                  value={c.latex || ''}
                                  onChange={(e) => updateBlockContent(b.id, { latex: e.target.value })}
                                />
                              </Field>
                              <div className="t-math">{c.latex}</div>
                            </div>
                          )}

                          {/* 9. CODE */}
                          {(b.block_type === 'code' || b.block_type === 'code_block') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <Field label="Ngôn ngữ lập trình">
                                <input
                                  className="t-input"
                                  style={{ maxWidth: 220 }}
                                  disabled={!canEdit}
                                  value={c.language || 'python'}
                                  onChange={(e) => updateBlockContent(b.id, { language: e.target.value })}
                                />
                              </Field>
                              <textarea
                                className="t-input"
                                style={{ fontFamily: 'var(--font-mono)' }}
                                rows={5}
                                disabled={!canEdit}
                                value={c.code || ''}
                                onChange={(e) => updateBlockContent(b.id, { code: e.target.value })}
                                aria-label="Nội dung mã nguồn"
                              />
                            </div>
                          )}

                          {/* 10. QUOTE */}
                          {b.block_type === 'quote' && (
                            <div className="t-form-grid">
                              <Field label="Nội dung trích dẫn" wide>
                                <textarea
                                  className="t-input"
                                  rows={2}
                                  disabled={!canEdit}
                                  value={c.text || ''}
                                  onChange={(e) => updateBlockContent(b.id, { text: e.target.value })}
                                />
                              </Field>
                              <Field label="Nguồn / Tác giả" wide>
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.cite || ''}
                                  onChange={(e) => updateBlockContent(b.id, { cite: e.target.value })}
                                />
                              </Field>
                            </div>
                          )}

                          {/* 11. CALLOUT */}
                          {b.block_type === 'callout' && (
                            <div className="t-form-grid">
                              <Field label="Kiểu hộp ghi chú">
                                <select
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.variant || 'note'}
                                  onChange={(e) => updateBlockContent(b.id, { variant: e.target.value })}
                                >
                                  {Object.entries(CALLOUT_TITLES).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Tiêu đề hộp">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.title || ''}
                                  onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                />
                              </Field>
                              <Field label="Nội dung" wide>
                                <textarea
                                  className="t-input"
                                  rows={3}
                                  disabled={!canEdit}
                                  value={c.text || ''}
                                  onChange={(e) => updateBlockContent(b.id, { text: e.target.value })}
                                />
                                {(() => {
                                  const detectedWiki = findMatchedWikiTerms(String(c.text || ''), wikiPages);
                                  if (detectedWiki.length === 0) return null;
                                  return (
                                    <WikiReaderProvider wikiPages={wikiPages}>
                                      <div className="ls-wiki-detected" style={{ marginTop: 8 }}>
                                        <span className="ls-wiki-detected__label">
                                          Thẻ Wiki tự động gắn (<span className="tabular-nums">{detectedWiki.length}</span>):
                                        </span>
                                        <div className="ls-wiki-detected__chips">
                                          {detectedWiki.map((m) => (
                                            <WikiTermTrigger
                                              key={`${m.page.id}_${m.matchedKey}`}
                                              variant="chip"
                                              label={m.matchedText}
                                              matchedKey={m.matchedKey}
                                              page={m.page}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    </WikiReaderProvider>
                                  );
                                })()}
                              </Field>
                            </div>
                          )}

                          {/* 12. LINK */}
                          {b.block_type === 'link' && (
                            <div className="t-form-grid">
                              <Field label="Đường dẫn liên kết (URL)" required>
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.url || ''}
                                  onChange={(e) => updateBlockContent(b.id, { url: e.target.value })}
                                  placeholder="https://..."
                                />
                              </Field>
                              <Field label="Tiêu đề hiển thị">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.label || ''}
                                  onChange={(e) => updateBlockContent(b.id, { label: e.target.value })}
                                />
                              </Field>
                              <Field label="Mô tả ngắn" wide>
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.description || ''}
                                  onChange={(e) => updateBlockContent(b.id, { description: e.target.value })}
                                />
                              </Field>
                            </div>
                          )}

                          {/* 13. STANDALONE QUIZ BLOCK */}
                          {b.block_type === 'quiz' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div className="t-form-grid">
                                <Field label="Vị trí sư phạm của bài kiểm tra">
                                  <select
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.quiz_kind || 'QUICK_CHECK'}
                                    onChange={(e) => updateBlockContent(b.id, { quiz_kind: e.target.value as QuizKind })}
                                  >
                                    {(Object.keys(QUIZ_KIND_LABELS) as QuizKind[]).map((k) => (
                                      <option key={k} value={k}>
                                        {QUIZ_KIND_LABELS[k]}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Tiêu đề bài kiểm tra">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.title || ''}
                                    onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                  />
                                </Field>
                                <Field label="Hướng dẫn làm bài" wide>
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.description || ''}
                                    onChange={(e) => updateBlockContent(b.id, { description: e.target.value })}
                                  />
                                </Field>
                              </div>

                              {(c.questions || []).map((q: QuestionSpec, qi: number) => (
                                <div key={q.id || qi} className="ls-quiz-qcard">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong>Câu hỏi #{qi + 1}</strong>
                                    {canEdit && (c.questions || []).length > 1 && (
                                      <Btn
                                        small
                                        variant="danger"
                                        onClick={() =>
                                          updateBlockContent(b.id, {
                                            questions: (c.questions || []).filter((_: unknown, idx: number) => idx !== qi),
                                          })
                                        }
                                      >
                                        Xóa câu #{qi + 1}
                                      </Btn>
                                    )}
                                  </div>
                                  <QuestionForm
                                    value={q}
                                    disabled={!canEdit}
                                    onChange={(nextQ) =>
                                      updateBlockContent(b.id, {
                                        questions: (c.questions || []).map((oldQ: QuestionSpec, idx: number) =>
                                          idx === qi ? nextQ : oldQ
                                        ),
                                      })
                                    }
                                  />
                                </div>
                              ))}

                              {canEdit && (
                                <div className="t-actions">
                                  <Btn
                                    small
                                    variant="primary"
                                    onClick={() =>
                                      updateBlockContent(b.id, {
                                        questions: [...(c.questions || []), createDefaultQuestionSpec('SINGLE_CHOICE')],
                                      })
                                    }
                                  >
                                    + Thêm câu hỏi mới
                                  </Btn>
                                  {resolvedCourseId && (
                                    <Btn
                                      small
                                      variant="secondary"
                                      onClick={() => {
                                        setBankForQuizBlockId(b.id);
                                        setBankModalOpen(true);
                                      }}
                                    >
                                      + Lấy từ Ngân hàng câu hỏi
                                    </Btn>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Legacy review_question / inline_mcq */}
                          {(b.block_type === 'review_question' || b.block_type === 'inline_mcq') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <Field label="Câu hỏi ôn tập nhanh">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.question || ''}
                                  onChange={(e) => updateBlockContent(b.id, { question: e.target.value })}
                                />
                              </Field>
                              {(c.options || []).map((o: any, oi: number) => (
                                <div key={o.id || oi} className="ls-option-editor-row">
                                  <button
                                    type="button"
                                    className={`t-btn t-btn--small ${o.is_correct ? 't-btn--primary' : 't-btn--quiet'}`}
                                    disabled={!canEdit}
                                    onClick={() =>
                                      updateBlockContent(b.id, {
                                        options: (c.options || []).map((x: any, idx: number) => ({
                                          ...x,
                                          is_correct: idx === oi,
                                        })),
                                      })
                                    }
                                  >
                                    {o.is_correct ? <><IconCheck size={14} /> Đúng</> : 'Đặt đúng'}
                                  </button>
                                  <input
                                    className="t-input"
                                    style={{ flex: 1 }}
                                    disabled={!canEdit}
                                    value={o.text || ''}
                                    aria-label={`Phương án ${oi + 1}`}
                                    onChange={(e) =>
                                      updateBlockContent(b.id, {
                                        options: (c.options || []).map((x: any, idx: number) =>
                                          idx === oi ? { ...x, text: e.target.value } : x
                                        ),
                                      })
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 14. ASSIGNMENT */}
                          {(b.block_type === 'assignment' || b.block_type === 'assignment_link') && (
                            <div className="t-form-grid">
                              <Field label="Tiêu đề bài tập" required wide>
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.title || ''}
                                  onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                />
                              </Field>
                              <Field label="Đề bài / Yêu cầu" wide>
                                <textarea
                                  className="t-input"
                                  rows={3}
                                  disabled={!canEdit}
                                  value={c.description || ''}
                                  onChange={(e) => updateBlockContent(b.id, { description: e.target.value })}
                                />
                              </Field>
                              {b.block_type === 'assignment' && (
                                <>
                                  <Field label="Hướng dẫn trình bày & tiêu chí chấm" wide>
                                    <textarea
                                      className="t-input"
                                      rows={2}
                                      disabled={!canEdit}
                                      value={c.instructions || ''}
                                      onChange={(e) => updateBlockContent(b.id, { instructions: e.target.value })}
                                    />
                                  </Field>
                                  <Field label="Hình thức nộp bài">
                                    <select
                                      className="t-input"
                                      disabled={!canEdit}
                                      value={c.submission_type || 'BOTH'}
                                      onChange={(e) => updateBlockContent(b.id, { submission_type: e.target.value })}
                                    >
                                      {Object.entries(SUBMISSION_TYPE_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                  <Field label="Thang điểm tối đa">
                                    <input
                                      type="number"
                                      min={1}
                                      max={1000}
                                      className="t-input tabular-nums"
                                      disabled={!canEdit}
                                      value={c.max_score ?? 10}
                                      onChange={(e) => updateBlockContent(b.id, { max_score: Number(e.target.value) || 10 })}
                                    />
                                  </Field>
                                </>
                              )}
                              <Field label="Gợi ý hạn nộp">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.due_at || ''}
                                  onChange={(e) => updateBlockContent(b.id, { due_at: e.target.value })}
                                  placeholder="Ví dụ: Trước buổi học tiếp theo"
                                />
                              </Field>
                              <Field label="Liên kết nộp bài ngoài (nếu có)">
                                <input
                                  className="t-input"
                                  disabled={!canEdit}
                                  value={c.url || ''}
                                  onChange={(e) => updateBlockContent(b.id, { url: e.target.value })}
                                  placeholder="https://..."
                                />
                              </Field>
                            </div>
                          )}

                          {/* 15. SAFE EMBED */}
                          {b.block_type === 'embed' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              <div className="t-sub">
                                Hỗ trợ nhúng an toàn (HTTPS, không nhận mã HTML tùy ý) từ:{' '}
                                <strong>{ALLOWED_EMBED_HOST_HINTS.map((h) => h.name).join(', ')}</strong>.
                              </div>
                              <div className="t-form-grid">
                                <Field label="Đường dẫn nhúng (HTTPS từ nguồn được phép)" required wide>
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.embed_url || ''}
                                    onChange={(e) => updateBlockContent(b.id, { embed_url: e.target.value })}
                                    placeholder="https://www.geogebra.org/classic"
                                  />
                                </Field>
                                <Field label="Tiêu đề học liệu nhúng">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.title || ''}
                                    onChange={(e) => updateBlockContent(b.id, { title: e.target.value })}
                                  />
                                </Field>
                                <Field label="Chú thích hướng dẫn tương tác">
                                  <input
                                    className="t-input"
                                    disabled={!canEdit}
                                    value={c.caption || ''}
                                    onChange={(e) => updateBlockContent(b.id, { caption: e.target.value })}
                                  />
                                </Field>
                              </div>
                            </div>
                          )}
                              </div>
                            )}
                          </article>
                          {renderInlineInserter(bi)}
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Streamlined Quick-Insert Bar + Expandable Full Block Palette */}
              {canEdit && (
                <div className="ls-palette">
                  <div className="ls-palette__quick-bar">
                    <div className="ls-palette__quick-items">
                      <span className="ls-palette__quick-label">Thêm nhanh</span>
                      {QUICK_PALETTE_ITEMS.map((it) => (
                        <button
                          key={it.type}
                          type="button"
                          className="ls-palette-btn ls-palette-btn--quick"
                          onClick={() => insertBlock(it.type, blocks.length - 1)}
                        >
                          <span className="ls-palette-btn__icon">
                            <BlockTypeIcon type={it.type} size={15} />
                          </span>
                          <span>{it.label}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="t-btn t-btn--small t-btn--quiet"
                      aria-expanded={showAllBottomPalette}
                      onClick={() => setShowAllBottomPalette((v) => !v)}
                    >
                      <span>{showAllBottomPalette ? 'Thu gọn danh mục' : 'Tất cả khối (15)'}</span>
                      {showAllBottomPalette ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </button>
                  </div>

                  {showAllBottomPalette && (
                    <div className="ls-palette-groups" style={{ marginTop: 16 }}>
                      {BLOCK_PALETTE_GROUPS.map((grp) => (
                        <div key={grp.group} className="ls-palette-group">
                          <span className="ls-palette-group__title">{grp.group}</span>
                          <div className="ls-palette-buttons">
                            {grp.items.map((it) => (
                              <button
                                key={it.type}
                                type="button"
                                className="ls-palette-btn"
                                onClick={() => insertBlock(it.type, blocks.length - 1)}
                              >
                                <span className="ls-palette-btn__icon">
                                  <BlockTypeIcon type={it.type} size={15} />
                                </span>
                                <span>{it.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ----------------- RIGHT PANE: CONTEXTUAL INSPECTOR ----------------- */}
        {inspectorOpen && (
          <aside className="ls-right-pane" aria-label="Bảng thuộc tính chi tiết">
            <div className="ls-inspector-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'block'}
                onClick={() => setInspectorTab('block')}
              >
                Thuộc tính khối
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'lesson'}
                onClick={() => setInspectorTab('lesson')}
              >
                Cấu hình bài học
              </button>
            </div>

            <div className="ls-inspector-body">
              {inspectorTab === 'block' ? (
                !selectedBlock ? (
                  <p className="t-sub">
                    Nhấp vào một khối nội dung ở khung giữa để thiết lập hiển thị, điều kiện làm bài hoặc vị trí chèn.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <span className="t-sub">Đang chọn</span>
                      <strong style={{ display: 'block', fontSize: 15 }}>
                        {BLOCK_TYPE_NAMES[selectedBlock.block_type] || selectedBlock.block_type}
                      </strong>
                    </div>

                    {/* Mode B Anchor Position */}
                    {studioMode === 'CLASS' && (
                      <Field label="Vị trí chèn trong bài học của lớp">
                        <select
                          className="t-input"
                          disabled={!canEdit}
                          value={selectedBlock.anchor_block_id || ''}
                          onChange={(e) =>
                            updateBlockAnchor(selectedBlock.id, e.target.value ? e.target.value : null)
                          }
                        >
                          <option value="">Đặt ở cuối bài học</option>
                          {(classLesson?.inherited_blocks || []).map((ib, idx) => (
                            <option key={ib.id} value={ib.id}>
                              Ngay sau khối gốc #{idx + 1} ({BLOCK_TYPE_NAMES[ib.block_type] || ib.block_type})
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}

                    {/* Video-specific settings */}
                    {selectedBlock.block_type === 'video' && (
                      <div className="ls-inspector-group">
                        <strong>Điều khiển phát Video</strong>
                        <Field label="Bắt đầu phát từ giây thứ">
                          <input
                            type="number"
                            min={0}
                            className="t-input tabular-nums"
                            disabled={!canEdit}
                            value={selectedBlock.content.start_seconds || 0}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, {
                                start_seconds: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </Field>
                        <Field label="Thời lượng video (giây)">
                          <input
                            type="number"
                            min={0}
                            className="t-input tabular-nums"
                            disabled={!canEdit}
                            value={selectedBlock.content.duration_seconds || 0}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, {
                                duration_seconds: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </Field>
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={selectedBlock.content.allow_seeking_ahead !== false}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, { allow_seeking_ahead: e.target.checked })
                            }
                          />
                          <span>Cho phép tua nhanh qua đoạn chưa xem</span>
                        </label>
                      </div>
                    )}

                    {/* PDF-specific settings */}
                    {selectedBlock.block_type === 'pdf' && (
                      <div className="ls-inspector-group">
                        <strong>Quyền truy cập PDF</strong>
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={selectedBlock.content.allow_download !== false}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, { allow_download: e.target.checked })
                            }
                          />
                          <span>Cho phép học viên tải tệp PDF về máy</span>
                        </label>
                      </div>
                    )}

                    {/* Quiz-specific settings */}
                    {selectedBlock.block_type === 'quiz' && (
                      <div className="ls-inspector-group">
                        <strong>Điều kiện đạt Quiz</strong>
                        <Field label="Điểm đạt tối thiểu (%)">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className="t-input tabular-nums"
                            disabled={!canEdit}
                            value={selectedBlock.content.pass_score_pct ?? 60}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, {
                                pass_score_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                              })
                            }
                          />
                        </Field>
                        <Field label="Số lượt làm tối đa (0 = không giới hạn)">
                          <input
                            type="number"
                            min={0}
                            max={20}
                            className="t-input tabular-nums"
                            disabled={!canEdit}
                            value={selectedBlock.content.max_attempts ?? 3}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, {
                                max_attempts: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </Field>
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(selectedBlock.content.is_required)}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, { is_required: e.target.checked })
                            }
                          />
                          <span>Bắt buộc vượt qua để hoàn thành bài học</span>
                        </label>
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={selectedBlock.content.show_answer_after_submit !== false}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, { show_answer_after_submit: e.target.checked })
                            }
                          />
                          <span>Hiện đáp án đúng sau khi nộp</span>
                        </label>
                      </div>
                    )}

                    {/* Embed-specific settings */}
                    {selectedBlock.block_type === 'embed' && (
                      <div className="ls-inspector-group">
                        <Field label="Chiều cao khung nhúng (240–800 px)">
                          <input
                            type="number"
                            min={240}
                            max={800}
                            step={20}
                            className="t-input tabular-nums"
                            disabled={!canEdit}
                            value={selectedBlock.content.height ?? 420}
                            onChange={(e) =>
                              updateBlockContent(selectedBlock.id, {
                                height: Math.max(240, Math.min(800, Number(e.target.value) || 420)),
                              })
                            }
                          />
                        </Field>
                      </div>
                    )}

                    {/* Universal Display Options (Section VII.2) */}
                    {selectedBlock.block_type !== 'math' && (
                      <div className="ls-inspector-group">
                        <strong>Tùy chọn hiển thị khối</strong>
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(selectedDisplayCfg.highlight)}
                            onChange={(e) => setSelectedDisplayPatch({ highlight: e.target.checked })}
                          />
                          <span>Làm nổi bật khối quan trọng</span>
                        </label>
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(selectedDisplayCfg.collapsible)}
                            onChange={(e) => setSelectedDisplayPatch({ collapsible: e.target.checked })}
                          />
                          <span>Cho phép học viên thu gọn / mở rộng</span>
                        </label>
                        {selectedDisplayCfg.collapsible && (
                          <label className="ls-check-row">
                            <input
                              type="checkbox"
                              disabled={!canEdit}
                              checked={Boolean(selectedDisplayCfg.default_collapsed)}
                              onChange={(e) => setSelectedDisplayPatch({ default_collapsed: e.target.checked })}
                            />
                            <span>Mặc định thu gọn khi mới mở bài</span>
                          </label>
                        )}
                        <label className="ls-check-row">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(selectedDisplayCfg.hidden)}
                            onChange={(e) => setSelectedDisplayPatch({ hidden: e.target.checked })}
                          />
                          <span>Ẩn tạm thời khỏi giao diện học viên</span>
                        </label>
                      </div>
                    )}

                    {canEdit && (
                      <div className="ls-inspector-footer">
                        <Btn
                          small
                          variant="quiet"
                          onClick={() => {
                            const idx = blocks.findIndex((x) => x.id === selectedBlock.id);
                            if (idx >= 0) duplicateBlock(selectedBlock, idx);
                          }}
                        >
                          <IconCopy size={14} /> Nhân bản
                        </Btn>
                        <Btn
                          small
                          variant="danger"
                          onClick={() => {
                            const c = selectedBlock.content || {};
                            const hasAttachedQuiz =
                              markers.some((m) => m.block_id === selectedBlock.id) ||
                              (selectedBlock.block_type === 'quiz' &&
                                Array.isArray(c.questions) &&
                                c.questions.length > 0);
                            if (hasAttachedQuiz) {
                              setTreeConfirm({
                                title: 'Xóa khối nội dung này?',
                                message:
                                  'Khối này đang chứa câu hỏi tương tác hoặc mốc thời gian trên video. Bạn có chắc chắn muốn xóa khỏi bài học?',
                                label: 'Xóa khối',
                                danger: true,
                                run: async () => removeBlock(selectedBlock.id),
                              });
                            } else {
                              removeBlock(selectedBlock.id);
                            }
                          }}
                        >
                          <IconTrash size={14} /> Xóa khối
                        </Btn>
                      </div>
                    )}
                  </div>
                )
              ) : studioMode === 'COURSE' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Field label="Thời lượng dự kiến (phút)">
                    <input
                      type="number"
                      min={1}
                      max={600}
                      className="t-input tabular-nums"
                      disabled={!canEdit}
                      value={lessonMeta.duration_minutes}
                      onChange={(e) => {
                        setLessonMeta((m) => ({
                          ...m,
                          duration_minutes: Math.max(1, Number(e.target.value) || 15),
                        }));
                        setSaveStatus('DIRTY');
                      }}
                    />
                  </Field>

                  <Field label="Mục tiêu cần đạt của bài học">
                    <textarea
                      className="t-input"
                      rows={4}
                      disabled={!canEdit}
                      value={lessonMeta.objectives}
                      onChange={(e) => {
                        setLessonMeta((m) => ({ ...m, objectives: e.target.value }));
                        setSaveStatus('DIRTY');
                      }}
                      placeholder="Sau bài học này, học viên có thể…"
                    />
                  </Field>

                  <Field label="Điều kiện ghi nhận hoàn thành bài học">
                    <select
                      className="t-input"
                      disabled={!canEdit}
                      value={lessonMeta.completion_rule}
                      onChange={(e) => {
                        const nextRule = e.target.value as CompletionRule;
                        setLessonMeta((m) => ({
                          ...m,
                          completion_rule: nextRule,
                          require_video_quizzes:
                            nextRule === 'VIDEO_AND_QUIZ' ? true : m.require_video_quizzes,
                        }));
                        setSaveStatus('DIRTY');
                      }}
                    >
                      <option value="MANUAL">Tự xác nhận hoàn thành</option>
                      <option value="REVIEW_CORRECT">Trả lời đúng câu hỏi ôn tập</option>
                      <option value="VIDEO_AND_QUIZ">Xem đủ Video & hoàn thành Quiz bắt buộc</option>
                    </select>
                  </Field>

                  <Field label="Tỷ lệ xem video tối thiểu (%)">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      className="t-input tabular-nums"
                      disabled={!canEdit}
                      value={lessonMeta.min_video_watch_pct}
                      onChange={(e) => {
                        setLessonMeta((m) => ({
                          ...m,
                          min_video_watch_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        }));
                        setSaveStatus('DIRTY');
                      }}
                    />
                  </Field>

                  <label className="ls-check-row">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={Boolean(lessonMeta.require_video_quizzes)}
                      onChange={(e) => {
                        setLessonMeta((m) => ({ ...m, require_video_quizzes: e.target.checked }));
                        setSaveStatus('DIRTY');
                      }}
                    />
                    <span>Bắt buộc trả lời hết các mốc câu hỏi bắt buộc trên video trước khi hoàn thành bài</span>
                  </label>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <strong>Thông tin kế thừa từ khóa học</strong>
                  <p className="t-sub" style={{ margin: 0 }}>
                    Phiên bản bài gốc đang áp dụng: <strong className="tabular-nums">v{classLesson?.lesson.published_version}</strong>
                  </p>
                  <p className="t-sub" style={{ margin: 0 }}>
                    Thời lượng chuẩn: <strong className="tabular-nums">{classLesson?.lesson.duration_minutes} phút</strong>
                  </p>
                  {classLesson?.lesson.objectives && (
                    <div>
                      <span className="t-sub">Mục tiêu gốc:</span>
                      <p style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                        {classLesson.lesson.objectives}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* =================================================================
          MODALS: PREVIEW / PUBLISH POLICY / VERSIONS / QUESTION BANK / TREE CONFIRM
      ================================================================= */}

      {/* 1. Student Preview Modal (Desktop / Mobile + Full Lesson / Interactive Video Only) */}
      {previewModal && (
        <Modal
          title="Xem trước giao diện học tập của học viên"
          onClose={() => setPreviewModal(null)}
          width={1040}
          footer={<Btn onClick={() => setPreviewModal(null)}>Đóng xem trước</Btn>}
        >
          <div className="ls-preview-toolbar">
            <div className="t-seg" role="group" aria-label="Phạm vi xem trước">
              <button
                type="button"
                aria-pressed={previewModal.scope === 'LESSON'}
                onClick={() => setPreviewModal({ ...previewModal, scope: 'LESSON' })}
              >
                Toàn bộ bài học
              </button>
              <button
                type="button"
                aria-pressed={previewModal.scope === 'VIDEO'}
                onClick={() => setPreviewModal({ ...previewModal, scope: 'VIDEO' })}
              >
                Chỉ Video tương tác
              </button>
            </div>

            <div className="t-seg" role="group" aria-label="Khung màn hình thiết bị">
              <button
                type="button"
                aria-pressed={previewModal.viewport === 'DESKTOP'}
                onClick={() => setPreviewModal({ ...previewModal, viewport: 'DESKTOP' })}
              >
                <IconMonitor size={14} /> Máy tính
              </button>
              <button
                type="button"
                aria-pressed={previewModal.viewport === 'MOBILE'}
                onClick={() => setPreviewModal({ ...previewModal, viewport: 'MOBILE' })}
              >
                <IconSmartphone size={14} /> Điện thoại
              </button>
            </div>
          </div>

          <div
            className={`ls-preview-stage ${
              previewModal.viewport === 'MOBILE' ? 'is-mobile' : ''
            }`}
          >
            <h2 style={{ marginTop: 0 }}>{previewPayload.title}</h2>
            {'instructorNote' in previewPayload && previewPayload.instructorNote && (
              <div className="t-callout" style={{ marginBottom: 16 }}>
                <strong>Dặn dò của giảng viên lớp</strong>
                <span style={{ whiteSpace: 'pre-wrap' }}>{previewPayload.instructorNote}</span>
              </div>
            )}
            <WikiReaderProvider wikiPages={wikiPages}>
              {previewPayload.objectives && (
                <div className="t-callout" style={{ marginBottom: 20 }}>
                  <strong>Mục tiêu bài học</strong>
                  <span style={{ whiteSpace: 'pre-wrap' }}>
                    <WikiAnnotatedText text={previewPayload.objectives} wikiPages={wikiPages} />
                  </span>
                </div>
              )}

              {previewPayload.blocks.length === 0 ? (
                <EmptyState title="Chưa có nội dung hiển thị trong chế độ xem này" />
              ) : (
                <BlockList
                  blocks={previewPayload.blocks}
                  ctx={{
                    previewMode: true,
                    resources: resourceMap,
                    wikiPages,
                    videoMarkers: previewPayload.markers,
                    onDownload: async (resId) => {
                      const f = await teachingApi.downloadResource(resId);
                      saveBlob(f);
                    },
                  }}
                />
              )}
            </WikiReaderProvider>
          </div>
        </Modal>
      )}

      {/* 2. Publish & Multi-Class Impact Policy Modal */}
      {publishDialogOpen && (
        <Modal
          title={
            studioMode === 'COURSE'
              ? 'Xuất bản phiên bản mới của bài học'
              : `Xuất bản nội dung riêng cho lớp ${classShell?.class.code}`
          }
          onClose={() => setPublishDialogOpen(false)}
          width={600}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setPublishDialogOpen(false)} disabled={publishing}>
                Hủy
              </Btn>
              <Btn variant="primary" onClick={handlePublishConfirm} loading={publishing}>
                {studioMode === 'COURSE' && classesUsing.length > 1
                  ? `Xác nhận xuất bản cho ${classesUsing.length} lớp`
                  : 'Xuất bản ngay'}
              </Btn>
            </>
          }
        >
          {studioMode === 'COURSE' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {classesUsing.length > 1 ? (
                <div className="t-notice t-notice--warning">
                  <strong>Cảnh báo phạm vi ảnh hưởng đa lớp:</strong> Khóa học này đang được sử dụng bởi{' '}
                  <strong className="tabular-nums">{classesUsing.length} lớp học</strong> (
                  {classesUsing.map((c) => c.code).join(', ')}).
                  <p style={{ margin: '8px 0 0' }}>
                    Khi xuất bản tại đây, toàn bộ các lớp trên sẽ nhận bản cập nhật mới. Nếu bạn chỉ muốn điều chỉnh riêng cho một lớp cụ thể:
                  </p>
                  <div className="t-actions" style={{ marginTop: 10 }}>
                    {classesUsing.map((cl) => (
                      <Link
                        key={cl.id}
                        className="t-btn t-btn--small"
                        to={`/teaching/classes/${cl.id}/studio?lesson=${activeLessonId}`}
                        onClick={() => setPublishDialogOpen(false)}
                      >
                        Mở Studio riêng lớp {cl.code} ↗
                      </Link>
                    ))}
                    {courseShell?.capabilities.can_duplicate && (
                      <Btn
                        small
                        variant="quiet"
                        onClick={async () => {
                          const copy = await teachingApi.duplicateCourse(resolvedCourseId, {});
                          setPublishDialogOpen(false);
                          toast({ tone: 'success', title: 'Đã nhân bản khóa học độc lập', detail: copy.code });
                          navigate(`/teaching/courses/${copy.id}/studio`);
                        }}
                      >
                        Sao chép thành khóa học mới
                      </Btn>
                    )}
                  </div>
                </div>
              ) : (
                <p style={{ margin: 0 }}>
                  Hệ thống sẽ lưu ảnh chụp phiên bản mới (bao gồm toàn bộ các khối nội dung và mốc câu hỏi tương tác trên video) để học viên bắt đầu học ngay.
                </p>
              )}

              <Field label="Ghi chú phiên bản (tùy chọn)">
                <input
                  className="t-input"
                  value={publishChangeNote}
                  onChange={(e) => setPublishChangeNote(e.target.value)}
                  placeholder="Ví dụ: Bổ sung video bài giảng và 3 câu hỏi mốc giờ…"
                />
              </Field>
            </div>
          ) : (
            <p style={{ margin: 0 }}>
              Các ghi chú dặn dò, khối học liệu và mốc câu hỏi video bạn vừa soạn sẽ được xuất bản riêng cho học viên lớp{' '}
              <strong>{classShell?.class.code}</strong>. Khóa học chuẩn và các lớp khác hoàn toàn không bị thay đổi.
            </p>
          )}
        </Modal>
      )}

      {/* 3. Version History & Restore Modal */}
      {versionsModalOpen && (
        <Modal
          title="Lịch sử phiên bản giáo án đã xuất bản"
          onClose={() => setVersionsModalOpen(false)}
          width={680}
          footer={<Btn onClick={() => setVersionsModalOpen(false)}>Đóng</Btn>}
        >
          {versionsLoading ? (
            <Loading rows={3} />
          ) : versionsError ? (
            <ErrorState error={versionsError} onRetry={openVersionHistory} />
          ) : versionsList.length === 0 ? (
            <EmptyState
              title="Bài học chưa có phiên bản xuất bản nào"
              text="Mỗi lần bạn bấm Xuất bản, hệ thống sẽ lưu lại một phiên bản độc lập tại đây để có thể khôi phục bất cứ lúc nào."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {versionsList.map((v) => (
                <div key={v.id} className="ls-bank-card">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong className="tabular-nums">Phiên bản v{v.version_number}</strong>
                      <span className="t-sub tabular-nums">{fmtDateTime(v.published_at)}</span>
                    </div>
                    <span className="t-sub" style={{ display: 'block', marginTop: 4 }}>
                      Người xuất bản: {v.published_by} ·{' '}
                      <span className="tabular-nums">
                        {v.blocks_count} khối · {v.markers_count} mốc video
                      </span>
                    </span>
                    {v.change_note && (
                      <p style={{ margin: '8px 0 0', fontSize: 13 }}>Ghi chú: {v.change_note}</p>
                    )}
                  </div>
                  {canEdit && (
                    <Btn
                      small
                      onClick={() =>
                        setTreeConfirm({
                          title: `Khôi phục phiên bản v${v.version_number} về bản nháp?`,
                          message:
                            'Nội dung bản nháp hiện tại sẽ được thay thế bằng phiên bản đã chọn. Phiên bản đang xuất bản cho học viên chưa thay đổi cho tới khi bạn bấm Xuất bản.',
                          label: 'Khôi phục về nháp',
                          run: () => handleRestoreVersion(v.version_number),
                        })
                      }
                    >
                      Khôi phục về nháp
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* 4. Question Bank Modal (Standalone or Picker for Standalone Quiz Block) */}
      {bankModalOpen && resolvedCourseId && (
        <QuestionBankModal
          courseId={resolvedCourseId}
          canEdit={canEdit}
          onClose={() => {
            setBankModalOpen(false);
            setBankForQuizBlockId(null);
          }}
          onPickQuestion={
            bankForQuizBlockId
              ? (item) => {
                  const targetBlock = blocks.find((x) => x.id === bankForQuizBlockId);
                  if (!targetBlock) return;
                  const nextQ: QuestionSpec = {
                    id: item.id,
                    question_id: item.id,
                    question_type: item.question_type,
                    prompt: item.prompt,
                    options: item.options ? item.options.map((o) => ({ ...o })) : [],
                    answer_key: item.answer_key ? { ...item.answer_key } : {},
                    points: item.points ?? 1,
                    explanation: item.explanation || '',
                  };
                  updateBlockContent(bankForQuizBlockId, {
                    questions: [...(targetBlock.content.questions || []), nextQ],
                  });
                }
              : undefined
          }
        />
      )}

      {/* 5. Tree Delete / Archive Confirmation */}
      {treeConfirm && (
        <ConfirmDialog
          title={treeConfirm.title}
          message={treeConfirm.message}
          confirmLabel={treeConfirm.label}
          danger={treeConfirm.danger}
          onCancel={() => setTreeConfirm(null)}
          onConfirm={async () => {
            await treeConfirm.run();
            setTreeConfirm(null);
          }}
        />
      )}
    </div>
  );
};
