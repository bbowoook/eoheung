// The island's side of the study board: a look at Telegram every half minute
// while the bot is on, and the reminders every minute. Both tell the island
// (a badge on the pill, a sound, the compact island showing the line) and, once
// the user's chat is paired, the bot sends the reminder to their phone too.

import { Bridge, IS_TAURI } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { Island } from "../island/island";
import { Study } from "./store";
import { applyUpdates, markSent, remindersDue, type TgUpdate } from "./model";
import { WEATHER_REFRESH_MS, Weather } from "./weather";

const POLL_MS = 30_000;
const REMIND_MS = 60_000;

const clearTimers = new Map<string, number>();

/** Shows `line` on the pill `id` the way an integration event does. */
export function studyAlert(island: Island, id: string, line: string, detail?: string) {
  if (State.paused) return;
  const task = State.tasks.find((t) => t.id === id);
  if (task) {
    task.state = "finished";
    task.steps = detail ? [line, detail] : [line];
    task.stepIndex = task.steps.length - 1;
    if (State.focusId !== id) task.pillBadge = "finished";
  }
  Sound.play("finish");
  island.reveal();
  State.notify();
  const existing = clearTimers.get(id);
  if (existing != null) window.clearTimeout(existing);
  clearTimers.set(id, window.setTimeout(() => {
    clearTimers.delete(id);
    const t = State.tasks.find((x) => x.id === id);
    if (!t || t.state !== "finished") return;
    t.state = "idle";
    t.steps = [];
    t.stepIndex = 0;
    t.pillBadge = null;
    State.notify();
  }, 60_000));
}

let polling = false;

async function pollTelegram(island: Island) {
  const tg = Study.board.telegram;
  if (polling || State.paused || !tg.enabled || !IS_TAURI) return;
  polling = true;
  try {
    const updates = (await Bridge.telegramUpdates(tg.offset)) as TgUpdate[];
    if (!Array.isArray(updates) || updates.length === 0) return;
    let result: ReturnType<typeof applyUpdates> | null = null;
    await Study.update((b) => {
      result = applyUpdates(b, updates);
      return result.board;
    });
    const r = result as ReturnType<typeof applyUpdates> | null;
    if (!r) return;
    for (const reply of r.replies) void Bridge.telegramSend(reply.chatId, reply.text).catch(() => {});
    // What the user sent from their phone to their own bot.
    const words = { task: "과제", appointment: "달력", memo: "메모", notice: "공지" } as const;
    const pills = { task: "study_tasks", appointment: "study_calendar", memo: "study_memo", notice: "study_notices" } as const;
    for (const c of r.captured.filter((x) => x.kind !== "notice")) {
      studyAlert(island, pills[c.kind], `폰에서 ${words[c.kind]}에 추가`, c.line);
    }
    if (r.added.length > 0) {
      const last = r.added[r.added.length - 1];
      const head = r.added.length > 1 ? `새 공지 ${r.added.length}개 · ${last.chat}` : `새 공지 · ${last.chat}`;
      studyAlert(island, "study_notices", head, last.text.replace(/\s+/g, " ").slice(0, 80));
    }
  } catch (err) {
    console.warn("[어흥이] telegram", err);
  } finally {
    polling = false;
  }
}

async function remind(island: Island) {
  if (!Study.loaded) return;
  const due = remindersDue(Study.board, new Date());
  if (due.length === 0) return;
  await Study.update((b) => markSent(b, due.map((d) => d.key)));
  const tg = Study.board.telegram;
  for (const r of due) {
    studyAlert(island, r.pill, r.text.replace(/^🐯\s*/, ""));
    if (tg.enabled && tg.ownerChatId != null && IS_TAURI) {
      void Bridge.telegramSend(tg.ownerChatId, r.text).catch((e) => console.warn("[어흥이] send", e));
    }
  }
}

export function startStudyLoops(island: Island) {
  // The weather: at launch, every half hour, and at once when the place changes.
  const weather = () => void Weather.refresh(Study.board.place);
  Study.subscribe((b) => {
    if (Weather.place && (Weather.place.lat !== b.place.lat || Weather.place.lon !== b.place.lon)) void Weather.refresh(b.place, true);
  });
  window.setInterval(weather, WEATHER_REFRESH_MS);
  Weather.subscribe(() => State.notify());
  void Study.load().then(() => {
    weather();
    window.setTimeout(() => void remind(island), 4_000);
    window.setTimeout(() => void pollTelegram(island), 6_000);
  });
  window.setInterval(() => void remind(island), REMIND_MS);
  window.setInterval(() => void pollTelegram(island), POLL_MS);
}
