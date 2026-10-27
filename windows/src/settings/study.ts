// Settings → 공부: the pages where the board is edited — exams, the timetable,
// assignments, and the Telegram bot. Everything is saved the moment it changes;
// the island hears about it through Rust's "study" event.

import "./study.css";
import { h, clear } from "../views/dom";
import { Bridge, IS_TAURI } from "../core/bridge";
import { Study } from "../study/store";
import {
  addDays, daysBetween, ddayLabel, makePairCode, mondayOf, newId, openTasks, parseQuickTask, shortDate,
  sortedMemos, upcomingEvents, upcomingExams, ymd, type Board, type ClassItem, type Exam, type Place, type Task,
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
  const root = page(container, ctx, "study-telegram", "텔레그램 · 공지", "폰과 어흥이를 잇는 통로: 시험·과제 알림을 받고, 폰에서 공지·과제·일정을 보내.");
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
        h("li", { text: "아래 ② 에서 [내 폰 연결하기] 를 눌러 내 텔레그램과 짝지어." }),
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
    const step2 = section("④ (선택) 단톡방·채널에 봇 넣기",
      h("div", { class: "hint", text: "봇을 단톡방에 초대하거나 공지 채널 관리자로 넣으면 거기 글도 자동으로 '공지'에 쌓여. 단톡방 글을 다 받으려면 BotFather 에서 /setprivacy → 내 봇 → Disable 로 바꾼 뒤 초대해. 초대가 어려우면 안 해도 돼: 공지는 섬에서 붙여넣거나 ③ 처럼 폰에서 봇에게 전달하면 돼." }),
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
    const step3 = section("② 내 폰 연결 · 알림",
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
    const usage = section("③ 폰에서 어흥이에게 보내기",
      h("div", { class: "hint", text: "내 봇과의 1:1 대화창이 PC 어흥이의 받은편지함이 돼. 보내면 30초 안에 섬에 들어오고, 봇이 어디에 넣었는지 답장해 줘." }),
      h("div", { class: "st-table" },
        ...[
          ["카톡·단톡 공지를 복사해서 그냥 보내기", "→ 공지 (날짜 있는 줄은 섬에서 달력·과제로 한 번에)"],
          ["다른 텔레그램 대화의 메시지를 봇에게 '전달'", "→ 공지 (어디서 왔는지 같이 기록)"],
          ["과제 침구 레포트 11/3", "→ 과제, 마감 11/3"],
          ["일정 11/5 3시 치과 @일산역", "→ 달력"],
          ["메모 가운 챙기기", "→ 메모"],
        ].map(([a, b]) => h("div", { class: "st-line" }, h("code", { text: a }), h("span", { class: "hint", text: b }))),
      ),
      h("div", { class: "hint", text: paired ? "PC가 꺼져 있을 때 보낸 것도 24시간 안에 켜면 들어와." : "먼저 ② 에서 내 폰을 연결해 줘. 연결 전에는 아무 메시지도 받지 않아." }),
    );
    return [step1, step3, usage, step2];
  });
};

/** A small helper Settings → 시간표 also uses to show this week. */
export function weekOf(day: string): string[] {
  const mon = mondayOf(day);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

// ── 날씨 · D-day · 메모 ───────────────────────────────────────────────────────

/** A few places a 동국대 student is likely to want, one click each. */
const PLACE_PRESETS: Place[] = [
  { name: "고양시 일산", lat: 37.6584, lon: 126.832 },
  { name: "서울 중구 (동국대)", lat: 37.5582, lon: 126.9982 },
  { name: "경주 (동국대)", lat: 35.8562, lon: 129.2247 },
];

export const renderLife: FlowPageRenderer = (container, ctx) => {
  const root = page(container, ctx, "study-life", "날씨 · D-day · 메모", "날씨를 볼 지역, 기다리는 날들, 적어 둔 메모를 정리해.");
  let results: { name: string; admin: string | null; country: string | null; lat: number; lon: number }[] = [];
  let searchNote = "";
  const repaint = () => void Study.update((b) => b);
  live(root, ctx, () => {
    const b = Study.board;
    const today = ymd(new Date());

    // Where the weather is for.
    const query = input("text", "", "동네 이름으로 찾기 (예: 일산, 파주, 경주)", 260);
    const search = h("button", {
      text: "찾기",
      onclick: async () => {
        const q = query.value.trim();
        if (!q) return;
        searchNote = "찾는 중…";
        try {
          results = (await Bridge.weatherSearch(q)) ?? [];
          searchNote = results.length ? "" : "찾는 곳이 없어. 다른 이름으로 해 봐";
        } catch (e) {
          results = [];
          searchNote = String(e instanceof Error ? e.message : e);
        }
        repaint();
      },
    });
    query.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) search.click(); });
    const choose = (p: Place) => {
      results = [];
      save((x) => ({ ...x, place: p }));
    };
    const weatherSec = section("날씨 지역",
      h("div", { class: "row" }, h("label", { text: "지금" }), h("b", { text: b.place.name })),
      h("div", { class: "row" }, ...PLACE_PRESETS.map((p) => h("button", { class: p.name === b.place.name ? "primary" : "", text: p.name, onclick: () => choose(p) }))),
      h("div", { class: "row" }, query, search, searchNote ? h("span", { class: "hint", text: searchNote }) : null),
      results.length ? h("div", { class: "st-table" }, ...results.map((r) => h("div", { class: "st-line" },
        h("b", { text: r.name }),
        h("span", { class: "hint", text: [r.admin, r.country].filter(Boolean).join(", ") }),
        h("span", { class: "spacer" }),
        h("button", { class: "primary", text: "이 곳으로", onclick: () => choose({ name: r.admin && r.admin !== r.name ? `${r.name} (${r.admin})` : r.name, lat: r.lat, lon: r.lon }) }),
      ))) : null,
      h("div", { class: "hint", text: "날씨와 미세먼지는 Open-Meteo에서 30분마다 가져와. 위치 좌표만 보내고 키는 필요 없어." }),
    );

    // D-days.
    const title = input("text", "", "이름 (예: 한의사 국시)", 220);
    const date = input("date", "", "", 150);
    let yearly = false;
    const yearlyToggle = toggle(false, (v) => { yearly = v; });
    const add = h("button", {
      class: "primary", text: "추가",
      onclick: () => {
        if (!title.value.trim() || !date.value) return;
        save((x) => ({ ...x, events: [...x.events, { id: newId(), title: title.value.trim(), date: date.value, yearly }] }));
      },
    });
    const ddays = upcomingEvents(b, today);
    const ddaySec = section(`D-day ${ddays.length}개`,
      h("div", { class: "st-table" }, ...(ddays.length ? ddays.map(({ e, date: d, n }) => h("div", { class: `st-line${n < 0 ? " past" : ""}` },
        h("span", { class: "st-dday", text: ddayLabel(n) }),
        h("b", { text: e.title }),
        h("span", { class: "hint", text: `${shortDate(d)}${e.yearly ? " · 매년" : ""}` }),
        h("span", { class: "spacer" }),
        h("button", { class: "danger", text: "삭제", onclick: () => save((x) => ({ ...x, events: x.events.filter((y) => y.id !== e.id) })) }),
      )) : [h("div", { class: "hint", text: "아직 없어. 섬의 D-day 알약에서 '국시 2027-01-16'처럼 바로 넣어도 돼." })])),
      h("div", { class: "row" }, title, date, h("span", { class: "hint", text: "매년" }), yearlyToggle, add),
    );

    // Memos.
    const memos = sortedMemos(b);
    const memoSec = section(`메모 ${memos.length}개`,
      h("div", { class: "st-table" }, ...(memos.length ? memos.map((m) => h("div", { class: "st-line" },
        h("button", { text: m.pinned ? "📌 고정됨" : "고정", onclick: () => save((x) => ({ ...x, memos: x.memos.map((y) => (y.id === m.id ? { ...y, pinned: !y.pinned } : y)) })) }),
        h("span", { class: "st-memo-text", text: m.text }),
        h("span", { class: "spacer" }),
        h("button", { class: "danger", text: "삭제", onclick: () => save((x) => ({ ...x, memos: x.memos.filter((y) => y.id !== m.id) })) }),
      )) : [h("div", { class: "hint", text: "섬의 메모 알약에서 한 줄씩 적으면 여기 모여." })])),
    );
    return [weatherSec, ddaySec, memoSec];
  });
};

export const STUDY_PAGE_RENDERERS = {
  "study-life": renderLife,
  "study-exams": renderExams,
  "study-classes": renderClasses,
  "study-tasks": renderTasks,
  "study-telegram": renderTelegram,
};

export async function loadStudy() {
  await Study.load();
}
