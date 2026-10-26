// Dev harness: the tiger in a few states and head turns. Not part of the app bundle.
import { BotEngine, hexToRGB } from "../src/mochi/engine";
import { setTigerStyle } from "../src/mochi/tiger";
setTigerStyle((new URLSearchParams(location.search).get("style") as never) ?? "cub");
const stage = document.getElementById("stage")!;
const params = new URLSearchParams(location.search);
type Cfg = { state?: any; yaw?: number; pitch?: number; eye?: any; mini?: string; size?: number; outfit?: any };
const cfgs: Cfg[] = [
  { state: "idle", size: 260 }, { state: "idle", eye: "happy", size: 260 }, { state: "idle", eye: "line", size: 260 },
  { state: "sleeping" }, { state: "dizzy" }, { state: "idle", eye: "heart" }, { state: "idle", eye: "star" },
  { state: "idle", outfit: params.get("outfit") ?? "witchHat" }, { state: "idle", outfit: "santaHat" },
  { state: "idle", size: 97 }, { mini: "#F39040", size: 40 }, { mini: "#F4505E", size: 40 }, { mini: "#5B8DEF", size: 40 }, { mini: "#34D399", size: 40 }, { mini: "#A78BFA", size: 40 },
];
const items = cfgs.map((c) => {
  const size = c.size ?? 200;
  const cv = document.createElement("canvas");
  cv.width = size * 2; cv.height = size * 2; cv.style.width = cv.style.height = `${size}px`;
  stage.append(cv);
  const e = new BotEngine();
  if (c.mini) { e.isMini = true; e.bodyColor = hexToRGB(c.mini); }
  e.setState(c.state ?? "idle", true);
  if (c.outfit) e.setOutfit(c.outfit, false);
  return { cv, e, c, size };
});
let last = performance.now();
function loop(n: number) {
  const dt = Math.min(0.05, (n - last) / 1000); last = n;
  for (const { cv, e, c, size } of items) {
    if (c.yaw != null) { (e as any).tgYaw = c.yaw; }
    if (c.pitch != null) { (e as any).tgPitch = c.pitch; }
    if (c.eye) { e.eyeOverride = c.eye; e.eyeOverrideUntil = Infinity; }
    e.update(dt);
    const x = cv.getContext("2d")!;
    x.setTransform(2, 0, 0, 2, 0, 0);
    x.clearRect(0, 0, size, size);
    e.draw(x, size, size);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
