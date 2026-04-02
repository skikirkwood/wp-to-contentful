/**
 * clean-space.js
 * Deletes ALL entries, assets, and content types from the Contentful space.
 * Use this to start completely fresh.
 */

require('dotenv').config();
const contentful = require('contentful-management');
const fs = require('fs-extra');

const DELAY_MS = 500;
const BATCH_SIZE = 10;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getEnvironment() {
  const client = contentful.createClient({
    accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN,
  });
  const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
  return space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT || 'master');
}

async function deleteAllEntries(environment) {
  console.log('1. Deleting all entries...\n');
  let deleted = 0;
  let pass = 1;

  while (true) {
    const response = await environment.getEntries({ limit: BATCH_SIZE, order: 'sys.createdAt' });
    if (response.items.length === 0) break;

    console.log(`  Pass ${pass}: ${response.total} entries remaining`);

    for (const entry of response.items) {
      const title = entry.fields?.title?.['en-US'] || entry.fields?.name?.['en-US'] || entry.fields?.internalTitle?.['en-US'] || entry.sys.id;
      try {
        if (entry.sys.publishedVersion) {
          await entry.unpublish();
        }
        await entry.delete();
        deleted++;
        console.log(`  ✓ Deleted entry: ${title}`);
      } catch (err) {
        console.warn(`  ✗ Failed to delete entry ${entry.sys.id} (${title}): ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    pass++;
  }

  console.log(`\n  Entries deleted: ${deleted}\n`);
  return deleted;
}

async function deleteAllAssets(environment) {
  console.log('2. Deleting all assets...\n');
  let deleted = 0;
  let pass = 1;

  while (true) {
    const response = await environment.getAssets({ limit: BATCH_SIZE, order: 'sys.createdAt' });
    if (response.items.length === 0) break;

    console.log(`  Pass ${pass}: ${response.total} assets remaining`);

    for (const asset of response.items) {
      const title = asset.fields?.title?.['en-US'] || asset.sys.id;
      try {
        if (asset.sys.publishedVersion) {
          await asset.unpublish();
        }
        await asset.delete();
        deleted++;
        console.log(`  ✓ Deleted asset: ${title}`);
      } catch (err) {
        console.warn(`  ✗ Failed to delete asset ${asset.sys.id} (${title}): ${err.message}`);
      }
      await sleep(DELAY_MS);
    }
    pass++;
  }

  console.log(`\n  Assets deleted: ${deleted}\n`);
  return deleted;
}

async function deleteAllContentTypes(environment) {
  console.log('3. Deleting all content types...\n');
  let deleted = 0;

  const response = await environment.getContentTypes({ limit: 100 });
  console.log(`  Found ${response.items.length} content type(s)\n`);

  for (const ct of response.items) {
    try {
      if (ct.sys.publishedVersion) {
        await ct.unpublish();
      }
      await ct.delete();
      deleted++;
      console.log(`  ✓ Deleted content type: ${ct.name} (${ct.sys.id})`);
    } catch (err) {
      console.warn(`  ✗ Failed to delete content type ${ct.sys.id}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n  Content types deleted: ${deleted}\n`);
  return deleted;
}

async function cleanSpace() {
  console.log('Contentful Space Cleanup');
  console.log('========================\n');
  console.log(`Space: ${process.env.CONTENTFUL_SPACE_ID}`);
  console.log(`Environment: ${process.env.CONTENTFUL_ENVIRONMENT || 'master'}\n`);

  const environment = await getEnvironment();

  const entries = await deleteAllEntries(environment);
  const assets = await deleteAllAssets(environment);
  const contentTypes = await deleteAllContentTypes(environment);

  // Clear local map/progress files
  console.log('4. Clearing local data files...\n');
  const dataFiles = ['./data/asset-map.json', './data/entry-map.json', './data/validation-report.json'];
  let cleared = 0;
  for (const f of dataFiles) {
    if (await fs.pathExists(f)) {
      await fs.remove(f);
      cleared++;
      console.log(`  ✓ Removed ${f}`);
    }
  }
  if (cleared === 0) console.log('  No data files to clear.');

  console.log('\n========================');
  console.log('Cleanup Complete!\n');
  console.log(`  Entries deleted:       ${entries}`);
  console.log(`  Assets deleted:        ${assets}`);
  console.log(`  Content types deleted: ${contentTypes}`);
  console.log(`  Data files cleared:    ${cleared}`);
}

cleanSpace().catch(err => {
  console.error('\nCleanup failed:', err.message);
  process.exit(1);
});
