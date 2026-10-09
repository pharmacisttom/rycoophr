import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(path + "/" + e.name)
      : /\.(m?js)$/.test(e.name)
        ? [path + "/" + e.name]
        : [],
  );
}
for (const file of ["apps", "packages", "modules", "scripts", "tests"].flatMap(
  files,
)) {
  const r = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (r.status) process.exit(r.status);
}
console.log("JavaScript syntax checks passed");
