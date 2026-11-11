/**
 * LMSPLUS Lesson Studio — Chuẩn hóa, bảo mật đáp án và chấm điểm tự động cho:
 *  1. Ngân hàng câu hỏi (question_bank_items)
 *  2. Câu hỏi tương tác theo mốc thời gian trên Video (video_quiz_markers)
 *  3. Khối Quiz độc lập trong bài học (block_type = 'quiz')
 *
 * Nguyên tắc bảo mật bắt buộc:
 *  - KHÔNG BAO GIỜ gửi answer_key, is_correct, correct_feedback, wrong_feedback xuống học viên trước khi nộp bài.
 *  - Sau khi nộp bài, chỉ trả về đáp án đúng / lời giải nếu giảng viên bật show_answer_after_submit / show_explanation.
 */

import crypto from 'node:crypto';

export const QUESTION_TYPES = [
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
  'FILL_BLANK',
  'SHORT_ANSWER',
];

export const MARKER_BEHAVIORS = ['PAUSE_AND_ASK', 'PAUSE_OPTIONAL', 'INFO_ONLY'];

export const QUIZ_KINDS = ['PRE_LESSON', 'MID_LESSON', 'POST_LESSON', 'QUICK_CHECK', 'PRACTICE'];

export const ALLOWED_DIRECT_VIDEO_DOMAINS = new Set([
  'storage.googleapis.com',
  'commondatastorage.googleapis.com',
  'interactive-examples.mdn.mozilla.net',
  'upload.wikimedia.org',
  'cdn.lmsplus.edu.vn',
  'media.lmsplus.edu.vn',
]);

export const ALLOWED_EMBED_DOMAINS = new Map([
  ['www.geogebra.org', 'GEOGEBRA'],
  ['geogebra.org', 'GEOGEBRA'],
  ['phet.colorado.edu', 'PHET'],
  ['www.desmos.com', 'DESMOS'],
  ['desmos.com', 'DESMOS'],
  ['www.youtube-nocookie.com', 'YOUTUBE'],
]);

export class QuizValidationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'INVALID_QUIZ_SPEC';
  }
}

const cleanStr = (v, max, label, required = false) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new QuizValidationError(`Thiếu ${label}.`);
    return '';
  }
  const s = String(v).trim();
  if (s.length > max) throw new QuizValidationError(`${label} vượt quá ${max} ký tự.`);
  if (required && !s) throw new QuizValidationError(`Thiếu ${label}.`);
  return s;
};

/**
 * Chuẩn hóa đặc tả một câu hỏi (dùng cho Ngân hàng câu hỏi, Video Marker và Quiz Block).
 */
export function normalizeQuestionSpec(raw, prefix = 'Câu hỏi') {
  if (!raw || typeof raw !== 'object') {
    throw new QuizValidationError(`${prefix}: dữ liệu câu hỏi không hợp lệ.`);
  }
  const questionType = String(raw.question_type || 'SINGLE_CHOICE').toUpperCase();
  if (!QUESTION_TYPES.includes(questionType)) {
    throw new QuizValidationError(`${prefix}: dạng câu hỏi "${questionType}" không được hỗ trợ.`);
  }
  const id =
    typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id)
      ? raw.id
      : `q_${crypto.randomBytes(5).toString('hex')}`;
  const questionId =
    typeof raw.question_id === 'string' && raw.question_id.trim() ? raw.question_id.trim().slice(0, 64) : null;
  const prompt = cleanStr(raw.prompt ?? raw.question, 3000, `${prefix}: nội dung câu hỏi`, true);
  const pointsNum = Number(raw.points ?? 1);
  if (!Number.isFinite(pointsNum) || pointsNum < 0 || pointsNum > 100) {
    throw new QuizValidationError(`${prefix}: điểm số phải từ 0 đến 100.`);
  }
  const points = Math.round(pointsNum * 100) / 100;
  const explanation = cleanStr(raw.explanation, 3000, `${prefix}: giải thích`);
  const correctFeedback = cleanStr(raw.correct_feedback, 1000, `${prefix}: phản hồi khi đúng`);
  const wrongFeedback = cleanStr(raw.wrong_feedback, 1000, `${prefix}: phản hồi khi sai`);

  let options = [];
  let answerKey = {};
  const rawKey = raw.answer_key && typeof raw.answer_key === 'object' ? raw.answer_key : {};

  if (questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') {
    if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 8) {
      throw new QuizValidationError(`${prefix}: cần từ 2 đến 8 phương án trả lời.`);
    }
    const seenOpt = new Set();
    options = raw.options.map((o, idx) => {
      if (!o || typeof o !== 'object') throw new QuizValidationError(`${prefix}: phương án #${idx + 1} không hợp lệ.`);
      let optId =
        typeof o.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(o.id) ? o.id : `opt_${idx + 1}`;
      if (seenOpt.has(optId)) optId = `opt_${idx + 1}_${crypto.randomBytes(2).toString('hex')}`;
      seenOpt.add(optId);
      const keyCorrectList = Array.isArray(rawKey.correct_option_ids)
        ? rawKey.correct_option_ids
        : Array.isArray(rawKey.option_ids)
          ? rawKey.option_ids
          : typeof rawKey.option_id === 'string' && rawKey.option_id
            ? [rawKey.option_id]
            : [];
      const isCorrect = Boolean(o.is_correct) || keyCorrectList.includes(optId);
      return {
        id: optId,
        text: cleanStr(o.text, 800, `${prefix}: nội dung phương án #${idx + 1}`, true),
        is_correct: isCorrect,
        feedback: cleanStr(o.feedback, 500, `${prefix}: phản hồi phương án`),
      };
    });
    const correctIds = options.filter((o) => o.is_correct).map((o) => o.id);
    if (correctIds.length === 0) {
      throw new QuizValidationError(`${prefix}: cần chọn ít nhất 1 đáp án đúng.`);
    }
    if (questionType === 'SINGLE_CHOICE' && correctIds.length > 1) {
      // Giữ đáp án đúng đầu tiên nếu là trắc nghiệm 1 đáp án
      const first = correctIds[0];
      options = options.map((o) => ({ ...o, is_correct: o.id === first }));
      answerKey = { correct_option_ids: [first] };
    } else {
      answerKey = { correct_option_ids: correctIds };
    }
  } else if (questionType === 'TRUE_FALSE') {
    let boolAns = true;
    if (typeof rawKey.boolean_answer === 'boolean') {
      boolAns = rawKey.boolean_answer;
    } else if (typeof rawKey.value === 'boolean') {
      boolAns = rawKey.value;
    } else if (Array.isArray(rawKey.correct_option_ids) && rawKey.correct_option_ids.length > 0) {
      boolAns = rawKey.correct_option_ids[0] === 'true';
    } else if (Array.isArray(raw.options)) {
      const tOpt = raw.options.find((o) => o && (o.id === 'true' || String(o.text).toLowerCase() === 'đúng'));
      const fOpt = raw.options.find((o) => o && (o.id === 'false' || String(o.text).toLowerCase() === 'sai'));
      if (fOpt && fOpt.is_correct && !(tOpt && tOpt.is_correct)) boolAns = false;
    }
    options = [
      { id: 'true', text: 'Đúng', is_correct: boolAns, feedback: '' },
      { id: 'false', text: 'Sai', is_correct: !boolAns, feedback: '' },
    ];
    answerKey = { correct_option_ids: [boolAns ? 'true' : 'false'], boolean_answer: boolAns };
  } else if (questionType === 'FILL_BLANK') {
    const rawAccepted = Array.isArray(rawKey.accepted_texts)
      ? rawKey.accepted_texts
      : Array.isArray(rawKey.accepted)
        ? rawKey.accepted
        : typeof raw.accepted_text === 'string'
          ? raw.accepted_text.split('|')
          : [];
    const acceptedTexts = rawAccepted
      .map((s) => cleanStr(s, 300, `${prefix}: đáp án điền khuyết`))
      .filter(Boolean);
    if (acceptedTexts.length === 0) {
      throw new QuizValidationError(`${prefix}: câu hỏi điền khuyết cần ít nhất 1 đáp án chấp nhận.`);
    }
    answerKey = {
      accepted_texts: acceptedTexts,
      case_sensitive: Boolean(rawKey.case_sensitive),
    };
  } else if (questionType === 'SHORT_ANSWER') {
    const keywords = (Array.isArray(rawKey.keywords) ? rawKey.keywords : [])
      .map((s) => cleanStr(s, 200, `${prefix}: từ khóa`))
      .filter(Boolean);
    const acceptedTexts = (Array.isArray(rawKey.accepted_texts) ? rawKey.accepted_texts : [])
      .map((s) => cleanStr(s, 500, `${prefix}: đáp án mẫu`))
      .filter(Boolean);
    const sampleAnswer = cleanStr(rawKey.sample_answer, 2000, `${prefix}: gợi ý đáp án`);
    const manualReview =
      rawKey.manual_review !== undefined
        ? Boolean(rawKey.manual_review)
        : keywords.length === 0 && acceptedTexts.length === 0;
    answerKey = {
      keywords,
      accepted_texts: acceptedTexts,
      sample_answer: sampleAnswer,
      manual_review: manualReview,
    };
  }

  return {
    id,
    question_id: questionId,
    question_type: questionType,
    prompt,
    options,
    answer_key: answerKey,
    points,
    explanation,
    correct_feedback: correctFeedback,
    wrong_feedback: wrongFeedback,
  };
}

/**
 * Gỡ toàn bộ thông tin đáp án & chấm điểm nhạy cảm trước khi trả về cho Học viên.
 */
export function stripQuestionForStudent(question, { revealAnswer = false, revealExplanation = false } = {}) {
  if (!question || typeof question !== 'object') return null;
  const out = {
    id: question.id,
    question_id: question.question_id || null,
    question_type: question.question_type,
    prompt: question.prompt,
    points: Number(question.points ?? 1),
    options: Array.isArray(question.options)
      ? question.options.map((o) => ({
          id: o.id,
          text: o.text,
          ...(revealAnswer ? { is_correct: Boolean(o.is_correct) } : {}),
        }))
      : [],
  };
  if (revealAnswer) {
    out.correct_answer = publicCorrectAnswer(question);
  }
  if (revealExplanation && question.explanation) {
    out.explanation = question.explanation;
  }
  return out;
}

export function publicCorrectAnswer(question) {
  const key = question.answer_key || {};
  switch (question.question_type) {
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
    case 'TRUE_FALSE':
      return {
        correct_option_ids:
          key.correct_option_ids ||
          (question.options || []).filter((o) => o.is_correct).map((o) => o.id),
      };
    case 'FILL_BLANK':
      return { accepted_texts: key.accepted_texts || [] };
    case 'SHORT_ANSWER':
      return {
        sample_answer: key.sample_answer || (key.accepted_texts && key.accepted_texts[0]) || '',
        keywords: key.keywords || [],
      };
    default:
      return {};
  }
}

const normText = (s, caseSensitive = false) => {
  const collapsed = String(s ?? '').trim().replace(/\s+/g, ' ');
  return caseSensitive ? collapsed : collapsed.toLowerCase();
};

/**
 * Chấm điểm câu trả lời của học viên cho một câu hỏi.
 * @returns {{ is_correct: boolean, grading_status: 'GRADED'|'PENDING_REVIEW', earned_points: number, max_points: number, feedback: string, normalized_response: object }}
 */
export function gradeQuestionResponse(question, rawResponse = {}) {
  const qType = question.question_type;
  const maxPoints = Number(question.points ?? 1);
  const key = question.answer_key || {};

  if (qType === 'SINGLE_CHOICE' || qType === 'TRUE_FALSE') {
    const boolShortcut = typeof rawResponse.value === 'boolean' ? (rawResponse.value ? 'true' : 'false') : undefined;
    const selectedId = String(
      rawResponse.selected_option_id ??
        rawResponse.option_id ??
        boolShortcut ??
        (Array.isArray(rawResponse.selected_option_ids) ? rawResponse.selected_option_ids[0] : undefined) ??
        (Array.isArray(rawResponse.option_ids) ? rawResponse.option_ids[0] : '') ??
        ''
    ).trim();
    const correctIds =
      key.correct_option_ids || (question.options || []).filter((o) => o.is_correct).map((o) => o.id);
    const isCorrect = Boolean(selectedId) && correctIds.includes(selectedId);
    const pickedOpt = (question.options || []).find((o) => o.id === selectedId);
    const feedback =
      (pickedOpt && pickedOpt.feedback) ||
      (isCorrect
        ? question.correct_feedback || 'Chính xác! Bạn đã chọn đúng đáp án.'
        : question.wrong_feedback || 'Chưa chính xác. Hãy xem lại nội dung vừa học nhé.');
    return {
      is_correct: isCorrect,
      grading_status: 'GRADED',
      earned_points: isCorrect ? maxPoints : 0,
      max_points: maxPoints,
      feedback,
      normalized_response: { selected_option_id: selectedId },
    };
  }

  if (qType === 'MULTIPLE_CHOICE') {
    const rawList = Array.isArray(rawResponse.selected_option_ids)
      ? rawResponse.selected_option_ids
      : Array.isArray(rawResponse.option_ids)
        ? rawResponse.option_ids
        : [];
    const selected = Array.from(
      new Set(
        rawList
          .map((x) => String(x).trim())
          .filter(Boolean)
      )
    ).sort();
    const correct = Array.from(
      new Set(
        (key.correct_option_ids || (question.options || []).filter((o) => o.is_correct).map((o) => o.id)).map((x) =>
          String(x).trim()
        )
      )
    ).sort();
    const isCorrect =
      selected.length === correct.length && selected.every((val, idx) => val === correct[idx]);
    return {
      is_correct: isCorrect,
      grading_status: 'GRADED',
      earned_points: isCorrect ? maxPoints : 0,
      max_points: maxPoints,
      feedback: isCorrect
        ? question.correct_feedback || 'Chính xác! Bạn đã chọn đầy đủ các phương án đúng.'
        : question.wrong_feedback || 'Chưa đầy đủ hoặc có phương án chưa đúng.',
      normalized_response: { selected_option_ids: selected },
    };
  }

  if (qType === 'FILL_BLANK') {
    const textAns = String(rawResponse.text ?? '').trim();
    const caseSensitive = Boolean(key.case_sensitive);
    const candidate = normText(textAns, caseSensitive);
    const accepted = (key.accepted_texts || []).map((t) => normText(t, caseSensitive));
    const isCorrect = Boolean(candidate) && accepted.includes(candidate);
    return {
      is_correct: isCorrect,
      grading_status: 'GRADED',
      earned_points: isCorrect ? maxPoints : 0,
      max_points: maxPoints,
      feedback: isCorrect
        ? question.correct_feedback || 'Chính xác!'
        : question.wrong_feedback || 'Đáp án điền vào chưa khớp.',
      normalized_response: { text: textAns },
    };
  }

  if (qType === 'SHORT_ANSWER') {
    const textAns = String(rawResponse.text ?? '').trim();
    if (!textAns) {
      return {
        is_correct: false,
        grading_status: 'GRADED',
        earned_points: 0,
        max_points: maxPoints,
        feedback: 'Vui lòng nhập câu trả lời tự luận ngắn.',
        normalized_response: { text: '' },
      };
    }
    const accepted = (key.accepted_texts || []).map((t) => normText(t, false));
    const keywords = (key.keywords || []).map((k) => normText(k, false)).filter(Boolean);
    if (!key.manual_review && (accepted.length > 0 || keywords.length > 0)) {
      const lowered = normText(textAns, false);
      const exactOk = accepted.length > 0 && accepted.includes(lowered);
      const kwOk = keywords.length > 0 && keywords.every((kw) => lowered.includes(kw));
      const isCorrect = exactOk || kwOk;
      return {
        is_correct: isCorrect,
        grading_status: 'GRADED',
        earned_points: isCorrect ? maxPoints : 0,
        max_points: maxPoints,
        feedback: isCorrect
          ? question.correct_feedback || 'Câu trả lời có đầy đủ ý chính!'
          : question.wrong_feedback || 'Câu trả lời chưa đủ các ý trọng tâm.',
        normalized_response: { text: textAns },
      };
    }
    return {
      is_correct: true,
      grading_status: 'PENDING_REVIEW',
      earned_points: maxPoints,
      max_points: maxPoints,
      feedback:
        question.correct_feedback ||
        'Đã ghi nhận câu trả lời tự luận của bạn để giảng viên xem xét.',
      normalized_response: { text: textAns },
    };
  }

  return {
    is_correct: false,
    grading_status: 'GRADED',
    earned_points: 0,
    max_points: maxPoints,
    feedback: 'Dạng câu hỏi không xác định.',
    normalized_response: {},
  };
}
