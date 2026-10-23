#!/usr/bin/env node
// Runs scripts/check_face_rig.py with whichever Python 3 this machine has. On Windows "python3" is
// often the Microsoft Store stub, so try the launcher and "python" too.
//
//   npm run check:rig [-- extra args]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "check_face_rig.py");
const candidates =
  process.platform === "win32"
    ? [["py", "-3"], ["python"], ["python3"]]
    : [["python3"], ["python"]];

function isPython3([cmd, ...pre]) {
  const probe = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0 && /Python 3\./.test(`${probe.stdout}${probe.stderr}`);
}

const python = candidates.find(isPython3);
if (!python) {
  console.error("check:rig needs Python 3 with numpy and Pillow (tried: " + candidates.map((c) => c.join(" ")).join(", ") + ").");
  process.exit(1);
}
const [cmd, ...pre] = python;
const run = spawnSync(cmd, [...pre, script, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(run.status ?? 1);
