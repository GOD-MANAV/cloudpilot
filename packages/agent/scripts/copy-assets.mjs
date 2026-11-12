import { cpSync } from "node:fs";
cpSync(new URL("../src/inject", import.meta.url), new URL("../dist/inject", import.meta.url), {
  recursive: true,
  filter: (p) => !p.endsWith(".ts"),
});
