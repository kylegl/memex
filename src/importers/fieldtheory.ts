import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "../core/parser.js";
import type { Importer, ImportOptions, ImportResult } from "./index.js";
import { slugify } from "./openclaw.js";

const MAX_TITLE_CHARS = 80;
const MAX_TAGS = 10;

export class FieldTheoryImporter implements Importer {
  name = "fieldtheory";
  description = "Import Field Theory bookmark markdown exports (~/.ft-bookmarks/md/bookmarks/)";
  defaultSourceDir = join(".ft-bookmarks", "md", "bookmarks");

  async run(opts: ImportOptions): Promise<ImportResult> {
    const { store, sourceDir, dryRun = false, onLog = console.log } = opts;
    const files = (await readdir(sourceDir))
      .filter((file) => file.endsWith(".md"))
      .sort();

    let created = 0;
    let skipped = 0;
    const createdSlugs: string[] = [];

    for (const file of files) {
      const slug = buildImporterSlug(store.isNestedSlugsEnabled(), file);
      const existing = await store.resolve(slug);
      if (existing) {
        skipped += 1;
        continue;
      }

      const raw = await readFile(join(sourceDir, file), "utf-8");
      const imported = buildImportedCard(raw, file);
      if (!imported) {
        onLog(`  skip ${file} (missing source_url frontmatter)`);
        continue;
      }

      if (dryRun) {
        onLog(`  [dry-run] would write: ${slug}.md (${imported.title})`);
      } else {
        await store.writeCard(slug, imported.content);
        onLog(`  ✓ ${slug}.md`);
      }

      created += 1;
      createdSlugs.push(slug);
    }

    return { created, skipped, createdSlugs };
  }
}

export function buildImporterSlug(nested: boolean, filename: string) {
  const stem = basename(filename, ".md");
  return nested ? `imports/fieldtheory/${stem}` : `fieldtheory-${stem}`;
}

export function buildImportedCard(raw: string, filename: string) {
  const { data, content } = parseFrontmatter(raw);
  const url = stringValue(data.source_url);
  if (!url) return null;

  const author = stringValue(data.author);
  const postedAt = normalizeDate(data.posted_at);
  const bookmarkedAt = normalizeDate(data.bookmarked_at);
  const categories = normalizeStringList(data.categories);
  const domains = normalizeStringList(data.domains);
  const primaryCategory = stringValue(data.category);
  const primaryDomain = stringValue(data.domain);
  const body = buildImportedBody({
    url,
    author,
    authorName: stringValue(data.author_name),
    postedAt,
    bookmarkedAt,
    primaryCategory,
    primaryDomain,
    categories,
    domains,
    content,
  });

  const created = postedAt || bookmarkedAt || today();
  const title = buildTitle(author, body, filename);
  const tags = buildTags(categories, domains, primaryCategory, primaryDomain);

  const frontmatter: Record<string, unknown> = {
    title,
    created,
    source: "fieldtheory",
    category: "reference",
    tags,
    url,
    tweet_id: stringValue(data.tweet_id),
    author,
    author_name: stringValue(data.author_name),
    posted_at: postedAt || undefined,
    bookmarked_at: bookmarkedAt || undefined,
    fieldtheory_category: primaryCategory || undefined,
    fieldtheory_domain: primaryDomain || undefined,
    fieldtheory_categories: categories.length > 0 ? categories : undefined,
    fieldtheory_domains: domains.length > 0 ? domains : undefined,
    imported_at: today(),
  };

  return {
    title,
    content: stringifyFrontmatter(body, frontmatter),
  };
}

function buildImportedBody(input: {
  url: string;
  author: string;
  authorName: string;
  postedAt: string;
  bookmarkedAt: string;
  primaryCategory: string;
  primaryDomain: string;
  categories: string[];
  domains: string[];
  content: string;
}) {
  const sourceBody = stripAuthorHeading(stripFieldTheorySections(input.content)).trim();
  const lines = [
    "Imported from a Field Theory bookmark export.",
    "Treat this as reference/source material for later distillation into atomic memex cards.",
    "",
    `Original URL: ${input.url}`,
  ];

  if (input.author) lines.push(`Author: ${input.author}`);
  if (input.authorName) lines.push(`Author name: ${input.authorName}`);
  if (input.postedAt) lines.push(`Posted: ${input.postedAt}`);
  if (input.bookmarkedAt) lines.push(`Bookmarked: ${input.bookmarkedAt}`);
  if (input.primaryCategory) lines.push(`Field Theory category: ${input.primaryCategory}`);
  if (input.primaryDomain) lines.push(`Field Theory domain: ${input.primaryDomain}`);
  if (input.categories.length > 0) lines.push(`Field Theory categories: ${input.categories.join(", ")}`);
  if (input.domains.length > 0) lines.push(`Field Theory domains: ${input.domains.join(", ")}`);
  lines.push("", "## Source", sourceBody);

  return lines.join("\n").trim() + "\n";
}

function buildTitle(author: string, body: string, filename: string) {
  const excerpt = extractExcerpt(body) || basename(filename, ".md");
  const prefix = author || "bookmark";
  return truncate(`${prefix} — ${excerpt}`, MAX_TITLE_CHARS);
}

function buildTags(categories: string[], domains: string[], primaryCategory: string, primaryDomain: string) {
  const tags = [
    "fieldtheory",
    "bookmark",
    "x-bookmark",
    ...categories,
    ...domains,
    primaryCategory,
    primaryDomain,
  ]
    .map((value) => slugify(String(value || "")).toLowerCase())
    .filter(Boolean);

  return [...new Set(tags)].slice(0, MAX_TAGS);
}

function stripAuthorHeading(content: string) {
  return content.replace(/^#\s+[^\n]+\n+/, "");
}

function stripFieldTheorySections(content: string) {
  const lines = content.split("\n");
  const kept: string[] = [];
  let skippingRelated = false;

  for (const line of lines) {
    if (/^##\s+Related\s*$/.test(line)) {
      skippingRelated = true;
      continue;
    }
    if (skippingRelated && /^##\s+/.test(line)) {
      skippingRelated = false;
    }
    if (skippingRelated) continue;
    if (/^\[Original tweet\]\(/.test(line)) continue;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

function extractExcerpt(body: string) {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("Imported from a Field Theory") && !line.startsWith("Treat this as reference") && !line.startsWith("Original URL:") && !line.startsWith("Author:") && !line.startsWith("Author name:") && !line.startsWith("Posted:") && !line.startsWith("Bookmarked:") && !line.startsWith("Field Theory ") && !line.startsWith("## "));

  const first = lines[0] || "";
  return truncate(first.replace(/\s+/g, " ").trim(), 60);
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }
  return stringValue(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
