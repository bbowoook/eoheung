// 어흥이 — the tiger's markings, drawn over the round body the engine already has.
//
// Everything that turns with the head (stripes, the 王 on the forehead, the white
// muzzle, nose, whiskers) is placed on the same sphere as the eyes, so it follows
// the cursor and rolls with him exactly like Mochi's eyes did. The ears sit behind
// the body. Colours are those of a Korean folk-painting (민화) tiger.

export const TIGER = {
  top: [0.953, 0.565, 0.235] as const, // #F39040
  bottom: [0.835, 0.384, 0.118] as const, // #D5621E
  ink: "#1F1612",
  cream: "#FFF3E3",
  iris: "#F2C230",
  nose: "#C96A5B",
  earInner: "#FFE2CC",
};

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
    const a = sd * 0.66 + headYaw;
    const ex = Math.sin(a) * rx * 0.92;
    const ey = -ry * 0.9;
    const r = R * (mini ? 0.36 : 0.33);
    const squash = Math.max(0.45, Math.abs(Math.cos(a * 0.8)));
    x.save();
    x.translate(ex, ey);
    x.scale(squash, 1);
    // Dark back of the ear, the orange rim, a light inside.
    x.fillStyle = TIGER.ink;
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = fill;
    x.beginPath();
    x.arc(0, r * 0.1, r * 0.8, 0, Math.PI * 2);
    x.fill();
    if (!mini) {
      x.fillStyle = TIGER.earInner;
      x.beginPath();
      x.arc(sd * -r * 0.04, r * 0.2, r * 0.42, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }
}

function stroke(x: CanvasRenderingContext2D, P: Project, pts: [number, number][], width: number) {
  const q = pts.map(([a, b]) => P(a, b));
  if (q.every((p) => p.vis <= 0.02)) return;
  x.beginPath();
  q.forEach((p, i) => (i === 0 ? x.moveTo(p.x, p.y) : x.lineTo(p.x, p.y)));
  x.lineWidth = width * Math.min(...q.map((p) => p.fx));
  x.stroke();
}

/** A stripe that starts wide past the edge and narrows to a point on the face. */
function wedge(x: CanvasRenderingContext2D, P: Project, a: [number, number], b: [number, number], tip: [number, number]) {
  const pa = P(...a);
  const pb = P(...b);
  const pt = P(...tip);
  if (pt.vis <= 0.02 && pa.vis <= 0.02) return;
  x.beginPath();
  x.moveTo(pa.x, pa.y);
  x.quadraticCurveTo((pa.x + pt.x) / 2, (pa.y + pt.y) / 2 - (pb.y - pa.y) * 0.2, pt.x, pt.y);
  x.quadraticCurveTo((pb.x + pt.x) / 2, (pb.y + pt.y) / 2 + (pb.y - pa.y) * 0.2, pb.x, pb.y);
  x.closePath();
  x.fill();
}

function blob(x: CanvasRenderingContext2D, P: Project, yaw: number, pitch: number, w: number, h: number) {
  const p = P(yaw, pitch);
  if (p.vis <= 0.02) return;
  x.beginPath();
  x.ellipse(p.x, p.y, w * p.fx, h * p.fy, 0, 0, Math.PI * 2);
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
  x.fillStyle = TIGER.ink;
  x.strokeStyle = TIGER.ink;
  x.lineCap = "round";
  x.lineJoin = "round";

  // Stripes from the sides and the top of the head.
  for (const sd of [-1, 1]) {
    wedge(x, P, [sd * 1.75, 0.2], [sd * 1.75, 0.02], [sd * 0.9, 0.08]);
    wedge(x, P, [sd * 1.75, -0.16], [sd * 1.75, -0.36], [sd * 0.98, -0.25]);
    if (!mini) wedge(x, P, [sd * 1.75, -0.52], [sd * 1.75, -0.68], [sd * 1.14, -0.58]);
    wedge(x, P, [sd * 0.42, 1.5], [sd * 0.66, 1.5], [sd * 0.5, 0.86]);
  }

  // 王 on the forehead.
  const w = R * (mini ? 0.13 : 0.085);
  stroke(x, P, [[-0.16, 0.75], [0.16, 0.75]], w);
  stroke(x, P, [[-0.2, 0.6], [0.2, 0.6]], w);
  stroke(x, P, [[0, 0.83], [0, 0.5]], w);

  if (!mini) {
    // White fur over the eyes, then the muzzle and the cheeks.
    x.fillStyle = TIGER.cream;
    for (const sd of [-1, 1]) blob(x, P, sd * eyeSpread, eyePitch + 0.33, R * 0.15, R * 0.06);
    for (const sd of [-1, 1]) blob(x, P, sd * 0.2, eyePitch - 0.44, R * 0.27, R * 0.21);
    blob(x, P, 0, eyePitch - 0.56, R * 0.2, R * 0.15);

    const nose = P(0, eyePitch - 0.3);
    if (nose.vis > 0.02) {
      const nw = R * 0.11 * nose.fx;
      const nh = R * 0.09 * nose.fy;
      x.fillStyle = TIGER.nose;
      x.beginPath();
      x.moveTo(nose.x - nw, nose.y - nh * 0.5);
      x.lineTo(nose.x + nw, nose.y - nh * 0.5);
      x.quadraticCurveTo(nose.x + nw * 0.8, nose.y + nh * 0.6, nose.x, nose.y + nh * 0.8);
      x.quadraticCurveTo(nose.x - nw * 0.8, nose.y + nh * 0.6, nose.x - nw, nose.y - nh * 0.5);
      x.fill();
    }

    // ω mouth under the nose.
    x.strokeStyle = TIGER.ink;
    const m0 = P(-0.1, eyePitch - 0.5);
    const m1 = P(0, eyePitch - 0.41);
    const m2 = P(0.1, eyePitch - 0.5);
    if (m1.vis > 0.02) {
      x.lineWidth = R * 0.035;
      x.beginPath();
      x.moveTo(m1.x, nose.y + R * 0.07 * nose.fy);
      x.lineTo(m1.x, m1.y);
      x.moveTo(m0.x, m0.y);
      x.quadraticCurveTo((m0.x + m1.x) / 2, m0.y + R * 0.04, m1.x, m1.y);
      x.quadraticCurveTo((m1.x + m2.x) / 2, m2.y + R * 0.04, m2.x, m2.y);
      x.stroke();
    }

    // Whisker dots and whiskers.
    x.fillStyle = TIGER.ink;
    for (const sd of [-1, 1]) {
      blob(x, P, sd * 0.17, eyePitch - 0.42, R * 0.018, R * 0.018);
      blob(x, P, sd * 0.24, eyePitch - 0.5, R * 0.018, R * 0.018);
      x.lineWidth = R * 0.014;
      stroke(x, P, [[sd * 0.3, eyePitch - 0.43], [sd * 0.85, eyePitch - 0.36]], R * 0.014);
      stroke(x, P, [[sd * 0.3, eyePitch - 0.5], [sd * 0.85, eyePitch - 0.54]], R * 0.014);
    }
  }
  x.restore();
}

/** The open eye: a dark rim, an amber iris and a round pupil with a catchlight. */
export function drawTigerEye(x: CanvasRenderingContext2D, w: number, hh: number) {
  x.save();
  x.fillStyle = TIGER.ink;
  x.beginPath();
  x.ellipse(0, 0, w * 0.62, hh * 0.62, 0, 0, Math.PI * 2);
  x.fill();
  if (hh > w * 0.45) {
    x.fillStyle = TIGER.iris;
    x.beginPath();
    x.ellipse(0, 0, w * 0.48, hh * 0.48, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = TIGER.ink;
    x.beginPath();
    x.ellipse(w * 0.03, hh * 0.04, w * 0.24, hh * 0.26, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(w * 0.14, -hh * 0.14, w * 0.09, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

export const rgbCss = (c: readonly [number, number, number], a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
