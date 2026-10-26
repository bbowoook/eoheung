// Settings → 공부: the pages where the board is edited — exams, the timetable,
// assignments, and the Telegram bot. Everything is saved the moment it changes;
// the island hears about it through Rust's "study" event.

import "./study.css";
import { h, clear } from "../views/dom";
import { Bridge, IS_TAURI } from "../core/bridge";
import { Study } from "../study/store";
import {
  addDays, daysBetween, ddayLabel, makePairCode, mondayOf, newId, openTasks, parseQuickTask, shortDate,
  upcomingExams, ymd, type Board, type ClassItem, type Exam, type Task,
} from "../study/model";
import type { HubContext, FlowPageRenderer } from "../hub/shell";

const TELEGRAM_KEY = "telegram-bot-token";

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function input(type: string, value: string, placeholder = "", width?: number): HTMLInputElement {
  const el = h("input", { type, value, placeholder }) as HTMLInputElement;
  if (width) el.style.width = `${width}px`;
  return el;
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", {}, h("h2", {}, h("span", { text: title })), ...children.filter((c): c is Node => c != null));
}

const save = (change: (b: Board) => Board) => void Study.update(change);

/** Redraws `container` with `draw` now and whenever the board changes elsewhere. */
function live(container: HTMLElement, ctx: HubContext, draw: () => Node[]) {
  const paint = () => {
    // Never under the user's typing: a field in focus keeps the page as it is.
    if (container.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    clear(container);
    container.append(...draw());
  };
  paint();
  const off = Study.subscribe(paint);
  ctx.onLeave = () => off();
}

function page(container: HTMLElement, ctx: HubContext, id: string, title: string, subtitle: string): HTMLElement {
  container.append(ctx.hero(id as never, title, subtitle));
  const root = h("div", { id: "settings-root", class: "study-root" });
  container.append(root);
  return root;
}

// ── 시험 ──────────────────────────────────────────────────────────────────────

function examForm(onDone: () => void, edit?: Exam): HTMLElement {
  const subject = input("text", edit?.subject ?? "", "과목 (예: 심계내과2)", 200);
  const date = input("date", edit?.date ?? "", "", 150);
  const start = input("time", edit?.start ?? "", "", 110);
  const end = input("time", edit?.end ?? "", "", 110);
  const place = input("text", edit?.place ?? "", "장소 (선택)", 160);
  const note = input("text", edit?.note ?? "", "메모 (범위, 교수님…)", 240);
  const err = h("span", { class: "hint st-err" });
  const ok = h("button", {
    class: "primary",
    text: edit ? "저장" : "추가",
    onclick: () => {
      if (!subject.value.trim() || !date.value) {
        err.textContent = "과목과 날짜는 꼭 적어줘";
        return;
      }
      const exam: Exam = {
        id: edit?.id ?? newId(), subject: subject.value.trim(), date: date.value, start: start.value, end: end.value,
        place: place.value.trim(), note: note.value.trim(),
      };
      save((b) => ({ ...b, exams: edit ? b.exams.map((e) => (e.id === exam.id ? exam : e)) : [...b.exams, exam] }));
      onDone();
    },
  });
  const cancel = edit ? h("button", { text: "취소", onclick: onDone }) : null;
  return h("div", { class: "st-form" },
    h("div", { class: "row" }, subject, date, start, h("span", { class: "hint", text: "~" }), end),
    h("div", { class: "row" }, place, note, ok, cancel, err),
  );
}

export const renderExams: FlowPageRenderer = (container, ctx) => {
  const root = page(container, ctx, "study-exams", "시험", "시험 날짜를 넣으면 D-day가 뜨고, 전날 밤과 당일 아침에 어흥이가 알려줘.");
  let editing: string | null = null;
  live(root, ctx, () => {
    const b = Study.board;
    const now = new Date();
    const today = ymd(now);
    const upcoming = upcomingExams(b, now);
    const past = b.exams.filter((e) => !upcoming.includes(e)).sort((a, c) => c.date.localeCompare(a.date));
    const list = h("div", { class: "st-table" });
    if (upcoming.length === 0) list.append(h("div", { class: "hint", text: "다가오는 시험이 없어. 아래에서 추가해 줘." }));
    for (const e of [...upcoming, ...past]) {
      if (editing === e.id) {
        list.append(examForm(() => { editing = null; paintAgain(); }, e));
        continue;
      }
      const n = daysBetween(today, e.date);
      list.append(h("div", { class: `st-line${upcoming.includes(e) ? "" : " past"}` },
        h("span", { class: "st-dday", text: ddayLabel(n) }),
        h("b", { text: e.subject }),
        h("span", { class: "hint", text: [shortDate(e.date), e.start && `${e.start}${e.end ? `–${e.end}` : ""}`, e.place, e.note].filter(Boolean).join(" · ") }),
        h("span", { class: "spacer" }),
        h("button", { text: "수정", onclick: () => { editing = e.id; paintAgain(); } }),
        h("button", { class: "danger", text: "삭제", onclick: () => save((x) => ({ ...x, exams: x.exams.filter((y) => y.id !== e.id) })) }),
      ));
    }
    return [
      section("다가오는 시험", list),
      section("시험 추가", examForm(() => {})),
    ];
  });
  function paintAgain() {
    // A local change (editing on/off) that the board doesn't know about.
    void Study.update((b) => b);
  }
};

// ── 시간표 ────────────────────────────────────────────────────────────────────

function classForm(day: string, onDone: () => void, edit?: ClassItem): HTMLElement {
  const date = input("date", edit?.date ?? day, "", 150);
  const start = input("time", edit?.start ?? "", "", 110);
  const end = input("time", edit?.end ?? "", "", 110);
  const subject = input("text", edit?.subject ?? "", "과목", 170);
  const who = input("text", edit?.who ?? "", "교수님", 110);
  const note = input("text", edit?.note ?? "", "메모 (보강, Zoom…)", 160);
  const repeat = h("select", {}) as HTMLSelectElement;
  repeat.append(
    h("option", { value: "1", text: "이 날만" }),
    h("option", { value: "4", text: "4주 반복" }),
    h("option", { value: "8", text: "8주 반복" }),
    h("option", { value: "15", text: "학기 끝까지(15주)" }),
  );
  const err = h("span", { class: "hint st-err" });
  const ok = h("button", {
    class: "primary",
    text: edit ? "저장" : "추가",
    onclick: () => {
      if (!subject.value.trim() || !date.value) {
        err.textContent = "날짜와 과목은 꼭 적어줘";
        return;
      }
      const base = { start: start.value, end: end.value, subject: subject.value.trim(), who: who.value.trim(), note: note.value.trim() };
      if (edit) {
        save((b) => ({ ...b, classes: b.classes.map((c) => (c.id === edit.id ? { ...c, ...base, date: date.value } : c)) }));
      } else {
        const weeks = Number(repeat.value) || 1;
        const items = Array.from({ length: weeks }, (_, i) => ({ id: newId(), date: addDays(date.value, i * 7), ...base }));
        save((b) => ({ ...b, classes: [...b.classes, ...items] }));
      }
      onDone();
    },
  });
  return h("div", { class: "st-form" },
    h("div", { class: "row" }, date, start, h("span", { class: "hint", text: "~" }), end, subject),
    h("div", { class: "row" }, who, note, edit ? null : repeat, ok, edit ? h("button", { text: "취소", onclick: onDone }) : null, err),
  );
}

export const renderClasses: FlowPageRenderer = (container, ctx) => {
  const root = page(container, ctx, "study-classes", "시간표", "주마다 바뀌는 시간표라 수업을 날짜별로 넣어 둬. 보강·휴강도 그 날만 고치면 돼.");
  let week = mondayOf(ymd(new Date()));
  let editing: string | null = null;
  const repaint = () => void Study.update((b) => b);
  live(root, ctx, () => {
    const b = Study.board;
    const nav = h("div", { class: "row" },
      h("button", { text: "‹ 지난주", onclick: () => { week = addDays(week, -7); repaint(); } }),
      h("b", { class: "st-week", text: `${shortDate(week)} ~ ${shortDate(addDays(week, 6))}` }),
      h("button", { text: "다음주 ›", onclick: () => { week = addDays(week, 7); repaint(); } }),
      h("button", { text: "이번 주", onclick: () => { week = mondayOf(ymd(new Date())); repaint(); } }),
    );
    const grid = h("div", { class: "st-week-list" });
    for (let i = 0; i < 7; i++) {
      const day = addDays(week, i);
      const items = b.classes.filter((c) => c.date === day).sort((a, c) => (a.start || "99").localeCompare(c.start || "99"));
      if (items.length === 0 && i >= 5) continue;
      const box = h("div", { class: `st-daybox${day === ymd(new Date()) ? " today" : ""}` }, h("div", { class: "st-dayhead", text: shortDate(day) }));
      if (items.length === 0) box.append(h("div", { class: "hint", text: "수업 없음" }));
      for (const c of items) {
        if (editing === c.id) {
          box.append(classForm(day, () => { editing = null; repaint(); }, c));
          continue;
        }
        box.append(h("div", { class: "st-line" },
          h("span", { class: "st-t", text: c.start ? `${c.start}–${c.end}` : "종일" }),
          h("b", { text: c.subject }),
          h("span", { class: "hint", text: [c.who, c.note].filter(Boolean).join(" · ") }),
          h("span", { class: "spacer" }),
          h("button", { text: "수정", onclick: () => { editing = c.id; repaint(); } }),
          h("button", { class: "danger", text: "삭제", onclick: () => save((x) => ({ ...x, classes: x.classes.filter((y) => y.id !== c.id) })) }),
        ));
      }
      grid.append(box);
    }
    return [
      section("주간 시간표", nav, grid),
      section("수업 추가", classForm(week, () => {})),
    ];
  });
};

// ── 과제 ──────────────────────────────────────────────────────────────────────

export const renderTasks: FlowPageRenderer = (container, ctx) => {
  const root = page(container, ctx, "study-tasks", "과제", "마감 전날 밤과 당일 아침에 어흥이가 알려줘. 섬에서도 바로 추가하고 체크할 수 있어.");
  live(root, ctx, () => {
    const b = Study.board;
    const today = ymd(new Date());
    const title = input("text", "", "과제 (예: 침구 조별과제 11/3)", 300);
    const subject = input("text", "", "과목 (선택)", 140);
    const due = input("date", "", "", 150);
    const add = h("button", {
      class: "primary",
      text: "추가",
      onclick: () => {
        const text = title.value.trim();
        if (!text) return;
        const quick = parseQuickTask(text, today);
        const t: Task = {
          id: newId(), title: quick.title, subject: subject.value.trim(), due: due.value || quick.due,
          done: false, doneAt: null, created: Date.now(),
        };
        title.value = "";
        save((x) => ({ ...x, tasks: [...x.tasks, t] }));
      },
    });
    title.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) add.click(); });
    const row = (t: Task) => h("div", { class: `st-line${t.done ? " past" : ""}` },
      h("button", {
        class: `st-box${t.done ? " on" : ""}`,
        text: t.done ? "✓" : "",
        onclick: () => save((x) => ({ ...x, tasks: x.tasks.map((y) => (y.id === t.id ? { ...y, done: !y.done, doneAt: y.done ? null : Date.now() } : y)) })),
      }),
      h("b", { text: t.title }),
      h("span", { class: "hint", text: [t.subject, t.due && `${shortDate(t.due)} · ${ddayLabel(daysBetween(today, t.due))}`].filter(Boolean).join(" · ") }),
      h("span", { class: "spacer" }),
      h("button", { class: "danger", text: "삭제", onclick: () => save((x) => ({ ...x, tasks: x.tasks.filter((y) => y.id !== t.id) })) }),
    );
    const open = openTasks(b);
    const done = b.tasks.filter((t) => t.done).sort((a, c) => (c.doneAt ?? 0) - (a.doneAt ?? 0));
    const doneList = h("div", { class: "st-table" }, ...done.slice(0, 30).map(row));
    return [
      section("과제 추가", h("div", { class: "row" }, title, subject, due, add),
        h("div", { class: "hint", text: "제목 끝에 11/3, 내일, 모레 같이 쓰면 마감일이 자동으로 들어가." })),
      section(`남은 과제 ${open.length}개`, h("div", { class: "st-table" }, ...(open.length ? open.map(row) : [h("div", { class: "hint", text: "남은 과제가 없어 🐯" })]))),
      done.length ? section(`끝낸 과제 ${done.length}개`, doneList,
        h("div", { class: "row" }, h("button", { text: "끝낸 과제 비우기", onclick: () => save((x) => ({ ...x, tasks: x.tasks.filter((y) => !y.done) })) }))) : null,
    ].filter((x): x is HTMLElement => x != null);
  });
};

// ── 텔레그램 ──────────────────────────────────────────────────────────────────

export const renderTelegram: FlowPageRenderer = async (container, ctx) => {
  const root = page(container, ctx, "study-telegram", "텔레그램 · 공지", "단톡방·채널 공지를 모아 보고, 시험·과제 알림을 폰으로 받아.");
  let hasToken = IS_TAURI ? (await Bridge.secretPresent(TELEGRAM_KEY)) ?? false : false;
  let status = "";
  let statusOk = true;
  const repaint = () => void Study.update((b) => b);

  live(root, ctx, () => {
    const b = Study.board;
    const tg = b.telegram;

    // ① The bot.
    const token = input("password", "", hasToken ? "토큰 저장됨 · 바꾸려면 새로 붙여넣기" : "123456789:ABC… (BotFather가 준 토큰)", 360);
    const saveToken = h("button", {
      class: "primary",
      text: "저장하고 확인",
      onclick: async () => {
        const value = token.value.trim();
        if (!value) return;
        try {
          await Bridge.secretSet(TELEGRAM_KEY, value);
          hasToken = true;
          const me = await Bridge.telegramCheck();
          status = `@${me.username ?? "bot"} 연결됨`;
          statusOk = true;
          save((x) => ({ ...x, telegram: { ...x.telegram, enabled: true, botName: me.username ?? "" } }));
        } catch (e) {
          status = String(e instanceof Error ? e.message : e);
          statusOk = false;
          repaint();
        }
      },
    });
    const forget = hasToken
      ? h("button", {
        class: "danger", text: "토큰 지우기",
        onclick: async () => {
          await Bridge.secretClear(TELEGRAM_KEY);
          hasToken = false;
          status = "";
          save((x) => ({ ...x, telegram: { ...x.telegram, enabled: false, botName: "", ownerChatId: null, ownerName: "" } }));
        },
      })
      : null;
    const botStatus = status || (tg.botName ? `@${tg.botName} 연결됨` : hasToken ? "토큰 저장됨" : "아직 연결 안 됨");
    const step1 = section("① 봇 만들기",
      h("ol", { class: "st-steps" },
        h("li", { text: "텔레그램에서 @BotFather 를 찾아 /newbot 을 보내고, 이름(예: 어흥이)과 아이디(예: eoheung_내이름_bot)를 정해." }),
        h("li", { text: "BotFather 가 주는 토큰(숫자:영문)을 아래에 붙여넣고 [저장하고 확인]." }),
        h("li", { text: "단톡방 글을 다 받으려면 BotFather 에서 /setprivacy → 내 봇 → Disable 로 바꿔 줘. (바꾼 뒤 봇을 방에 다시 초대해야 해)" }),
      ),
      h("div", { class: "row" }, token, saveToken, forget),
      h("div", { class: "row" },
        h("i", { class: "dot", style: `background:${(tg.botName || hasToken) && statusOk ? "#22c55e" : "#f4505e"}` }),
        h("span", { class: "hint", text: botStatus }),
        h("span", { class: "spacer" }),
        h("label", { class: "hint", text: "봇 켜기" }),
        toggle(tg.enabled, (v) => save((x) => ({ ...x, telegram: { ...x.telegram, enabled: v } }))),
      ),
    );

    // ② Notices from groups and channels.
    const chats = Object.entries(tg.chats);
    const chatList = h("div", { class: "st-table" });
    if (chats.length === 0) chatList.append(h("div", { class: "hint", text: "아직 봇이 들어간 방이 없어. 봇을 단톡방에 초대하거나 공지 채널의 관리자로 추가해 줘." }));
    for (const [id, c] of chats) {
      chatList.append(h("div", { class: "st-line" },
        h("b", { text: c.title }),
        h("span", { class: "hint", text: c.kind === "channel" ? "채널" : "그룹" }),
        h("span", { class: "spacer" }),
        h("label", { class: "hint", text: "공지 받기" }),
        toggle(!c.muted, (v) => save((x) => ({ ...x, telegram: { ...x.telegram, chats: { ...x.telegram.chats, [id]: { ...c, muted: !v } } } }))),
      ));
    }
    const step2 = section("② 공지 모아보기",
      h("div", { class: "hint", text: "봇이 들어간 방에 올라오는 글이 '공지' 알약에 쌓여. PC가 켜져 있고 어흥이가 실행 중일 때 30초마다 가져와. 꺼져 있던 동안의 글은 다시 켜면 한꺼번에 들어와(텔레그램이 최대 24시간 보관)." }),
      chatList,
      h("div", { class: "row" },
        h("span", { class: "hint", text: `공지 ${b.notices.length}개 보관 중` }),
        h("span", { class: "spacer" }),
        h("button", { class: "danger", text: "공지 모두 지우기", onclick: () => save((x) => ({ ...x, notices: [] })) }),
      ),
    );

    // ③ Reminders to the phone.
    const paired = tg.ownerChatId != null;
    const pairRow = paired
      ? h("div", { class: "row" },
        h("i", { class: "dot", style: "background:#22c55e" }),
        h("span", { text: `${tg.ownerName || "내 계정"} 에게 알림을 보내고 있어` }),
        h("span", { class: "spacer" }),
        h("button", {
          text: "테스트 알림",
          onclick: async () => {
            try {
              await Bridge.telegramSend(tg.ownerChatId!, "🐯 어흥! 테스트 알림이야. 잘 오지?");
              status = "테스트 알림을 보냈어";
              statusOk = true;
            } catch (e) {
              status = String(e instanceof Error ? e.message : e);
              statusOk = false;
            }
            repaint();
          },
        }),
        h("button", { class: "danger", text: "연결 끊기", onclick: () => save((x) => ({ ...x, telegram: { ...x.telegram, ownerChatId: null, ownerName: "" } })) }),
      )
      : tg.pairCode
        ? h("div", { class: "st-pair" },
          h("div", { text: "내 봇과의 1:1 대화창에 아래 숫자를 보내 줘. 30초 안에 연결돼." }),
          h("div", { class: "st-code", text: tg.pairCode }),
          h("button", { text: "취소", onclick: () => save((x) => ({ ...x, telegram: { ...x.telegram, pairCode: "" } })) }),
        )
        : h("div", { class: "row" },
          h("button", {
            class: "primary",
            text: "내 폰 연결하기",
            disabled: !tg.enabled,
            onclick: () => save((x) => ({ ...x, telegram: { ...x.telegram, pairCode: makePairCode() } })),
          }),
          tg.enabled ? null : h("span", { class: "hint", text: "먼저 ①에서 봇을 연결해 줘" }),
        );
    const evening = input("time", tg.remindEvening, "", 110);
    evening.addEventListener("change", () => save((x) => ({ ...x, telegram: { ...x.telegram, remindEvening: evening.value || "21:00" } })));
    const morning = input("time", tg.remindMorning, "", 110);
    morning.addEventListener("change", () => save((x) => ({ ...x, telegram: { ...x.telegram, remindMorning: morning.value || "07:30" } })));
    const step3 = section("③ 폰으로 알림",
      pairRow,
      h("div", { class: "row" },
        h("label", { text: "시험 알림" }),
        toggle(tg.remindExam, (v) => save((x) => ({ ...x, telegram: { ...x.telegram, remindExam: v } }))),
        h("span", { class: "hint", text: "일주일 전 · 전날 밤 · 당일 아침" }),
      ),
      h("div", { class: "row" },
        h("label", { text: "과제 알림" }),
        toggle(tg.remindTask, (v) => save((x) => ({ ...x, telegram: { ...x.telegram, remindTask: v } }))),
        h("span", { class: "hint", text: "마감 전날 밤 · 당일 아침" }),
      ),
      h("div", { class: "row" }, h("label", { text: "전날 밤 알림" }), evening, h("label", { text: "당일 아침 알림" }), morning),
      h("div", { class: "hint", text: "폰이 연결되지 않아도 같은 알림이 화면 위 어흥이에게 떠. 알림은 PC가 켜져 있을 때만 보낼 수 있어." }),
    );
    return [step1, step2, step3];
  });
};

/** A small helper Settings → 시간표 also uses to show this week. */
export function weekOf(day: string): string[] {
  const mon = mondayOf(day);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

export const STUDY_PAGE_RENDERERS = {
  "study-exams": renderExams,
  "study-classes": renderClasses,
  "study-tasks": renderTasks,
  "study-telegram": renderTelegram,
};

export async function loadStudy() {
  await Study.load();
}
