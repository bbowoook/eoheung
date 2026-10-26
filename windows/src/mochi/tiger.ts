// 어흥이 — the tiger's markings, drawn over the round body the engine already has.
//
// Drawn from photographs of Amur and Bengal tigers and a cub, then made round and
// soft: an orange head with a fluffy white ruff (cheeks, muzzle and chin), white
// brows over amber eyes, the dark "tear line" running from each eye, stacked bars
// on the forehead, stripes from the temples and across the white cheeks, round
// ears with a dark rim and white fur inside, a pink nose, and whiskers that reach
// past the face.
//
// Everything that turns with the head is placed on the same sphere as the eyes,
// so it follows the cursor and rolls with him exactly like Mochi's eyes did.

export const TIGER = {
  top: [0.957, 0.6, 0.255] as const, // #F49941
  bottom: [0.847, 0.408, 0.133] as const, // #D86822
  ink: "#231812",
  cream: "#FFF8F0",
  iris: "#EFB53C",
  irisDeep: "#C8841E",
  nose: "#E9918C",
  noseRim: "#B8615C",
  earInner: "#FFF3E8",
  blush: "rgba(255,138,128,0.32)",
};

/**
 * The two looks to choose between: "classic" follows the photos closely (full
 * stripes, a long white ruff); "cub" is the baby version — bigger eyes, fewer and
 * softer stripes, rosier cheeks.
 */
export type TigerStyle = "classic" | "cub";
let style: TigerStyle = "cub";
export function setTigerStyle(next: TigerStyle) {
  style = next;
}
export function tigerStyle(): TigerStyle {
  return style;
}
/** How much bigger than Mochi's the open eyes are drawn. */
export function eyeScale(): number {
  return style === "cub" ? 1.34 : 1.18;
}

/** A point on the head: where it lands on the body, and whether it faces us. */
export interface Projected {
  x: number;
  y: number;
  /** > 0 when the point faces the viewer. */
  vis: number;
  /** Foreshortening across and down. */
  fx: number;
  fy: number;
}

/** yaw (radians, + to his left on screen) and pitch (+ up) on the head → the body plane. */
export type Project = (yaw: number, pitch: number) => Projected;

/** Builds the projector the engine's eyes use, for a head turned by `yaw`/`pitch`. */
export function projector(rx: number, ry: number, headYaw: number, headPitch: number): Project {
  return (yaw, pitch) => {
    const a = yaw + headYaw;
    const p = pitch + headPitch;
    const cp = Math.cos(p);
    return {
      x: Math.sin(a) * cp * rx,
      y: -Math.sin(p) * ry,
      vis: Math.cos(a) * cp,
      fx: Math.max(0.18, Math.cos(a)),
      fy: Math.max(0.18, cp),
    };
  };
}

/** The two round ears behind the head, at the top, turning with it. */
export function drawEars(
  x: CanvasRenderingContext2D, rx: number, ry: number, R: number, headYaw: number,
  fill: string | CanvasGradient, mini: boolean,
) {
  for (const sd of [-1, 1]) {
    const a = sd * 0.62 + headYaw;
    const ex = Math.sin(a) * rx * 0.9;
    const ey = -ry * 0.88;
    const r = R * (mini ? 0.36 : 0.32);
    const squash = Math.max(0.45, Math.abs(Math.cos(a * 0.8)));
    x.save();
    x.translate(ex, ey);
    x.scale(squash, 1);
    // A dark rim (the back of the ear shows round its edge), the orange ear,
    // and the white fur inside, fluffier towards the head.
    x.fillStyle = TIGER.ink;
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = fill;
    x.beginPath();
    x.arc(0, r * 0.08, r * 0.82, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = TIGER.earInner;
    x.beginPath();
    x.arc(-sd * r * 0.05, r * 0.22, r * (mini ? 0.38 : 0.5), 0, Math.PI * 2);
    x.fill();
    if (!mini) {
      // Tufts of white fur poking out of the ear.
      x.beginPath();
      for (const k of [-0.32, 0, 0.32]) {
        const tx = -sd * r * 0.05 + k * r;
        x.moveTo(tx - r * 0.12, r * 0.05);
        x.lineTo(tx, -r * 0.22);
        x.lineTo(tx + r * 0.12, r * 0.05);
      }
      x.fill();
    }
    x.restore();
  }
}

function blob(x: CanvasRenderingContext2D, P: Project, yaw: number, pitch: number, w: number, h: number, rot = 0) {
  const p = P(yaw, pitch);
  if (p.vis <= 0.02) return;
  x.beginPath();
  x.ellipse(p.x, p.y, w * p.fx, h * p.fy, rot, 0, Math.PI * 2);
  x.fill();
}

/** A stripe: wide at `a`/`b`, narrowing to a point at `tip`, gently curved. */
function wedge(
  x: CanvasRenderingContext2D, P: Project, a: [number, number], b: [number, number], tip: [number, number], bend = 0.2,
) {
  const pa = P(...a);
  const pb = P(...b);
  const pt = P(...tip);
  if (pt.vis <= 0.02 && pa.vis <= 0.02) return;
  const dy = pb.y - pa.y;
  const dx = pb.x - pa.x;
  x.beginPath();
  x.moveTo(pa.x, pa.y);
  x.quadraticCurveTo((pa.x + pt.x) / 2 - dx * bend, (pa.y + pt.y) / 2 - dy * bend, pt.x, pt.y);
  x.quadraticCurveTo((pb.x + pt.x) / 2 + dx * bend, (pb.y + pt.y) / 2 + dy * bend, pb.x, pb.y);
  x.closePath();
  x.fill();
}

/** A short bar across the forehead, thick in the middle and pointed at both ends. */
function bar(x: CanvasRenderingContext2D, P: Project, yaw: number, pitch: number, half: number, thick: number) {
  const l = P(yaw - half, pitch);
  const r = P(yaw + half, pitch - thick * 0.25);
  const top = P(yaw, pitch + thick);
  const bot = P(yaw, pitch - thick * 0.9);
  if (top.vis <= 0.02) return;
  x.beginPath();
  x.moveTo(l.x, l.y);
  x.quadraticCurveTo(top.x, top.y, r.x, r.y);
  x.quadraticCurveTo(bot.x, bot.y, l.x, l.y);
  x.fill();
}

/**
 * The markings, inside the body (the caller has clipped to it). `alpha` fades them
 * out while he turns into a box for a dropped file.
 */
export function drawMarkings(
  x: CanvasRenderingContext2D, P: Project, R: number, eyePitch: number, eyeSpread: number,
  alpha: number, mini: boolean,
) {
  if (alpha <= 0.01) return;
  x.save();
  x.globalAlpha *= alpha;
  x.lineCap = "round";
  x.lineJoin = "round";
  const ep = eyePitch;

  // ── The white ruff: cheeks, muzzle and chin, scalloped at its edge ──
  x.fillStyle = TIGER.cream;
  if (!mini) {
    for (const sd of [-1, 1]) {
      blob(x, P, sd * 0.58, ep - 0.31, R * 0.5, R * 0.33);
      blob(x, P, sd * 1.18, ep - 0.36, R * 0.34, R * 0.3);
      // White under the eyes, soft-edged.
      blob(x, P, sd * (eyeSpread + 0.02), ep - 0.13, R * 0.2, R * 0.12);
    }
    blob(x, P, 0, ep - 0.42, R * 0.44, R * 0.3);
    blob(x, P, 0, ep - 0.68, R * 0.4, R * 0.24);
  } else {
    blob(x, P, 0, ep - 0.55, R * 0.5, R * 0.26);
  }

  // ── Stripes ──
  x.fillStyle = TIGER.ink;
  for (const sd of [-1, 1]) {
    // From the temples towards the eyes.
    wedge(x, P, [sd * 1.75, 0.3], [sd * 1.75, 0.12], [sd * 0.92, 0.2]);
    wedge(x, P, [sd * 1.75, 0.0], [sd * 1.75, -0.12], [sd * 1.08, -0.04]);
    // Across the white cheeks, pointing at the nose.
    if (!mini && style === "classic") {
      wedge(x, P, [sd * 1.75, ep - 0.3], [sd * 1.75, ep - 0.4], [sd * 0.78, ep - 0.36], 0.15);
      wedge(x, P, [sd * 1.75, ep - 0.5], [sd * 1.75, ep - 0.6], [sd * 0.9, ep - 0.56], 0.15);
    }
    // From the crown down.
    wedge(x, P, [sd * 0.34, 1.5], [sd * 0.52, 1.5], [sd * 0.4, 0.86]);
    if (style === "classic") wedge(x, P, [sd * 0.78, 1.45], [sd * 0.94, 1.4], [sd * 0.78, 0.72]);
  }
  // Stacked bars on the forehead, the tiger's "王", softened.
  const s = mini ? 1.35 : 1;
  bar(x, P, 0, 0.76, 0.08 * s, 0.03 * s);
  bar(x, P, -0.01, 0.65, 0.13 * s, 0.038 * s);
  bar(x, P, 0.01, 0.53, 0.18 * s, 0.045 * s);
  if (!mini) {
    // Short strokes either side of the bars, as on the photos' foreheads.
    if (style === "classic") for (const sd of [-1, 1]) wedge(x, P, [sd * 0.26, 0.82], [sd * 0.33, 0.8], [sd * 0.22, 0.52], 0.1);
  }

  if (!mini) {
    // White brows over the eyes, tilted up at the outside.
    x.fillStyle = TIGER.cream;
    for (const sd of [-1, 1]) blob(x, P, sd * (eyeSpread + 0.03), ep + 0.34, R * 0.16, R * 0.075, sd * -0.18);

    // The dark tear line from the inner corner of each eye down the face.
    x.fillStyle = TIGER.ink;
    for (const sd of style === "classic" ? [-1, 1] : []) {
      wedge(x, P, [sd * (eyeSpread - 0.17), ep - 0.06], [sd * (eyeSpread - 0.08), ep - 0.12], [sd * (eyeSpread - 0.22), ep - 0.36], 0.1);
    }

    // A little blush on the white cheeks.
    x.fillStyle = TIGER.blush;
    if (style === "cub") x.fillStyle = "rgba(255,128,120,0.45)";
    for (const sd of [-1, 1]) blob(x, P, sd * 0.58, ep - 0.3, R * (style === "cub" ? 0.16 : 0.13), R * (style === "cub" ? 0.09 : 0.075));

    // The nose: pink, rounded, with a darker rim and a shine.
    const nose = P(0, ep - 0.3);
    if (nose.vis > 0.02) {
      const nw = R * 0.13 * nose.fx;
      const nh = R * 0.1 * nose.fy;
      x.beginPath();
      x.moveTo(nose.x - nw, nose.y - nh * 0.55);
      x.quadraticCurveTo(nose.x, nose.y - nh * 0.85, nose.x + nw, nose.y - nh * 0.55);
      x.quadraticCurveTo(nose.x + nw * 0.85, nose.y + nh * 0.55, nose.x, nose.y + nh * 0.85);
      x.quadraticCurveTo(nose.x - nw * 0.85, nose.y + nh * 0.55, nose.x - nw, nose.y - nh * 0.55);
      x.fillStyle = TIGER.nose;
      x.fill();
      x.strokeStyle = TIGER.noseRim;
      x.lineWidth = R * 0.022;
      x.stroke();
      x.fillStyle = "rgba(255,255,255,0.55)";
      x.beginPath();
      x.ellipse(nose.x - nw * 0.3, nose.y - nh * 0.3, nw * 0.22, nh * 0.18, -0.3, 0, Math.PI * 2);
      x.fill();
    }

    // ω mouth under the nose.
    x.strokeStyle = TIGER.ink;
    const m0 = P(-0.11, ep - 0.5);
    const m1 = P(0, ep - 0.43);
    const m2 = P(0.11, ep - 0.5);
    if (m1.vis > 0.02) {
      x.lineWidth = R * 0.032;
      x.beginPath();
      x.moveTo(m1.x, nose.y + R * 0.085 * nose.fy);
      x.lineTo(m1.x, m1.y);
      x.moveTo(m0.x, m0.y);
      x.quadraticCurveTo((m0.x + m1.x) / 2, m0.y + R * 0.045, m1.x, m1.y);
      x.quadraticCurveTo((m1.x + m2.x) / 2, m2.y + R * 0.045, m2.x, m2.y);
      x.stroke();
    }

    // Rows of whisker spots on the muzzle.
    x.fillStyle = TIGER.ink;
    for (const sd of [-1, 1]) {
      for (const [yw, pt] of [[0.16, -0.42], [0.23, -0.4], [0.19, -0.49], [0.26, -0.47]] as const) {
        blob(x, P, sd * yw, ep + pt, R * 0.016, R * 0.016);
      }
    }
  }
  x.restore();
}

/**
 * Whiskers, drawn after the clip so they reach past the face. Long, thin and pale
 * like a real tiger's; a dark edge keeps them visible on the white ruff.
 */
export function drawWhiskers(x: CanvasRenderingContext2D, P: Project, R: number, eyePitch: number, alpha: number) {
  if (alpha <= 0.01) return;
  x.save();
  x.globalAlpha *= alpha;
  x.lineCap = "round";
  // The white cheek ruff puffs out past the round face, like a real tiger's.
  x.fillStyle = TIGER.cream;
  for (const sd of [-1, 1]) {
    const edge = P(sd * 1.5, eyePitch - 0.3);
    if (edge.vis < -0.35) continue;
    const ex = edge.x;
    const ey = edge.y;
    x.beginPath();
    x.moveTo(ex - sd * R * 0.12, ey - R * 0.2);
    x.lineTo(ex + sd * R * 0.13, ey - R * 0.08);
    x.lineTo(ex - sd * R * 0.02, ey + R * 0.0);
    x.lineTo(ex + sd * R * 0.16, ey + R * 0.12);
    x.lineTo(ex - sd * R * 0.04, ey + R * 0.16);
    x.lineTo(ex + sd * R * 0.08, ey + R * 0.3);
    x.lineTo(ex - sd * R * 0.2, ey + R * 0.26);
    x.closePath();
    x.fill();
  }
  for (const sd of [-1, 1]) {
    const root = P(sd * 0.3, eyePitch - 0.42);
    if (root.vis <= 0.05) continue;
    for (const [dy, len, bend] of [[-0.05, 0.78, -0.05], [0.07, 0.7, 0.06]] as const) {
      const x0 = root.x;
      const y0 = root.y + dy * R;
      const x1 = x0 + sd * len * R * root.fx;
      const y1 = y0 + dy * R * 1.6 + bend * R;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2 - R * 0.06;
      for (const [w, c] of [[R * 0.03, "rgba(35,24,18,0.45)"], [R * 0.016, "#FFFDF8"]] as const) {
        x.strokeStyle = c;
        x.lineWidth = w;
        x.beginPath();
        x.moveTo(x0, y0);
        x.quadraticCurveTo(cx, cy, x1, y1);
        x.stroke();
      }
    }
  }
  x.restore();
}

/** The open eye: a dark rim, an amber iris deepening at its edge, a round pupil and two catchlights. */
export function drawTigerEye(x: CanvasRenderingContext2D, w: number, hh: number) {
  x.save();
  x.fillStyle = TIGER.ink;
  x.beginPath();
  x.ellipse(0, 0, w * 0.64, hh * 0.64, 0, 0, Math.PI * 2);
  x.fill();
  if (hh > w * 0.45) {
    x.fillStyle = TIGER.irisDeep;
    x.beginPath();
    x.ellipse(0, 0, w * 0.52, hh * 0.52, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = TIGER.iris;
    x.beginPath();
    x.ellipse(0, hh * 0.04, w * 0.44, hh * 0.44, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = TIGER.ink;
    x.beginPath();
    x.ellipse(w * 0.02, hh * 0.04, w * 0.27, hh * 0.29, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(w * 0.16, -hh * 0.16, w * 0.12, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.arc(-w * 0.14, hh * 0.18, w * 0.05, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

export const rgbCss = (c: readonly [number, number, number], a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
