import { writeFileSync, readFileSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { execSync } from "node:child_process";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function buildVideoFrontmatter(sourcePath: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `---\nsource_file: ${sourcePath}\nmedia_type: video\nconverted: ${date}\n---`;
}

export function buildTranscriptMarkdown(
  segments: TranscriptSegment[],
  frames: string[],
  framesDir: string
): string {
  const lines: string[] = [];
  let frameIndex = 0;

  for (const segment of segments) {
    if (frameIndex < frames.length) {
      const frameName = frames[frameIndex];
      const frameTimeMatch = frameName.match(/frame_(\d+)/);
      const frameTime = frameTimeMatch ? parseInt(frameTimeMatch[1]) : -1;

      if (frameTime <= segment.start) {
        lines.push(`![${formatTimestamp(frameTime)}](${framesDir}/${frameName})`);
        lines.push("");
        frameIndex++;
      }
    }

    lines.push(`**[${formatTimestamp(segment.start)}]** ${segment.text}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function extractFrames(videoPath: string, outputDir: string, intervalSeconds: number = 30): string[] {
  mkdirSync(outputDir, { recursive: true });

  try {
    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/${intervalSeconds}" -q:v 2 "${join(outputDir, "frame_%03d.png")}" -y`,
      { encoding: "utf-8", stdio: "pipe", timeout: 300000 }
    );
  } catch (err) {
    throw new Error(
      `ffmpeg failed. Ensure ffmpeg is installed: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Error: ${err}`
    );
  }

  const rawFrames = readdirSync(outputDir).filter((f) => f.startsWith("frame_")).sort();
  const renamedFrames: string[] = [];
  for (let i = 0; i < rawFrames.length; i++) {
    const timeSeconds = i * intervalSeconds;
    const newName = `frame_${String(timeSeconds).padStart(3, "0")}.png`;
    renameSync(join(outputDir, rawFrames[i]), join(outputDir, newName));
    renamedFrames.push(newName);
  }
  return renamedFrames;
}

function transcribeAudio(videoPath: string, outputDir: string): TranscriptSegment[] {
  const audioPath = join(outputDir, "audio.wav");

  try {
    execSync(`ffmpeg -i "${videoPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 300000,
    });

    execSync(
      `whisper "${audioPath}" --output_format json --output_dir "${outputDir}" --model base`,
      { encoding: "utf-8", stdio: "pipe", timeout: 600000 }
    );

    const jsonPath = join(outputDir, "audio.json");
    const whisperOutput = JSON.parse(readFileSync(jsonPath, "utf-8"));
    return whisperOutput.segments.map((s: { start: number; end: number; text: string }) => ({
      start: Math.floor(s.start),
      end: Math.floor(s.end),
      text: s.text.trim(),
    }));
  } catch (err) {
    throw new Error(
      `Transcription failed. Ensure whisper is installed: pip install openai-whisper. Error: ${err}`
    );
  }
}

export async function preprocessVideo(
  videoPath: string,
  outputDir: string,
  frameInterval: number = 30
): Promise<{ markdownPath: string }> {
  const name = basename(videoPath, extname(videoPath));
  const framesDir = join(outputDir, `${name}_frames`);

  const frames = extractFrames(videoPath, framesDir, frameInterval);
  const segments = transcribeAudio(videoPath, outputDir);

  const frontmatter = buildVideoFrontmatter(videoPath);
  const transcript = buildTranscriptMarkdown(segments, frames, `${name}_frames`);
  const fullContent = `${frontmatter}\n\n# ${name}\n\n${transcript}\n`;

  const mdPath = join(outputDir, `${name}.md`);
  writeFileSync(mdPath, fullContent);

  return { markdownPath: mdPath };
}

// CLI entry point
const [, , videoArg, outputDirArg] = process.argv;
if (videoArg && outputDirArg) {
  preprocessVideo(videoArg, outputDirArg)
    .then(({ markdownPath }) => {
      console.log(JSON.stringify({ markdownPath }));
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
