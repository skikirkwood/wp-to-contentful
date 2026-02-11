/**
 * 01-export-wordpress.js
 * Exports all content from WordPress via REST API
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');

const WP_BASE = process.env.WP_API_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

// Configure axios with optional authentication
const wpClient = axios.create({
  baseURL: WP_BASE,
  ...(WP_USERNAME && WP_APP_PASSWORD && {
    auth: {
      username: WP_USERNAME,
      password: WP_APP_PASSWORD
    }
  })
});

/**
 * Fetch all items from a paginated WordPress endpoint
 */
// Some WordPress hosts (e.g. about.fb.com) return empty body with _embed=true. Default off.
const USE_EMBED = process.env.WP_EMBED === 'true';

async function fetchAllPaginated(endpoint, params = {}) {
  let page = 1;
  let allItems = [];
  
  console.log(`  Fetching ${endpoint}...`);
  
  while (true) {
    try {
      const response = await wpClient.get(`/${endpoint}`, {
        params: { 
          per_page: 100, 
          page, 
          _embed: USE_EMBED,
          ...params 
        },
        responseType: 'text',  // Get raw response so we control JSON parsing
        timeout: 90000,       // 90s - _embed can make responses large/slow
        maxContentLength: 50 * 1024 * 1024,  // 50MB
        maxBodyLength: 50 * 1024 * 1024
      });
      
      let data;
      const raw = response.data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        const preview = raw.substring(0, 120).replace(/\s+/g, ' ');
        const isHtml = raw.trimStart().toLowerCase().startsWith('<!') || raw.trimStart().toLowerCase().startsWith('<html');
        console.warn(`    Warning: ${endpoint} returned invalid JSON (parse error: ${e.message})`);
        console.warn(`    Response looks like: ${isHtml ? 'HTML page' : 'plain text'}`);
        console.warn(`    First 120 chars: "${preview}${raw.length > 120 ? '...' : ''}"`);
        if (page === 1) {
          console.warn(`    Tip: Try the URL in a browser: ${WP_BASE}/${endpoint}?per_page=1`);
          console.warn(`    (Embed is disabled by default; some hosts return empty with _embed=true)`);
        }
        data = [];
      }
      // WordPress REST API returns array directly; handle wrapped response from some hosts
      if (!Array.isArray(data)) {
        if (data && typeof data === 'object' && Array.isArray(data.data)) {
          data = data.data;
        } else if (data && typeof data === 'object') {
          console.warn(`    Warning: Unexpected response format for ${endpoint}, got object with keys: ${Object.keys(data).join(', ')}`);
          data = [];
        } else {
          console.warn(`    Warning: Expected array for ${endpoint}, got ${typeof data}`);
          data = [];
        }
      }
      
      allItems = allItems.concat(data);
      
      const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1');
      const total = parseInt(response.headers['x-wp-total'] || data.length);
      
      // Validate first page: media must have source_url, posts/pages must have content
      if (page === 1 && data.length > 0) {
        const sample = data[0];
        if (typeof sample !== 'object' || sample === null) {
          console.warn(`    Warning: ${endpoint} returned non-object items (got ${typeof sample}). Check API auth/permissions.`);
        } else if (endpoint === 'media' && !sample.source_url && !sample.guid?.rendered) {
          console.warn(`    Warning: Media items missing source_url. Ensure WP_USERNAME and WP_APP_PASSWORD are set for private media.`);
        }
      }
      
      console.log(`    Page ${page}/${totalPages} (${allItems.length}/${total} items)`);
      
      if (page >= totalPages) break;
      page++;
      
      // Rate limiting - be nice to the server
      await new Promise(r => setTimeout(r, 200));
      
    } catch (error) {
      if (error.response?.status === 400 && page > 1) {
        // No more pages
        break;
      }
      throw error;
    }
  }
  
  return allItems;
}

/**
 * Get list of registered custom post types
 */
async function getPostTypes() {
  try {
    const response = await wpClient.get('/types');
    return Object.keys(response.data).filter(type => 
      !['attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation'].includes(type)
    );
  } catch (error) {
    console.warn('Could not fetch post types, using defaults');
    return ['post', 'page'];
  }
}

/**
 * Main export function
 */
async function exportWordPress() {
  console.log('WordPress Content Export');
  console.log('========================\n');
  console.log(`Source: ${WP_BASE}\n`);
  
  if (!WP_BASE) {
    console.error('Error: WP_API_URL not set in .env');
    process.exit(1);
  }

  if (!WP_BASE.startsWith('https://') && !WP_BASE.startsWith('http://')) {
    console.error('Error: WP_API_URL should start with https:// or http:// (e.g. https://yoursite.com/wp-json/wp/v2)');
    process.exit(1);
  }

  // Test connection
  try {
    await wpClient.get('/', { responseType: 'text' });
    console.log('✓ Connected to WordPress API');
    if (USE_EMBED) console.log('  (WP_EMBED=true: including embedded author/media)');
    console.log('');
  } catch (error) {
    console.error(`Error connecting to WordPress API: ${error.message}`);
    console.error('Check your WP_API_URL and authentication settings');
    process.exit(1);
  }

  const exports = {};

  // Core content types
  console.log('Exporting core content:');
  exports.posts = await fetchAllPaginated('posts');
  exports.pages = await fetchAllPaginated('pages');
  exports.categories = await fetchAllPaginated('categories');
  exports.tags = await fetchAllPaginated('tags');
  exports.media = await fetchAllPaginated('media');
  exports.users = await fetchAllPaginated('users');

  // Filter out invalid items (empty strings, null) that some WordPress hosts return
  for (const key of ['posts', 'pages', 'media']) {
    const before = exports[key].length;
    exports[key] = exports[key].filter(item => typeof item === 'object' && item !== null);
    const removed = before - exports[key].length;
    if (removed > 0) {
      console.warn(`\n  Note: Filtered ${removed} invalid ${key} items. Re-run with WP_USERNAME/WP_APP_PASSWORD if auth is required.`);
    }
  }

  // Check for custom post types
  console.log('\nChecking for custom post types...');
  const postTypes = await getPostTypes();
  const customTypes = postTypes.filter(t => !['post', 'page'].includes(t));
  
  if (customTypes.length > 0) {
    console.log(`Found custom post types: ${customTypes.join(', ')}\n`);
    console.log('Exporting custom post types:');
    
    for (const type of customTypes) {
      try {
        exports[type] = await fetchAllPaginated(type);
      } catch (error) {
        console.warn(`  Could not export ${type}: ${error.message}`);
        exports[type] = [];
      }
    }
  }

  // Add metadata
  exports._meta = {
    exportDate: new Date().toISOString(),
    sourceUrl: WP_BASE,
    counts: {
      posts: exports.posts.length,
      pages: exports.pages.length,
      categories: exports.categories.length,
      tags: exports.tags.length,
      media: exports.media.length,
      users: exports.users.length,
      ...Object.fromEntries(customTypes.map(t => [t, exports[t]?.length || 0]))
    }
  };

  // Save export
  await fs.ensureDir('./data');
  await fs.writeJson('./data/wp-export.json', exports, { spaces: 2 });

  // Print summary
  console.log('\n========================');
  console.log('Export Complete!\n');
  console.log('Content exported:');
  Object.entries(exports._meta.counts).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  console.log(`\nSaved to: ./data/wp-export.json`);
}

// Run export
exportWordPress().catch(error => {
  console.error('\nExport failed:', error.message);
  process.exit(1);
});
