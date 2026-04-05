import { writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import TurndownService from "turndown";
import { parseHTML } from "linkedom";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function buildFrontmatter(url: string, title: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nsource_url: ${url}\ntitle: ${title}\nfetched: ${date}\n---`;
}

function extractArticleContent(html: string): { title: string; content: string } {
  const { document } = parseHTML(html);

  const article =
    document.querySelector("article") ||
    document.querySelector('[role="main"]') ||
    document.querySelector("main") ||
    document.querySelector(".post-content") ||
    document.querySelector(".entry-content") ||
    document.body;

  const titleEl =
    document.querySelector("h1") ||
    document.querySelector("title");
  const title = titleEl?.textContent?.trim() || "Untitled";

  const removeSelectors = ["script", "style", "nav", "footer", "header", "aside", ".sidebar", ".comments"];
  for (const selector of removeSelectors) {
    for (const el of article!.querySelectorAll(selector)) {
      el.remove();
    }
  }

  const content = article?.innerHTML || "";
  return { title, content };
}

async function downloadImage(url: string, outputDir: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = basename(new URL(url).pathname) || "image.png";
    const outputPath = join(outputDir, filename);
    writeFileSync(outputPath, buffer);
    return filename;
  } catch {
    return null;
  }
}

export async function preprocessUrl(
  url: string,
  outputDir: string,
  imagesDir?: string
): Promise<{ markdownPath: string; title: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();

  const { title, content } = extractArticleContent(html);
  let markdown = htmlToMarkdown(content);

  if (imagesDir) {
    mkdirSync(imagesDir, { recursive: true });
    const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];
    for (const match of matches) {
      const [fullMatch, alt, imageUrl] = match;
      const localFilename = await downloadImage(imageUrl, imagesDir);
      if (localFilename) {
        markdown = markdown.replace(fullMatch, `![${alt}](../images/${localFilename})`);
      }
    }
  }

  const frontmatter = buildFrontmatter(url, title);
  const fullContent = `${frontmatter}\n\n${markdown}\n`;
  const filename = `${slugifyTitle(title)}.md`;
  const outputPath = join(outputDir, filename);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, fullContent);

  return { markdownPath: outputPath, title };
}

// CLI entry point
const [, , urlArg, outputDirArg, imagesDirArg] = process.argv;
if (urlArg && outputDirArg) {
  preprocessUrl(urlArg, outputDirArg, imagesDirArg)
    .then(({ markdownPath, title }) => {
      console.log(JSON.stringify({ markdownPath, title }));
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
