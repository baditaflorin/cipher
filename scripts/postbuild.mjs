import { copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const docs = resolve("docs");

copyFileSync(resolve(docs, "index.html"), resolve(docs, "404.html"));
writeFileSync(resolve(docs, ".nojekyll"), "");
