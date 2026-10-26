// The study pills' cards in the overview's left card: 오늘, 시험, 시간표, 과제, 공지.
// Each card is rebuilt from the board when something it shows changes; the task
// field is built once so a draft survives notices coming in.

import { h, clear, dot } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { Study } from "../study/store";
import {
  addDays, classPhases, classesOn, daysBetween, ddayLabel, headline, longDate, newId, openTasks, parseQuickTask,
  shortDate, sortedNotices, tasksDueWithin, unreadNotices, upcomingExams, ymd, type ClassItem, type Task,
} from "../study/model";

export const STUDY_IDS = ["study_today", "study_exams", "study_classes", "study_tasks", "study_notices"] as const;
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
  const time = c.start ? `${c.start}` : "종일";
  const row = h("div", { class: `st-row st-${phase}` },
    h("span", { class: "st-time", text: time }),
    h("span", { class: "st-main", text: c.subject }),
    h("span", { class: "st-sub", text: [c.who, c.note].filter(Boolean).join(" · ") }),
  );
  if (phase === "now") row.append(h("span", { class: "st-now", text: "수업 중" }));
  return row;
}

function taskRow(t: Task, today: string, host: StudyCardHost): HTMLElement {
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
  if (t.due) {
    const n = daysBetween(today, t.due);
    row.append(ddayChip(n));
  }
  return row;
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
  /** The day the 시간표 card shows; null = today. */
  let classDay: string | null = null;
  /** The notice opened in full. */
  let openNotice: string | null = null;

  // The task field, kept across rebuilds.
  const field = h("input", {
    class: "st-input",
    type: "text",
    placeholder: "과제 추가 · 예) 침구 레포트 11/3",
    maxlength: "120",
  }) as HTMLInputElement;
  field.addEventListener("focus", () => host.keyboard(true));
  field.addEventListener("blur", () => {
    host.holdOpen(false);
    host.keyboard(false);
  });
  field.addEventListener("input", () => host.holdOpen(field.value.trim().length > 0));
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      field.value = "";
      field.blur();
      return;
    }
    if (e.key !== "Enter" || e.isComposing) return;
    const text = field.value.trim();
    if (!text) return;
    const { title, due } = parseQuickTask(text, ymd(new Date()));
    field.value = "";
    host.holdOpen(false);
    void Study.update((b) => ({
      ...b,
      tasks: [...b.tasks, { id: newId(), title, subject: "", due, done: false, doneAt: null, created: Date.now() }],
    }));
  });

  Study.subscribe(() => {
    key = "";
    State.notify();
  });

  function today(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const day = ymd(now);
    const out: HTMLElement[] = [head("#F39040", "오늘", longDate(day))];
    out.push(h("div", { class: "st-headline", text: headline(b, now) }));
    const classes = classesOn(b, day);
    const phases = classPhases(classes, now);
    const rows = h("div", { class: "st-list" });
    const left = classes.map((c, i) => ({ c, p: phases[i] })).filter((x) => x.p !== "past");
    if (classes.length === 0) rows.append(h("div", { class: "st-quiet", text: "오늘은 수업이 없어 🐯" }));
    else if (left.length === 0) rows.append(h("div", { class: "st-quiet", text: "오늘 수업 끝! 수고했어 🐯" }));
    for (const { c, p } of left.slice(0, 3)) rows.append(classRow(c, p));
    if (left.length > 3) rows.append(h("div", { class: "st-more", text: `수업 ${left.length - 3}개 더` }));
    const due = tasksDueWithin(b, day, 2);
    for (const t of due.slice(0, 2)) rows.append(taskRow(t, day, host));
    out.push(rows);
    const unread = unreadNotices(b).length;
    if (unread > 0) {
      out.push(h("button", {
        class: "link-btn st-link",
        text: `새 공지 ${unread}개 보기 →`,
        onclick: () => host.setFocus("study_notices"),
      }));
    }
    return out;
  }

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

  function classesCard(): HTMLElement[] {
    const b = Study.board;
    const now = new Date();
    const todayStr = ymd(now);
    const day = classDay ?? todayStr;
    const nav = h("span", { class: "st-nav" },
      h("button", { class: "st-arrow", text: "‹", "aria-label": "이전 날", onclick: () => move(-1) }),
      h("button", {
        class: "st-day", text: day === todayStr ? `오늘 ${shortDate(day)}` : shortDate(day),
        onclick: () => {
          classDay = null;
          key = "";
          State.notify();
        },
      }),
      h("button", { class: "st-arrow", text: "›", "aria-label": "다음 날", onclick: () => move(1) }),
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
    let day = addDays(classDay ?? ymd(new Date()), n);
    // Weekends without classes are skipped.
    for (let i = 0; i < 3 && classesOn(Study.board, day).length === 0 && [0, 6].includes(new Date(day).getDay()); i++) {
      day = addDays(day, n);
    }
    classDay = day === ymd(new Date()) ? null : day;
    key = "";
    State.notify();
  }

  function tasks(): HTMLElement[] {
    const b = Study.board;
    const day = ymd(new Date());
    const open = openTasks(b);
    const doneToday = b.tasks.filter((t) => t.done && t.doneAt && ymd(new Date(t.doneAt)) === day).length;
    const sub = [open.length ? `${open.length}개 남음` : "", doneToday ? `오늘 ${doneToday}개 완료` : ""].filter(Boolean).join(" · ");
    const out: HTMLElement[] = [head("#34D399", "과제", sub)];
    out.push(field);
    const rows = h("div", { class: "st-list" });
    if (open.length === 0) rows.append(h("div", { class: "st-quiet", text: doneToday ? "다 했다! 최고야 🐯" : "남은 과제가 없어" }));
    for (const t of open.slice(0, 5)) rows.append(taskRow(t, day, host));
    if (open.length > 5) rows.append(h("div", { class: "st-more", text: `${open.length - 5}개 더` }));
    out.push(rows);
    return out;
  }

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
      const row = h("div", {
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
      h("div", { class: "st-ntext", text: n.text }));
      rows.append(row);
    }
    out.push(rows);
    return out;
  }

  return {
    el,
    sync(id: StudyId) {
      const minute = Math.floor(Date.now() / 60_000);
      const next = `${id}~${minute}~${classDay}~${openNotice}~${JSON.stringify(Study.board)}`;
      if (next === key) return;
      key = next;
      const hadFocus = document.activeElement === field;
      clear(el);
      const parts = id === "study_today" ? today()
        : id === "study_exams" ? exams()
        : id === "study_classes" ? classesCard()
        : id === "study_tasks" ? tasks()
        : notices();
      el.append(...parts);
      if (hadFocus && id === "study_tasks") field.focus();
    },
    /** Leaving the card: the field lets go of the keyboard. */
    leave() {
      classDay = null;
      openNotice = null;
      if (document.activeElement === field) field.blur();
    },
  };
}

/** Kept for Settings: opens the study page there. */
export function openStudySettings(page: string) {
  void Bridge.openSettingsWindow(page);
}
