// esbuild bundler: src/{content,background}/index.ts -> dist/{content,background}.js
// Both are classic IIFE bundles (no ESM). The service worker is NOT a module
// worker, so it must not use `"type":"module"` — a plain IIFE avoids that.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const dev = process.argv.includes("--dev");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
  // MV3 CSP forbids eval, so dev maps must be external (non-eval) files.
  sourcemap: dev ? "external" : false,
  minify: !dev,
  loader: { ".css": "text" },
};

const entries = [
  { in: "src/content/index.ts", out: "dist/content.js" },
  { in: "src/background/index.ts", out: "dist/background.js" },
];

function copyStatic() {
  mkdirSync("dist", { recursive: true });
  cpSync("manifest.json", "dist/manifest.json");
}

async function run() {
  copyStatic();
  const configs = entries.map((e) => ({
    ...common,
    entryPoints: [e.in],
    outfile: e.out,
  }));

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("esbuild watching…");
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log("build complete -> dist/");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
