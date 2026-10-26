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
