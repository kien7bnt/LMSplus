import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WikiPageItem } from './api';
import { Btn, Modal, Tone, fmtDateTime } from './ui';

interface WikiMatchEntry {
  term: string;
  norm: string;
  page: WikiPageItem;
  source: 'TAG' | 'TITLE';
}

export interface DetectedWikiMatch {
  matchedText: string;
  matchedKey: string;
  page: WikiPageItem;
  source: 'TAG' | 'TITLE' | 'EXPLICIT';
}

interface TextSegment {
  kind: 'text' | 'wiki';
  text: string;
  matchedKey?: string;
  page?: WikiPageItem;
  source?: 'TAG' | 'TITLE' | 'EXPLICIT';
}

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && WORD_CHAR_RE.test(ch));
}

function normVi(str: string): string {
  return str.normalize('NFC').trim().toLocaleLowerCase('vi');
}

function buildWikiIndex(wikiPages: WikiPageItem[], excludePageId?: string): WikiMatchEntry[] {
  const entries: WikiMatchEntry[] = [];
  const seenKey = new Set<string>();

  for (const page of wikiPages) {
    if (!page || page.id === excludePageId || page.status === 'ARCHIVED') continue;
    const rawTags = Array.isArray(page.tags) ? page.tags : [];
    for (const rawTag of rawTags) {
      const term = String(rawTag || '').normalize('NFC').trim().replace(/^#+/, '').trim();
      if (term.length < 2) continue;
      const norm = normVi(term);
      if (!seenKey.has(norm)) {
        seenKey.add(norm);
        entries.push({ term, norm, page, source: 'TAG' });
      }
    }
    const title = String(page.title || '').normalize('NFC').trim();
    if (title.length >= 2) {
      const norm = normVi(title);
      if (!seenKey.has(norm)) {
        seenKey.add(norm);
        entries.push({ term: title, norm, page, source: 'TITLE' });
      }
    }
  }

  // Match longer phrases first (e.g., "phân số thập phân" before "phân số")
  entries.sort((a, b) => b.norm.length - a.norm.length);
  return entries;
}

function findPageForExplicitRef(refText: string, wikiPages: WikiPageItem[], excludePageId?: string): WikiPageItem | null {
  const target = normVi(refText);
  if (!target) return null;
  for (const page of wikiPages) {
    if (!page || page.id === excludePageId || page.status === 'ARCHIVED') continue;
    if (normVi(page.title) === target || normVi(page.slug) === target) return page;
    if ((page.tags || []).some((t) => normVi(String(t)) === target)) return page;
  }
  return null;
}

function tokenizePlainSegment(
  plainRaw: string,
  entries: WikiMatchEntry[],
  matchedTermsInBlock: Set<string>
): TextSegment[] {
  if (!plainRaw || entries.length === 0) return [{ kind: 'text', text: plainRaw }];
  const plain = plainRaw.normalize('NFC');
  const lower = plain.toLocaleLowerCase('vi');
  const out: TextSegment[] = [];
  let cursor = 0;
  let bufStart = 0;

  while (cursor < plain.length) {
    let found: WikiMatchEntry | null = null;
    const prevChar = cursor > 0 ? plain[cursor - 1] : undefined;
    if (!isWordChar(prevChar)) {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (matchedTermsInBlock.has(entry.norm)) continue;
        const len = entry.norm.length;
        if (cursor + len > lower.length) continue;
        if (lower.startsWith(entry.norm, cursor)) {
          const nextChar = cursor + len < plain.length ? plain[cursor + len] : undefined;
          if (!isWordChar(nextChar)) {
            found = entry;
            break;
          }
        }
      }
    }

    if (found) {
      if (cursor > bufStart) {
        out.push({ kind: 'text', text: plain.slice(bufStart, cursor) });
      }
      const originalSlice = plain.slice(cursor, cursor + found.norm.length);
      out.push({
        kind: 'wiki',
        text: originalSlice,
        matchedKey: found.term,
        page: found.page,
        source: found.source,
      });
      matchedTermsInBlock.add(found.norm);
      cursor += found.norm.length;
      bufStart = cursor;
    } else {
      cursor += 1;
    }
  }

  if (bufStart < plain.length) {
    out.push({ kind: 'text', text: plain.slice(bufStart) });
  }
  return out;
}

export function tokenizeTextWithWiki(
  text: string,
  wikiPages: WikiPageItem[] = [],
  excludePageId?: string
): TextSegment[] {
  if (!text) return [];
  if (!wikiPages || wikiPages.length === 0) return [{ kind: 'text', text }];

  const entries = buildWikiIndex(wikiPages, excludePageId);
  const matchedTermsInBlock = new Set<string>();
  const segments: TextSegment[] = [];

  // Support explicit Wikipedia syntax [[Từ khóa]] or [[Từ khóa|Nhãn hiển thị]]
  const explicitRe = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = explicitRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      segments.push(...tokenizePlainSegment(text.slice(lastIdx, m.index), entries, matchedTermsInBlock));
    }
    const target = m[1].trim();
    const displayLabel = (m[2] || m[1]).trim();
    const page = findPageForExplicitRef(target, wikiPages, excludePageId);
    if (page) {
      segments.push({
        kind: 'wiki',
        text: displayLabel,
        matchedKey: target,
        page,
        source: 'EXPLICIT',
      });
      matchedTermsInBlock.add(normVi(target));
    } else {
      segments.push({ kind: 'text', text: displayLabel });
    }
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < text.length) {
    segments.push(...tokenizePlainSegment(text.slice(lastIdx), entries, matchedTermsInBlock));
  }
  return segments;
}

export function findMatchedWikiTerms(
  text: string,
  wikiPages: WikiPageItem[] = []
): DetectedWikiMatch[] {
  const segs = tokenizeTextWithWiki(text, wikiPages);
  const seen = new Set<string>();
  const matches: DetectedWikiMatch[] = [];
  for (const s of segs) {
    if (s.kind === 'wiki' && s.page) {
      const key = `${s.page.id}:${normVi(s.matchedKey || s.text)}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          matchedText: s.text,
          matchedKey: s.matchedKey || s.text,
          page: s.page,
          source: s.source || 'TAG',
        });
      }
    }
  }
  return matches;
}

function cleanReadableLatex(raw: string): string {
  return raw
    .replace(/\$([^$]+)\$/g, (_, expr: string) =>
      expr
        .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
        .replace(/\\times/g, '×')
        .replace(/\\div/g, '÷')
        .replace(/\\cdot/g, '·')
        .replace(/\\le/g, '≤')
        .replace(/\\ge/g, '≥')
        .replace(/\{,\}/g, ',')
        .replace(/\\[a-zA-Z]+/g, '')
        .replace(/[{}]/g, '')
        .trim()
    );
}

function cleanLineForExcerpt(line: string): string {
  return cleanReadableLatex(line)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function extractWikiExcerpt(
  page: WikiPageItem,
  maxChars = 190
): { lead: string; bodyLines: string[]; hasMore: boolean } {
  const rawLead = cleanLineForExcerpt(page.summary || '');
  const lead = rawLead && normVi(rawLead) !== normVi(page.title || '') ? rawLead : '';
  const rawLines = String(page.content_markdown || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bodyLines: string[] = [];
  const charBudget = Math.max(96, maxChars - Math.min(lead.length, 100));
  let consumed = 0;
  let truncated = false;

  for (const rawLine of rawLines) {
    const cleaned = cleanLineForExcerpt(rawLine);
    if (!cleaned) continue;
    // Skip pure section header if it's just "1. Định nghĩa" and we still have body text
    if (/^#{1,6}\s+/.test(rawLine) && rawLines.length > 1 && bodyLines.length === 0) {
      continue;
    }
    if (lead && normVi(cleaned) === normVi(lead)) continue;

    if (consumed + cleaned.length > charBudget) {
      const remaining = Math.max(44, charBudget - consumed);
      const cut = cleaned.slice(0, remaining).replace(/\s+\S*$/, '').trim();
      if (cut) bodyLines.push(`${cut}…`);
      truncated = true;
      break;
    }
    bodyLines.push(cleaned);
    consumed += cleaned.length;
    if (bodyLines.length >= 2) {
      if (rawLines.length > bodyLines.length + 1) truncated = true;
      break;
    }
  }

  return {
    lead,
    bodyLines,
    hasMore: truncated || String(page.content_markdown || '').length > maxChars,
  };
}

// Inline Markdown formatter (bold, italic, code, math) — 100% React elements, zero dangerouslySetInnerHTML
function renderInlineFormatting(
  line: string,
  wikiPages: WikiPageItem[],
  excludePageId?: string,
  onOpenWiki?: (page: WikiPageItem) => void
): React.ReactNode {
  const cleaned = cleanReadableLatex(line);
  const parts: React.ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let keyIdx = 0;

  while ((m = tokenRe.exec(cleaned)) !== null) {
    if (m.index > last) {
      parts.push(
        <WikiAnnotatedText
          key={`t_${keyIdx++}`}
          text={cleaned.slice(last, m.index)}
          wikiPages={wikiPages}
          excludePageId={excludePageId}
          onOpenWiki={onOpenWiki}
        />
      );
    }
    const tok = m[0];
    if (tok.startsWith('**') && tok.endsWith('**')) {
      parts.push(<strong key={`b_${keyIdx++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      parts.push(<code key={`c_${keyIdx++}`} className="wiki-inline-code">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      parts.push(<em key={`i_${keyIdx++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }

  if (last < cleaned.length) {
    parts.push(
      <WikiAnnotatedText
        key={`t_${keyIdx++}`}
        text={cleaned.slice(last)}
        wikiPages={wikiPages}
        excludePageId={excludePageId}
        onOpenWiki={onOpenWiki}
      />
    );
  }
  return parts;
}

export const WikiMarkdownView: React.FC<{
  content: string;
  wikiPages?: WikiPageItem[];
  excludePageId?: string;
  onOpenWiki?: (page: WikiPageItem) => void;
}> = ({ content, wikiPages = [], excludePageId, onOpenWiki }) => {
  const lines = String(content || '').split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let keyIdx = 0;

  const flushList = () => {
    if (listBuf.length === 0) return;
    const items = listBuf;
    listBuf = [];
    nodes.push(
      <ul key={`ul_${keyIdx++}`} className="wiki-md-list">
        {items.map((it, idx) => (
          <li key={idx}>{renderInlineFormatting(it, wikiPages, excludePageId, onOpenWiki)}</li>
        ))}
      </ul>
    );
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      flushList();
      const level = hMatch[1].length;
      nodes.push(
        level <= 2 ? (
          <h3 key={`h_${keyIdx++}`} className="wiki-md-h3">
            {hMatch[2]}
          </h3>
        ) : (
          <h4 key={`h_${keyIdx++}`} className="wiki-md-h4">
            {hMatch[2]}
          </h4>
        )
      );
      continue;
    }
    const liMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (liMatch) {
      listBuf.push(liMatch[1]);
      continue;
    }
    flushList();
    nodes.push(
      <p key={`p_${keyIdx++}`} className="wiki-md-p">
        {renderInlineFormatting(trimmed, wikiPages, excludePageId, onOpenWiki)}
      </p>
    );
  }
  flushList();

  return <div className="wiki-md-body">{nodes}</div>;
};

// Shared Reader Context so clicking "Đọc toàn bộ" from ANY block opens the full Wiki Reader Modal
interface WikiReaderContextValue {
  wikiPages: WikiPageItem[];
  openWikiPage: (page: WikiPageItem) => void;
}

const WikiReaderContext = createContext<WikiReaderContextValue | null>(null);

export const WikiReaderProvider: React.FC<{
  wikiPages?: WikiPageItem[];
  onOpenWikiPage?: (page: WikiPageItem) => void;
  children: React.ReactNode;
}> = ({ wikiPages = [], onOpenWikiPage, children }) => {
  const [activePage, setActivePage] = useState<WikiPageItem | null>(null);

  const openWikiPage = useCallback(
    (page: WikiPageItem) => {
      setActivePage(page);
      onOpenWikiPage?.(page);
    },
    [onOpenWikiPage]
  );

  const ctxValue = useMemo(
    () => ({ wikiPages, openWikiPage }),
    [wikiPages, openWikiPage]
  );

  return (
    <WikiReaderContext.Provider value={ctxValue}>
      {children}
      {activePage && (
        <Modal
          title={activePage.title}
          onClose={() => setActivePage(null)}
          width={760}
          footer={<Btn onClick={() => setActivePage(null)}>Đóng bài Wiki</Btn>}
        >
          <div className="wiki-reader-modal">
            <div className="wiki-reader-modal__meta">
              <div className="wiki-tag-list">
                <Tone tone="info">Wiki môn học</Tone>
                {(activePage.tags || []).map((tag) => (
                  <span key={tag} className="wiki-tag-pill">
                    #{tag}
                  </span>
                ))}
              </div>
              {activePage.updated_at && (
                <span className="t-sub tabular-nums">
                  Cập nhật {fmtDateTime(activePage.updated_at)}
                </span>
              )}
            </div>

            {activePage.summary && (
              <p className="wiki-reader-modal__summary">{activePage.summary}</p>
            )}

            <WikiMarkdownView
              content={activePage.content_markdown}
              wikiPages={wikiPages}
              excludePageId={activePage.id}
              onOpenWiki={openWikiPage}
            />
          </div>
        </Modal>
      )}
    </WikiReaderContext.Provider>
  );
};

// Crisp SVG Book/Wiki Emblem (1.75px stroke, zero raw emojis)
const WikiBookIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="ls-svg"
  >
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    <path d="M8 7h8" />
    <path d="M8 11h6" />
  </svg>
);

const WikiCloseIcon: React.FC = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="ls-svg"
  >
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const WikiArrowRightIcon: React.FC = () => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="ls-svg"
  >
    <path d="M5 12h14" />
    <path d="M13 5l7 7-7 7" />
  </svg>
);

export const WikiTermTrigger: React.FC<{
  label: string;
  matchedKey: string;
  page: WikiPageItem;
  onOpenWiki?: (page: WikiPageItem) => void;
  variant?: 'inline' | 'chip';
}> = ({ label, matchedKey, page, onOpenWiki, variant = 'inline' }) => {
  const readerCtx = useContext(WikiReaderContext);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  });

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    const gap = 10;
    const cardW = Math.min(368, window.innerWidth - 32);
    const measuredH = cardRef.current?.getBoundingClientRect().height || 240;
    const cardH = Math.min(measuredH, window.innerHeight - margin * 2);

    const idealLeft = rect.left + rect.width / 2 - cardW / 2;
    const clampedLeft = Math.max(16, Math.min(window.innerWidth - cardW - 16, idealLeft));

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;

    // Avoid overlapping cross-origin video/PDF iframes when the opposite side is clear
    const bottomTop = rect.bottom + gap;
    const bottomEnd = bottomTop + cardH;
    const topStart = Math.max(margin, rect.top - cardH - gap);
    const topEnd = topStart + cardH;
    let bottomHitsIframe = false;
    let topHitsIframe = false;
    const iframes = document.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i += 1) {
      const r = iframes[i].getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const overlapX = clampedLeft < r.right && clampedLeft + cardW > r.left;
      if (overlapX && bottomTop < r.bottom && bottomEnd > r.top) {
        bottomHitsIframe = true;
      }
      if (overlapX && topStart < r.bottom && topEnd > r.top) {
        topHitsIframe = true;
      }
    }

    const preferTop =
      (bottomHitsIframe && !topHitsIframe && spaceAbove >= Math.min(cardH, 180)) ||
      (spaceBelow < cardH + gap && spaceAbove >= spaceBelow);
    const placement: 'top' | 'bottom' = preferTop ? 'top' : 'bottom';

    const rawTop = placement === 'bottom' ? bottomTop : rect.top - cardH - gap;
    const clampedTop = Math.max(margin, Math.min(window.innerHeight - cardH - margin, rawTop));

    setCoords({ top: clampedTop, left: clampedLeft, placement });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const raf = window.requestAnimationFrame(updatePosition);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && cardRef.current) {
      ro = new ResizeObserver(() => updatePosition());
      ro.observe(cardRef.current);
    }
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        clearTimers();
        setOpen(false);
        setPinned(false);
      }
    };
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !cardRef.current?.contains(target)
      ) {
        clearTimers();
        setOpen(false);
        setPinned(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const scheduleOpen = () => {
    clearTimers();
    openTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, 170);
  };

  const scheduleClose = () => {
    if (pinned) return;
    clearTimers();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 180);
  };

  const handleOpenFull = () => {
    clearTimers();
    setOpen(false);
    setPinned(false);
    if (readerCtx) readerCtx.openWikiPage(page);
    else onOpenWiki?.(page);
  };

  const excerpt = useMemo(() => extractWikiExcerpt(page, 190), [page]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={variant === 'chip' ? 'wiki-studio-chip' : 'wiki-inline-term'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onBlur={(ev) => {
          const next = ev.relatedTarget as Node | null;
          if (!next || !cardRef.current?.contains(next)) {
            scheduleClose();
          }
        }}
        onClick={(ev) => {
          ev.stopPropagation();
          clearTimers();
          if (open && pinned) {
            setOpen(false);
            setPinned(false);
          } else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        {variant === 'chip' && <WikiBookIcon size={13} />}
        <span>{variant === 'chip' ? `#${matchedKey}` : label}</span>
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label={`Xem nhanh Wiki: ${page.title}`}
            className={`wiki-hovercard is-${coords.placement}`}
            style={{ top: coords.top, left: coords.left }}
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="wiki-hovercard__head">
              <div className="wiki-hovercard__eyebrow">
                <span className="wiki-emblem" aria-hidden="true">
                  <WikiBookIcon size={13} />
                </span>
                <span>Wiki bài học</span>
                {matchedKey && normVi(matchedKey) !== normVi(page.title) && (
                  <span className="wiki-tag-pill">#{matchedKey}</span>
                )}
              </div>
              <button
                type="button"
                className="wiki-hovercard__close"
                aria-label="Đóng thẻ xem nhanh Wiki"
                onClick={() => {
                  clearTimers();
                  setOpen(false);
                  setPinned(false);
                }}
              >
                <WikiCloseIcon />
              </button>
            </div>

            <div className="wiki-hovercard__body">
              <strong className="wiki-hovercard__title">{page.title}</strong>
              {excerpt.lead && <p className="wiki-hovercard__lead">{excerpt.lead}</p>}
              {excerpt.bodyLines.length > 0 && (
                <div className="wiki-hovercard__excerpt">
                  {excerpt.bodyLines.map((line, idx) => (
                    <p key={idx}>{line}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="wiki-hovercard__foot">
              <div className="wiki-hovercard__tags">
                {(page.tags || []).slice(0, 3).map((tag) => (
                  <span key={tag} className="wiki-tag-pill">
                    #{tag}
                  </span>
                ))}
              </div>
              {(readerCtx || onOpenWiki) && (
                <button
                  type="button"
                  className="wiki-hovercard__more"
                  onClick={handleOpenFull}
                >
                  <span>Đọc toàn bộ</span>
                  <WikiArrowRightIcon />
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

export const WikiAnnotatedText: React.FC<{
  text?: string | null;
  wikiPages?: WikiPageItem[];
  excludePageId?: string;
  onOpenWiki?: (page: WikiPageItem) => void;
}> = ({ text, wikiPages, excludePageId, onOpenWiki }) => {
  const readerCtx = useContext(WikiReaderContext);
  const effectivePages = wikiPages ?? readerCtx?.wikiPages ?? [];

  const segments = useMemo(
    () => tokenizeTextWithWiki(text || '', effectivePages, excludePageId),
    [text, effectivePages, excludePageId]
  );

  if (!text) return null;
  if (segments.length === 1 && segments[0].kind === 'text') {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'wiki' && seg.page ? (
          <WikiTermTrigger
            key={`${seg.page.id}_${i}`}
            label={seg.text}
            matchedKey={seg.matchedKey || seg.text}
            page={seg.page}
            onOpenWiki={onOpenWiki}
          />
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </>
  );
};
