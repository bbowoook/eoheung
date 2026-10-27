// The study pills' cards in the overview's left card: 오늘, 시험, 시간표, 과제, 날씨,
// 공지, D-day, 메모. Each card is rebuilt from the board when something it shows
// changes; the text fields are built once so a draft survives notices coming in.
// The 시간표 card can open a week view that takes the whole overview.

import { h, clear, dot } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { Study } from "../study/store";
import {
  addDays, addMonths, appointmentsOn, autoClassDay, classPhases, classesOn, minutes, monthGrid, monthMarks,
  parseAppointment, daysBetween, ddayLabel, headline, longDate, mondayOf, newId, openTasks, parseDday,
  parseQuickTask, shortDate, sortedMemos, sortedNotices, tasksDueWithin, unreadNotices, upcomingEvents, upcomingExams,
  ymd, WEEKDAYS, type Appointment, type ClassItem, type Task,
} from "../study/model";
import { Weather, dustGrade } from "../study/weather";

export const STUDY_IDS = [
  "study_today", "study_calendar", "study_exams", "study_classes", "study_tasks", "study_weather", "study_notices", "study_dday", "study_memo",
] as const;
export type StudyId = (typeof STUDY_IDS)[number];

export function isStudyPill(id: string | undefined | null): id is StudyId {
  return id != null && (STUDY_IDS as readonly string[]).includes(id);
}

/** The overview is taller for these cards: lists need the room. */
export const STUDY_OVERVIEW_H = 262;

export interface StudyCardHost {
  keyboard(on: boolean): void;
  holdOpen(on: boolean): void;
  setFocus(id: string): void;
  /** Opens Settings on one of the study pages. */
  openStudySettings(page: string): void;
  /** 어흥이 is pleased (a task ticked off). */
  cheer(): void;
}

const RED = "#F4505E";
const AMBER = "#F7B32B";

function head(color: string, name: string, sub: string, extra?: Node): HTMLElement {
  const row = h("div", { class: "int-head" }, dot(color, 7), h("b", { text: name }), h("span", { text: sub }));
  if (extra) row.append(extra);
  return row;
}

function ddayChip(n: number): HTMLElement {
  const color = n <= 0 ? RED : n <= 3 ? AMBER : "#9398a1";
  const chip = h("span", { class: "st-chip", text: ddayLabel(n) });
  chip.style.color = color;
  chip.style.background = `${color}1f`;
  return chip;
}

function empty(text: string, action?: { label: string; run: () => void }): HTMLElement {
  const box = h("div", { class: "st-empty" }, h("span", { text }));
  if (action) box.append(h("button", { class: "link-btn st-link", text: action.label, onclick: action.run }));
  return box;
}

function classRow(c: ClassItem, phase: string): HTMLElement {
  const row = h("div", { class: `st-row st-${phase}` },
    h("span", { class: "st-time", text: c.start || "종일" }),
    h("span", { class: "st-main", text: c.subject }),
    h("span", { class: "st-sub", text: [c.who, c.note].filter(Boolean).join(" · ") }),
  );
  if (phase === "now") row.append(h("span", { class: "st-now", text: "수업 중" }));
  return row;
}

function apptRow(a: Appointment, remove?: () => void): HTMLElement {
  const row = h("div", { class: "st-row st-appt" },
    h("span", { class: "st-time", text: a.start ? (a.end ? `${a.start}` : a.start) : "종일" }),
    h("span", { class: "st-main", text: a.title }),
    h("span", { class: "st-sub", text: [a.end && `~${a.end}`, a.place].filter(Boolean).join(" · ") }),
  );
  if (remove) row.append(xButton("지우기", remove));
  return row;
}

function xButton(label: string, run: () => void): HTMLElement {
  return h("button", {
    class: "st-x", text: "×", "aria-label": label,
    onclick: (e: Event) => {
      e.stopPropagation();
      run();
    },
  });
}

function timeAgo(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function buildStudyCard(host: StudyCardHost) {
  const el = h("div", { class: "int-card st-card" });
  let key = "";
  /** The day the 시간표 card shows when moved by hand; null = automatic. */
  let classDay: string | null = null;
  /** The week view's Monday; null = the day view. */
  let week: string | null = null;
  /** The notice opened in full. */
  let openNotice: string | null = null;
  /** The calendar's month ("YYYY-MM") and picked day; null = this month, today. */
  let calMonth: string | null = null;
  let calDay: string | null = null;

  /** A one-line field that keeps the keyboard and its draft across rebuilds. */
  function field(placeholder: string, onEnter: (text: string) => void): HTMLInputElement {
    const f = h("input", { class: "st-input", type: "text", placeholder, maxlength: "200" }) as HTMLInputElement;
    f.addEventListener("focus", () => host.keyboard(true));
    f.addEventListener("blur", () => {
      host.holdOpen(false);
      host.keyboard(false);
    });
    f.addEventListener("input", () => host.holdOpen(f.value.trim().length > 0));
    f.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        f.value = "";
        f.blur();
        return;
      }
      if (e.key !== "Enter" || e.isComposing) return;
      const text = f.value.trim();
      if (!text) return;
      onEnter(text);
    });
    return f;
  }

  const taskField = field("과제 추가 · 예) 침구 레포트 11/3", (text) => {
    const { title, due } = parseQuickTask(text, ymd(new Date()));
    taskField.value = "";
    host.holdOpen(false);
    void Study.update((b) => ({
      ...b,
      tasks: [...b.tasks, { id: newId(), title, subject: "", due, done: false, doneAt: null, created: Date.now() }],
    }));
  });

  const memoField = field("메모 쓰고 Enter", (text) => {
    memoField.value = "";
    host.holdOpen(false);
    void Study.update((b) => ({ ...b, memos: [...b.memos, { id: newId(), text, pinned: false, created: Date.now() }] }));
  });

  const ddayHint = h("div", { class: "st-hint" });
  const ddayField = field("예) 국시 2027-01-16 · 방학 12/19 · 엄마 생일 3/14", (text) => {
    const parsed = parseDday(text, ymd(new Date()));
    if (!parsed) {
      ddayHint.textContent = "날짜를 못 찾았어. 끝에 11/3 이나 2027-01-16 처럼 써 줘";
      return;
    }
    ddayHint.textContent = "";
    ddayField.value = "";
    host.holdOpen(false);
    void Study.update((b) => ({ ...b, events: [...b.events, { id: newId(), ...parsed }] }));
  });
  const apptHint = h("div", { class: "st-hint" });
  const apptField = field("일정 추가 · 예) 3시 치과 @일산역", (text) => {
    const today = ymd(new Date());
    const parsed = parseAppointment(text, calDay ?? today, today);
    if (!parsed) {
      apptHint.textContent = "무슨 일정인지 이름도 적어 줘";
      return;
    }
    apptHint.textContent = "";
    apptField.value = "";
    host.holdOpen(false);
    // A date written in the line moves the calendar there, so the new one is seen.
    calDay = parsed.date;
    calMonth = parsed.date.slice(0, 7);
    void Study.update((b) => ({ ...b, appointments: [...b.appointments, { id: newId(), ...parsed }] }));
  });
  const fields = [taskField, memoField, ddayField, apptField];

  Study.subscribe(() => {
    key = "";
    State.notify();
  });
  // Folding the island brings the 시간표 card back to its own day and the day view.
  State.subscribe(() => {
    if (State.mode === "expanded" || (classDay == null && week == null && openNotice == null && calMonth == null && calDay == null)) return;
    classDay = null;
    week = null;
    openNotice = null;
    calMonth = null;
    calDay = null;
    key = "";
  });

  const redraw = () => {
    key = "";
    State.notify();
  };

  function taskRow(t: Task, today: string): HTMLElement {
    const box = h("button", {
      class: "st-check",
      "aria-label": "완료",
      onclick: (e: Event) => {
        e.stopPropagation();
        host.cheer();
        void Study.update((b) => ({
          ...b,
          tasks: b.tasks.map((x) => (x.id === t.id ? { ...x, done: true, doneAt: Date.now() } : x)),
        }));
      },
    });
    const row = h("div", { class: "st-row" }, box, h("span", { class: "st-main", text: t.title }));
    if (t.subject) row.append(h("span", { class: "st-sub", text: t.subject }));
    if (t.due) row.append(ddayChip(daysBetween(today, t.due)));
    return row;
  }

  // ── 오늘 ──

  function today(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const day = ymd(now);
    const w = Weather.summary(now);
    const weatherChip = w
      ? h("button", {
        class: "st-wchip", text: `${w.umbrella ? "☂️" : w.icon} ${w.temp}°`,
        title: w.rain, onclick: () => host.setFocus("study_weather"),
      })
      : undefined;
    const out: HTMLElement[] = [head("#F39040", "오늘", longDate(day), weatherChip)];
    out.push(h("div", { class: "st-headline", text: headline(b, now) }));
    const classes = classesOn(b, day);
    const phases = classPhases(classes, now);
    const rows = h("div", { class: "st-list" });
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const appts = appointmentsOn(b, day).filter((a) => {
      const end = minutes(a.end) ?? minutes(a.start);
      return end == null || end + (a.end ? 0 : 60) > nowMin;
    });
    for (const a of appts.slice(0, 2)) rows.append(apptRow(a));
    const left = classes.map((c, i) => ({ c, p: phases[i] })).filter((x) => x.p !== "past");
    if (left.length === 0) {
      const next = autoClassDay(b, now);
      const first = next.day !== day ? classesOn(b, next.day)[0] : null;
      rows.append(h("div", {
        class: "st-quiet",
        text: classes.length ? "오늘 수업 끝! 수고했어 🐯" : "오늘은 수업이 없어 🐯",
      }));
      if (first) {
        rows.append(h("div", { class: "st-row st-later" },
          h("span", { class: "st-time", text: next.label === "내일" ? "내일" : shortDate(next.day).split(" ")[0] }),
          h("span", { class: "st-main", text: `${first.start} ${first.subject}` }),
          h("span", { class: "st-sub", text: "첫 수업" }),
        ));
      }
    }
    for (const { c, p } of left.slice(0, appts.length ? 2 : 3)) rows.append(classRow(c, p));
    const shown = appts.length ? 2 : 3;
    if (left.length > shown) rows.append(h("div", { class: "st-more", text: `수업 ${left.length - shown}개 더` }));
    for (const t of tasksDueWithin(b, day, 2).slice(0, 2)) rows.append(taskRow(t, day));
    out.push(rows);
    const unread = unreadNotices(b).length;
    if (unread > 0) {
      out.push(h("button", { class: "link-btn st-link", text: `새 공지 ${unread}개 보기 →`, onclick: () => host.setFocus("study_notices") }));
    }
    return out;
  }

  // ── 시험 ──

  function exams(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const day = ymd(now);
    const list = upcomingExams(b, now);
    const out: HTMLElement[] = [head("#F4505E", "시험", list.length ? `${list.length}개 남음` : "")];
    if (list.length === 0) {
      out.push(empty("등록된 시험이 없어.", { label: "시험 추가하기", run: () => host.openStudySettings("study-exams") }));
      return out;
    }
    const rows = h("div", { class: "st-list" });
    for (const e of list.slice(0, 4)) {
      const when = [shortDate(e.date), e.start && `${e.start}${e.end ? `–${e.end}` : ""}`, e.place].filter(Boolean).join(" · ");
      rows.append(h("div", { class: "st-row st-two" },
        ddayChip(daysBetween(day, e.date)),
        h("div", { class: "st-col" },
          h("span", { class: "st-main", text: e.subject }),
          h("span", { class: "st-sub", text: [when, e.note].filter(Boolean).join(" · ") }),
        ),
      ));
    }
    if (list.length > 4) rows.append(h("div", { class: "st-more", text: `${list.length - 4}개 더 · 설정에서 전체 보기` }));
    out.push(rows);
    return out;
  }

  // ── 시간표: a day, or the week ──

  function classesDay(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const todayStr = ymd(now);
    const auto = autoClassDay(b, now);
    const day = classDay ?? auto.day;
    const label = classDay == null ? auto.label : day === todayStr ? "오늘" : day === addDays(todayStr, 1) ? "내일" : "";
    const nav = h("span", { class: "st-nav" },
      h("button", { class: "st-arrow", text: "‹", "aria-label": "이전 날", onclick: () => move(-1) }),
      h("button", {
        class: "st-day", text: label ? `${label} ${shortDate(day).split(" ")[0]}` : shortDate(day),
        onclick: () => {
          classDay = null;
          redraw();
        },
      }),
      h("button", { class: "st-arrow", text: "›", "aria-label": "다음 날", onclick: () => move(1) }),
      h("button", {
        class: "st-day st-weekbtn", text: "주간",
        onclick: () => {
          week = mondayOf(day);
          redraw();
        },
      }),
    );
    const out: HTMLElement[] = [head("#5B8DEF", "시간표", "", nav)];
    const classes = classesOn(b, day);
    const phases = day === todayStr ? classPhases(classes, now) : classes.map(() => "later");
    const rows = h("div", { class: "st-list" });
    if (classes.length === 0) rows.append(h("div", { class: "st-quiet", text: "이 날은 수업이 없어" }));
    classes.forEach((c, i) => rows.append(classRow(c, phases[i])));
    out.push(rows);
    return out;
  }

  function move(n: number) {
    const b = Study.board;
    let day = addDays(classDay ?? autoClassDay(b, new Date()).day, n);
    // Weekends without classes are skipped.
    for (let i = 0; i < 3 && classesOn(b, day).length === 0 && [0, 6].includes(new Date(`${day}T12:00`).getDay()); i++) {
      day = addDays(day, n);
    }
    classDay = day;
    redraw();
  }

  function classesWeek(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const todayStr = ymd(now);
    const mon = week!;
    const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
      .filter((d, i) => i < 5 || classesOn(b, d).length > 0);
    const nav = h("span", { class: "st-nav" },
      h("button", { class: "st-arrow", text: "‹", "aria-label": "지난주", onclick: () => { week = addDays(mon, -7); redraw(); } }),
      h("button", {
        class: "st-day", text: `${shortDate(mon).split(" ")[0]} – ${shortDate(addDays(mon, 4)).split(" ")[0]}`,
        onclick: () => { week = mondayOf(todayStr); redraw(); },
      }),
      h("button", { class: "st-arrow", text: "›", "aria-label": "다음 주", onclick: () => { week = addDays(mon, 7); redraw(); } }),
      h("button", { class: "st-day st-weekbtn on", text: "하루", onclick: () => { week = null; redraw(); } }),
    );
    const grid = h("div", { class: "st-week" });
    grid.style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
    for (const d of days) {
      const items = classesOn(b, d);
      const phases = d === todayStr ? classPhases(items, now) : items.map(() => (d < todayStr ? "past" : "later"));
      const col = h("div", { class: `st-wcol${d === todayStr ? " today" : ""}` },
        h("div", { class: "st-wday", text: `${WEEKDAYS[new Date(`${d}T12:00`).getDay()]} ${Number(d.slice(8))}` }));
      const own = appointmentsOn(b, d);
      if (items.length === 0 && own.length === 0) col.append(h("div", { class: "st-wnone", text: "—" }));
      // Classes and the user's own appointments, in time order (all-day ones first).
      const cells: { at: string; el: HTMLElement }[] = [];
      for (const a of own) {
        cells.push({ at: a.start || "00:00", el: h("div", { class: "st-wcell st-wappt", title: [a.start && `${a.start}${a.end ? `–${a.end}` : ""}`, a.title, a.place].filter(Boolean).join(" · ") },
          h("span", { class: "st-wtime", text: a.start ? a.start.replace(/^0/, "") : "종일" }),
          h("span", { class: "st-wsub", text: a.title }),
        ) });
      }
      items.forEach((c, i) => {
        cells.push({ at: c.start || "00:00", el: h("div", { class: `st-wcell st-${phases[i]}`, title: [c.start && `${c.start}–${c.end}`, c.subject, c.who, c.note].filter(Boolean).join(" · ") },
          h("span", { class: "st-wtime", text: c.start ? c.start.replace(/^0/, "") : "종일" }),
          h("span", { class: "st-wsub", text: c.subject }),
        ) });
      });
      cells.sort((x, y) => x.at.localeCompare(y.at));
      for (const c of cells) col.append(c.el);
      grid.append(col);
    }
    return [head("#5B8DEF", "시간표", "주간", nav), grid];
  }

  // ── 달력 ──

  function calendar(): HTMLElement[] {
    const b = Study.board;
    const todayStr = ymd(new Date());
    const month = calMonth ?? todayStr.slice(0, 7);
    const picked = calDay ?? (month === todayStr.slice(0, 7) ? todayStr : `${month}-01`);
    const marks = monthMarks(b, month, todayStr);
    const go = (n: number) => {
      calMonth = addMonths(month, n);
      calDay = calMonth === todayStr.slice(0, 7) ? todayStr : `${calMonth}-01`;
      redraw();
    };
    const [y, m] = month.split("-").map(Number);
    const nav = h("span", { class: "st-nav" },
      h("button", { class: "st-arrow", text: "‹", "aria-label": "지난달", onclick: () => go(-1) }),
      h("button", { class: "st-day", text: `${y}년 ${m}월`, onclick: () => { calMonth = null; calDay = null; redraw(); } }),
      h("button", { class: "st-arrow", text: "›", "aria-label": "다음 달", onclick: () => go(1) }),
      h("button", { class: "st-day st-weekbtn on", text: "닫기", onclick: () => host.setFocus("study_today") }),
    );

    // The month: Monday first, a dot per kind of thing on each day.
    const grid = h("div", { class: "st-month" });
    for (const w of ["월", "화", "수", "목", "금", "토", "일"]) grid.append(h("div", { class: `st-mhead${w === "토" ? " sat" : w === "일" ? " sun" : ""}`, text: w }));
    for (const d of monthGrid(month)) {
      const mk = marks.get(d);
      const dow = new Date(`${d}T12:00`).getDay();
      const cls = [
        "st-mday",
        d.startsWith(month) ? "" : "out",
        d === todayStr ? "today" : "",
        d === picked ? "picked" : "",
        dow === 6 ? "sat" : dow === 0 ? "sun" : "",
        mk?.exams ? "exam" : "",
      ].filter(Boolean).join(" ");
      const dots = h("span", { class: "st-mdots" });
      if (mk?.appointments) dots.append(h("i", { class: "d-appt" }));
      if (mk?.exams) dots.append(h("i", { class: "d-exam" }));
      if (mk?.tasks) dots.append(h("i", { class: "d-task" }));
      if (mk?.ddays) dots.append(h("i", { class: "d-dday" }));
      grid.append(h("button", {
        class: cls,
        onclick: () => {
          calDay = d;
          calMonth = d.slice(0, 7);
          redraw();
        },
      }, h("span", { class: "st-mnum", text: String(Number(d.slice(8))) }), dots));
    }

    // The picked day: appointments (deletable), then exams, deadlines, D-days, classes.
    const agenda = h("div", { class: "st-agenda" });
    const dn = daysBetween(todayStr, picked);
    const rel = dn === 0 ? "오늘" : dn === 1 ? "내일" : dn === -1 ? "어제" : dn > 0 ? `${dn}일 뒤` : `${-dn}일 전`;
    agenda.append(h("div", { class: "st-ahead" }, h("b", { text: shortDate(picked) }), h("span", { class: "st-sub", text: rel })));
    agenda.append(apptField, apptHint);
    const list = h("div", { class: "st-list st-alist" });
    for (const a of appointmentsOn(b, picked)) {
      list.append(apptRow(a, () => void Study.update((x) => ({ ...x, appointments: x.appointments.filter((y) => y.id !== a.id) }))));
    }
    for (const e of b.exams.filter((x) => x.date === picked)) {
      list.append(h("div", { class: "st-row" }, h("span", { class: "st-tag t-exam", text: "시험" }),
        h("span", { class: "st-main", text: e.subject }), h("span", { class: "st-sub", text: e.start })));
    }
    for (const t of b.tasks.filter((x) => !x.done && x.due === picked)) {
      list.append(h("div", { class: "st-row" }, h("span", { class: "st-tag t-task", text: "마감" }),
        h("span", { class: "st-main", text: t.title })));
    }
    for (const { e } of upcomingEvents(b, picked).filter((x) => x.date === picked)) {
      list.append(h("div", { class: "st-row" }, h("span", { class: "st-tag t-dday", text: "D-day" }),
        h("span", { class: "st-main", text: e.title })));
    }
    const classes = classesOn(b, picked).filter((c) => c.start);
    if (classes.length) {
      list.append(h("div", { class: "st-row st-later" }, h("span", { class: "st-tag t-class", text: "수업" }),
        h("span", { class: "st-sub", text: `${classes.length}개 · ${classes[0].start}–${classes[classes.length - 1].end}` })));
    }
    if (!list.childElementCount) list.append(h("div", { class: "st-quiet", text: "비어 있어. 위에 일정을 적어 봐" }));
    agenda.append(list);

    return [head("#F39040", "달력", "", nav), h("div", { class: "st-cal" }, grid, agenda)];
  }

  // ── 과제 ──

  function tasks(): HTMLElement[] {
    const b = Study.board;
    const day = ymd(new Date());
    const open = openTasks(b);
    const doneToday = b.tasks.filter((t) => t.done && t.doneAt && ymd(new Date(t.doneAt)) === day).length;
    const sub = [open.length ? `${open.length}개 남음` : "", doneToday ? `오늘 ${doneToday}개 완료` : ""].filter(Boolean).join(" · ");
    const out: HTMLElement[] = [head("#34D399", "과제", sub), taskField];
    const rows = h("div", { class: "st-list" });
    if (open.length === 0) rows.append(h("div", { class: "st-quiet", text: doneToday ? "다 했다! 최고야 🐯" : "남은 과제가 없어" }));
    for (const t of open.slice(0, 5)) rows.append(taskRow(t, day));
    if (open.length > 5) rows.append(h("div", { class: "st-more", text: `${open.length - 5}개 더` }));
    out.push(rows);
    return out;
  }

  // ── 날씨 ──

  function weather(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const w = Weather.summary(now);
    const place = h("button", { class: "link-btn st-mark", text: "지역", onclick: () => host.openStudySettings("study-life") });
    const out: HTMLElement[] = [head("#38BDF8", "날씨", [b.place.name, Weather.age().replace(" 업데이트", "")].filter(Boolean).join(" · "), place)];
    if (!w) {
      out.push(empty(
        Weather.error ? `날씨를 못 가져왔어: ${Weather.error}` : Weather.loading ? "날씨 불러오는 중…" : "곧 날씨를 가져올게",
        { label: "다시 시도", run: () => void Weather.refresh(b.place, true) },
      ));
      return out;
    }
    out.push(h("div", { class: "st-wnow" },
      h("span", { class: "st-wicon", text: w.icon }),
      h("span", { class: "st-wtemp", text: `${w.temp}°` }),
      h("div", { class: "st-col" },
        h("span", { class: "st-main", text: `${w.text} · 체감 ${w.feels}°` }),
        h("span", { class: "st-sub", text: w.max != null ? `최고 ${w.max}° · 최저 ${w.min}°` : "" }),
      ),
    ));
    out.push(h("div", { class: `st-rain${w.umbrella ? " wet" : ""}`, text: `${w.umbrella ? "☂️ " : ""}${w.rain}` }));
    if (w.hours.length) {
      out.push(h("div", { class: "st-hours" }, ...w.hours.map((x) => h("div", { class: "st-hour" },
        h("span", { class: "st-hl", text: `${x.label} ${x.icon}` }),
        h("span", { class: "st-ht" }, `${x.temp}°`, x.chance >= 20 ? h("i", { class: "st-chance", text: ` ${x.chance}%` }) : null),
      ))));
    }
    const d10 = dustGrade("pm10", w.pm10);
    const d25 = dustGrade("pm25", w.pm25);
    const dust = h("div", { class: "st-dust" });
    for (const [label, g] of [["미세", d10], ["초미세", d25]] as const) {
      if (!g) continue;
      dust.append(h("span", { class: "st-sub st-dl", text: label }), h("span", { class: "st-grade", text: g.text, style: `color:${g.color}` }));
    }
    if (dust.childElementCount) out.push(dust);
    out.push(h("div", { class: "st-tip", text: `🐯 ${w.tip}` }));
    return out;
  }

  // ── 공지 ──

  function notices(): HTMLElement[] {
    const b = Study.board;
    const all = sortedNotices(b);
    const unread = unreadNotices(b).length;
    const markAll = unread
      ? h("button", {
        class: "link-btn st-mark", text: "모두 읽음",
        onclick: () => void Study.update((x) => ({ ...x, notices: x.notices.map((n) => ({ ...n, read: true })) })),
      })
      : undefined;
    const out: HTMLElement[] = [head("#A78BFA", "공지", unread ? `새 공지 ${unread}개` : "", markAll)];
    if (all.length === 0) {
      const linked = b.telegram.enabled;
      out.push(empty(
        linked ? "아직 들어온 공지가 없어. 봇을 단톡방에 초대했는지 확인해 줘." : "텔레그램을 연결하면 단톡방 공지가 여기 모여.",
        { label: linked ? "텔레그램 설정" : "연결하기", run: () => host.openStudySettings("study-telegram") },
      ));
      return out;
    }
    const rows = h("div", { class: "st-list" });
    for (const n of all.slice(0, openNotice ? 8 : 5)) {
      const isOpen = openNotice === n.id;
      rows.append(h("div", {
        class: `st-notice${n.read ? "" : " unread"}${isOpen ? " open" : ""}`,
        onclick: () => {
          openNotice = isOpen ? null : n.id;
          key = "";
          if (!n.read) {
            void Study.update((x) => ({ ...x, notices: x.notices.map((y) => (y.id === n.id ? { ...y, read: true } : y)) }));
          } else {
            State.notify();
          }
        },
      },
      h("div", { class: "st-nmeta" },
        n.read ? null : h("i", { class: "st-dot" }),
        h("span", { text: [n.chat, n.author].filter(Boolean).join(" · ") }),
        h("span", { class: "st-ago", text: timeAgo(n.date) }),
      ),
      h("div", { class: "st-ntext", text: n.text })));
    }
    out.push(rows);
    return out;
  }

  // ── D-day ──

  function dday(): HTMLElement[] {
    const b = Study.board;
    const day = ymd(new Date());
    const list = upcomingEvents(b, day);
    const out: HTMLElement[] = [head("#F472B6", "D-day", list.length ? `${list.length}개` : ""), ddayField, ddayHint];
    const rows = h("div", { class: "st-list" });
    if (list.length === 0) rows.append(h("div", { class: "st-quiet", text: "국시·방학·생일처럼 기다리는 날을 넣어 봐" }));
    for (const { e, date, n } of list.slice(0, 5)) {
      rows.append(h("div", { class: `st-row${n < 0 ? " st-past" : ""}` },
        ddayChip(n),
        h("span", { class: "st-main", text: e.title }),
        h("span", { class: "st-sub", text: `${shortDate(date)}${e.yearly ? " · 매년" : ""}` }),
        xButton("지우기", () => void Study.update((x) => ({ ...x, events: x.events.filter((y) => y.id !== e.id) }))),
      ));
    }
    if (list.length > 5) rows.append(h("div", { class: "st-more", text: `${list.length - 5}개 더 · 설정에서 전체 보기` }));
    out.push(rows);
    return out;
  }

  // ── 메모 ──

  function memo(): HTMLElement[] {
    const b = Study.board;
    const list = sortedMemos(b);
    const out: HTMLElement[] = [head("#F7B32B", "메모", list.length ? `${list.length}개` : ""), memoField];
    const rows = h("div", { class: "st-list" });
    if (list.length === 0) rows.append(h("div", { class: "st-quiet", text: "잊으면 안 되는 걸 한 줄씩 적어 둬" }));
    for (const m of list.slice(0, 5)) {
      rows.append(h("div", { class: `st-row st-memo${m.pinned ? " pinned" : ""}` },
        h("button", {
          class: "st-pin", text: m.pinned ? "📌" : "·", "aria-label": m.pinned ? "고정 풀기" : "고정",
          onclick: (e: Event) => {
            e.stopPropagation();
            void Study.update((x) => ({ ...x, memos: x.memos.map((y) => (y.id === m.id ? { ...y, pinned: !y.pinned } : y)) }));
          },
        }),
        h("span", { class: "st-main st-memotext", text: m.text, title: m.text }),
        xButton("지우기", () => void Study.update((x) => ({ ...x, memos: x.memos.filter((y) => y.id !== m.id) }))),
      ));
    }
    if (list.length > 5) rows.append(h("div", { class: "st-more", text: `${list.length - 5}개 더` }));
    out.push(rows);
    return out;
  }

  return {
    el,
    /** The week view takes the whole overview. */
    get wide(): boolean {
      return week != null || State.focusTask?.id === "study_calendar";
    },
    sync(id: StudyId) {
      if (id !== "study_classes") week = null;
      const minute = Math.floor(Date.now() / 60_000);
      const next = `${id}~${minute}~${classDay}~${week}~${openNotice}~${calMonth}~${calDay}~${Weather.fetchedAt}~${Weather.loading}~${JSON.stringify(Study.board)}`;
      if (next === key) return;
      key = next;
      const focused = fields.find((f) => document.activeElement === f) ?? null;
      clear(el);
      const parts = id === "study_today" ? today()
        : id === "study_calendar" ? calendar()
        : id === "study_exams" ? exams()
        : id === "study_classes" ? (week ? classesWeek() : classesDay())
        : id === "study_tasks" ? tasks()
        : id === "study_weather" ? weather()
        : id === "study_dday" ? dday()
        : id === "study_memo" ? memo()
        : notices();
      el.append(...parts);
      if (focused && el.contains(focused)) focused.focus();
    },
    /** Leaving the card: the fields let go of the keyboard. */
    leave() {
      classDay = null;
      week = null;
      openNotice = null;
      calMonth = null;
      calDay = null;
      for (const f of fields) if (document.activeElement === f) f.blur();
    },
  };
}

/** Kept for Settings: opens the study page there. */
export function openStudySettings(page: string) {
  void Bridge.openSettingsWindow(page);
}
