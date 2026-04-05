import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
// @ts-expect-error pdf-parse has no type declarations
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

type DocType = "pdf" | "docx" | "pptx" | "unknown";

export function detectDocType(filename: string): DocType {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf": return "pdf";
    case ".docx": return "docx";
    case ".pptx": return "pptx";
    default: return "unknown";
  }
}

export function buildDocFrontmatter(sourcePath: string, docType: DocType): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nsource_file: ${sourcePath}\ndoc_type: ${docType}\nconverted: ${date}\n---`;
}

async function convertPdf(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text.trim();
}

async function convertDocx(filePath: string): Promise<string> {
  const result = await mammoth.convertToMarkdown({ path: filePath });
  return result.value.trim();
}

async function convertPptx(filePath: string): Promise<string> {
  const { execSync } = await import("node:child_process");
  try {
    const output = execSync(`pandoc "${filePath}" -t markdown --wrap=none`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    return output.trim();
  } catch {
    return `_PPTX conversion requires pandoc. Install it with: brew install pandoc (macOS) or apt install pandoc (Linux)_\n\n_Original file: ${basename(filePath)}_`;
  }
}

export async function preprocessDocument(
  filePath: string,
  outputDir: string
): Promise<{ markdownPath: string; docType: DocType }> {
  const docType = detectDocType(filePath);
  if (docType === "unknown") {
    throw new Error(`Unsupported document type: ${extname(filePath)}`);
  }

  let content: string;
  switch (docType) {
    case "pdf":
      content = await convertPdf(filePath);
      break;
    case "docx":
      content = await convertDocx(filePath);
      break;
    case "pptx":
      content = await convertPptx(filePath);
      break;
  }

  const frontmatter = buildDocFrontmatter(filePath, docType);
  const fullContent = `${frontmatter}\n\n${content}\n`;
  const mdFilename = basename(filePath, extname(filePath)) + ".md";
  const outputPath = join(outputDir, mdFilename);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, fullContent);

  return { markdownPath: outputPath, docType };
}

// CLI entry point
const [, , fileArg, outputDirArg] = process.argv;
if (fileArg && outputDirArg) {
  preprocessDocument(fileArg, outputDirArg)
    .then(({ markdownPath, docType }) => {
      console.log(JSON.stringify({ markdownPath, docType }));
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
