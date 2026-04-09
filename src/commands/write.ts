import { parseFrontmatter, stringifyFrontmatter } from "../core/parser.js";
import { CardStore } from "../core/store.js";
import { autoSync } from "../core/sync.js";
import { dirname } from "node:path";

const REQUIRED_FIELDS = ["title", "created", "source"];

interface WriteResult {
  success: boolean;
  error?: string;
}

export async function writeCommand(store: CardStore, slug: string, input: string): Promise<WriteResult> {
  const { data, content } = parseFrontmatter(input);

  const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
  if (missing.length > 0) {
    return { success: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  // Normalize all date fields to YYYY-MM-DD strings
  const today = new Date().toISOString().split("T")[0];
  data.modified = today;
  if (data.created instanceof Date) {
    data.created = data.created.toISOString().split("T")[0];
  }

  const output = stringifyFrontmatter(content, data);
  await store.writeCard(slug, output);
  await autoSync(dirname(store.cardsDir));
  return { success: true };
}
