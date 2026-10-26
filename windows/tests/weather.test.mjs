// 어흥이's weather pill (src/study/weather.ts): Open-Meteo's answer in words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, dustGrade, summarize, wearTip } from "../src/study/weather.ts";

const pad = (n) => String(n).padStart(2, "0");

/** An answer shaped like weather_get's, for the day of `now`, rain from `wetFrom` to `wetTo` (hours). */
function sample(now, { code = 2, temp = 12, feels = 10, wetFrom = -1, wetTo = -1, pm10 = 40, pm25 = 20 } = {}) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = [], t2 = [], prob = [], mm = [], codes = [];
  for (let i = 0; i < 48; i++) {
    const t = new Date(d0.getTime() + i * 3600e3);
    time.push(`${day(t)}T${pad(t.getHours())}:00`);
    const wet = i >= wetFrom && i <= wetTo;
    t2.push(temp); prob.push(wet ? 80 : 5); mm.push(wet ? 1 : 0); codes.push(wet ? 61 : 1);
  }
  return {
    forecast: {
      current: { temperature_2m: temp, apparent_temperature: feels, weather_code: code, is_day: 1, precipitation: 0 },
      hourly: { time, temperature_2m: t2, precipitation_probability: prob, precipitation: mm, weather_code: codes },
      daily: { time: [day(d0)], temperature_2m_max: [temp + 3], temperature_2m_min: [temp - 6] },
    },
    air: { current: { pm10, pm2_5: pm25 } },
  };
}

test("WMO codes read as Korean words", () => {
  assert.equal(describe(0).text, "맑음");
  assert.equal(describe(0, false).icon, "🌙");
  assert.equal(describe(63).text, "비");
  assert.equal(describe(73).text, "눈");
  assert.equal(describe(95).text, "뇌우");
});

test("미세먼지 grades follow 환경부's bands", () => {
  assert.equal(dustGrade("pm10", 30).text, "좋음");
  assert.equal(dustGrade("pm10", 81).text, "나쁨");
  assert.equal(dustGrade("pm25", 36).text, "나쁨");
  assert.equal(dustGrade("pm25", 76).text, "매우 나쁨");
  assert.equal(dustGrade("pm10", null), null);
});

test("rain later today: when, and the umbrella", () => {
  const now = new Date("2026-10-26T10:20");
  const s = summarize(sample(now, { wetFrom: 15, wetTo: 18 }), now);
  assert.equal(s.temp, 12);
  assert.equal(s.max, 15);
  assert.equal(s.min, 6);
  assert.match(s.rain, /^15시쯤부터 비 소식 \(80%\)$/);
  assert.equal(s.umbrella, true);
  assert.match(s.tip, /우산/);
  assert.equal(s.hours.length, 4);
});

test("dry day, and rain that only starts tomorrow", () => {
  const now = new Date("2026-10-26T10:20");
  const dry = summarize(sample(now), now);
  assert.match(dry.rain, /비 소식 없어/);
  assert.equal(dry.umbrella, false);
  const tomorrow = summarize(sample(now, { wetFrom: 26, wetTo: 28 }), now);
  assert.match(tomorrow.rain, /^내일 2시쯤부터 비/);
  assert.equal(tomorrow.umbrella, false);
});

test("raining now, and when it stops", () => {
  const now = new Date("2026-10-26T10:20");
  const s = summarize(sample(now, { code: 63, wetFrom: 0, wetTo: 13 }), now);
  assert.match(s.rain, /^지금 비 와\. 14시쯤 그칠 것 같아$/);
  assert.equal(s.umbrella, true);
});

test("what to wear", () => {
  assert.match(wearTip(-8, 0, -10, false, 20, 10), /패딩/);
  assert.match(wearTip(9, 16, 4, false, 20, 10), /일교차/);
  assert.match(wearTip(20, 22, 15, false, 20, 10), /좋은 날씨/);
  assert.match(wearTip(20, 22, 15, false, 120, 10), /마스크/);
});

test("nothing usable gives no summary", () => {
  assert.equal(summarize(null, new Date()), null);
  assert.equal(summarize({ forecast: {} }, new Date()), null);
});
