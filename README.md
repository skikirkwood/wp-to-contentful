# WordPress to Contentful Migration Toolkit

A Node.js toolkit for migrating WordPress content to Contentful, including posts, pages, categories, tags, and media assets.

## Prerequisites

- Node.js 18+
- A WordPress site with REST API enabled (default in WP 4.7+)
- A Contentful space with Management API access

## Quick Start

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

   **PoC (Proof of Concept):** For a smaller demo, filter to home page + linked pages only:
   ```bash
   npm run filter-poc      # Creates wp-export-poc.json (11 pages, ~20 media)
   rm -f data/asset-map.json data/entry-map.json  # Clean slate
   npm run migrate-assets  # Migrates only PoC media
   npm run migrate-content # Migrates only PoC pages
   ```
   Options: `POC_HOME_SLUG=front-page` `POC_PAGE_SLUGS=about,contact` `POC_MAX_MEDIA=50`

## Project Structure

```
wp-to-contentful/
├── scripts/
│   ├── 01-export-wordpress.js    # Exports WP content via REST API
│   ├── 02-create-content-types.js # Creates Contentful content models
│   ├── 03-migrate-assets.js      # Migrates media library
│   ├── 04-migrate-content.js     # Migrates posts, pages, categories
│   └── 05-validate-migration.js  # Validates migration completeness
├── lib/
│   ├── contentful-client.js      # Contentful API wrapper
│   ├── wp-client.js              # WordPress API wrapper
│   └── rich-text-transformer.js  # HTML to Rich Text conversion
├── mappings/
│   └── content-type-mappings.json # Custom field mappings
├── data/                          # Generated during migration
│   ├── wp-export.json            # Raw WordPress export
│   ├── asset-map.json            # WP media ID -> CF asset ID
│   ├── entry-map.json            # WP post ID -> CF entry ID
│   └── validation-report.json    # Migration validation results
├── .env.example
├── .env                          # Your configuration (gitignored)
└── package.json
```

## Configuration

### WordPress API

The toolkit uses the WordPress REST API. If your site requires authentication for certain content:

1. Install the [Application Passwords](https://wordpress.org/plugins/application-passwords/) plugin (built into WP 5.6+)
2. Generate an application password in your WP user profile
3. Add credentials to `.env`:
   ```
   WP_USERNAME=your_username
   WP_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ```

### Contentful Tokens

You'll need two types of Contentful tokens:

- **Management Token**: For creating content types and entries
  - Get from: Settings → API Keys → Content management tokens
- **Delivery Token**: For validation reads
  - Get from: Settings → API Keys → Add API Key

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

## Troubleshooting

### Rate Limiting

Contentful has API rate limits. If you hit them:
- Increase `DELAY_MS` in `.env`
- Decrease `BATCH_SIZE` in `.env`

### Large Media Files

For sites with many large images:
- Consider migrating assets in batches over multiple runs
- Use the asset map to track progress and resume

### Rich Text Errors

Contentful Rich Text has strict validation. Common issues:
- Empty paragraphs (handled by transformer)
- Invalid node nesting (transformer flattens as needed)
- Missing required text nodes (transformer adds empty text)

Check `data/validation-report.json` for specific entry issues.

## Post-Migration

After migration:

1. **Review content in Contentful** - Spot check entries for formatting issues
2. **Update internal links** - The transformer attempts to convert internal WP links to entry hyperlinks
3. **Set up redirects** - Map old WordPress URLs to new frontend routes
4. **Configure webhooks** - Set up build triggers for your frontend

## License

MIT
