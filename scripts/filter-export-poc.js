/**
 * filter-export-poc.js
 * Creates a PoC subset of wp-export.json: home page + linked pages + their media only.
 * Use for proof-of-concept migrations when full export is too large.
 *
 * Usage:
 *   POC_HOME_SLUG=front-page npm run filter-poc
 *   POC_HOME_SLUG=home POC_MAX_LINKED_PAGES=10 npm run filter-poc
 *
 * Then run migrate-assets and migrate-content - they use wp-export-poc.json when it exists.
 */

require('dotenv').config();
const fs = require('fs-extra');

const POC_HOME_SLUG = process.env.POC_HOME_SLUG || 'front-page';
const POC_MAX_LINKED_PAGES = parseInt(process.env.POC_MAX_LINKED_PAGES || '10');
const POC_MAX_MEDIA = parseInt(process.env.POC_MAX_MEDIA || '200'); // Cap media to avoid huge PoC
// Optional: comma-separated slugs to include (overrides home+linked logic)
const POC_PAGE_SLUGS = process.env.POC_PAGE_SLUGS
  ? process.env.POC_PAGE_SLUGS.split(',').map(s => s.trim()).filter(Boolean)
  : null;

// Extract domain from first page link for matching internal URLs
function getBaseDomain(pages) {
  const link = pages[0]?.link;
  if (!link) return 'about.fb.com';
  try {
    const u = new URL(link);
    return u.hostname;
  } catch {
    return 'about.fb.com';
  }
}

// Extract internal page links from HTML content (same domain)
function extractPageLinks(html, baseDomain) {
  if (!html) return [];
  const hrefRegex = /href=["'](https?:\/\/[^"']+|(?:\/)[^"']*)["']/gi;
  const slugs = new Set();
  let m;
  while ((m = hrefRegex.exec(html)) !== null) {
    let url = m[1];
    if (url.startsWith('/')) {
      url = `https://${baseDomain}${url}`;
    }
    try {
      const u = new URL(url);
      if (u.hostname !== baseDomain) continue;
      // WordPress page URLs: /news/slug/ or /slug/ or /page-slug/
      const path = u.pathname.replace(/\/$/, '');
      const slug = path.split('/').filter(Boolean).pop();
      if (slug && !['news', 'category', 'tag', 'author', 'page', 'wp-content'].includes(slug)) {
        slugs.add(slug);
      }
    } catch {
      // ignore
    }
  }
  return [...slugs];
}

// Extract media URLs from content (wp-content/uploads)
function extractMediaUrls(html) {
  if (!html) return [];
  const urls = new Set();
  const regex = /(?:src|href)=["']([^"']*wp-content\/uploads\/[^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    urls.add(m[1].split('?')[0]);
  }
  return [...urls];
}

// Extract path part after wp-content/uploads/ for matching
function uploadsPath(url) {
  const idx = url.indexOf('wp-content/uploads/');
  return idx >= 0 ? url.substring(idx).split('?')[0] : null;
}

// Match media URL to media item (by source_url or guid)
function findMediaByUrl(media, url) {
  const path = uploadsPath(url);
  if (!path) return null;
  return media.find(m => {
    const su = m.source_url || m.guid?.rendered || '';
    const mp = uploadsPath(su);
    return mp && (mp === path || mp.endsWith(path) || path.endsWith(mp));
  });
}

async function filterExport() {
  console.log('PoC Export Filter');
  console.log('=================\n');

  const inputPath = './data/wp-export.json';
  const outputPath = './data/wp-export-poc.json';

  if (!await fs.pathExists(inputPath)) {
    console.error('Error: wp-export.json not found. Run npm run export first.');
    process.exit(1);
  }

  const data = await fs.readJson(inputPath);
  const pages = (data.pages || []).filter(p => typeof p === 'object' && p !== null);
  const media = (data.media || []).filter(m => typeof m === 'object' && m !== null);

  if (pages.length === 0) {
    console.error('Error: No pages in export.');
    process.exit(1);
  }

  const baseDomain = getBaseDomain(pages);

  // Find home page
  const homePage = pages.find(p => p.slug === POC_HOME_SLUG);
  if (!homePage) {
    console.log(`Home slug "${POC_HOME_SLUG}" not found. Available slugs: ${pages.slice(0, 10).map(p => p.slug).join(', ')}...`);
    console.log('Using first page as home. Set POC_HOME_SLUG to match your home page slug.\n');
  }

  let pocPages;

  if (POC_PAGE_SLUGS && POC_PAGE_SLUGS.length > 0) {
    // Explicit slug list
    pocPages = pages.filter(p => POC_PAGE_SLUGS.includes(p.slug));
    if (pocPages.length === 0) {
      console.error(`No pages found for slugs: ${POC_PAGE_SLUGS.join(', ')}`);
      process.exit(1);
    }
    console.log(`Using ${POC_PAGE_SLUGS.length} explicitly requested page(s)\n`);
  } else {
    const home = homePage || pages[0];
    const pageIds = new Set([home.id]);
    const pageSlugs = new Set([home.slug]);

    // Collect linked pages (BFS from home)
    let toProcess = [home];
    let depth = 0;

    while (toProcess.length > 0 && depth < 2) {
      const next = [];
      for (const page of toProcess) {
        const content = page.content?.rendered || '';
        const links = extractPageLinks(content, baseDomain);
        let added = 0;
        for (const slug of links) {
          if (pageSlugs.has(slug) || added >= POC_MAX_LINKED_PAGES) continue;
          const linked = pages.find(p => p.slug === slug);
          if (linked) {
            pageIds.add(linked.id);
            pageSlugs.add(slug);
            next.push(linked);
            added++;
          }
        }
      }
      toProcess = next;
      depth++;
    }

    // If home had no links, include first N pages as fallback
    if (pageIds.size === 1) {
      const extra = pages.filter(p => !pageIds.has(p.id)).slice(0, POC_MAX_LINKED_PAGES);
      extra.forEach(p => pageIds.add(p.id));
      console.log(`Home had no internal links; including first ${extra.length} additional pages\n`);
    }

    pocPages = pages.filter(p => pageIds.has(p.id));
    // Keep home first
    const homeId = homePage?.id || pages[0]?.id;
    pocPages.sort((a, b) => (a.id === homeId ? -1 : b.id === homeId ? 1 : 0));
  }

  // Collect media used in those pages
  const mediaUrls = new Set();
  for (const page of pocPages) {
    extractMediaUrls(page.content?.rendered || '').forEach(u => mediaUrls.add(u));
    if (page.featured_media) {
      const m = media.find(x => x.id === page.featured_media);
      if (m?.source_url) mediaUrls.add(m.source_url);
      if (m?.guid?.rendered) mediaUrls.add(m.guid.rendered);
    }
  }

  const mediaIds = new Set();
  for (const url of mediaUrls) {
    const m = findMediaByUrl(media, url);
    if (m) mediaIds.add(m.id);
  }

  // Cap media
  const mediaArr = Array.from(mediaIds);
  const cappedMediaIds = new Set(mediaArr.slice(0, POC_MAX_MEDIA));
  const pocMedia = media.filter(m => cappedMediaIds.has(m.id));

  // Collect referenced users
  const userIds = new Set(pocPages.map(p => p.author).filter(Boolean));
  const pocUsers = (data.users || []).filter(u => userIds.has(u.id));

  // Build filtered export
  const filtered = {
    ...data,
    pages: pocPages,
    media: pocMedia,
    users: pocUsers,
    posts: [], // No posts for page-only PoC
    _meta: {
      ...data._meta,
      filteredBy: 'filter-export-poc',
      filterOptions: {
        homeSlug: POC_HOME_SLUG,
        pageSlugs: POC_PAGE_SLUGS,
        maxLinkedPages: POC_MAX_LINKED_PAGES,
        maxMedia: POC_MAX_MEDIA,
        pagesIncluded: pocPages.length,
        mediaIncluded: pocMedia.length
      }
    }
  };

  await fs.writeJson(outputPath, filtered, { spaces: 2 });

  console.log('Filtered export saved to:');
  console.log(`  ${outputPath}\n`);
  console.log('Included:');
  console.log(`  Pages: ${pocPages.length} (primary: ${pocPages[0]?.slug || 'n/a'})`);
  console.log(`  Media: ${pocMedia.length}`);
  console.log(`  Users: ${pocUsers.length}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Stop any running migration (Ctrl+C)`);
  console.log(`  2. For a clean PoC: rm -f data/asset-map.json data/entry-map.json`);
  console.log(`  3. npm run migrate-assets   (migrates only ${pocMedia.length} media)`);
  console.log(`  4. npm run migrate-content`);
}

filterExport().catch(err => {
  console.error(err);
  process.exit(1);
});
