// 어흥이's study board (src/study/model.ts): dates, cards' rules, reminders, Telegram.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, applyUpdates, classPhases, daysBetween, ddayLabel, headline, markSent, mondayOf, normalizeBoard,
  openTasks, parseQuickTask, remindersDue, upcomingExams,
} from "../src/study/model.ts";
import SEED from "../src-tauri/study-seed.json";

const at = (s) => new Date(s); // local time, "2026-10-26T20:00"

function board(extra = {}) {
  return normalizeBoard({
    exams: [{ id: "e1", subject: "심계내과2", date: "2026-10-29", start: "09:00", end: "10:00", place: "본관 301" }],
    classes: [
      { id: "c1", date: "2026-10-27", start: "09:00", end: "12:00", subject: "산부인과학", who: "김동일" },
      { id: "c2", date: "2026-10-27", start: "13:00", end: "16:00", subject: "신계내과학2", who: "홍승철" },
      { id: "c3", date: "2026-10-27", start: "16:00", end: "18:00", subject: "심계내과2", who: "최동준" },
    ],
    tasks: [
      { id: "t1", title: "침구 레포트", due: "2026-10-28", created: 1 },
      { id: "t2", title: "체촌 가운", due: "", created: 2 },
      { id: "t3", title: "끝낸 것", due: "2026-10-27", done: true, created: 3 },
    ],
    ...extra,
  });
}

test("the seed is a valid board with the timetable in it", () => {
  const b = normalizeBoard(SEED);
  assert.ok(b.classes.length > 200, "the semester's classes");
  assert.ok(b.classes.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date)));
  assert.equal(b.telegram.enabled, false);
  assert.equal(b.telegram.remindEvening, "21:00");
});

test("normalizeBoard never throws and drops what can't be shown", () => {
  for (const junk of [null, 3, "x", [], { exams: "no", tasks: [{}], classes: [{ subject: "x" }] }]) {
    const b = normalizeBoard(junk);
    assert.deepEqual(b.exams, []);
    assert.deepEqual(b.tasks, []);
    assert.deepEqual(b.classes, []);
  }
});

test("dates are counted in whole local days", () => {
  assert.equal(daysBetween("2026-10-26", "2026-10-29"), 3);
  assert.equal(daysBetween("2026-10-26", "2026-10-26"), 0);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(mondayOf("2026-10-29"), "2026-10-26");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26"); // Sunday belongs to the week before
  assert.deepEqual([ddayLabel(0), ddayLabel(3), ddayLabel(-2)], ["D-day", "D-3", "D+2"]);
});

test("an exam stays upcoming until it has ended", () => {
  const b = board();
  assert.equal(upcomingExams(b, at("2026-10-29T09:30")).length, 1);
  assert.equal(upcomingExams(b, at("2026-10-29T10:01")).length, 0);
  assert.match(headline(b, at("2026-10-26T12:00")), /심계내과2 시험까지 3일/);
  assert.match(headline(b, at("2026-10-28T12:00")), /내일 심계내과2/);
});

test("today's classes: over, going on, next, later", () => {
  const b = board();
  const items = b.classes;
  assert.deepEqual(classPhases(items, at("2026-10-27T13:30")), ["past", "now", "next"]);
  assert.deepEqual(classPhases(items, at("2026-10-27T08:00")), ["next", "later", "later"]);
  assert.deepEqual(classPhases(items, at("2026-10-27T19:00")), ["past", "past", "past"]);
});

test("open tasks: due first, undated last, done ones out", () => {
  assert.deepEqual(openTasks(board()).map((t) => t.id), ["t1", "t2"]);
});

test("a task typed in one line finds its due date", () => {
  const today = "2026-10-26";
  assert.deepEqual(parseQuickTask("침구 레포트 11/3", today), { title: "침구 레포트", due: "2026-11-03" });
  assert.deepEqual(parseQuickTask("조별과제 내일", today), { title: "조별과제", due: "2026-10-27" });
  assert.deepEqual(parseQuickTask("발표 11월 5일", today), { title: "발표", due: "2026-11-05" });
  assert.deepEqual(parseQuickTask("레포트 1/10", today), { title: "레포트", due: "2027-01-10" });
  assert.deepEqual(parseQuickTask("그냥 메모", today), { title: "그냥 메모", due: "" });
});

test("reminders: the evening before, the morning of, each only once", () => {
  let b = board();
  // 10/28 at 21:00: the exam is tomorrow; the task is due today (its morning reminder too).
  const due = remindersDue(b, at("2026-10-28T21:05"));
  const keys = due.map((r) => r.key);
  assert.ok(keys.some((k) => k.startsWith("exam-eve-e1-")));
  assert.ok(keys.some((k) => k.startsWith("task-day-t1-")));
  assert.ok(due.every((r) => r.text.startsWith("🐯")));
  b = markSent(b, keys);
  assert.deepEqual(remindersDue(b, at("2026-10-28T21:30")), []);
  // Before the evening time nothing about tomorrow yet.
  assert.ok(!remindersDue(board(), at("2026-10-28T20:00")).some((r) => r.key.startsWith("exam-eve")));
  // The exam morning, but not once it has started.
  assert.ok(remindersDue(board(), at("2026-10-29T07:40")).some((r) => r.key.startsWith("exam-day-e1")));
  assert.ok(!remindersDue(board(), at("2026-10-29T09:10")).some((r) => r.key.startsWith("exam-day-e1")));
  // Switched off.
  const off = normalizeBoard({ ...board(), telegram: { remindExam: false, remindTask: false } });
  assert.deepEqual(remindersDue(off, at("2026-10-28T21:05")), []);
});

const group = (id, mid, text, extra = {}) => ({
  update_id: id,
  message: { message_id: mid, date: 1_793_000_000, chat: { id: -100, type: "supergroup", title: "본3 단톡" }, from: { first_name: "과대" }, text, ...extra },
});

test("group messages become notices; the offset moves past them", () => {
  const r = applyUpdates(board(), [group(10, 1, "내일 휴강입니다"), group(11, 2, "  ")]);
  assert.equal(r.board.telegram.offset, 12);
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].chat, "본3 단톡");
  assert.equal(r.added[0].author, "과대");
  assert.equal(r.board.notices[0].read, false);
  assert.equal(r.board.telegram.chats["-100"].title, "본3 단톡");
  // The same message again is not a second notice.
  const again = applyUpdates(r.board, [group(12, 1, "내일 휴강입니다")]);
  assert.equal(again.added.length, 0);
  assert.equal(again.board.notices.length, 1);
});

test("a muted chat brings nothing in", () => {
  const b = normalizeBoard({ ...board(), telegram: { chats: { "-100": { title: "본3 단톡", muted: true } } } });
  assert.equal(applyUpdates(b, [group(1, 1, "공지")]).added.length, 0);
});

test("pairing: only the right code in a private chat links the user", () => {
  const b = normalizeBoard({ ...board(), telegram: { pairCode: "4821" } });
  const dm = (id, text) => ({ update_id: id, message: { message_id: id, date: 1, chat: { id: 77, type: "private", first_name: "보욱" }, text } });
  const wrong = applyUpdates(b, [dm(1, "1234"), dm(2, "안녕")]);
  assert.equal(wrong.board.telegram.ownerChatId, null);
  assert.equal(wrong.added.length, 0, "private chats are never notices");
  const right = applyUpdates(b, [dm(3, "/start 4821")]);
  assert.equal(right.paired, true);
  assert.equal(right.board.telegram.ownerChatId, 77);
  assert.equal(right.board.telegram.ownerName, "보욱");
  assert.equal(right.board.telegram.pairCode, "");
  assert.equal(right.replies.length, 1);
});

test("the bot leaving a group forgets it", () => {
  const r1 = applyUpdates(board(), [{ update_id: 1, my_chat_member: { chat: { id: -5, type: "group", title: "조별" }, new_chat_member: { status: "member" } } }]);
  assert.ok(r1.board.telegram.chats["-5"]);
  const r2 = applyUpdates(r1.board, [{ update_id: 2, my_chat_member: { chat: { id: -5, type: "group", title: "조별" }, new_chat_member: { status: "left" } } }]);
  assert.equal(r2.board.telegram.chats["-5"], undefined);
});

// ── 1.1: D-days, memos, the automatic 시간표 day ──────────────────────────────

import { autoClassDay, nextOccurrence, parseDday, sortedMemos, upcomingEvents } from "../src/study/model.ts";

test("a D-day typed in one line", () => {
  const today = "2026-10-26";
  assert.deepEqual(parseDday("한의사 국시 2027-01-16", today), { title: "한의사 국시", date: "2027-01-16", yearly: false });
  assert.deepEqual(parseDday("겨울방학 12/19", today), { title: "겨울방학", date: "2026-12-19", yearly: false });
  assert.deepEqual(parseDday("엄마 생일 3/14", today), { title: "엄마 생일", date: "2027-03-14", yearly: true });
  assert.deepEqual(parseDday("매년 개강 기념 9/1", today).yearly, true);
  assert.equal(parseDday("날짜 없음", today), null);
});

test("a yearly D-day comes round again; one-offs that passed go last", () => {
  const e = { id: "b", title: "생일", date: "2001-11-14", yearly: true };
  assert.equal(nextOccurrence(e, "2026-10-26"), "2026-11-14");
  assert.equal(nextOccurrence(e, "2026-11-15"), "2027-11-14");
  assert.equal(nextOccurrence({ ...e, date: "2000-02-29" }, "2026-01-01"), "2026-02-28");
  const b = normalizeBoard({
    events: [
      { id: "old", title: "지난 일", date: "2026-10-01" },
      { id: "far", title: "국시", date: "2027-01-16" },
      e,
    ],
  });
  assert.deepEqual(upcomingEvents(b, "2026-10-26").map((x) => x.e.id), ["b", "far", "old"]);
});

test("memos: pinned first, then newest", () => {
  const b = normalizeBoard({ memos: [
    { id: "a", text: "a", created: 1 }, { id: "b", text: "b", created: 3 }, { id: "p", text: "p", pinned: true, created: 0 },
  ] });
  assert.deepEqual(sortedMemos(b).map((m) => m.id), ["p", "b", "a"]);
});

test("the 시간표 card shows tomorrow once today's classes are over", () => {
  const b = board();
  assert.equal(autoClassDay(b, at("2026-10-27T10:00")).day, "2026-10-27");
  const evening = autoClassDay(b, at("2026-10-26T20:00"));
  assert.deepEqual(evening, { day: "2026-10-27", label: "내일" });
  // After the last class of the 27th, nothing within a week: it stays on today.
  assert.equal(autoClassDay(b, at("2026-10-27T19:00")).day, "2026-10-27");
});

test("the weather place falls back to 고양시 and refuses nonsense", () => {
  assert.equal(normalizeBoard({}).place.name, "고양시 일산");
  assert.equal(normalizeBoard({ place: { name: "x", lat: 200, lon: 0 } }).place.name, "고양시 일산");
  assert.deepEqual(normalizeBoard({ place: { name: "경주", lat: 35.8, lon: 129.2 } }).place, { name: "경주", lat: 35.8, lon: 129.2 });
});

// ── 1.2: the calendar ─────────────────────────────────────────────────────────

import { addMonths, monthGrid, monthMarks, parseAppointment } from "../src/study/model.ts";

test("an appointment typed in one line", () => {
  const day = "2026-10-27";
  const p = (t) => parseAppointment(t, day, day);
  assert.deepEqual(p("14:00 치과"), { title: "치과", date: day, start: "14:00", end: "", place: "" });
  assert.deepEqual(p("3시 치과 @일산역"), { title: "치과", date: day, start: "15:00", end: "", place: "일산역" });
  assert.deepEqual(p("오후 3시~5시 스터디 @도서관"), { title: "스터디", date: day, start: "15:00", end: "17:00", place: "도서관" });
  assert.deepEqual(p("3시 반 조모임"), { title: "조모임", date: day, start: "15:30", end: "", place: "" });
  assert.deepEqual(p("오전 9시 병원"), { title: "병원", date: day, start: "09:00", end: "", place: "" });
  assert.deepEqual(p("종일 MT"), { title: "MT", date: day, start: "", end: "", place: "" });
  assert.deepEqual(p("11/3 18시 저녁약속"), { title: "저녁약속", date: "2026-11-03", start: "18:00", end: "", place: "" });
  assert.deepEqual(p("내일 10:30 상담"), { title: "상담", date: "2026-10-28", start: "10:30", end: "", place: "" });
  assert.deepEqual(p("19:00-21:00 스터디"), { title: "스터디", date: day, start: "19:00", end: "21:00", place: "" });
  assert.deepEqual(p("동아리 회의"), { title: "동아리 회의", date: day, start: "", end: "", place: "" });
  assert.equal(p("14:00"), null);
});

test("the month grid starts on Monday and has whole weeks", () => {
  const oct = monthGrid("2026-10");
  assert.equal(oct[0], "2026-09-28");
  assert.equal(oct.length % 7, 0);
  assert.ok(oct.includes("2026-10-31"));
  const nov = monthGrid("2026-11");
  assert.equal(nov.length, 42, "November 2026 spans six weeks");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

test("the calendar's dots: appointments, exams, open deadlines, D-days", () => {
  const b = normalizeBoard({
    appointments: [{ id: "a", title: "치과", date: "2026-11-03", start: "15:00" }],
    exams: [{ id: "e", subject: "심계", date: "2026-11-03" }],
    tasks: [{ id: "t", title: "레포트", due: "2026-11-05" }, { id: "d", title: "끝", due: "2026-11-05", done: true }],
    events: [{ id: "y", title: "생일", date: "2001-11-14", yearly: true }, { id: "o", title: "방학", date: "2026-12-19" }],
  });
  const m = monthMarks(b, "2026-11", "2026-10-27");
  assert.equal(m.get("2026-11-03").appointments, 1);
  assert.equal(m.get("2026-11-03").exams, 1);
  assert.equal(m.get("2026-11-05").tasks, 1);
  assert.equal(m.get("2026-11-14").ddays, 1);
  assert.equal(m.has("2026-12-19"), false);
});

// ── 1.3: notices pasted by hand, the phone as an inbox ───────────────────────

import { manualNotice, noticeSuggestions, takeSuggestion } from "../src/study/model.ts";

test("a pasted notice: the dated lines become suggestions", () => {
  const text = [
    "[본3 공지]",
    "1. 11/3(화) 침구 조별 레포트 제출 23:59까지",
    "2. 11.5 3교시 휴강, 11월 12일 오후 2시 보강",
    "• 중간고사 성적 확인 10/30",
    "• 심계 퀴즈 11/10 9시",
    "3.5학점 과목은 출석 필수",
  ].join("\n");
  const s = noticeSuggestions(text, "2026-10-27");
  assert.deepEqual(s.map((x) => [x.kind, x.date]), [
    ["task", "2026-11-03"],
    ["appointment", "2026-11-05"],
    ["appointment", "2026-11-12"],
    ["appointment", "2026-10-30"],
    ["exam", "2026-11-10"],
  ]);
  assert.match(s[0].title, /침구 조별 레포트 제출/);
  assert.equal(s[2].start, "14:00", "보강 at 오후 2시");
  assert.equal(s[4].start, "09:00");
});

test("taking a suggestion files it and remembers it", () => {
  let b = board();
  const n = manualNotice("11/3 침구 레포트 제출", "과대 단톡");
  b = normalizeBoard({ ...b, notices: [n] });
  const [s] = noticeSuggestions(n.text, "2026-10-27");
  b = takeSuggestion(b, n.id, s);
  assert.ok(b.tasks.some((t) => t.title === "침구 레포트 제출" && t.due === "2026-11-03"));
  assert.deepEqual(b.notices[0].done, [s.key]);
  assert.equal(b.notices[0].source, "manual");
});

test("messages to the user's own bot go to notices, tasks, the calendar or memos", () => {
  const b = normalizeBoard({ ...board(), telegram: { ownerChatId: 77 } });
  let id = 100;
  const dm = (text, extra = {}) => ({ update_id: id++, message: { message_id: id, date: 1_793_000_000, chat: { id: 77, type: "private" }, text, ...extra } });
  const r = applyUpdates(b, [
    dm("과제 침구 레포트 11/3"),
    dm("일정 11/5 3시 치과 @일산역"),
    dm("메모 가운 챙기기"),
    dm("내일 1교시 휴강입니다", { forward_origin: { type: "user", sender_user: { first_name: "과대" } } }),
    dm("과제 이건 전달된 것", { forward_origin: { type: "user", sender_user_name: "누군가" } }),
  ], "2026-10-27");
  assert.ok(r.board.tasks.some((t) => t.title === "침구 레포트" && t.due === "2026-11-03"));
  assert.ok(r.board.appointments.some((a) => a.title === "치과" && a.date === "2026-11-05" && a.start === "15:00" && a.place === "일산역"));
  assert.ok(r.board.memos.some((m) => m.text === "가운 챙기기"));
  assert.equal(r.added.length, 2, "a forwarded message is a notice even if it starts with 과제");
  assert.equal(r.added[0].chat, "전달 · 과대");
  assert.equal(r.replies.length, 5);
  // Someone else writing to the bot is ignored.
  const other = applyUpdates(b, [{ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 5, type: "private" }, text: "과제 해킹" } }]);
  assert.equal(other.board.tasks.length, b.tasks.length);
  assert.equal(other.replies.length, 0);
});
