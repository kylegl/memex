import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AGENTS_SECTION = `## Memory (memex)

- **Task start**: Call memex_recall to retrieve relevant prior knowledge
- **Task end**: Call memex_retro to save non-obvious insights
`;

interface InitResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function initCommand(dir: string): Promise<InitResult> {
  const filePath = join(dir, "AGENTS.md");

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // file doesn't exist, will create
  }

  if (existing.includes("## Memory (memex)")) {
    return { success: true, output: "AGENTS.md already has memex section. No changes made." };
  }

  const content = existing
    ? existing.trimEnd() + "\n\n" + AGENTS_SECTION
    : AGENTS_SECTION;

  await writeFile(filePath, content, "utf-8");

  return {
    success: true,
    output: existing
      ? "Appended memex section to AGENTS.md."
      : "Created AGENTS.md with memex section.",
  };
}
