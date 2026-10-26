// Dev harness: 어흥이's app icon, drawn by the real engine. Not part of the bundle.
import { BotEngine } from "../src/mochi/engine";
const size = Number(new URLSearchParams(location.search).get("s") ?? 512);
const cv = document.getElementById("c") as HTMLCanvasElement;
cv.width = cv.height = size;
const e = new BotEngine();
e.setState("idle", true);
e.setOutfit("none" as never, false);
for (let i = 0; i < 120; i++) e.update(1 / 60);
e.open = 1;
const x = cv.getContext("2d")!;
// The engine draws the body at ~68% of its box and leaves room for the ears above.
const box = size * 1.22;
x.translate((size - box) / 2, (size - box) / 2 + size * 0.07);
e.draw(x, box, box);
(window as any).done = true;
