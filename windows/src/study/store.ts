// The study board as every window holds it: loaded once, saved whole, and kept in
// step across windows by Rust's "study" event. In a plain browser (npm run dev) it
// lives in localStorage, starting from the same seed as a fresh install.

import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import SEED from "../../src-tauri/study-seed.json";
import { normalizeBoard, type Board } from "./model";

const LOCAL_KEY = "eoheung-study";

type Listener = (board: Board) => void;

let board: Board = normalizeBoard(SEED);
let loaded = false;
let loading: Promise<Board> | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(board);
}

function readLocal(): unknown {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : SEED;
  } catch {
    return SEED;
  }
}

export const Study = {
  get board(): Board {
    return board;
  },
  get loaded(): boolean {
    return loaded;
  },

  /** Loads the board once; later calls get the same one. */
  load(): Promise<Board> {
    if (loading) return loading;
    loading = (async () => {
      const raw = IS_TAURI ? await Bridge.studyGet() : readLocal();
      board = normalizeBoard(raw ?? SEED);
      loaded = true;
      void onEvent<unknown>("study", (fresh) => {
        const next = normalizeBoard(fresh);
        if (JSON.stringify(next) === JSON.stringify(board)) return;
        board = next;
        emit();
      });
      emit();
      return board;
    })();
    return loading;
  },

  /** Changes the board and saves it. Listeners hear about it at once. */
  async update(change: (b: Board) => Board): Promise<void> {
    board = normalizeBoard(change(structuredClone(board)));
    emit();
    if (IS_TAURI) {
      await Bridge.studySet(board);
    } else {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(board));
      } catch {
        /* a private window: the change lasts until the page closes */
      }
    }
  },

  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
