/**
 * 04-migrate-content.js
 * Migrates WordPress posts, pages, categories, tags, and authors to Contentful
 */

require('dotenv').config();
const contentful = require('contentful-management');
const fs = require('fs-extra');
const RichTextTransformer = require('../lib/rich-text-transformer');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 5;
const DELAY_MS = parseInt(process.env.DELAY_MS) || 1000;

async function getClient() {
  const client = contentful.createClient({
    accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
  });
  
  const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
  const environment = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT || 'master');
  
  return { client, space, environment };
}

/**
 * Sanitize HTML entities and clean text
 */
function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .trim();
}

/**
 * Create Contentful link object
 */
function createLink(id, linkType = 'Entry') {
  return {
    sys: {
      type: 'Link',
      linkType,
      id
    }
  };
}

async function migrateContent() {
  console.log('Contentful Content Migration');
  console.log('============================\n');

  // Use PoC export if it exists (from npm run filter-poc)
  const wpExportPath = await fs.pathExists('./data/wp-export-poc.json')
    ? './data/wp-export-poc.json'
    : './data/wp-export.json';
  if (wpExportPath.includes('poc')) {
    console.log('Using PoC export (wp-export-poc.json)\n');
  }
  const assetMapPath = './data/asset-map.json';
  
  if (!await fs.pathExists(wpExportPath)) {
    console.error('Error: wp-export.json not found. Run npm run export first.');
    process.exit(1);
  }
  
  if (!await fs.pathExists(assetMapPath)) {
    console.error('Error: asset-map.json not found. Run npm run migrate-assets first.');
    process.exit(1);
  }

  const wpData = await fs.readJson(wpExportPath);
  const assetMap = await fs.readJson(assetMapPath);
  
  // Load or initialize entry map
  const entryMapPath = './data/entry-map.json';
  let entryMap = {};
  if (await fs.pathExists(entryMapPath)) {
    entryMap = await fs.readJson(entryMapPath);
    console.log(`Resuming from previous run (${Object.keys(entryMap).length} entries migrated)\n`);
  }

  const { environment } = await getClient();
  const transformer = new RichTextTransformer(assetMap, entryMap);

  const stats = {
    authors: { total: 0, migrated: 0, skipped: 0, failed: 0 },
    categories: { total: 0, migrated: 0, skipped: 0, failed: 0 },
    tags: { total: 0, migrated: 0, skipped: 0, failed: 0 },
    posts: { total: 0, migrated: 0, skipped: 0, failed: 0 },
    pages: { total: 0, migrated: 0, skipped: 0, failed: 0 }
  };

  // Helper to save progress
  const saveProgress = async () => {
    await fs.writeJson(entryMapPath, entryMap, { spaces: 2 });
  };

  // =====================================
  // 1. Migrate Authors
  // =====================================
  console.log('1. Migrating Authors\n');
  const users = wpData.users || [];
  stats.authors.total = users.length;

  for (const user of users) {
    const mapKey = `author_${user.id}`;
    
    if (entryMap[mapKey]) {
      stats.authors.skipped++;
      continue;
    }

    try {
      const entry = await environment.createEntry('author', {
        fields: {
          name: { 'en-US': user.name },
          slug: { 'en-US': user.slug },
          bio: { 'en-US': sanitizeText(user.description) || '' },
          wpId: { 'en-US': user.id }
        }
      });
      
      await entry.publish();
      entryMap[mapKey] = entry.sys.id;
      stats.authors.migrated++;
      console.log(`  ✓ Author: ${user.name}`);
    } catch (error) {
      stats.authors.failed++;
      console.error(`  ✗ Author ${user.id}: ${error.message}`);
    }
  }
  
  await saveProgress();
  console.log(`  Authors: ${stats.authors.migrated}/${stats.authors.total}\n`);

  // =====================================
  // 2. Migrate Categories
  // =====================================
  console.log('2. Migrating Categories\n');
  const categories = wpData.categories || [];
  stats.categories.total = categories.length;

  // Sort by parent to handle hierarchy
  const sortedCategories = [...categories].sort((a, b) => a.parent - b.parent);

  for (const cat of sortedCategories) {
    const mapKey = `cat_${cat.id}`;
    
    if (entryMap[mapKey]) {
      stats.categories.skipped++;
      continue;
    }

    try {
      const fields = {
        name: { 'en-US': sanitizeText(cat.name) },
        slug: { 'en-US': cat.slug },
        description: { 'en-US': sanitizeText(cat.description) || '' },
        wpId: { 'en-US': cat.id }
      };
      
      // Link to parent category if exists
      if (cat.parent && entryMap[`cat_${cat.parent}`]) {
        fields.parent = { 'en-US': createLink(entryMap[`cat_${cat.parent}`]) };
      }

      const entry = await environment.createEntry('category', { fields });
      await entry.publish();
      entryMap[mapKey] = entry.sys.id;
      stats.categories.migrated++;
      console.log(`  ✓ Category: ${cat.name}`);
    } catch (error) {
      stats.categories.failed++;
      console.error(`  ✗ Category ${cat.id}: ${error.message}`);
    }
  }
  
  await saveProgress();
  console.log(`  Categories: ${stats.categories.migrated}/${stats.categories.total}\n`);

  // =====================================
  // 3. Migrate Tags
  // =====================================
  console.log('3. Migrating Tags\n');
  const tags = wpData.tags || [];
  stats.tags.total = tags.length;

  for (const tag of tags) {
    const mapKey = `tag_${tag.id}`;
    
    if (entryMap[mapKey]) {
      stats.tags.skipped++;
      continue;
    }

    try {
      const entry = await environment.createEntry('tag', {
        fields: {
          name: { 'en-US': sanitizeText(tag.name) },
          slug: { 'en-US': tag.slug },
          wpId: { 'en-US': tag.id }
        }
      });
      
      await entry.publish();
      entryMap[mapKey] = entry.sys.id;
      stats.tags.migrated++;
      console.log(`  ✓ Tag: ${tag.name}`);
    } catch (error) {
      stats.tags.failed++;
      console.error(`  ✗ Tag ${tag.id}: ${error.message}`);
    }
  }
  
  await saveProgress();
  console.log(`  Tags: ${stats.tags.migrated}/${stats.tags.total}\n`);

  // =====================================
  // 4. Migrate Posts
  // =====================================
  console.log('4. Migrating Posts\n');
  const posts = wpData.posts || [];
  stats.posts.total = posts.length;

  for (let i = 0; i < posts.length; i += BATCH_SIZE) {
    const batch = posts.slice(i, i + BATCH_SIZE);
    
    for (const post of batch) {
      const mapKey = `post_${post.id}`;
      
      if (entryMap[mapKey]) {
        stats.posts.skipped++;
        continue;
      }

      try {
        // Build category links
        const categoryLinks = (post.categories || [])
          .map(catId => entryMap[`cat_${catId}`])
          .filter(Boolean)
          .map(id => createLink(id));

        // Build tag links
        const tagLinks = (post.tags || [])
          .map(tagId => entryMap[`tag_${tagId}`])
          .filter(Boolean)
          .map(id => createLink(id));

        // Get author link
        const authorId = entryMap[`author_${post.author}`];
        
        // Get featured image
        const featuredImageId = post.featured_media ? assetMap[post.featured_media] : null;

        // Transform content to Rich Text
        const richTextContent = transformer.transform(post.content?.rendered || '');

        const fields = {
          title: { 'en-US': sanitizeText(post.title?.rendered) },
          slug: { 'en-US': post.slug },
          publishDate: { 'en-US': post.date },
          modifiedDate: { 'en-US': post.modified },
          excerpt: { 'en-US': sanitizeText(post.excerpt?.rendered) },
          content: { 'en-US': richTextContent },
          wpId: { 'en-US': post.id }
        };

        // Add optional fields
        if (categoryLinks.length > 0) {
          fields.categories = { 'en-US': categoryLinks };
        }
        if (tagLinks.length > 0) {
          fields.tags = { 'en-US': tagLinks };
        }
        if (authorId) {
          fields.author = { 'en-US': createLink(authorId) };
        }
        if (featuredImageId) {
          fields.featuredImage = { 'en-US': createLink(featuredImageId, 'Asset') };
        }

        // SEO fields from Yoast if available
        const yoast = post.yoast_head_json;
        if (yoast) {
          if (yoast.title) {
            fields.seoTitle = { 'en-US': yoast.title };
          }
          if (yoast.description) {
            fields.seoDescription = { 'en-US': yoast.description.substring(0, 160) };
          }
        }

        const entry = await environment.createEntry('blogPost', { fields });
        await entry.publish();
        entryMap[mapKey] = entry.sys.id;
        stats.posts.migrated++;
        
        const title = sanitizeText(post.title?.rendered).substring(0, 50);
        console.log(`  ✓ Post: ${title}...`);
        
        // Log any transformer warnings
        const warnings = transformer.getWarnings();
        if (warnings.length > 0) {
          warnings.forEach(w => console.log(`    ⚠ ${w}`));
        }

      } catch (error) {
        stats.posts.failed++;
        const title = sanitizeText(post.title?.rendered).substring(0, 30);
        console.error(`  ✗ Post ${post.id} (${title}): ${error.message}`);
        
        if (error.details?.errors) {
          console.error(`    Details: ${JSON.stringify(error.details.errors)}`);
        }
      }
    }

    await saveProgress();
    
    const progress = Math.min(i + BATCH_SIZE, posts.length);
    console.log(`\n  Progress: ${progress}/${posts.length}\n`);
    
    if (i + BATCH_SIZE < posts.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`  Posts: ${stats.posts.migrated}/${stats.posts.total}\n`);

  // =====================================
  // 5. Migrate Pages
  // =====================================
  console.log('5. Migrating Pages\n');
  const pages = wpData.pages || [];
  stats.pages.total = pages.length;

  // Sort by parent to handle hierarchy
  const sortedPages = [...pages].sort((a, b) => a.parent - b.parent);

  for (const page of sortedPages) {
    const mapKey = `page_${page.id}`;
    
    if (entryMap[mapKey]) {
      stats.pages.skipped++;
      continue;
    }

    try {
      // Transform content to Rich Text
      const richTextContent = transformer.transform(page.content?.rendered || '');
      
      // Create a richTextSection for the page content (modular page model)
      const sectionTitle = sanitizeText(page.title?.rendered) || 'Content';
      const sectionEntry = await environment.createEntry('richTextSection', {
        fields: {
          internalTitle: { 'en-US': `${sectionTitle} (Content)` },
          content: { 'en-US': richTextContent },
          wpId: { 'en-US': page.id }
        }
      });
      await sectionEntry.publish();
      const sectionId = sectionEntry.sys.id;
      
      // Get featured image
      const featuredImageId = page.featured_media ? assetMap[page.featured_media] : null;

      const fields = {
        title: { 'en-US': sectionTitle },
        slug: { 'en-US': page.slug },
        sections: { 'en-US': [createLink(sectionId)] },
        template: { 'en-US': ['default', 'full-width', 'sidebar', 'landing'].includes(page.template) ? page.template : 'default' },
        wpId: { 'en-US': page.id }
      };

      // Link to parent page if exists
      if (page.parent && entryMap[`page_${page.parent}`]) {
        fields.parent = { 'en-US': createLink(entryMap[`page_${page.parent}`]) };
      }
      
      if (featuredImageId) {
        fields.featuredImage = { 'en-US': createLink(featuredImageId, 'Asset') };
      }

      // SEO from Yoast
      const yoast = page.yoast_head_json;
      if (yoast) {
        if (yoast.title) fields.seoTitle = { 'en-US': yoast.title };
        if (yoast.description) fields.seoDescription = { 'en-US': yoast.description.substring(0, 160) };
      }

      const entry = await environment.createEntry('page', { fields });
      await entry.publish();
      entryMap[mapKey] = entry.sys.id;
      stats.pages.migrated++;
      
      console.log(`  ✓ Page: ${sectionTitle}`);
      
    } catch (error) {
      stats.pages.failed++;
      console.error(`  ✗ Page ${page.id}: ${error.message}`);
    }
  }

  await saveProgress();
  console.log(`  Pages: ${stats.pages.migrated}/${stats.pages.total}\n`);

  // =====================================
  // Summary
  // =====================================
  console.log('============================');
  console.log('Migration Complete!\n');
  console.log('Summary:');
  console.log(`  Authors:    ${stats.authors.migrated}/${stats.authors.total} (${stats.authors.failed} failed)`);
  console.log(`  Categories: ${stats.categories.migrated}/${stats.categories.total} (${stats.categories.failed} failed)`);
  console.log(`  Tags:       ${stats.tags.migrated}/${stats.tags.total} (${stats.tags.failed} failed)`);
  console.log(`  Posts:      ${stats.posts.migrated}/${stats.posts.total} (${stats.posts.failed} failed)`);
  console.log(`  Pages:      ${stats.pages.migrated}/${stats.pages.total} (${stats.pages.failed} failed)`);
  console.log(`\nEntry map saved to: ${entryMapPath}`);
  console.log('\nNext step: npm run validate');
}

migrateContent().catch(error => {
  console.error('\nMigration failed:', error.message);
  process.exit(1);
});
