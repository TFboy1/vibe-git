import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const folder = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(folder, "../vibe-git/apps/web");
const built = path.join(web, "review-dist");
const html = await readFile(path.join(built, "review.html"), "utf8");
const jsPath = /src="(\/assets\/[^\"]+\.js)"/.exec(html)?.[1];
const cssPath = /href="(\/assets\/[^\"]+\.css)"/.exec(html)?.[1];
if (!jsPath || !cssPath) throw new Error("Review bundle is incomplete");
const logo = `data:image/png;base64,${(await readFile(path.join(web, "public/vibe-git-logo.png"))).toString("base64")}`;
const script = (await readFile(path.join(built, jsPath.slice(1)), "utf8"))
  .replaceAll("/vibe-git-logo.png", logo).replaceAll("</script", "<\\/script");
const style = (await readFile(path.join(built, cssPath.slice(1)), "utf8"))
  .replaceAll("/vibe-git-logo.png", logo).replaceAll("</style", "<\\/style");
const output = html
  .replace(`<script type="module" crossorigin src="${jsPath}"></script>`, () => `<script type="module">${script}</script>`)
  .replace(`<link rel="stylesheet" crossorigin href="${cssPath}">`, () => `<style>${style}</style>`);
const external = output.match(/\b(?:src|href)="\/assets\/[^\"]+"|url\(\/?vibe-git-logo\.png\)/);
if (external) throw new Error(`Standalone review page has an external asset at ${external.index}: ${output.slice(external.index - 100, external.index + 120)}`);
// Keep credentials and local-only data adapters out of the production bundle.
const entry = await readFile(path.join(web, "src/review-main.tsx"), "utf8");
if (entry.indexOf("installReviewApi();") < 0 || entry.indexOf("installReviewApi();") > entry.indexOf("ReactDOM.createRoot")) throw new Error("Local data transport must be installed before rendering");
if (/\b(?:src|href)=["'](?:https?:|\/assets\/)/.test(output)) throw new Error("Standalone file must not load remote assets");
const target = path.join(folder, "agents-product-plan-mock.html");
await writeFile(target, output, "utf8");
process.stdout.write(`${target}\n${Buffer.byteLength(output)} bytes\n`);
