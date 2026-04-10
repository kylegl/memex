import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import { stringifyFrontmatter, parseFrontmatter } from "../core/parser.js";
import { CardStore } from "../core/store.js";
import { OrganizationStore, resolveOrganizationFields, type OrganizationProposal, type RoutingRule } from "../core/organization.js";

type SkippedIndex = { slug: string; reason: string };

type ScannedCardInfo = {
  slug: string;
  path: string;
  relativePath: string;
  targetPath: string;
  title: string;
  category: string;
  type?: string;
  project?: string;
  package?: string;
  domain?: string;
  created: string;
  source: string;
  generated: string;
  body: string;
  isGeneratedNavigationIndex: boolean;
  isLegacyGeneratedRootIndex: boolean;
};

type CardLinkRef = {
  linkSlug: string;
  sortKey: string;
};

type FolderNode = {
  childFolders: Set<string>;
  cards: Map<string, string>; // key: link slug, value: sort key
};

type RenderedIndexTarget = {
  slug: string;
  title: string;
  body: string;
};

type RelatedLinkRef = {
  linkSlug: string;
  label: string;
};

export type BuildIndexResult = {
  rootSlug: "index";
  nested: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  skipped: SkippedIndex[];
  mixedModeArtifacts: string[];
};

const NAV_INDEX_GENERATED = "navigation-index";
const ORGANIZE_SOURCE = "organize";

export async function buildIndexCommand(
  store: CardStore,
  options: { memexHome?: string } = {},
): Promise<BuildIndexResult> {
  const nested = store.isNestedSlugsEnabled();
  const scanned = await store.scanAll();
  const cardInfos = await Promise.all(scanned.map((card) => readCardInfo(store, card.slug, card.path)));
  const bySlug = new Map<string, ScannedCardInfo>();

  for (const card of cardInfos) {
    if (!bySlug.has(card.slug)) bySlug.set(card.slug, card);
  }

  let rules: RoutingRule[] = [];
  let proposals: OrganizationProposal[] = [];
  if (options.memexHome) {
    const orgStore = new OrganizationStore(options.memexHome);
    rules = await orgStore.readRules();
    proposals = await orgStore.listProposals();
  }

  const mixedModeArtifacts: string[] = [];
  if (!nested) {
    for (const card of cardInfos) {
      const isNestedIndexPath = card.relativePath.includes("/") && basename(card.relativePath) === "index.md";
      if (isNestedIndexPath && card.isGeneratedNavigationIndex) {
        mixedModeArtifacts.push(card.relativePath.replace(/\.md$/, ""));
      }
    }
    mixedModeArtifacts.sort();
  }

  const targets = nested
    ? buildNestedTargets(cardInfos, rules, proposals)
    : [buildFlatRootTarget(cardInfos, rules, proposals)];

  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const skipped: SkippedIndex[] = [];

  for (const target of targets) {
    const existing = bySlug.get(target.slug);

    if (target.slug.endsWith("/index") && existing && !existing.isGeneratedNavigationIndex) {
      skipped.push({
        slug: target.slug,
        reason: "existing non-generated nested index",
      });
      continue;
    }

    const isRoot = target.slug === "index";
    const canOverwriteRoot = !existing || existing.isGeneratedNavigationIndex || existing.isLegacyGeneratedRootIndex || isRoot;

    if (!canOverwriteRoot) {
      skipped.push({
        slug: target.slug,
        reason: "existing non-generated index",
      });
      continue;
    }

    const today = new Date().toISOString().split("T")[0];
    const createdDate = existing && (existing.isGeneratedNavigationIndex || existing.isLegacyGeneratedRootIndex)
      ? normalizeDate(existing.created, today)
      : today;

    const desiredData = {
      title: target.title,
      created: createdDate,
      modified: today,
      source: ORGANIZE_SOURCE,
      generated: NAV_INDEX_GENERATED,
    };

    const isUnchanged = existing
      ? areManagedIndexContentsEqual(existing, desiredData, target.body)
      : false;

    if (isUnchanged) {
      unchanged.push(target.slug);
      continue;
    }

    const output = stringifyFrontmatter(target.body, desiredData);
    await store.writeCard(target.slug, output);
    if (existing) {
      updated.push(target.slug);
    } else {
      created.push(target.slug);
    }
  }

  created.sort();
  updated.sort();
  unchanged.sort();
  skipped.sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    rootSlug: "index",
    nested,
    created,
    updated,
    unchanged,
    skipped,
    mixedModeArtifacts,
  };
}

async function readCardInfo(store: CardStore, slug: string, path: string): Promise<ScannedCardInfo> {
  const raw = await readFile(path, "utf-8");
  const { data, content } = parseFrontmatter(raw);
  const title = String(data.title || slug);
  const category = String(data.category || "Uncategorized");
  const source = String(data.source || "");
  const generated = String(data.generated || "");
  const relativePath = relative(store.cardsDir, path).replace(/\\/g, "/");

  const isGeneratedNavigationIndex = source === ORGANIZE_SOURCE && generated === NAV_INDEX_GENERATED;
  const isLegacyGeneratedRootIndex = slug === "index"
    && title === "Keyword Index"
    && source === ORGANIZE_SOURCE;

  return {
    slug,
    path,
    relativePath,
    targetPath: `cards/${relativePath}`,
    title,
    category,
    type: typeof data.type === "string" ? data.type : undefined,
    project: typeof data.project === "string" ? data.project : undefined,
    package: typeof data.package === "string" ? data.package : undefined,
    domain: typeof data.domain === "string" ? data.domain : undefined,
    created: toDateString(data.created),
    source,
    generated,
    body: content,
    isGeneratedNavigationIndex,
    isLegacyGeneratedRootIndex,
  };
}

function buildNestedTargets(
  cardInfos: ScannedCardInfo[],
  rules: RoutingRule[],
  proposals: OrganizationProposal[],
): RenderedIndexTarget[] {
  const cardsForNavigation = cardInfos.filter((card) => !isIndexSlug(card.slug) && !isRedirectCard(card));

  const topFolders = new Set<string>();
  const rootCards: CardLinkRef[] = [];

  const titleBySlug = new Map<string, string>();
  for (const card of cardsForNavigation) {
    titleBySlug.set(card.slug, card.title);
  }

  const tree = new Map<string, FolderNode>();

  for (const card of cardsForNavigation) {
    const pathSegments = card.slug.includes("/")
      ? card.slug.split("/").filter(Boolean).slice(0, -1)
      : inferVirtualFolderSegments(card, rules, proposals);

    if (!pathSegments || pathSegments.length === 0) {
      rootCards.push({ linkSlug: card.slug, sortKey: card.slug });
      continue;
    }

    topFolders.add(pathSegments[0]);

    const parentFolder = pathSegments.join("/");
    addCardToFolder(tree, parentFolder, {
      linkSlug: card.slug,
      sortKey: card.slug,
    });

    for (let i = 1; i <= pathSegments.length; i += 1) {
      const folder = pathSegments.slice(0, i).join("/");
      ensureFolder(tree, folder);
      if (i > 1) {
        const parent = pathSegments.slice(0, i - 1).join("/");
        ensureFolder(tree, parent).childFolders.add(folder);
      }
    }
  }

  const targets: RenderedIndexTarget[] = [];
  const topLevelFolders = [...topFolders].sort();

  targets.push({
    slug: "index",
    title: "Keyword Index",
    body: renderRootNestedBody(topLevelFolders, sortCardRefs(rootCards), titleBySlug),
  });

  for (const folder of [...tree.keys()].sort()) {
    const node = tree.get(folder)!;
    const childFolders = [...node.childFolders].sort();
    const cards = sortCardRefs(
      [...node.cards.entries()].map(([linkSlug, sortKey]) => ({ linkSlug, sortKey })),
    );
    targets.push({
      slug: `${folder}/index`,
      title: `${titleCase(lastSegment(folder))} Index`,
      body: renderNestedFolderBody(childFolders, cards, titleBySlug, buildRelatedLinks(folder, titleBySlug, proposals)),
    });
  }

  return targets;
}

function buildFlatRootTarget(
  cardInfos: ScannedCardInfo[],
  rules: RoutingRule[],
  proposals: OrganizationProposal[],
): RenderedIndexTarget {
  const cards = cardInfos
    .filter((card) => card.slug !== "index" && !isRedirectCard(card))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const categoryMap = new Map<string, string[]>();
  for (const card of cards) {
    const resolution = resolveOrganizationFields(card.targetPath, {
      type: card.type,
      project: card.project,
      package: card.package,
      domain: card.domain,
    }, rules, proposals);
    const category = resolution.type || card.category || "Uncategorized";
    const list = categoryMap.get(category) ?? [];
    list.push(card.slug);
    categoryMap.set(category, list);
  }

  const categories = [...categoryMap.keys()].sort((a, b) => {
    const isAUncategorized = a === "Uncategorized";
    const isBUncategorized = b === "Uncategorized";
    if (isAUncategorized && !isBUncategorized) return 1;
    if (!isAUncategorized && isBUncategorized) return -1;
    return a.localeCompare(b);
  });

  const titleBySlug = new Map<string, string>();
  for (const card of cards) {
    titleBySlug.set(card.slug, card.title);
  }

  const sections: string[] = [];
  for (const category of categories) {
    const slugs = (categoryMap.get(category) ?? []).sort();
    sections.push(
      `## ${category}\n${slugs.map((slug) => `- [[${slug}]] — ${titleBySlug.get(slug) || slug}`).join("\n")}`,
    );
  }

  return {
    slug: "index",
    title: "Keyword Index",
    body: sections.join("\n\n"),
  };
}

function renderRootNestedBody(topLevelFolders: string[], rootCards: CardLinkRef[], titleBySlug: Map<string, string>): string {
  const sections: string[] = [];

  if (topLevelFolders.length > 0) {
    sections.push(
      "## Navigation\n" + topLevelFolders
        .map((folder) => `- [[${folder}/index]] — ${titleCase(lastSegment(folder))} Index`)
        .join("\n"),
    );
  }

  if (rootCards.length > 0) {
    sections.push(
      "## Root Cards\n" + rootCards
        .map(({ linkSlug }) => `- [[${linkSlug}]] — ${titleBySlug.get(linkSlug) || linkSlug}`)
        .join("\n"),
    );
  }

  return sections.join("\n\n");
}

function renderNestedFolderBody(
  childFolders: string[],
  cards: CardLinkRef[],
  titleBySlug: Map<string, string>,
  relatedLinks: RelatedLinkRef[] = [],
): string {
  const sections: string[] = [];

  if (childFolders.length > 0) {
    sections.push(
      "## Navigation\n" + childFolders
        .map((folder) => `- [[${folder}/index]] — ${titleCase(lastSegment(folder))} Index`)
        .join("\n"),
    );
  }

  if (cards.length > 0) {
    sections.push(
      "## Cards\n" + cards
        .map(({ linkSlug }) => `- [[${linkSlug}]] — ${titleBySlug.get(linkSlug) || linkSlug}`)
        .join("\n"),
    );
  }

  if (relatedLinks.length > 0) {
    sections.push(
      "## Related\n" + relatedLinks
        .map(({ linkSlug, label }) => `- [[${linkSlug}]] — ${label}`)
        .join("\n"),
    );
  }

  return sections.join("\n\n");
}

function ensureFolder(tree: Map<string, FolderNode>, folder: string): FolderNode {
  const existing = tree.get(folder);
  if (existing) return existing;
  const created: FolderNode = { childFolders: new Set(), cards: new Map() };
  tree.set(folder, created);
  return created;
}

function addCardToFolder(tree: Map<string, FolderNode>, folder: string, ref: CardLinkRef): void {
  const node = ensureFolder(tree, folder);
  const existingSortKey = node.cards.get(ref.linkSlug);
  if (!existingSortKey || ref.sortKey < existingSortKey) {
    node.cards.set(ref.linkSlug, ref.sortKey);
  }
}

function sortCardRefs(cards: CardLinkRef[]): CardLinkRef[] {
  return cards
    .slice()
    .sort((a, b) => {
      if (a.sortKey === b.sortKey) return a.linkSlug.localeCompare(b.linkSlug);
      return a.sortKey.localeCompare(b.sortKey);
    });
}

function inferVirtualFolderSegments(
  card: Pick<ScannedCardInfo, "slug" | "targetPath" | "type" | "project" | "package" | "domain">,
  rules: RoutingRule[],
  proposals: OrganizationProposal[],
): string[] | null {
  const slug = card.slug;
  if (slug.includes("/")) return null;

  const resolved = resolveOrganizationFields(card.targetPath, {
    type: card.type,
    project: card.project,
    package: card.package,
    domain: card.domain,
  }, rules, proposals);

  const resolvedType = sanitizeSegment(resolved.type ?? "");
  const resolvedProject = sanitizeSegment(resolved.project ?? "");
  const resolvedPackage = sanitizeSegment(resolved.package ?? "");
  const resolvedDomain = sanitizeSegment(resolved.domain ?? "");

  if (resolvedType === "core") {
    if (resolvedDomain) return ["core", resolvedDomain];
    return ["core"];
  }

  if (resolvedType === "notes") {
    if (resolvedDomain) return ["notes", resolvedDomain];
    return ["notes"];
  }

  if (resolvedType === "project") {
    if (resolvedProject) return ["project", resolvedProject];
    if (resolvedPackage) return ["project", resolvedPackage];
    return ["project"];
  }

  if (resolvedType === "reference") {
    if (resolvedPackage) return ["reference", resolvedPackage];
    return ["reference"];
  }

  if (resolvedType === "memex" || resolvedType === "pi" || resolvedType === "dawarich") {
    return [resolvedType];
  }

  if (slug.startsWith("home-assistant-da-")) {
    return ["project", "home-assistant-da"];
  }

  if (slug.startsWith("sdge-") && slug.includes("green-button")) {
    return ["project", "home-assistant-da", "sdge", "green-button"];
  }

  if (slug.startsWith("green-button-")) {
    return ["project", "home-assistant-da", "sdge", "green-button"];
  }

  if ((slug.startsWith("sdge-") && slug.includes("patchwright")) || slug.startsWith("patchright-")) {
    return ["reference", "patchright"];
  }

  if (slug.startsWith("sdge-")) {
    return ["project", "home-assistant-da", "sdge"];
  }

  const parts = slug.split("-").filter(Boolean);
  if (parts.length < 2) return null;

  const first = sanitizeSegment(parts[0]);
  if (!first) return null;

  // Prefer stable, compact top-level navigation.
  // Major domains get first-class roots; other flat slugs are grouped under notes/<prefix>.
  if (first === "core" && parts.length >= 2) {
    const second = sanitizeSegment(parts[1]);
    if (second) return ["core", second];
    return ["core"];
  }

  if (first === "notes" && parts.length >= 2) {
    const second = sanitizeSegment(parts[1]);
    if (second) return ["notes", second];
    return ["notes"];
  }

  if (first === "project" && parts.length >= 2) {
    const second = sanitizeSegment(parts[1]);
    if (second) return ["project", second];
    return ["project"];
  }

  if (first === "reference" && parts.length >= 2) {
    const second = sanitizeSegment(parts[1]);
    if (second) return ["reference", second];
    return ["reference"];
  }

  if (first === "pi" || first === "memex" || first === "dawarich") {
    return [first];
  }

  return ["notes", first];
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").trim();
}

function buildRelatedLinks(
  folder: string,
  titleBySlug: Map<string, string>,
  proposals: OrganizationProposal[],
): RelatedLinkRef[] {
  const related: RelatedLinkRef[] = [];

  if (folder === "project/home-assistant-da/sdge") {
    const hasPatchrightCards = [...titleBySlug.keys()].some(
      (slug) => slug.startsWith("patchright-") || (slug.startsWith("sdge-") && slug.includes("patchwright")),
    );

    if (hasPatchrightCards) {
      related.push({
        linkSlug: "reference/patchright/index",
        label: "Patchright reference",
      });
    }
  }

  const proposalLinks = proposals
    .filter((proposal) => proposal.kind === "related-link")
    .filter((proposal) => proposal.status === "approved" || (proposal.status === "pending" && proposal.autoSafe))
    .map((proposal) => proposal.payload ?? {})
    .filter((payload) => payload && typeof payload === "object")
    .map((payload) => ({
      folder: typeof payload.folder === "string" ? payload.folder : "",
      linkSlug: typeof payload.linkSlug === "string" ? payload.linkSlug : "",
      label: typeof payload.label === "string" ? payload.label : "Related",
    }))
    .filter((item) => item.folder === folder && item.linkSlug.length > 0)
    .sort((a, b) => a.linkSlug.localeCompare(b.linkSlug));

  for (const item of proposalLinks) {
    if (!related.some((existing) => existing.linkSlug === item.linkSlug)) {
      related.push({ linkSlug: item.linkSlug, label: item.label });
    }
  }

  return related;
}

function isIndexSlug(slug: string): boolean {
  return slug === "index" || slug.endsWith("/index");
}

function isRedirectCard(card: Pick<ScannedCardInfo, "type">): boolean {
  return typeof card.type === "string" && card.type.trim().toLowerCase() === "redirect";
}

function areManagedIndexContentsEqual(
  existing: ScannedCardInfo,
  desiredData: Record<string, string>,
  desiredBody: string,
): boolean {
  if (existing.source !== desiredData.source) return false;
  if (existing.generated !== desiredData.generated) return false;
  if (normalizeDate(existing.created, "") !== normalizeDate(desiredData.created, "")) return false;
  if (existing.title !== desiredData.title) return false;

  return existing.body.trimEnd() === desiredBody.trimEnd();
}

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return String(value || "");
}

function normalizeDate(value: string, fallback: string): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().split("T")[0];
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function lastSegment(slug: string): string {
  const segments = slug.split("/").filter(Boolean);
  return segments[segments.length - 1] || slug;
}
