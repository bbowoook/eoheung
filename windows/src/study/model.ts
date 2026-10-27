// 어흥이's study board: what is in it, and the pure rules the cards, Settings and
// the reminders follow. Rust only stores it (src-tauri/src/study.rs); nothing here
// touches the network or the DOM, so all of it is tested in tests/study.test.mjs.

export interface Exam {
  id: string;
  subject: string;
  /** YYYY-MM-DD, local. */
  date: string;
  /** HH:MM, or "" when the time isn't known yet. */
  start: string;
  end: string;
  place: string;
  note: string;
}

/** One class on one day: the timetable changes week to week, so every class is dated. */
export interface ClassItem {
  id: string;
  date: string;
  /** "" for an all-day line (중간고사, 휴강…). */
  start: string;
  end: string;
  subject: string;
  who: string;
  note: string;
}

export interface Task {
  id: string;
  title: string;
  subject: string;
  /** YYYY-MM-DD or "" (no due date). */
  due: string;
  done: boolean;
  doneAt: number | null;
  created: number;
}

export interface Notice {
  id: string;
  source: "telegram" | "manual";
  /** The group or channel it came from. */
  chat: string;
  author: string;
  text: string;
  /** Unix ms. */
  date: number;
  read: boolean;
  /** Keys of the suggestions (noticeSuggestions) already put on the calendar or the task list. */
  done: string[];
}

export interface TelegramChat {
  title: string;
  kind: string;
  muted: boolean;
}

export interface TelegramState {
  enabled: boolean;
  /** The user's own chat with the bot, where reminders go (set by pairing). */
  ownerChatId: number | null;
  ownerName: string;
  botName: string;
  /** The code the user sends the bot to pair; "" until one is made. */
  pairCode: string;
  /** The next getUpdates offset. */
  offset: number;
  chats: Record<string, TelegramChat>;
  /** HH:MM: the evening-before reminders. */
  remindEvening: string;
  /** HH:MM: the morning-of reminders. */
  remindMorning: string;
  remindExam: boolean;
  remindTask: boolean;
  /** Reminder keys already sent, newest last. */
  sent: string[];
}

export interface Memo {
  id: string;
  text: string;
  pinned: boolean;
  created: number;
}

/** A date to count down to that isn't an exam: 국시, 방학, a birthday, a trip. */
export interface DdayEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD; for a yearly one, the year of the first time. */
  date: string;
  /** Birthdays and anniversaries come back every year. */
  yearly: boolean;
}

/** Something of the user's own on a day: 약속, 치과, 스터디. */
export interface Appointment {
  id: string;
  title: string;
  date: string;
  /** HH:MM, "" for all day. */
  start: string;
  end: string;
  place: string;
}

/** Where the weather is for. */
export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export const DEFAULT_PLACE: Place = { name: "고양시 일산", lat: 37.6584, lon: 126.832 };

export interface Board {
  version: 1;
  semester: string;
  exams: Exam[];
  classes: ClassItem[];
  tasks: Task[];
  notices: Notice[];
  memos: Memo[];
  events: DdayEvent[];
  appointments: Appointment[];
  place: Place;
  telegram: TelegramState;
}

export const DEFAULT_TELEGRAM: TelegramState = {
  enabled: false,
  ownerChatId: null,
  ownerName: "",
  botName: "",
  pairCode: "",
  offset: 0,
  chats: {},
  remindEvening: "21:00",
  remindMorning: "07:30",
  remindExam: true,
  remindTask: true,
  sent: [],
};

/** Notices kept: older ones fall off. */
export const MAX_NOTICES = 300;
const MAX_SENT = 400;

// ── Reading a stored board ───────────────────────────────────────────────────

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x != null && typeof x === "object") : [];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const date = (v: unknown) => (DATE.test(str(v)) ? str(v) : "");
const time = (v: unknown) => (TIME.test(str(v)) ? str(v) : "");

/** Whatever was stored, as a board with every field in place (never throws). */
export function normalizeBoard(raw: unknown): Board {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tg = (o.telegram && typeof o.telegram === "object" ? o.telegram : {}) as Record<string, unknown>;
  const chats: Record<string, TelegramChat> = {};
  if (tg.chats && typeof tg.chats === "object") {
    for (const [k, v] of Object.entries(tg.chats as Record<string, Record<string, unknown>>)) {
      chats[k] = { title: str(v?.title, k), kind: str(v?.kind), muted: v?.muted === true };
    }
  }
  return {
    version: 1,
    semester: str(o.semester),
    exams: arr(o.exams).map((e) => ({
      id: str(e.id) || newId(), subject: str(e.subject), date: date(e.date), start: time(e.start), end: time(e.end),
      place: str(e.place), note: str(e.note),
    })).filter((e) => e.subject && e.date),
    classes: arr(o.classes).map((c) => ({
      id: str(c.id) || newId(), date: date(c.date), start: time(c.start), end: time(c.end),
      subject: str(c.subject), who: str(c.who), note: str(c.note),
    })).filter((c) => c.subject && c.date),
    tasks: arr(o.tasks).map((t) => ({
      id: str(t.id) || newId(), title: str(t.title), subject: str(t.subject), due: date(t.due),
      done: t.done === true, doneAt: typeof t.doneAt === "number" ? t.doneAt : null,
      created: typeof t.created === "number" ? t.created : 0,
    })).filter((t) => t.title),
    memos: arr(o.memos).map((m) => ({
      id: str(m.id) || newId(), text: str(m.text), pinned: m.pinned === true,
      created: typeof m.created === "number" ? m.created : 0,
    })).filter((m) => m.text),
    events: arr(o.events).map((e) => ({
      id: str(e.id) || newId(), title: str(e.title), date: date(e.date), yearly: e.yearly === true,
    })).filter((e) => e.title && e.date),
    appointments: arr(o.appointments).map((a) => ({
      id: str(a.id) || newId(), title: str(a.title), date: date(a.date), start: time(a.start), end: time(a.end),
      place: str(a.place),
    })).filter((a) => a.title && a.date),
    place: (() => {
      const p = (o.place && typeof o.place === "object" ? o.place : {}) as Record<string, unknown>;
      const lat = typeof p.lat === "number" && Math.abs(p.lat) <= 90 ? p.lat : null;
      const lon = typeof p.lon === "number" && Math.abs(p.lon) <= 180 ? p.lon : null;
      return lat != null && lon != null ? { name: str(p.name, "내 지역"), lat, lon } : { ...DEFAULT_PLACE };
    })(),
    notices: arr(o.notices).map((n) => ({
      id: str(n.id) || newId(), source: n.source === "manual" ? "manual" as const : "telegram" as const,
      chat: str(n.chat), author: str(n.author), text: str(n.text),
      date: typeof n.date === "number" ? n.date : 0, read: n.read === true,
      done: Array.isArray(n.done) ? n.done.filter((k): k is string => typeof k === "string") : [],
    })).filter((n) => n.text),
    telegram: {
      ...DEFAULT_TELEGRAM,
      enabled: tg.enabled === true,
      ownerChatId: typeof tg.ownerChatId === "number" ? tg.ownerChatId : null,
      ownerName: str(tg.ownerName),
      botName: str(tg.botName),
      pairCode: str(tg.pairCode),
      offset: typeof tg.offset === "number" ? tg.offset : 0,
      chats,
      remindEvening: time(tg.remindEvening) || DEFAULT_TELEGRAM.remindEvening,
      remindMorning: time(tg.remindMorning) || DEFAULT_TELEGRAM.remindMorning,
      remindExam: tg.remindExam !== false,
      remindTask: tg.remindTask !== false,
      sent: Array.isArray(tg.sent) ? tg.sent.filter((s): s is string => typeof s === "string").slice(-MAX_SENT) : [],
    },
  };
}

let idSeq = 0;
export function newId(): string {
  idSeq = (idSeq + 1) % 1296;
  return `${Date.now().toString(36)}${idSeq.toString(36).padStart(2, "0")}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// ── Dates (all local) ────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD): tomorrow is 1. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);
}

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "10/27 (화)". */
export function shortDate(s: string): string {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
}

/** "10월 27일 화요일". */
export function longDate(s: string): string {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`;
}

/** "D-3", "D-day", "D+2". */
export function ddayLabel(n: number): string {
  if (n === 0) return "D-day";
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** The Monday of the week `s` is in. */
export function mondayOf(s: string): string {
  const d = parseYmd(s);
  const back = (d.getDay() + 6) % 7;
  return addDays(s, -back);
}

/** "15:00" → minutes since midnight; "" → null. */
export function minutes(t: string): number | null {
  if (!TIME.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── What the cards show ──────────────────────────────────────────────────────

const byDateTime = <T extends { date: string; start: string }>(a: T, b: T) =>
  a.date.localeCompare(b.date) || (a.start || "99").localeCompare(b.start || "99");

/** Exams still to come — today's until it has ended — soonest first. */
export function upcomingExams(board: Board, now: Date): Exam[] {
  const today = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return board.exams
    .filter((e) => {
      if (e.date > today) return true;
      if (e.date < today) return false;
      const end = minutes(e.end) ?? minutes(e.start);
      return end == null || end > nowMin;
    })
    .sort(byDateTime);
}

export function classesOn(board: Board, day: string): ClassItem[] {
  return board.classes.filter((c) => c.date === day).sort(byDateTime);
}

export type ClassPhase = "past" | "now" | "next" | "later";

/** Where each of today's classes stands: over, going on, the next one, later. */
export function classPhases(items: ClassItem[], now: Date): ClassPhase[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let nextGiven = false;
  return items.map((c) => {
    const s = minutes(c.start);
    const e = minutes(c.end);
    if (s == null) return "later";
    if (e != null && e <= nowMin) return "past";
    if (s <= nowMin) return "now";
    if (!nextGiven) {
      nextGiven = true;
      return "next";
    }
    return "later";
  });
}

/** Open tasks, the ones due first on top; those without a date last. */
export function openTasks(board: Board): Task[] {
  return board.tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.created - b.created);
}

/** Open tasks due within `days` days (overdue ones included). */
export function tasksDueWithin(board: Board, today: string, days: number): Task[] {
  return openTasks(board).filter((t) => t.due && daysBetween(today, t.due) <= days);
}

export function unreadNotices(board: Board): Notice[] {
  return board.notices.filter((n) => !n.read);
}

export function sortedNotices(board: Board): Notice[] {
  return [...board.notices].sort((a, b) => b.date - a.date);
}

/**
 * The one line under the date on the 오늘 card: the next exam, or a word of
 * encouragement when there is none.
 */
export function headline(board: Board, now: Date): string {
  const next = upcomingExams(board, now)[0];
  if (!next) return "다가오는 시험이 없어. 오늘도 차근차근 하자!";
  const n = daysBetween(ymd(now), next.date);
  if (n === 0) return `오늘 ${next.subject} 시험이야${next.start ? ` (${next.start})` : ""}! 화이팅!`;
  if (n === 1) return `내일 ${next.subject} 시험! 오늘 마무리 잘 하자`;
  return `${next.subject} 시험까지 ${n}일 남았어`;
}

// ── A task typed in one line ─────────────────────────────────────────────────

/**
 * "침구 레포트 11/3" → title "침구 레포트", due 2026-11-03 (the next 11/3 from
 * today). Also understands "내일", "모레", "오늘" and "~11/3", "11월 3일".
 */
export function parseQuickTask(text: string, today: string): { title: string; due: string } {
  let title = text.trim();
  let due = "";
  const rel: [RegExp, number][] = [[/(^|\s)오늘(\s|$)/, 0], [/(^|\s)내일(\s|$)/, 1], [/(^|\s)모레(\s|$)/, 2]];
  for (const [re, n] of rel) {
    if (re.test(title)) {
      due = addDays(today, n);
      title = title.replace(re, " ").trim();
      break;
    }
  }
  if (!due) {
    const m = title.match(/(?:^|\s)~?(\d{1,2})\s*(?:\/|월\s*)(\d{1,2})일?(?=\s|$)/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const year = Number(today.slice(0, 4));
        let cand = `${year}-${pad(month)}-${pad(day)}`;
        // A date more than two months back is next year's.
        if (daysBetween(today, cand) < -60) cand = `${year + 1}-${pad(month)}-${pad(day)}`;
        due = cand;
        title = title.replace(m[0], " ").replace(/\s+/g, " ").trim();
      }
    }
  }
  return { title: title || text.trim(), due };
}

// ── Reminders ────────────────────────────────────────────────────────────────

export interface Reminder {
  key: string;
  text: string;
  /** The pill it belongs to, so the island can badge it. */
  pill: "study_exams" | "study_tasks";
}

/**
 * The reminders due at `now` that haven't been sent. Each one belongs to one day
 * (its key carries the date), so a computer that was off simply misses it rather
 * than sending yesterday's reminder late.
 */
export function remindersDue(board: Board, now: Date): Reminder[] {
  const tg = board.telegram;
  const today = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const evening = minutes(tg.remindEvening) ?? 21 * 60;
  const morning = minutes(tg.remindMorning) ?? 7 * 60 + 30;
  const sent = new Set(tg.sent);
  const out: Reminder[] = [];
  const add = (key: string, text: string, pill: Reminder["pill"]) => {
    if (!sent.has(key)) out.push({ key, text, pill });
  };

  if (tg.remindExam) {
    for (const e of board.exams) {
      const n = daysBetween(today, e.date);
      const when = [e.start && `${e.start} 시작`, e.place].filter(Boolean).join(" · ");
      if (n === 7 && nowMin >= evening) {
        add(`exam-d7-${e.id}-${today}`, `🐯 ${e.subject} 시험까지 딱 일주일 남았어 (${shortDate(e.date)}). 슬슬 족보 돌려보자!`, "study_exams");
      }
      if (n === 1 && nowMin >= evening) {
        add(`exam-eve-${e.id}-${today}`, `🐯 내일 ${e.subject} 시험이야!${when ? ` (${when})` : ""} 마지막 정리하고 일찍 자자.`, "study_exams");
      }
      const start = minutes(e.start);
      if (n === 0 && nowMin >= morning && (start == null || nowMin < start)) {
        add(`exam-day-${e.id}-${today}`, `🐯 오늘 ${e.subject} 시험!${when ? ` (${when})` : ""} 어흥이가 응원할게, 화이팅!`, "study_exams");
      }
    }
  }
  if (tg.remindTask) {
    for (const t of openTasks(board)) {
      if (!t.due) continue;
      const n = daysBetween(today, t.due);
      if (n === 1 && nowMin >= evening) {
        add(`task-eve-${t.id}-${today}`, `🐯 '${t.title}' 마감이 내일이야. 잊지 마!`, "study_tasks");
      }
      if (n === 0 && nowMin >= morning) {
        add(`task-day-${t.id}-${today}`, `🐯 오늘이 '${t.title}' 마감이야!`, "study_tasks");
      }
    }
  }
  return out;
}

export function markSent(board: Board, keys: string[]): Board {
  if (keys.length === 0) return board;
  const sent = [...board.telegram.sent, ...keys].slice(-MAX_SENT);
  return { ...board, telegram: { ...board.telegram, sent } };
}

// ── Telegram updates ─────────────────────────────────────────────────────────

/** The Bot API's update, the fields we read. */
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  my_chat_member?: { chat: TgChat; new_chat_member?: { status?: string } };
}

interface TgChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: { first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
  author_signature?: string;
  sender_chat?: { title?: string };
  /** Set on a message forwarded from elsewhere (Bot API 7). */
  forward_origin?: {
    type?: string;
    sender_user?: { first_name?: string; last_name?: string; username?: string };
    sender_user_name?: string;
    chat?: { title?: string };
  };
  text?: string;
  caption?: string;
}

export interface UpdatesResult {
  board: Board;
  /** What the user sent their own bot and where it went, for the island to say so. */
  captured: { kind: "notice" | "task" | "appointment" | "memo"; line: string }[];
  /** Notices that just came in, newest last. */
  added: Notice[];
  /** Messages to send back (pairing confirmations). */
  replies: { chatId: number; text: string }[];
  /** Set when this batch paired the user's own chat. */
  paired: boolean;
}

const personName = (p?: { first_name?: string; last_name?: string; username?: string }) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") || (p?.username ? `@${p.username}` : "");

/** A 4-digit code to send the bot. */
export function makePairCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Folds a batch of updates into the board: group and channel posts become notices,
 * the pairing message sets the user's own chat, and the offset moves past the batch.
 */
export function applyUpdates(board: Board, updates: TgUpdate[], today = ymd(new Date())): UpdatesResult {
  const tg = { ...board.telegram, chats: { ...board.telegram.chats } };
  const notices = [...board.notices];
  const tasks = [...board.tasks];
  const appointments = [...board.appointments];
  const memos = [...board.memos];
  const captured: UpdatesResult["captured"] = [];
  const known = new Set(notices.map((n) => n.id));
  const added: Notice[] = [];
  const replies: { chatId: number; text: string }[] = [];
  let paired = false;

  for (const u of updates) {
    if (typeof u.update_id === "number") tg.offset = Math.max(tg.offset, u.update_id + 1);
    if (u.my_chat_member) {
      const c = u.my_chat_member.chat;
      if (c.type !== "private") {
        const left = ["left", "kicked"].includes(u.my_chat_member.new_chat_member?.status ?? "");
        const prev = tg.chats[String(c.id)];
        if (left) delete tg.chats[String(c.id)];
        else tg.chats[String(c.id)] = { title: c.title ?? String(c.id), kind: c.type, muted: prev?.muted ?? false };
      }
      continue;
    }
    const m = u.message ?? u.channel_post ?? u.edited_channel_post;
    if (!m?.chat) continue;
    const text = (m.text ?? m.caption ?? "").trim();
    if (m.chat.type === "private") {
      // Only the pairing code matters in a private chat: anyone else is ignored.
      const code = tg.pairCode;
      if (code && text.replace(/^\/start\s*/, "").trim() === code) {
        tg.ownerChatId = m.chat.id;
        tg.ownerName = personName(m.chat) || personName(m.from);
        tg.pairCode = "";
        paired = true;
        replies.push({
          chatId: m.chat.id,
          text: "🐯 연결됐어! 시험 전날이랑 과제 마감 전에 여기로 알려줄게.\n\n" +
            "여기로 보내면 PC의 어흥이에게 바로 들어가:\n" +
            "• 그냥 보내기 / 공지 전달 → 공지\n• 과제 침구 레포트 11/3 → 과제\n" +
            "• 일정 11/5 3시 치과 → 달력\n• 메모 가운 챙기기 → 메모",
        });
        continue;
      }
      // The user's own chat with their bot: whatever they send is captured.
      if (tg.ownerChatId == null || m.chat.id !== tg.ownerChatId || !text || /^\/start\b/.test(text)) continue;
      const id = `tg-${m.chat.id}-${m.message_id}`;
      if (known.has(id)) continue;
      known.add(id);
      const cmd = text.match(/^\/?(과제|일정|약속|메모)\s+([\s\S]+)$/);
      const created = (m.date || 0) * 1000 || Date.now();
      if (cmd && !m.forward_origin) {
        const body = cmd[2].trim();
        if (cmd[1] === "과제") {
          const q = parseQuickTask(body, today);
          tasks.push({ id, title: q.title, subject: "", due: q.due, done: false, doneAt: null, created });
          captured.push({ kind: "task", line: q.title });
          replies.push({ chatId: m.chat.id, text: `🐯 과제에 넣었어: ${q.title}${q.due ? ` (마감 ${shortDate(q.due)})` : ""}` });
          continue;
        }
        if (cmd[1] === "메모") {
          memos.push({ id, text: body, pinned: false, created });
          captured.push({ kind: "memo", line: body });
          replies.push({ chatId: m.chat.id, text: "🐯 메모에 적어 뒀어" });
          continue;
        }
        const a = parseAppointment(body, today, today);
        if (a) {
          appointments.push({ id, ...a });
          captured.push({ kind: "appointment", line: a.title });
          replies.push({ chatId: m.chat.id, text: `🐯 달력에 넣었어: ${shortDate(a.date)}${a.start ? ` ${a.start}` : ""} ${a.title}` });
          continue;
        }
      }
      const fo = m.forward_origin;
      const from = fo ? fo.chat?.title || personName(fo.sender_user) || fo.sender_user_name || "" : "";
      const notice: Notice = {
        id, source: "telegram", chat: from ? `전달 · ${from}` : "내 폰", author: "", text: text.slice(0, 4000),
        date: created, read: false, done: [],
      };
      notices.push(notice);
      added.push(notice);
      captured.push({ kind: "notice", line: text.split("\n")[0].slice(0, 60) });
      const n = noticeSuggestions(notice.text, today).length;
      replies.push({
        chatId: m.chat.id,
        text: `🐯 공지에 저장했어${n ? `. 날짜가 있는 줄 ${n}개는 섬의 공지 카드에서 바로 달력·과제로 넣을 수 있어` : ""}`,
      });
      continue;
    }
    const key = String(m.chat.id);
    const prev = tg.chats[key];
    tg.chats[key] = { title: m.chat.title ?? prev?.title ?? key, kind: m.chat.type, muted: prev?.muted ?? false };
    if (!text || tg.chats[key].muted) continue;
    if (m.from?.is_bot) continue;
    const id = `tg-${m.chat.id}-${m.message_id}`;
    const author = m.author_signature || personName(m.from) || m.sender_chat?.title || "";
    if (known.has(id)) {
      // An edited channel post replaces the text it had.
      const i = notices.findIndex((n) => n.id === id);
      if (i >= 0) notices[i] = { ...notices[i], text };
      continue;
    }
    const notice: Notice = {
      id, source: "telegram", chat: tg.chats[key].title, author, text: text.slice(0, 2000),
      date: (m.date || 0) * 1000, read: false, done: [],
    };
    known.add(id);
    notices.push(notice);
    added.push(notice);
  }

  notices.sort((a, b) => a.date - b.date);
  return {
    board: { ...board, notices: notices.slice(-MAX_NOTICES), tasks, appointments, memos, telegram: tg },
    added,
    captured,
    replies,
    paired,
  };
}

// ── Memos and D-days ─────────────────────────────────────────────────────────

/** Pinned first, then newest first. */
export function sortedMemos(board: Board): Memo[] {
  return [...board.memos].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created - a.created);
}

/** The next time `e` comes round, on or after `today` (a past one-off stays where it was). */
export function nextOccurrence(e: DdayEvent, today: string): string {
  if (!e.yearly) return e.date;
  const year = Number(today.slice(0, 4));
  const md = e.date.slice(5);
  // 29 February in a year without it falls on the 28th.
  const fit = (y: number) => {
    const cand = `${y}-${md}`;
    return parseYmd(cand).getMonth() + 1 === Number(md.slice(0, 2)) ? cand : `${y}-02-28`;
  };
  const thisYear = fit(year);
  return thisYear >= today ? thisYear : fit(year + 1);
}

/** Every D-day with its next date and how far it is, soonest first; past one-offs last. */
export function upcomingEvents(board: Board, today: string): { e: DdayEvent; date: string; n: number }[] {
  return board.events
    .map((e) => {
      const d = nextOccurrence(e, today);
      return { e, date: d, n: daysBetween(today, d) };
    })
    .sort((a, b) => (a.n < 0 ? 1 : 0) - (b.n < 0 ? 1 : 0) || Math.abs(a.n) - Math.abs(b.n));
}

/**
 * "국시 2027-01-16", "방학 12/19", "엄마 생일 3/14" → a D-day. A birthday (생일),
 * an anniversary (기념일) or anything with "매년" comes back every year. Null when
 * no date is found.
 */
export function parseDday(text: string, today: string): { title: string; date: string; yearly: boolean } | null {
  let t = text.trim();
  let date = "";
  const full = t.match(/(?:^|\s)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?=\s|$)/);
  if (full) {
    date = `${full[1]}-${pad(Number(full[2]))}-${pad(Number(full[3]))}`;
    t = t.replace(full[0], " ");
  } else {
    const q = parseQuickTask(t, today);
    if (!q.due) return null;
    date = q.due;
    t = q.title;
  }
  const yearly = /생일|기념일|매년/.test(t);
  t = t.replace(/매년/g, " ").replace(/\s+/g, " ").trim();
  if (!t || !DATE.test(date)) return null;
  return { title: t, date, yearly };
}

/**
 * The day the 시간표 card shows by itself: today while it still has classes to
 * come, else the next day that has some (within a week), so in the evening it
 * already shows tomorrow.
 */
export function autoClassDay(board: Board, now: Date): { day: string; label: string } {
  const today = ymd(now);
  const items = classesOn(board, today);
  const left = classPhases(items, now).some((p) => p !== "past");
  if (items.length > 0 && left) return { day: today, label: "오늘" };
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    if (classesOn(board, d).length > 0) return { day: d, label: i === 1 ? "내일" : "다음 수업" };
  }
  return { day: today, label: "오늘" };
}

// ── The calendar: appointments and what each day holds ───────────────────────

export function appointmentsOn(board: Board, day: string): Appointment[] {
  return board.appointments.filter((a) => a.date === day).sort(byDateTime);
}

/** "3", "15:30", "3시", "3시 반", "오후 3시", "3:30pm" → "HH:MM", with 오전/오후 applied. */
function clock(h: number, m: number, ampm: string | undefined): string | null {
  let hour = h;
  if (ampm === "오후" || ampm === "pm" || ampm === "저녁" || ampm === "밤") {
    if (hour < 12) hour += 12;
  } else if (ampm === "오전" || ampm === "am" || ampm === "아침" || ampm === "새벽") {
    if (hour === 12) hour = 0;
  } else if (ampm == null && hour >= 1 && hour <= 7) {
    // Nobody makes a 3 a.m. appointment: "3시 스터디" is in the afternoon.
    hour += 12;
  }
  if (hour > 23 || m > 59) return null;
  return `${pad(hour)}:${pad(m)}`;
}

const TIME_RE = /(?:(오전|오후|아침|저녁|밤|새벽)\s*)?(\d{1,2})(?:\s*[:시]\s*(?:(\d{2})\s*분?|(반))?)(\s*(?:am|pm))?/i;

/**
 * One line → an appointment on `day`: "14:00 치과", "오후 3시~5시 스터디 @도서관",
 * "3시 반 조모임", "종일 MT", "11/3 18시 저녁약속" (a date in the line wins over
 * `day`). A place goes after "@". Null when there is no title left.
 */
export function parseAppointment(text: string, day: string, today: string): Omit<Appointment, "id"> | null {
  let t = ` ${text.trim()} `;
  let date = day;
  // A date of its own: "11/3", "11월 3일", "내일".
  const q = parseQuickTask(t.trim(), today);
  if (q.due) {
    date = q.due;
    t = ` ${q.title} `;
  }
  let place = "";
  const at = t.match(/\s@\s*(\S.*)$/);
  if (at) {
    place = at[1].trim();
    t = t.slice(0, at.index);
  }
  let start = "";
  let end = "";
  if (/\s종일\s/.test(t)) {
    t = t.replace(/\s종일\s/, " ");
  } else {
    const m1 = t.match(new RegExp(`(?:^|\\s)${TIME_RE.source}(?=\\s|~|-|부터|까지|$)`, "i"));
    if (m1 && (m1[0].includes(":") || m1[0].includes("시"))) {
      const ampm = (m1[1] ?? m1[5]?.trim())?.toLowerCase();
      const s1 = clock(Number(m1[2]), m1[4] ? 30 : Number(m1[3] ?? 0), ampm);
      if (s1) {
        start = s1;
        t = t.slice(0, m1.index) + " " + t.slice((m1.index ?? 0) + m1[0].length);
        // "~5시", "- 17:00", "부터 5시까지".
        const m2 = t.match(new RegExp(`^\\s*(?:~|-|부터)\\s*${TIME_RE.source}\\s*(?:까지)?`, "i"))
          ?? t.match(new RegExp(`(?:~|-|부터)\\s*${TIME_RE.source}\\s*(?:까지)?`, "i"));
        if (m2) {
          const am2 = (m2[1] ?? m2[5]?.trim())?.toLowerCase() ?? (Number(start.slice(0, 2)) >= 12 ? "오후" : undefined);
          const e1 = clock(Number(m2[2]), m2[4] ? 30 : Number(m2[3] ?? 0), am2);
          if (e1 && e1 > start) {
            end = e1;
            t = t.replace(m2[0], " ");
          }
        }
      }
    }
  }
  const title = t.replace(/\s+/g, " ").trim();
  if (!title || !DATE.test(date)) return null;
  return { title, date, start, end, place };
}

export interface DayMarks {
  appointments: number;
  exams: number;
  tasks: number;
  ddays: number;
  classes: number;
}

/** What each day of a month holds, for the calendar's dots. `month` is "YYYY-MM". */
export function monthMarks(board: Board, month: string, today: string): Map<string, DayMarks> {
  const out = new Map<string, DayMarks>();
  const get = (d: string) => {
    let m = out.get(d);
    if (!m) out.set(d, (m = { appointments: 0, exams: 0, tasks: 0, ddays: 0, classes: 0 }));
    return m;
  };
  const inMonth = (d: string) => d.startsWith(month);
  for (const a of board.appointments) if (inMonth(a.date)) get(a.date).appointments++;
  for (const e of board.exams) if (inMonth(e.date)) get(e.date).exams++;
  for (const t of board.tasks) if (!t.done && t.due && inMonth(t.due)) get(t.due).tasks++;
  for (const c of board.classes) if (inMonth(c.date) && c.start) get(c.date).classes++;
  for (const e of board.events) {
    // A yearly one shows on its day this month, whatever year it started.
    const d = e.yearly ? `${month}-${e.date.slice(8)}` : e.date;
    if (inMonth(d) && (e.yearly ? e.date.slice(5, 7) === month.slice(5) : true)) get(d).ddays++;
  }
  void today;
  return out;
}

/** The 6×7 days of the month view, Monday first; days outside `month` included to fill the weeks. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = mondayOf(first);
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  // Drop a last week that is entirely next month.
  while (days.length > 35 && !days[days.length - 7].startsWith(month)) days.splice(-7);
  return days;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// ── A notice, read for dates ─────────────────────────────────────────────────

export interface Suggestion {
  /** Stable for the notice: the line's index and kind. */
  key: string;
  kind: "task" | "appointment" | "exam";
  title: string;
  date: string;
  start: string;
  /** The line it came from, for the chip's tooltip. */
  line: string;
}

/** A notice pasted in by hand: today's date, unread so it shows as new. */
export function manualNotice(text: string, chat: string, now = Date.now()): Notice {
  return { id: newId(), source: "manual", chat: chat.trim() || "직접 붙여넣음", author: "", text: text.trim().slice(0, 4000), date: now, read: false, done: [] };
}

/**
 * The lines of a notice that carry a date, as things to put on the calendar or the
 * task list: "11/3(월) 침구 레포트 제출" → a task due 11/3; "11월 5일 3교시 휴강" → an
 * appointment; "중간고사 10/20 9시" → an exam. Lines without a date are skipped.
 */
export function noticeSuggestions(text: string, today: string): Suggestion[] {
  const out: Suggestion[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    // "11/3(월)" and "11.3" read as "11/3"; bullets and numbering go.
    const line = raw
      // Bullets and "1." / "2)" numbering first, so "1. 11/3" keeps its date.
      .replace(/^(?:[\s\-•·*▶▷►☞※✔✅◆◇■□○●]+|\d{1,2}[.)]\s+)+/, "")
      .replace(/(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:\([월화수목금토일]\))?/g, "$1/$2 ")
      // "11.3" only when it stands alone or before "(월)": "3.5학점" is not a date.
      .replace(/(^|\s)(\d{1,2})\.(\d{1,2})(?:\s*\([월화수목금토일]\))?(?=\s|$)/g, "$1$2/$3 ")
      .replace(/\s+/g, " ")
      .trim();
    const DATE_IN = /\d{1,2}\/\d{1,2}|\d{1,2}월\s*\d{1,2}일|내일|모레/;
    if (!DATE_IN.test(line)) return;
    // "11/5 휴강, 11/12 보강": one suggestion per date when a line holds several.
    const parts = line.split(/\s*[,，、;]\s*/);
    const pieces = parts.length > 1 && parts.filter((x) => DATE_IN.test(x)).length > 1 ? parts : [line];
    pieces.forEach((piece, j) => {
      if (!DATE_IN.test(piece)) return;
      const a = parseAppointment(piece, today, today);
      if (!a) return;
      const title = a.title.replace(/^[:\-~,·]+|[:\-~,·]+$/g, "").trim();
      if (!title) return;
      const kind: Suggestion["kind"] = /제출|마감|과제|레포트|리포트|보고서|까지/.test(piece)
        ? "task"
        : /시험|퀴즈|평가/.test(piece) && !/휴강|보강/.test(piece) ? "exam" : "appointment";
      out.push({ key: `${i}${pieces.length > 1 ? `.${j}` : ""}:${kind}`, kind, title, date: a.date, start: a.start, line: raw.trim() });
    });
  });
  return out.slice(0, 6);
}

/** Puts one suggestion where it belongs and remembers it was taken. */
export function takeSuggestion(board: Board, noticeId: string, s: Suggestion): Board {
  const notices = board.notices.map((n) => (n.id === noticeId ? { ...n, done: [...new Set([...n.done, s.key])] } : n));
  if (s.kind === "task") {
    return { ...board, notices, tasks: [...board.tasks, { id: newId(), title: s.title, subject: "", due: s.date, done: false, doneAt: null, created: Date.now() }] };
  }
  if (s.kind === "exam") {
    return { ...board, notices, exams: [...board.exams, { id: newId(), subject: s.title, date: s.date, start: s.start, end: "", place: "", note: "공지에서" }] };
  }
  return { ...board, notices, appointments: [...board.appointments, { id: newId(), title: s.title, date: s.date, start: s.start, end: "", place: "" }] };
}
