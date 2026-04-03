/**
 * 01-export-poc.js
 * Exports ONLY the home page, pages it links to, and their media
 * directly from the WordPress REST API. No full export needed.
 *
 * Environment variables:
 *   POC_HOME_SLUG        - Slug of the home/landing page (default: "front-page")
 *   POC_MAX_LINKED_PAGES - Max linked pages to follow (default: 10)
 *   POC_PAGE_SLUGS       - Comma-separated explicit slugs (overrides link discovery)
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');

const WP_BASE = process.env.WP_API_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

const POC_HOME_SLUG = process.env.POC_HOME_SLUG || 'front-page';
const POC_MAX_LINKED_PAGES = parseInt(process.env.POC_MAX_LINKED_PAGES || '10');
const POC_PAGE_SLUGS = process.env.POC_PAGE_SLUGS
  ? process.env.POC_PAGE_SLUGS.split(',').map(s => s.trim()).filter(Boolean)
  : null;

const wpClient = axios.create({
  baseURL: WP_BASE,
  ...(WP_USERNAME && WP_APP_PASSWORD && {
    auth: { username: WP_USERNAME, password: WP_APP_PASSWORD }
  }),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': WP_BASE ? WP_BASE.replace(/\/wp-json\/wp\/v2\/?$/, '/') : '',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  },
  responseType: 'text',
  timeout: 90000,
  maxContentLength: 50 * 1024 * 1024,
  maxBodyLength: 50 * 1024 * 1024,
});

function parseJson(raw, label) {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch {
    console.warn(`  Warning: ${label} returned invalid JSON`);
    return [];
  }
}

function getBaseDomain() {
  try {
    return new URL(WP_BASE).hostname;
  } catch {
    return '';
  }
}

function extractPageSlugs(html, baseDomain) {
  if (!html) return [];
  const hrefRegex = /href=["'](https?:\/\/[^"']+|\/[^"']*)["']/gi;
  const slugs = new Set();
  let m;
  while ((m = hrefRegex.exec(html)) !== null) {
    let url = m[1];
    if (url.startsWith('/')) url = `https://${baseDomain}${url}`;
    try {
      const u = new URL(url);
      if (u.hostname !== baseDomain) continue;
      const slug = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop();
      if (slug && !['news', 'category', 'tag', 'author', 'page', 'wp-content', 'wp-json'].includes(slug)) {
        slugs.add(slug);
      }
    } catch { /* ignore */ }
  }
  return [...slugs];
}

function extractMediaIds(pages) {
  const ids = new Set();
  for (const page of pages) {
    if (page.featured_media) ids.add(page.featured_media);
  }
  return [...ids];
}

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

const CONTENT_SELECTORS = [
  '.entry-content',
  '.post-content',
  '.page-content',
  '.hero-section .desc',
  'article .desc',
  '.hero-section',
  '.hero2',
  'article',
];

const MAX_SCRAPED_HTML = 50000;

async function scrapeRenderedContent(pageUrl) {
  if (!pageUrl) return '';
  try {
    const resp = await axios.get(pageUrl, {
      timeout: 15000,
      maxRedirects: 5,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WP-Migration/1.0)' },
    });
    const { parse } = require('node-html-parser');
    const root = parse(resp.data);

    for (const sel of CONTENT_SELECTORS) {
      const el = root.querySelector(sel);
      if (el && el.innerHTML.trim().length > 50) {
        let html = el.innerHTML;
        if (html.length > MAX_SCRAPED_HTML) {
          html = html.substring(0, MAX_SCRAPED_HTML);
        }
        return html;
      }
    }
    return '';
  } catch (err) {
    console.warn(`    Could not scrape ${pageUrl}: ${err.message}`);
    return '';
  }
}

async function fetchPageBySlug(slug) {
  try {
    const resp = await wpClient.get('/pages', { params: { slug, per_page: 1 } });
    const data = parseJson(resp.data, `page "${slug}"`);
    return data.find(p => typeof p === 'object' && p !== null) || null;
  } catch (err) {
    console.warn(`  Could not fetch page "${slug}": ${err.message}`);
    return null;
  }
}

async function fetchMediaById(id) {
  try {
    const resp = await wpClient.get(`/media/${id}`);
    const data = JSON.parse(resp.data);
    return (typeof data === 'object' && data !== null) ? data : null;
  } catch (err) {
    console.warn(`  Could not fetch media ${id}: ${err.message}`);
    return null;
  }
}

async function fetchMediaByUrl(url) {
  const filename = url.split('/').pop()?.split('?')[0];
  if (!filename) return null;
  try {
    const resp = await wpClient.get('/media', {
      params: { search: filename.replace(/\.[^.]+$/, ''), per_page: 5 }
    });
    const data = parseJson(resp.data, `media search "${filename}"`);
    const uploadsPath = (u) => {
      const idx = u.indexOf('wp-content/uploads/');
      return idx >= 0 ? u.substring(idx) : null;
    };
    const targetPath = uploadsPath(url);
    return data.find(m => {
      const su = m.source_url || m.guid?.rendered || '';
      const mp = uploadsPath(su);
      return mp && targetPath && (mp === targetPath || mp.endsWith(targetPath) || targetPath.endsWith(mp));
    }) || null;
  } catch {
    return null;
  }
}

async function fetchUserById(id) {
  try {
    const resp = await wpClient.get(`/users/${id}`);
    return JSON.parse(resp.data);
  } catch {
    return null;
  }
}

async function fetchCategories() {
  try {
    const resp = await wpClient.get('/categories', { params: { per_page: 100 } });
    return parseJson(resp.data, 'categories');
  } catch {
    return [];
  }
}

async function fetchTags() {
  try {
    const resp = await wpClient.get('/tags', { params: { per_page: 100 } });
    return parseJson(resp.data, 'tags');
  } catch {
    return [];
  }
}

async function clearPreviousRunData() {
  const files = ['./data/asset-map.json', './data/entry-map.json', './data/validation-report.json'];
  let cleared = 0;
  for (const f of files) {
    if (await fs.pathExists(f)) {
      await fs.remove(f);
      cleared++;
    }
  }
  if (cleared > 0) {
    console.log(`Cleared ${cleared} data file(s) from previous run.\n`);
  }
}

async function exportPoc() {
  console.log('WordPress PoC Export');
  console.log('====================\n');

  await clearPreviousRunData();

  console.log(`Source: ${WP_BASE}\n`);

  if (!WP_BASE) {
    console.error('Error: WP_API_URL not set in .env');
    process.exit(1);
  }

  if (!WP_BASE.startsWith('https://') && !WP_BASE.startsWith('http://')) {
    console.error('Error: WP_API_URL should start with https:// or http://');
    process.exit(1);
  }

  // Test connection
  try {
    await wpClient.get('/', { responseType: 'text' });
    console.log('✓ Connected to WordPress API\n');
  } catch (error) {
    console.error(`Error connecting to WordPress API: ${error.message}`);
    process.exit(1);
  }

  const baseDomain = getBaseDomain();
  const collectedPages = [];
  const collectedPageIds = new Set();

  // Step 1: Determine which pages to fetch
  if (POC_PAGE_SLUGS && POC_PAGE_SLUGS.length > 0) {
    console.log(`Fetching ${POC_PAGE_SLUGS.length} explicitly requested page(s)...\n`);
    for (const slug of POC_PAGE_SLUGS) {
      const page = await fetchPageBySlug(slug);
      if (page && !collectedPageIds.has(page.id)) {
        collectedPages.push(page);
        collectedPageIds.add(page.id);
        console.log(`  ✓ ${slug} (ID ${page.id})`);
      } else if (!page) {
        console.log(`  ✗ ${slug} — not found`);
      }
    }
  } else {
    // Fetch home page
    console.log(`Fetching home page (slug: "${POC_HOME_SLUG}")...`);
    let homePage = await fetchPageBySlug(POC_HOME_SLUG);

    if (!homePage) {
      console.log(`  Home slug "${POC_HOME_SLUG}" not found. Trying "home"...`);
      homePage = await fetchPageBySlug('home');
    }
    if (!homePage) {
      console.log(`  "home" not found either. Fetching first published page...`);
      try {
        const resp = await wpClient.get('/pages', { params: { per_page: 1, orderby: 'menu_order', order: 'asc', status: 'publish' } });
        const data = parseJson(resp.data, 'first page');
        homePage = data[0] || null;
      } catch { /* ignore */ }
    }

    if (!homePage) {
      console.log('  No pages found on this site.\n');
    } else {
      collectedPages.push(homePage);
      collectedPageIds.add(homePage.id);
      console.log(`  ✓ "${homePage.title?.rendered || homePage.slug}" (ID ${homePage.id})\n`);

      // Discover linked pages from home page content
      const linkedSlugs = extractPageSlugs(homePage.content?.rendered || '', baseDomain);
      console.log(`Found ${linkedSlugs.length} internal link(s) on home page.`);
      const slugsToFetch = linkedSlugs.slice(0, POC_MAX_LINKED_PAGES);

      if (slugsToFetch.length > 0) {
        console.log(`Fetching up to ${slugsToFetch.length} linked page(s)...\n`);
        for (const slug of slugsToFetch) {
          await new Promise(r => setTimeout(r, 200));
          const page = await fetchPageBySlug(slug);
          if (page && !collectedPageIds.has(page.id)) {
            collectedPages.push(page);
            collectedPageIds.add(page.id);
            console.log(`  ✓ ${slug} (ID ${page.id})`);
          } else if (!page) {
            console.log(`  - ${slug} — not a page (may be a post or external link)`);
          }
        }
      } else {
        console.log('Home page had no internal links. Fetching a few additional pages...\n');
        try {
          const resp = await wpClient.get('/pages', { params: { per_page: POC_MAX_LINKED_PAGES, status: 'publish' } });
          const extras = parseJson(resp.data, 'extra pages').filter(p => typeof p === 'object' && p !== null);
          for (const page of extras) {
            if (!collectedPageIds.has(page.id)) {
              collectedPages.push(page);
              collectedPageIds.add(page.id);
              console.log(`  ✓ ${page.slug} (ID ${page.id})`);
            }
          }
        } catch { /* ignore */ }
      }
    }
  }

  if (collectedPages.length > 0) {
    console.log(`\n${collectedPages.length} page(s) collected.\n`);
  }

  // If no pages were found, fetch recent posts instead
  const collectedPosts = [];
  const collectedPostIds = new Set();

  if (collectedPages.length === 0) {
    console.log('Fetching recent posts instead...\n');
    try {
      const resp = await wpClient.get('/posts', {
        params: { per_page: POC_MAX_LINKED_PAGES + 1, status: 'publish', orderby: 'date', order: 'desc' }
      });
      const posts = parseJson(resp.data, 'posts').filter(p => typeof p === 'object' && p !== null);
      for (const post of posts) {
        if (!collectedPostIds.has(post.id)) {
          collectedPosts.push(post);
          collectedPostIds.add(post.id);
          const title = (post.title?.rendered || post.slug || '').replace(/<[^>]*>/g, '').substring(0, 60);
          console.log(`  ✓ ${title} (ID ${post.id})`);
        }
      }
    } catch (err) {
      console.warn(`  Could not fetch posts: ${err.message}`);
    }
    console.log(`\n${collectedPosts.length} post(s) collected.\n`);
  }

  const allContent = [...collectedPages, ...collectedPosts];

  // Fill in empty content by scraping the live page
  const emptyItems = allContent.filter(p => !(p.content?.rendered));
  if (emptyItems.length > 0) {
    console.log(`${emptyItems.length} item(s) have empty content — scraping live site...\n`);
    for (const item of emptyItems) {
      const url = item.link || '';
      if (!url) continue;
      await new Promise(r => setTimeout(r, 300));
      const html = await scrapeRenderedContent(url);
      if (html) {
        if (!item.content) item.content = {};
        item.content.rendered = html;
        console.log(`  ✓ ${item.slug} — scraped ${html.length} chars`);
      } else {
        console.log(`  ⊘ ${item.slug} — no content found`);
      }
    }
    console.log('');
  }

  // Step 2: Collect media referenced by content
  console.log('Collecting referenced media...');
  const mediaMap = new Map();

  // Featured images
  const featuredIds = extractMediaIds(allContent);
  for (const id of featuredIds) {
    if (mediaMap.has(id)) continue;
    await new Promise(r => setTimeout(r, 200));
    const media = await fetchMediaById(id);
    if (media) {
      mediaMap.set(media.id, media);
      console.log(`  ✓ Featured: ${media.source_url?.split('/').pop() || media.id}`);
    }
  }

  // Inline media from content
  for (const item of allContent) {
    const urls = extractMediaUrls(item.content?.rendered || '');
    for (const url of urls) {
      await new Promise(r => setTimeout(r, 200));
      const media = await fetchMediaByUrl(url);
      if (media && !mediaMap.has(media.id)) {
        mediaMap.set(media.id, media);
        console.log(`  ✓ Inline: ${media.source_url?.split('/').pop() || media.id}`);
      }
    }
  }

  const collectedMedia = [...mediaMap.values()];
  console.log(`\n${collectedMedia.length} media item(s) collected.\n`);

  // Step 3: Collect authors
  console.log('Collecting authors...');
  const userMap = new Map();
  for (const item of allContent) {
    if (item.author && !userMap.has(item.author)) {
      const user = await fetchUserById(item.author);
      if (user) {
        userMap.set(user.id, user);
        console.log(`  ✓ ${user.name || user.slug}`);
      }
    }
  }
  const collectedUsers = [...userMap.values()];

  // Step 4: Fetch categories and tags (lightweight)
  console.log('\nFetching categories and tags...');
  const categories = await fetchCategories();
  const tags = await fetchTags();
  console.log(`  ${categories.length} categories, ${tags.length} tags`);

  // Build export
  const exportData = {
    pages: collectedPages,
    posts: collectedPosts,
    media: collectedMedia,
    users: collectedUsers,
    categories,
    tags,
    _meta: {
      exportDate: new Date().toISOString(),
      sourceUrl: WP_BASE,
      exportType: 'poc',
      filteredBy: 'direct-api-fetch',
      filterOptions: {
        homeSlug: POC_HOME_SLUG,
        pageSlugs: POC_PAGE_SLUGS,
        maxLinkedPages: POC_MAX_LINKED_PAGES,
        pagesIncluded: collectedPages.length,
        postsIncluded: collectedPosts.length,
        mediaIncluded: collectedMedia.length,
      },
      counts: {
        posts: collectedPosts.length,
        pages: collectedPages.length,
        categories: categories.length,
        tags: tags.length,
        media: collectedMedia.length,
        users: collectedUsers.length,
      }
    }
  };

  await fs.ensureDir('./data');
  await fs.writeJson('./data/wp-export-poc.json', exportData, { spaces: 2 });

  console.log('\n====================');
  console.log('PoC Export Complete!\n');
  console.log('Content exported:');
  console.log(`  Pages:      ${collectedPages.length}`);
  console.log(`  Posts:      ${collectedPosts.length}`);
  console.log(`  Media:      ${collectedMedia.length}`);
  console.log(`  Users:      ${collectedUsers.length}`);
  console.log(`  Categories: ${categories.length}`);
  console.log(`  Tags:       ${tags.length}`);
  console.log(`\nSaved to: ./data/wp-export-poc.json`);
}

exportPoc().catch(error => {
  console.error('\nExport failed:', error.message);
  process.exit(1);
});
