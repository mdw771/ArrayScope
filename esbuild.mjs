import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const common = {
  bundle: true,
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  }),
  esbuild.context({
    ...common,
    entryPoints: ["src/webview/index.tsx"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: ["chrome120"],
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  esbuild.context({
    ...common,
    entryPoints: ["src/webview/styles.css"],
    outfile: "dist/webview.css",
    loader: { ".css": "css" },
  }),
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching extension and webview sources...");
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
