# WordPress to Contentful Migration Toolkit

A Node.js toolkit for migrating WordPress content to Contentful, featuring a real-time visual dashboard for monitoring and controlling the migration process. Supports posts, pages, categories, tags, authors, and media assets.

## Prerequisites

- Node.js 18+
- A WordPress site with REST API enabled (default in WP 4.7+)
- A Contentful space with Management API access

## Quick Start

### Using the Migration Dashboard (Recommended)

The visual dashboard provides a guided, step-by-step migration experience with real-time progress tracking.

1. **Install dependencies**
   ```bash
   npm install
   cd frontend && npm install
   ```

2. **Start the dashboard**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Open http://localhost:3000** and use the **Configure** screen to enter your WordPress and Contentful credentials.

4. Click **Start Full Migration** to run all steps automatically, or use **Run Step-by-Step** to control each phase individually.

### Dashboard Features

- **Configuration panel** — Enter WordPress API URL, credentials, Contentful space ID, management token, and delivery token through a visual form
- **Step-by-step navigation** — Sidebar shows all migration phases with status indicators (idle, running, complete, error)
- **Real-time stat cards** — Live counters for pages, posts, media, authors, categories, and tags update as items are processed
- **Progress tracking** — Progress bars and percentage indicators for each step
- **Log viewer** — Dark-themed terminal showing real-time script output with color-coded log levels
- **Full migration mode** — One-click to run all five steps sequentially without manual intervention
- **Step-by-step mode** — Run individual steps with a "Run Next Step" button to advance when ready
- **Total elapsed time** — Displayed on the completion banner after all steps finish
- **Stop button** — Cancel any running step at any time

### Using the CLI

You can also run the migration entirely from the command line:

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your WordPress and Contentful credentials
   ```

3. **Run the full migration**
   ```bash
   npm run full-migration
   ```

   Or run each step individually:
   ```bash
   npm run export          # Export WordPress data
   npm run create-types    # Create Contentful content types
   npm run migrate-assets  # Migrate media files
   npm run migrate-content # Migrate posts and pages
   npm run validate        # Validate migration
   ```

### PoC (Proof of Concept) Mode

For a smaller demo migration, the PoC export fetches only the home page (or a set of specified pages/posts) and their referenced media:

```bash
npm run export-poc      # Fetches targeted content directly from WP API
npm run create-types    # Create Contentful content types
npm run migrate-assets  # Migrates only PoC media
npm run migrate-content # Migrates only PoC content
npm run validate        # Validate migration
```

Options (set in `.env`):
- `POC_HOME_SLUG` — Slug of the home/landing page (default: `front-page`)
- `POC_PAGE_SLUGS` — Comma-separated explicit slugs to export (overrides link discovery)
- `POC_MAX_LINKED_PAGES` — Max linked pages to follow from the home page (default: `10`)

The PoC export automatically handles blog-style sites (falls back to recent posts if no pages exist), scrapes live pages when `content.rendered` is empty from the API, resolves lazy-loaded images, and verifies media URLs before including them.

## Project Structure

```
wp-to-contentful/
├── frontend/                      # Next.js migration dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # Dashboard entry point
│   │   │   ├── api/run/route.ts   # SSE endpoint for script execution
│   │   │   └── api/config/route.ts # Read/write .env configuration
│   │   ├── components/
│   │   │   ├── Dashboard.tsx      # Main orchestration component
│   │   │   ├── Sidebar.tsx        # Step navigation sidebar
│   │   │   ├── ConfigPanel.tsx    # Configuration form
│   │   │   ├── StepView.tsx       # Step detail view with stats & logs
│   │   │   └── LogViewer.tsx      # Real-time log terminal
│   │   └── lib/
│   │       ├── scripts.ts         # Step definitions & stat card config
│   │       └── parse-output.ts    # Script output parser for counters
│   └── public/
│       └── contentful-logo.png
├── scripts/
│   ├── 01-export-wordpress.js     # Full WP content export via REST API
│   ├── 01-export-poc.js           # PoC export (targeted pages/posts)
│   ├── 02-create-content-types.js # Creates Contentful content models
│   ├── 03-migrate-assets.js       # Migrates media library
│   ├── 04-migrate-content.js      # Migrates posts, pages, categories
│   ├── 05-validate-migration.js   # Validates migration completeness
│   └── clean-space.js             # Deletes all content from Contentful space
├── lib/
│   └── rich-text-transformer.js   # HTML to Contentful Rich Text conversion
├── data/                           # Generated during migration
│   ├── wp-export.json             # Full WordPress export
│   ├── wp-export-poc.json         # PoC WordPress export
│   ├── asset-map.json             # WP media ID → Contentful asset ID
│   ├── entry-map.json             # WP post/page ID → Contentful entry ID
│   └── validation-report.json     # Migration validation results
├── .env.example
├── .env                           # Your configuration (gitignored)
└── package.json
```

## Configuration

All settings can be configured through the dashboard's **Configure** screen or by editing the `.env` file directly.

### WordPress API

The toolkit uses the WordPress REST API (built into WP 4.7+). For sites that require authentication:

1. Generate an application password in your WordPress user profile (built into WP 5.6+)
2. Set credentials in `.env` or the dashboard:
   ```
   WP_API_URL=https://yoursite.com/wp-json/wp/v2
   WP_USERNAME=your_username
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```

The toolkit sends browser-like HTTP headers to bypass WAF/bot protection on sites like Cloudflare-protected blogs.

### Contentful Tokens

You'll need two types of Contentful tokens:

- **Management Token**: For creating content types, entries, and assets
  - Get from: Settings → API Keys → Content management tokens
- **Delivery Token**: Used by the validation step to verify migrated content
  - Get from: Settings → API Keys → Add API Key

### Migration Options

```
BATCH_SIZE=5              # Items processed in parallel per batch
DELAY_MS=1000             # Delay between batches (rate limiting)
MAX_ASSET_SIZE_MB=500     # Maximum asset file size to download
MIGRATE_VIDEOS=false      # Set to true to include video files
SKIP_ASSET_IDS=           # Comma-separated WP media IDs to skip
```

## Customization

### Adding Custom Post Types

Edit `scripts/01-export-wordpress.js`:

```javascript
const exports = {
  posts: await fetchAllPaginated('posts'),
  pages: await fetchAllPaginated('pages'),
  // Add your custom post types:
  products: await fetchAllPaginated('products'),
  testimonials: await fetchAllPaginated('testimonials'),
  // ...
};
```

### Mapping Custom Fields (ACF)

If using Advanced Custom Fields, the fields are available via the REST API. Modify the content type creation and migration scripts to include your custom fields.

### Handling Shortcodes

The rich text transformer handles basic HTML. For WordPress shortcodes, you have options:

1. **Pre-process**: Run shortcode expansion before export
2. **Transform**: Add handlers in `lib/rich-text-transformer.js`
3. **Strip**: Remove shortcodes and migrate clean content

Example shortcode handler:

```javascript
// In rich-text-transformer.js
processNode(node) {
  // Handle [gallery] shortcode
  if (node.text?.includes('[gallery')) {
    return this.handleGalleryShortcode(node.text);
  }
  // ... rest of processing
}
```

## Cleaning Up

To delete all migrated content from your Contentful space and start fresh:

```bash
npm run clean-space
```

This unpublishes and removes all entries, assets, and content types, and clears local map files. Previous run data (`asset-map.json`, `entry-map.json`, `validation-report.json`) is also automatically cleared when starting a new export.

## Troubleshooting

### 403 Errors from WordPress API

Some WordPress sites (e.g., behind Cloudflare) block API requests that don't look like browser traffic. The toolkit includes browser-like headers to bypass this, but if you still get 403s, try accessing the API URL directly in a browser to confirm it's reachable.

### Rate Limiting

Contentful has API rate limits. If you hit them:
- Increase `DELAY_MS` in `.env`
- Decrease `BATCH_SIZE` in `.env`

### Large Media Files

For sites with many large images:
- Increase `MAX_ASSET_SIZE_MB` and `ASSET_UPLOAD_TIMEOUT_MS`
- Add problematic asset IDs to `SKIP_ASSET_IDS` to bypass them
- The asset map enables resume — re-running skips already-uploaded assets

### Empty Content Fields

WordPress pages using custom PHP templates or page builders often return empty `content.rendered` from the REST API. The PoC export handles this by scraping the live page HTML as a fallback, including resolving lazy-loaded images from `data-src` attributes.

### Rich Text Validation Errors

Contentful Rich Text has strict schema validation. The transformer handles:
- Inline images inside paragraphs (splits into separate block nodes)
- Stray inline nodes at the top level (wraps in paragraphs)
- Lazy-loaded images with `data-src` placeholders
- Empty paragraphs and missing text nodes

Check `data/validation-report.json` for specific entry issues.

## Post-Migration

After migration:

1. **Review content in Contentful** - Spot check entries for formatting issues
2. **Update internal links** - The transformer attempts to convert internal WP links to entry hyperlinks
3. **Set up redirects** - Map old WordPress URLs to new frontend routes
4. **Configure webhooks** - Set up build triggers for your frontend

## License

MIT
