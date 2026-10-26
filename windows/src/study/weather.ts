// The weather pill: what Open-Meteo says (src-tauri/src/weather.rs), in words.
// `summarize` is pure and tested; `Weather` keeps the last answer and refreshes
// it every half hour, or at once when the place changes.

import { Bridge, IS_TAURI } from "../core/bridge";
import { hm, ymd, type Place } from "./model";

/** WMO weather codes → a word and a picture. */
export function describe(code: number, isDay = true): { text: string; icon: string } {
  if (code === 0) return { text: "맑음", icon: isDay ? "☀️" : "🌙" };
  if (code === 1) return { text: "대체로 맑음", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { text: "구름 조금", icon: "⛅" };
  if (code === 3) return { text: "흐림", icon: "☁️" };
  if (code === 45 || code === 48) return { text: "안개", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { text: "이슬비", icon: "🌦️" };
  if (code >= 61 && code <= 67) return { text: code >= 65 ? "많은 비" : "비", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { text: code >= 75 ? "많은 눈" : "눈", icon: "🌨️" };
  if (code >= 80 && code <= 82) return { text: "소나기", icon: "🌦️" };
  if (code === 85 || code === 86) return { text: "눈보라", icon: "🌨️" };
  if (code >= 95) return { text: "뇌우", icon: "⛈️" };
  return { text: "알 수 없음", icon: "🌡️" };
}

const isWet = (code: number) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
const isSnow = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86;

/** 미세먼지 grades as Korea's 환경부 uses them (µg/m³). */
export function dustGrade(kind: "pm10" | "pm25", value: number | null | undefined): { text: string; color: string } | null {
  if (value == null || !Number.isFinite(value)) return null;
  const [a, b, c] = kind === "pm10" ? [30, 80, 150] : [15, 35, 75];
  if (value <= a) return { text: "좋음", color: "#5B8DEF" };
  if (value <= b) return { text: "보통", color: "#34D399" };
  if (value <= c) return { text: "나쁨", color: "#F7B32B" };
  return { text: "매우 나쁨", color: "#F4505E" };
}

export interface WeatherSummary {
  temp: number;
  feels: number;
  text: string;
  icon: string;
  max: number | null;
  min: number | null;
  /** One line about rain or snow in the hours to come. */
  rain: string;
  /** Take an umbrella. */
  umbrella: boolean;
  pm10: number | null;
  pm25: number | null;
  /** The next hours, every 3 hours: "15시", icon, temperature, chance of rain. */
  hours: { label: string; icon: string; temp: number; chance: number }[];
  /** A word from 어흥이 about what to wear. */
  tip: string;
}

type Num = number | null | undefined;
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The forecast and air as weather_get returns them, at `now` → what the card shows. */
export function summarize(raw: unknown, now: Date): WeatherSummary | null {
  const r = (raw ?? {}) as { forecast?: Record<string, any>; air?: Record<string, any> | null };
  const f = r.forecast;
  const cur = f?.current;
  if (!cur || n(cur.temperature_2m) == null) return null;
  const code = n(cur.weather_code) ?? -1;
  const d = describe(code, cur.is_day !== 0);
  const today = ymd(now);
  const daily = f.daily ?? {};
  const di = Array.isArray(daily.time) ? daily.time.indexOf(today) : -1;
  const max = di >= 0 ? n(daily.temperature_2m_max?.[di]) : null;
  const min = di >= 0 ? n(daily.temperature_2m_min?.[di]) : null;

  // The hours from now on, as far as the forecast goes (up to 18 hours).
  const h = f.hourly ?? {};
  const times: string[] = Array.isArray(h.time) ? h.time : [];
  const nowKey = `${today}T${String(now.getHours()).padStart(2, "0")}:00`;
  let start = times.findIndex((t) => t >= nowKey);
  if (start < 0) start = times.length;
  const ahead = times.slice(start, start + 18).map((t, i) => ({
    t,
    hour: Number(t.slice(11, 13)),
    day: t.slice(0, 10),
    chance: n(h.precipitation_probability?.[start + i]) ?? 0,
    mm: n(h.precipitation?.[start + i]) ?? 0,
    code: n(h.weather_code?.[start + i]) ?? -1,
    temp: n(h.temperature_2m?.[start + i]),
  }));

  const wetNow = isWet(code) || isSnow(code) || (n(cur.precipitation) ?? 0) > 0.05;
  const firstWet = ahead.find((x) => x.chance >= 50 || x.mm >= 0.2 || isWet(x.code) || isSnow(x.code));
  const snowy = isSnow(code) || (firstWet ? isSnow(firstWet.code) : false);
  const what = snowy ? "눈" : "비";
  let rain: string;
  let umbrella = false;
  if (wetNow) {
    const dry = ahead.find((x) => x.chance < 30 && x.mm < 0.1 && !isWet(x.code) && !isSnow(x.code));
    rain = dry ? `지금 ${what} 와. ${dry.day === today ? "" : "내일 "}${dry.hour}시쯤 그칠 것 같아` : `지금 ${what} 와. 오늘은 계속 올 것 같아`;
    umbrella = true;
  } else if (firstWet) {
    const when = firstWet.day === today ? `${firstWet.hour}시쯤` : `내일 ${firstWet.hour}시쯤`;
    rain = `${when}부터 ${what} 소식 (${Math.round(firstWet.chance)}%)`;
    umbrella = firstWet.day === today;
  } else {
    rain = `앞으로 ${ahead.length >= 12 ? "반나절" : "몇 시간"}은 ${what} 소식 없어`;
  }

  const hours = ahead
    .filter((_, i) => i > 0 && i % 3 === 0)
    .slice(0, 4)
    .map((x) => ({
      label: `${x.hour}시`,
      icon: describe(x.code, x.hour >= 6 && x.hour < 19).icon,
      temp: Math.round(x.temp ?? 0),
      chance: Math.round(x.chance),
    }));

  const feels = n(cur.apparent_temperature) ?? n(cur.temperature_2m)!;
  const pm10 = n(r.air?.current?.pm10);
  const pm25 = n(r.air?.current?.pm2_5);
  return {
    temp: Math.round(n(cur.temperature_2m)!),
    feels: Math.round(feels),
    text: d.text,
    icon: d.icon,
    max: max == null ? null : Math.round(max),
    min: min == null ? null : Math.round(min),
    rain,
    umbrella,
    pm10,
    pm25,
    hours,
    tip: wearTip(feels, max, min, umbrella, pm10, pm25),
  };
}

/** 어흥이's one line: what to wear, or the umbrella, or a mask. */
export function wearTip(feels: number, max: Num, min: Num, umbrella: boolean, pm10: Num, pm25: Num): string {
  const dust = Math.max(
    pm10 == null ? 0 : pm10 > 150 ? 3 : pm10 > 80 ? 2 : 0,
    pm25 == null ? 0 : pm25 > 75 ? 3 : pm25 > 35 ? 2 : 0,
  );
  if (umbrella) return "우산 꼭 챙겨! ☂️";
  if (dust >= 2) return "미세먼지 나빠. 마스크 챙기자 😷";
  const gap = max != null && min != null ? max - min : 0;
  if (feels <= -5) return "엄청 추워! 패딩에 목도리까지 🧣";
  if (feels <= 4) return "추워. 두꺼운 외투 입고 가";
  if (feels <= 11) return gap >= 10 ? "일교차 커. 겉옷 꼭 챙겨" : "쌀쌀해. 자켓이나 코트 챙기자";
  if (feels <= 17) return gap >= 10 ? "낮엔 괜찮은데 저녁엔 쌀쌀해. 가디건!" : "선선해. 가벼운 겉옷이면 돼";
  if (feels <= 23) return "딱 좋은 날씨야. 산책하기 좋겠다";
  if (feels <= 28) return "따뜻해. 반팔도 괜찮아";
  return "더워! 물 자주 마시자 💧";
}

// ── The last answer, kept fresh ──────────────────────────────────────────────

const REFRESH_MS = 30 * 60_000;

type Listener = () => void;

export const Weather = {
  raw: null as unknown,
  fetchedAt: 0,
  error: null as string | null,
  loading: false,
  place: null as Place | null,
  listeners: new Set<Listener>(),

  summary(now = new Date()): WeatherSummary | null {
    return summarize(this.raw, now);
  },

  /** "12분 전 업데이트" for the card. */
  age(now = Date.now()): string {
    if (!this.fetchedAt) return "";
    const m = Math.floor((now - this.fetchedAt) / 60_000);
    if (m < 1) return "방금 업데이트";
    if (m < 60) return `${m}분 전 업데이트`;
    return `${hm(new Date(this.fetchedAt))} 업데이트`;
  },

  async refresh(place: Place, force = false): Promise<void> {
    const samePlace = this.place && this.place.lat === place.lat && this.place.lon === place.lon;
    if (!force && samePlace && Date.now() - this.fetchedAt < REFRESH_MS - 30_000) return;
    if (this.loading || !IS_TAURI) return;
    this.loading = true;
    if (!samePlace) this.raw = null;
    this.place = place;
    try {
      this.raw = await Bridge.weatherGet(place.lat, place.lon);
      this.fetchedAt = Date.now();
      this.error = null;
    } catch (e) {
      this.error = String(e instanceof Error ? e.message : e);
    } finally {
      this.loading = false;
      for (const l of this.listeners) l();
    }
  },

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  },
};

export const WEATHER_REFRESH_MS = REFRESH_MS;
