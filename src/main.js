import path from "path";
import extract from "extract-zip";
import { mkdir, open } from "fs/promises";
import { move } from "fs-extra";
import logUpdate from "log-update";
import { rimraf } from "rimraf";

const cwd = process.cwd();

async function checkUpdates(config) {
  if (config.directURL) {
    return {
      url: config.directURL,
    };
  }
  const res = await fetch(config.updateURL, config.fetchOptions);
  const text = await res.text();
  console.log(text);
  const data = JSON.parse(text);
  if (!data?.success) throw new Error(data ? JSON.stringify(data) : "Failed to get latest update.");
  return data.value;
}

async function downloadZip(url, save) {
  const res = await fetch(url);
  const total = +res.headers.get("content-length");
  let current = 0;
  const handle = await open(save, "w+");
  let last = 0;
  let speed = 0;
  const timer = setInterval(() => {
    speed = (current - last) / 5 / 1024;
    last = current;
  }, 5000);
  try {
    await res.body.pipeTo(
      new (class extends WritableStream {
        constructor() {
          super({
            write: async (chunk) => {
              await handle.write(chunk);
              current += chunk.length;
              !!process.env.SHOW_PROGRESS && logUpdate(`\
Current:  ${current.toString().padStart(16)}
Total:    ${total.toString().padStart(16)}
Progress: ${((current * 100) / total).toFixed(4).padStart(16)} %
Speed:    ${speed.toFixed(2).padStart(16)} KB / s
`);
            },
          });
        }
      })()
    );
  } catch (error) {
    console.error(error);
  } finally {
    await handle.close();
    !!process.env.SHOW_PROGRESS && logUpdate.done();
    clearInterval(timer);
  }
}

async function extractZip(zip) {
  const extractDir = path.resolve(cwd, "temp");
  await extract(zip, { dir: extractDir });
}

async function moveCategory(patterns, category) {
  const categoryDir = path.resolve(cwd, "dist", category);
  await mkdir(categoryDir, { recursive: true });
  await Promise.all(
    patterns.map(async (pattern) => {
      const moveSrc = path.resolve(cwd, "temp", pattern);
      const moveDist = path.resolve(categoryDir, pattern);
      await move(moveSrc, moveDist);
    })
  );
}

async function excludeSpecified(patterns, category) {
  await Promise.all(patterns.map((pattern) => rimraf(`dist/${category}/${pattern}`, { glob: true })));
}

async function main() {
  const save = "file.zip";
  const config = JSON.parse(atob(process.env.ZIP_ENV));
  const update = await checkUpdates(config);
  await downloadZip(update.url, save);
  await extractZip(save);
  await moveCategory(config.keepPatterns, config.category);
  await excludeSpecified(config.excludePatterns, config.category);
  console.log("done.");
}

main();
