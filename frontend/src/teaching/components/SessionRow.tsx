import React from 'react';
import { Link } from 'react-router-dom';
import { SessionSummary } from '../api';
import { Badge, fmtDate, fmtTime, fmtWeekday } from '../ui';

export const attendanceLink = (s: Pick<SessionSummary, 'class_id' | 'id'>) =>
  `/teaching/classes/${s.class_id}/attendance?session=${encodeURIComponent(s.id)}`;

export const virtualSessionLink = (s: Pick<SessionSummary, 'class_id' | 'id'>) =>
  `/teaching/classes/${s.class_id}/sessions/${encodeURIComponent(s.id)}/live`;

/** Một dòng buổi học: thời gian, lớp, nội dung, trạng thái điểm danh + thao tác nhanh. */
export const SessionRow: React.FC<{ s: SessionSummary; showClass?: boolean; showDate?: boolean; actions?: React.ReactNode; classLink?: boolean }> = ({
  s,
  showClass = true,
  showDate = false,
  actions,
  classLink = true,
}) => (
  <div className="t-session-item">
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: '1 1 320px', minWidth: 0 }}>
      <span className="t-session-time">
        {fmtTime(s.start_at)}–{fmtTime(s.end_at)}
        {showDate && <span className="t-sub">{fmtWeekday(s.start_at)}, {fmtDate(s.start_at)}</span>}
      </span>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            {showClass &&
              (classLink ? (
                <Link className="t-row-link" to={`/teaching/classes/${s.class_id}`}>
                  Lớp {s.class_code}
                </Link>
              ) : (
                <>Lớp {s.class_code}</>
              ))}
            {showClass ? ' · ' : ''}
            {s.title}
          </span>
          {s.virtual_room && <Badge kind="virtualProvider" value={s.virtual_room.provider} />}
          {s.live_status === 'LIVE' && <Badge kind="liveStatus" value="LIVE" />}
        </strong>
        <span className="t-sub">
          {s.virtual_room
            ? `${s.virtual_room.room_title}${s.virtual_room.external_meeting_id ? ` · ID: ${s.virtual_room.external_meeting_id}` : ''}`
            : s.room_or_link || 'Chưa có phòng học'}
          {s.session_status === 'CANCELLED' && s.cancel_reason ? ` · Lý do hủy: ${s.cancel_reason}` : ''}
        </span>
      </span>
    </div>
    <div className="t-actions">
      {classLink && <Badge kind="attendanceState" value={s.attendance_state} />}
      {s.attendance_state === 'SAVED' || s.attendance_state === 'LOCKED' ? (
        <span className="t-sub tabular-nums">
          {s.marked_count} đã điểm danh
        </span>
      ) : null}
      {actions ??
        (s.session_status !== 'CANCELLED' ? (
          <>
            {classLink && (
              <Link className="t-btn t-btn--small" to={virtualSessionLink(s)}>
                {s.virtual_room ? 'Phòng trực tuyến' : 'Tạo phòng online'}
              </Link>
            )}
            {s.attendance_state !== 'NOT_STARTED' && (
              <Link className={`t-btn t-btn--small ${s.attendance_state === 'NEEDS_ATTENDANCE' ? 't-btn--primary' : ''}`} to={attendanceLink(s)}>
                {s.attendance_state === 'NEEDS_ATTENDANCE' ? 'Điểm danh ngay' : 'Xem điểm danh'}
              </Link>
            )}
          </>
        ) : null)}
    </div>
  </div>
);
