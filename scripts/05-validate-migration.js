/**
 * 05-validate-migration.js
 * Validates migration completeness and data integrity
 */

require('dotenv').config();
const contentful = require('contentful');
const fs = require('fs-extra');

async function validate() {
  console.log('Migration Validation');
  console.log('====================\n');

  // Load data files
  const wpExportPath = './data/wp-export.json';
  const entryMapPath = './data/entry-map.json';
  const assetMapPath = './data/asset-map.json';

  if (!await fs.pathExists(wpExportPath)) {
    console.error('Error: wp-export.json not found');
    process.exit(1);
  }

  if (!await fs.pathExists(entryMapPath)) {
    console.error('Error: entry-map.json not found. Run migration first.');
    process.exit(1);
  }

  const wpData = await fs.readJson(wpExportPath);
  const entryMap = await fs.readJson(entryMapPath);
  const assetMap = await fs.pathExists(assetMapPath) 
    ? await fs.readJson(assetMapPath) 
    : {};

  // Initialize Contentful client
  const client = contentful.createClient({
    space: process.env.CONTENTFUL_SPACE_ID,
    accessToken: process.env.CONTENTFUL_DELIVERY_TOKEN,
    environment: process.env.CONTENTFUL_ENVIRONMENT || 'master'
  });

  const report = {
    timestamp: new Date().toISOString(),
    counts: {
      wordpress: {
        posts: wpData.posts?.length || 0,
        pages: wpData.pages?.length || 0,
        categories: wpData.categories?.length || 0,
        tags: wpData.tags?.length || 0,
        media: wpData.media?.length || 0,
        users: wpData.users?.length || 0
      },
      migrated: {
        posts: Object.keys(entryMap).filter(k => k.startsWith('post_')).length,
        pages: Object.keys(entryMap).filter(k => k.startsWith('page_')).length,
        categories: Object.keys(entryMap).filter(k => k.startsWith('cat_')).length,
        tags: Object.keys(entryMap).filter(k => k.startsWith('tag_')).length,
        assets: Object.keys(assetMap).length,
        authors: Object.keys(entryMap).filter(k => k.startsWith('author_')).length
      }
    },
    issues: [],
    spotChecks: []
  };

  console.log('1. Count Comparison\n');
  console.log('Content Type        WordPress    Migrated    Status');
  console.log('─'.repeat(55));

  const compareAndLog = (type, wpCount, migratedCount) => {
    const status = migratedCount >= wpCount ? '✓' : '⚠';
    const wpStr = wpCount.toString().padStart(8);
    const migStr = migratedCount.toString().padStart(8);
    console.log(`${type.padEnd(20)}${wpStr}    ${migStr}       ${status}`);
    
    if (migratedCount < wpCount) {
      report.issues.push({
        type: 'incomplete_migration',
        contentType: type,
        expected: wpCount,
        actual: migratedCount,
        missing: wpCount - migratedCount
      });
    }
  };

  compareAndLog('Posts', report.counts.wordpress.posts, report.counts.migrated.posts);
  compareAndLog('Pages', report.counts.wordpress.pages, report.counts.migrated.pages);
  compareAndLog('Categories', report.counts.wordpress.categories, report.counts.migrated.categories);
  compareAndLog('Tags', report.counts.wordpress.tags, report.counts.migrated.tags);
  compareAndLog('Media/Assets', report.counts.wordpress.media, report.counts.migrated.assets);
  compareAndLog('Users/Authors', report.counts.wordpress.users, report.counts.migrated.authors);

  // 2. Spot check some entries
  console.log('\n\n2. Spot Check Verification\n');

  const samplePosts = (wpData.posts || []).slice(0, 5);
  
  for (const wp of samplePosts) {
    const cfId = entryMap[`post_${wp.id}`];
    const checkResult = {
      wpId: wp.id,
      wpTitle: wp.title?.rendered,
      contentfulId: cfId,
      status: 'unknown',
      issues: []
    };

    if (!cfId) {
      checkResult.status = 'missing';
      checkResult.issues.push('Entry not found in Contentful');
      console.log(`  ✗ Post ${wp.id}: Not migrated`);
    } else {
      try {
        const entry = await client.getEntry(cfId);
        
        // Check title match
        const wpTitle = wp.title?.rendered
          ?.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
          ?.replace(/&amp;/g, '&');
        
        if (entry.fields.title !== wpTitle) {
          checkResult.issues.push({
            field: 'title',
            expected: wpTitle,
            actual: entry.fields.title
          });
        }

        // Check slug match
        if (entry.fields.slug !== wp.slug) {
          checkResult.issues.push({
            field: 'slug',
            expected: wp.slug,
            actual: entry.fields.slug
          });
        }

        // Check featured image
        if (wp.featured_media && !entry.fields.featuredImage) {
          checkResult.issues.push({
            field: 'featuredImage',
            message: 'WordPress has featured image but Contentful does not'
          });
        }

        checkResult.status = checkResult.issues.length === 0 ? 'ok' : 'issues';
        
        const icon = checkResult.status === 'ok' ? '✓' : '⚠';
        console.log(`  ${icon} Post ${wp.id}: ${entry.fields.title?.substring(0, 40)}...`);
        
        if (checkResult.issues.length > 0) {
          checkResult.issues.forEach(issue => {
            if (typeof issue === 'string') {
              console.log(`      - ${issue}`);
            } else {
              console.log(`      - ${issue.field}: ${issue.message || `expected "${issue.expected}", got "${issue.actual}"`}`);
            }
          });
        }

      } catch (error) {
        checkResult.status = 'error';
        checkResult.issues.push(`Fetch error: ${error.message}`);
        console.log(`  ✗ Post ${wp.id}: ${error.message}`);
      }
    }

    report.spotChecks.push(checkResult);
  }

  // 3. Check for orphaned references
  console.log('\n\n3. Reference Integrity\n');

  let orphanedCategories = 0;
  let orphanedTags = 0;
  let orphanedAssets = 0;

  // Check a sample of posts for broken references
  const sampleForRefs = (wpData.posts || []).slice(0, 20);
  
  for (const post of sampleForRefs) {
    // Check categories
    for (const catId of (post.categories || [])) {
      if (!entryMap[`cat_${catId}`]) {
        orphanedCategories++;
      }
    }
    
    // Check tags
    for (const tagId of (post.tags || [])) {
      if (!entryMap[`tag_${tagId}`]) {
        orphanedTags++;
      }
    }

    // Check featured image
    if (post.featured_media && !assetMap[post.featured_media]) {
      orphanedAssets++;
    }
  }

  console.log(`  Category references checked: ${orphanedCategories === 0 ? '✓' : `⚠ ${orphanedCategories} orphaned`}`);
  console.log(`  Tag references checked: ${orphanedTags === 0 ? '✓' : `⚠ ${orphanedTags} orphaned`}`);
  console.log(`  Asset references checked: ${orphanedAssets === 0 ? '✓' : `⚠ ${orphanedAssets} orphaned`}`);

  if (orphanedCategories > 0 || orphanedTags > 0 || orphanedAssets > 0) {
    report.issues.push({
      type: 'orphaned_references',
      categories: orphanedCategories,
      tags: orphanedTags,
      assets: orphanedAssets
    });
  }

  // 4. Generate missing items list
  console.log('\n\n4. Missing Items\n');

  const missingPosts = [];
  for (const post of (wpData.posts || [])) {
    if (!entryMap[`post_${post.id}`]) {
      missingPosts.push({
        id: post.id,
        title: post.title?.rendered,
        slug: post.slug
      });
    }
  }

  const missingPages = [];
  for (const page of (wpData.pages || [])) {
    if (!entryMap[`page_${page.id}`]) {
      missingPages.push({
        id: page.id,
        title: page.title?.rendered,
        slug: page.slug
      });
    }
  }

  if (missingPosts.length > 0) {
    console.log(`  Missing posts (${missingPosts.length}):`);
    missingPosts.slice(0, 10).forEach(p => {
      console.log(`    - [${p.id}] ${p.title}`);
    });
    if (missingPosts.length > 10) {
      console.log(`    ... and ${missingPosts.length - 10} more`);
    }
    report.missingPosts = missingPosts;
  } else {
    console.log('  All posts migrated ✓');
  }

  if (missingPages.length > 0) {
    console.log(`\n  Missing pages (${missingPages.length}):`);
    missingPages.slice(0, 10).forEach(p => {
      console.log(`    - [${p.id}] ${p.title}`);
    });
    if (missingPages.length > 10) {
      console.log(`    ... and ${missingPages.length - 10} more`);
    }
    report.missingPages = missingPages;
  } else {
    console.log('  All pages migrated ✓');
  }

  // Summary
  console.log('\n\n====================');
  console.log('Validation Summary');
  console.log('====================\n');

  const totalExpected = 
    report.counts.wordpress.posts + 
    report.counts.wordpress.pages + 
    report.counts.wordpress.categories + 
    report.counts.wordpress.tags;
  
  const totalMigrated = 
    report.counts.migrated.posts + 
    report.counts.migrated.pages + 
    report.counts.migrated.categories + 
    report.counts.migrated.tags;

  const percentage = Math.round((totalMigrated / totalExpected) * 100);

  console.log(`Overall migration: ${totalMigrated}/${totalExpected} entries (${percentage}%)`);
  console.log(`Issues found: ${report.issues.length}`);

  if (report.issues.length === 0 && percentage === 100) {
    console.log('\n🎉 Migration validation passed!');
  } else if (percentage >= 95) {
    console.log('\n✓ Migration mostly complete. Review issues above.');
  } else {
    console.log('\n⚠ Migration incomplete. Re-run migration scripts or review errors.');
  }

  // Save report
  const reportPath = './data/validation-report.json';
  await fs.writeJson(reportPath, report, { spaces: 2 });
  console.log(`\nFull report saved to: ${reportPath}`);
}

validate().catch(error => {
  console.error('\nValidation failed:', error.message);
  process.exit(1);
});
