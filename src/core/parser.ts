import matter from "gray-matter";

export interface ParsedCard {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedCard {
  try {
    const { data, content } = matter(raw);
    return { data, content };
  } catch {
    // Frontmatter parse failed (e.g. YAML special chars like # in values).
    // Fall back: treat entire file as content with empty metadata.
    const stripped = raw.replace(/^---[\s\S]*?---\n?/, "");
    return { data: {}, content: stripped || raw };
  }
}

export function stringifyFrontmatter(
  content: string,
  data: Record<string, unknown>
): string {
  // Build YAML manually to avoid gray-matter/js-yaml block scalars (>-)
  // which break simple frontmatter parsers.
  //
  // Arrays are emitted as YAML lists so Obsidian and other frontmatter
  // consumers treat tags and similar fields as structured values instead of
  // one comma-delimited string.
  const yamlLines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      const items = value
        .filter((item) => item !== undefined && item !== null)
        .map((item) => formatScalar(item));

      if (items.length === 0) {
        yamlLines.push(`${key}: []`);
        continue;
      }

      yamlLines.push(`${key}:`);
      for (const item of items) {
        yamlLines.push(`  - ${quoteYamlIfNeeded(item)}`);
      }
      continue;
    }

    yamlLines.push(`${key}: ${quoteYamlIfNeeded(formatScalar(value))}`);
  }
  return `---\n${yamlLines.join("\n")}\n---\n${content}`;
}

function formatScalar(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\n/g, " ").trim();
}

function quoteYamlIfNeeded(value: string): string {
  if (value === "" || /[:#{}[\],&*?|>!%@`']/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return value;
}

export function extractLinks(body: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    links.add(match[1]);
  }
  return [...links];
}
