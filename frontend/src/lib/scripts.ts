export interface MigrationStep {
  id: string;
  name: string;
  shortName: string;
  sidebarName: string;
  description: string;
  scriptFile: string;
  npmScript: string;
}

export interface StatCardDef {
  key: string;
  label: string;
  color: string;
}

export const STEPS: MigrationStep[] = [
  {
    id: "export",
    name: "Export WordPress Content",
    shortName: "Export",
    sidebarName: "Export WordPress",
    description: "Fetching all content via the WordPress REST API.",
    scriptFile: "scripts/01-export-poc.js",
    npmScript: "export-poc",
  },
  {
    id: "create-types",
    name: "Create Content Models",
    shortName: "Models",
    sidebarName: "Create Models",
    description: "Create Contentful content types for blog posts, pages, categories, tags, and authors.",
    scriptFile: "scripts/02-create-content-types.js",
    npmScript: "create-types",
  },
  {
    id: "migrate-assets",
    name: "Migrate Assets",
    shortName: "Assets",
    sidebarName: "Migrate Assets",
    description: "Download WordPress media and upload to Contentful as assets.",
    scriptFile: "scripts/03-migrate-assets.js",
    npmScript: "migrate-assets",
  },
  {
    id: "migrate-content",
    name: "Migrate Content",
    shortName: "Content",
    sidebarName: "Migrate Content",
    description: "Migrate posts, pages, categories, tags, and authors to Contentful.",
    scriptFile: "scripts/04-migrate-content.js",
    npmScript: "migrate-content",
  },
  {
    id: "validate",
    name: "Validate Migration",
    shortName: "Validate",
    sidebarName: "Validate",
    description: "Compare WordPress export with Contentful entries and check data integrity.",
    scriptFile: "scripts/05-validate-migration.js",
    npmScript: "validate",
  },
];

export const STEP_STATS: Record<string, StatCardDef[]> = {
  export: [
    { key: "pages", label: "PAGES", color: "blue" },
    { key: "posts", label: "POSTS", color: "amber" },
    { key: "media", label: "MEDIA", color: "emerald" },
    { key: "authors", label: "AUTHORS", color: "purple" },
  ],
  "create-types": [
    { key: "created", label: "CREATED", color: "blue" },
    { key: "existing", label: "EXISTING", color: "slate" },
  ],
  "migrate-assets": [
    { key: "total", label: "TOTAL", color: "slate" },
    { key: "migrated", label: "MIGRATED", color: "emerald" },
    { key: "skipped", label: "SKIPPED", color: "amber" },
    { key: "failed", label: "FAILED", color: "red" },
  ],
  "migrate-content": [
    { key: "pages", label: "PAGES", color: "emerald" },
    { key: "posts", label: "POSTS", color: "amber" },
    { key: "categories", label: "CATEGORIES", color: "blue" },
    { key: "tags", label: "TAGS", color: "slate" },
    { key: "authors", label: "AUTHORS", color: "purple" },
  ],
  validate: [
    { key: "expected", label: "EXPECTED", color: "blue" },
    { key: "migrated", label: "MIGRATED", color: "emerald" },
    { key: "issues", label: "ISSUES", color: "red" },
  ],
};
