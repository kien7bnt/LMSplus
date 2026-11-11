import React, { useState } from 'react';
import { BlockType, CalloutVariant, LessonBlock, TAPermissionFlags, UserRole } from '../../types/elearning';
import {
  Badge,
  Button,
  ScopePermissionGuard,
  SurfacePanel,
} from '../ui/Primitives';

interface BlockEditorViewProps {
  lessonTitle: string;
  initialBlocks: LessonBlock[];
  currentRole: UserRole;
  taFlags: TAPermissionFlags;
  onPublishVersion: (blocks: LessonBlock[], versionNum: number) => void;
  onNotify?: (msg: string, detail?: string) => void;
}

const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  learning_objective: '🎯 Mục tiêu học tập (Learning Objective)',
  definition: '📘 Định nghĩa chuẩn (Definition)',
  remember: '💡 Ghi nhớ cốt lõi (Remember)',
  note: '📝 Lưu ý mở rộng (Note)',
  warning: '⚠️ Cảnh báo lỗi thường gặp (Warning)',
  exam_tip: '🔥 Mẹo thi & Câu hỏi trọng tâm (Exam Tip)',
  summary: '📌 Tóm tắt nhanh (Summary)',
};

export const BlockEditorView: React.FC<BlockEditorViewProps> = ({
  lessonTitle,
  initialBlocks,
  currentRole,
  taFlags,
  onPublishVersion,
  onNotify,
}) => {
  const [blocks, setBlocks] = useState<LessonBlock[]>(initialBlocks);
  const [revisionNumber, setRevisionNumber] = useState<number>(4);
  const [publishedVersion, setPublishedVersion] = useState<number>(2);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);
  const [lastSavedText, setLastSavedText] = useState<string>(
    'Bản nháp đã được lưu tự động'
  );

  const handleAddBlock = (type: BlockType) => {
    const newBlock: LessonBlock = {
      id: `blk_${Date.now().toString().slice(-4)}`,
      lesson_id: 'les_302',
      schema_version: '1.0',
      block_type: type,
      sort_order: (blocks.length + 1) * 1000,
      status: 'ACTIVE',
      content:
        type === 'callout'
          ? {
              variant: 'exam_tip',
              title: 'Mẹo thi trọng tâm Chương 3',
              text: 'Nhớ kiểm tra điều kiện quá bán (Quorum = floor(N/2) + 1) trong mọi bài toán đồng thuận Raft.',
            }
          : type === 'inline_mcq'
          ? {
              question: 'Câu hỏi kiểm tra nhanh mới: Khi nào xảy ra Split Vote trong Raft?',
              options: [
                {
                  id: 'a',
                  text: 'Khi 2 Candidate cùng hết hạn Election Timeout và tự bầu cùng lúc',
                  is_correct: true,
                  feedback: 'Chính xác! Raft giải quyết bằng Randomized Timeout (150ms–300ms).',
                },
                {
                  id: 'b',
                  text: 'Khi Leader gửi Heartbeat định kỳ',
                  is_correct: false,
                  feedback: 'Heartbeat giúp duy trì quyền của Leader hiện tại.',
                },
              ],
            }
          : type === 'step_by_step_solution'
          ? {
              problem: 'Bài tập mới: Cụm 9 nút chịu được tối đa bao nhiêu nút dừng hoạt động?',
              steps: [
                {
                  step_number: 1,
                  title: 'Tính Quorum tối thiểu',
                  explanation: 'Q = floor(9 / 2) + 1 = 5 nút.',
                },
                {
                  step_number: 2,
                  title: 'Suy ra số nút lỗi chịu được',
                  explanation: 'F = 9 - 5 = 4 nút lỗi.',
                },
              ],
            }
          : type === 'code_block'
          ? {
              language: 'python',
              code: 'def quorum_size(total_nodes: int) -> int:\n    return (total_nodes // 2) + 1',
            }
          : {
              text: 'Nhập nội dung đoạn văn mới...',
            },
    };

    const nextRev = revisionNumber + 1;
    setBlocks((prev) => [...prev, newBlock]);
    setRevisionNumber(nextRev);
    setLastSavedText('Bản nháp đã được lưu tự động');
    onNotify?.(
      `Đã thêm khối "${BLOCK_TYPE_NAMES[type]}" vào bài giảng!`,
      'Nội dung đang soạn đã được lưu nháp tự động.'
    );
  };

  const handleMoveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const cloned = [...blocks];
    const [moved] = cloned.splice(index, 1);
    cloned.splice(target, 0, moved);
    setBlocks(cloned);
    setRevisionNumber((r) => r + 1);
  };

  const handleDeleteBlock = (blockId: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== blockId));
    setRevisionNumber((r) => r + 1);
    onNotify?.('Đã xóa khối nội dung khỏi bản nháp hiện tại.');
  };

  const handlePublish = () => {
    const nextVer = publishedVersion + 1;
    setPublishedVersion(nextVer);
    setLastSavedText(`Đã xuất bản chính thức Phiên bản v${nextVer}`);
    onPublishVersion(blocks, nextVer);
    onNotify?.(
      `Đã xuất bản chính thức Phiên bản v${nextVer}!`,
      'Nội dung bài học tại màn hình Không gian Học bài đã được cập nhật tức thì.'
    );
  };

  const BLOCK_TYPE_NAMES: Record<string, string> = {
    paragraph: 'Đoạn văn bản',
    callout: 'Hộp ghi chú sư phạm',
    step_by_step_solution: 'Bài giải từng bước',
    inline_mcq: 'Câu hỏi trắc nghiệm',
    code_block: 'Khối mã nguồn',
  };

  const ROLE_NAMES: Record<UserRole, string> = {
    STUDENT: 'Học viên',
    INSTRUCTOR: 'Giảng viên',
    TEACHING_ASSISTANT: 'Trợ giảng',
    ACADEMIC_STAFF: 'Giáo vụ Khoa',
    ADMIN: 'Quản trị viên',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      <div className="editor-2col-layout">
        {/* LEFT: NOTION-STYLE BLOCK AUTHORING CANVAS */}
        <SurfacePanel>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              paddingBottom: 'var(--space-4)',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: 'var(--space-5)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <Badge tone="learning">Trình soạn thảo Học liệu Tương tác</Badge>
                <span className="tabular-nums" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {lastSavedText}
                </span>
              </div>
              <h1 style={{ fontSize: 'var(--text-h2)', margin: '6px 0 0 0' }}>{lessonTitle}</h1>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button variant="subtle" size="sm" onClick={() => setIsPreviewMode((p) => !p)}>
                {isPreviewMode ? '✏️ Quay lại Chỉnh sửa' : '👁️ Xem thử giao diện Học viên'}
              </Button>

              {/* Only Instructor or Admin can Publish a LessonVersion; TA cannot publish */}
              <ScopePermissionGuard
                currentRole={currentRole}
                allowedRoles={['INSTRUCTOR', 'ADMIN']}
                fallback={
                  <Badge tone="warning">
                    🔒 Vai trò {ROLE_NAMES[currentRole]}: Chỉ được lưu bản nháp (Cần quyền Giảng viên để Xuất bản)
                  </Badge>
                }
              >
                <Button variant="primary" size="sm" onClick={handlePublish}>
                  🚀 Xuất bản Phiên bản v{publishedVersion + 1}
                </Button>
              </ScopePermissionGuard>
            </div>
          </div>

          <ScopePermissionGuard
            currentRole={currentRole}
            allowedRoles={['INSTRUCTOR', 'TEACHING_ASSISTANT', 'ADMIN']}
            taFlags={taFlags}
            requiredTaFlag="can_manage_materials"
            fallback={
              <div
                style={{
                  padding: 'var(--space-6)',
                  textAlign: 'center',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <Badge tone="danger">Chế độ Chỉ đọc</Badge>
                <h3 style={{ marginTop: '8px' }}>
                  Vai trò hiện tại ({ROLE_NAMES[currentRole]}) không có quyền chỉnh sửa học liệu
                </h3>
                <p style={{ margin: '4px auto 0 auto', color: 'var(--text-secondary)', fontSize: '14px' }}>
                  Vui lòng chuyển sang tài khoản <strong>Giảng viên</strong> hoặc{' '}
                  <strong>Trợ giảng được cấp quyền biên tập học liệu</strong> để chỉnh sửa nội dung.
                </p>
              </div>
            }
          >
            {/* Block List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {blocks.map((block, index) => (
                <div
                  key={block.id}
                  style={{
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    boxShadow: 'var(--shadow-card)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '8px',
                      marginBottom: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Badge tone="neutral">
                        Phần #{index + 1} • {BLOCK_TYPE_NAMES[block.block_type] || 'Nội dung'}
                      </Badge>

                      {block.block_type === 'callout' && !isPreviewMode && (
                        <select
                          aria-label="Chọn kiểu hộp Callout sư phạm"
                          value={block.content.variant || 'learning_objective'}
                          onChange={(e) => {
                            const nextVariant = e.target.value as CalloutVariant;
                            setBlocks((prev) =>
                              prev.map((b) =>
                                b.id === block.id
                                  ? { ...b, content: { ...b.content, variant: nextVariant } }
                                  : b
                              )
                            );
                          }}
                          style={{
                            minHeight: '44px',
                            padding: '0 12px',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid var(--border-strong)',
                            backgroundColor: 'var(--bg-surface-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          {Object.entries(CALLOUT_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {!isPreviewMode && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={index === 0}
                          onClick={() => handleMoveBlock(index, -1)}
                          aria-label="Di chuyển khối lên"
                        >
                          ↑ Lên
                        </Button>
                        <Button
                          size="sm"
                          variant="subtle"
                          disabled={index === blocks.length - 1}
                          onClick={() => handleMoveBlock(index, 1)}
                          aria-label="Di chuyển khối xuống"
                        >
                          ↓ Xuống
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteBlock(block.id)}
                          aria-label="Xóa khối"
                        >
                          Xóa
                        </Button>
                      </div>
                    )}
                  </div>

                  {isPreviewMode ? (
                    <div
                      style={{
                        fontSize: '15px',
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface-subtle)',
                      }}
                    >
                      {block.content.title && <strong>{block.content.title}: </strong>}
                      {block.content.text ||
                        block.content.question ||
                        block.content.problem ||
                        block.content.code}
                    </div>
                  ) : (
                    <textarea
                      aria-label={`Nội dung khối ${block.block_type}`}
                      value={
                        block.content.text ||
                        block.content.question ||
                        block.content.problem ||
                        block.content.code ||
                        ''
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        setBlocks((prev) =>
                          prev.map((item) =>
                            item.id === block.id
                              ? {
                                  ...item,
                                  content: {
                                    ...item.content,
                                    ...(item.block_type === 'inline_mcq'
                                      ? { question: val }
                                      : item.block_type === 'step_by_step_solution'
                                      ? { problem: val }
                                      : item.block_type === 'code_block'
                                      ? { code: val }
                                      : { text: val }),
                                  },
                                }
                              : item
                          )
                        );
                        setRevisionNumber((r) => r + 1);
                      }}
                      rows={block.block_type === 'code_block' ? 4 : 2}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        backgroundColor: 'var(--bg-surface-subtle)',
                        color: 'var(--text-primary)',
                        fontFamily:
                          block.block_type === 'code_block' ? 'var(--font-mono)' : 'var(--font-sans)',
                        fontSize: '14px',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Insert Block Toolbar (6 Categories) */}
            {!isPreviewMode && (
              <div
                style={{
                  marginTop: 'var(--space-6)',
                  paddingTop: 'var(--space-4)',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  + CHÈN KHỐI NỘI DUNG MỚI (6 NHÓM BLOCK CHUẨN NOTION / COURSERA):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <Button size="sm" variant="subtle" onClick={() => handleAddBlock('paragraph')}>
                    + 📝 Văn bản / Khái niệm
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => handleAddBlock('callout')}>
                    + 🎯 Callout Sư phạm (7 nhãn)
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => handleAddBlock('step_by_step_solution')}>
                    + 🪜 Ví dụ giải từng bước
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => handleAddBlock('inline_mcq')}>
                    + ❓ Quiz Kiểm tra nhanh (MCQ)
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => handleAddBlock('code_block')}>
                    + 💻 Code Sandbox (Python/SQL)
                  </Button>
                </div>
              </div>
            )}
          </ScopePermissionGuard>
        </SurfacePanel>

        {/* RIGHT: REVISION HISTORY & LESSON OUTLINE SUMMARY */}
        <SurfacePanel style={{ padding: 'var(--space-5)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
            Lịch sử Phiên bản Bài giảng
          </h2>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginBottom: 'var(--space-5)',
            }}
          >
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-strong)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong className="tabular-nums">● Bản nháp hiện tại (#{revisionNumber})</strong>
                <Badge tone="warning">Đang soạn thảo</Badge>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Bao gồm {blocks.length} phần nội dung • Tự động kiểm tra đồng bộ khi lưu
              </div>
            </div>

            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong className="tabular-nums">✔ Phiên bản v{publishedVersion}</strong>
                <Badge tone="success">Đang phát hành</Badge>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Bản chính thức đang hiển thị cho Học viên tại Không gian Học bài
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px' }}>
            Tóm tắt Mục lục Bài giảng ({blocks.length} phần)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {blocks.map((b, idx) => (
              <div
                key={b.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '12px',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {idx + 1}. {BLOCK_TYPE_NAMES[b.block_type] || 'Nội dung bài học'}
                </div>
                <div
                  style={{
                    color: 'var(--text-secondary)',
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.content.title || b.content.question || b.content.problem || b.content.text || 'Nội dung mã nguồn'}
                </div>
              </div>
            ))}
          </div>
        </SurfacePanel>
      </div>
    </div>
  );
};
