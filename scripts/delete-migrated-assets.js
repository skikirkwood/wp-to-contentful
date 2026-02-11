/**
 * delete-migrated-assets.js
 * Deletes all assets that were uploaded by migrate-assets.
 * Reads asset-map.json, unpublishes and deletes each asset, then clears the map.
 *
 * Usage: npm run delete-assets
 */

require('dotenv').config();
const contentful = require('contentful-management');
const fs = require('fs-extra');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 5;
const DELAY_MS = parseInt(process.env.DELAY_MS) || 500;

async function getClient() {
  const client = contentful.createClient({
    accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
  });
  const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
  const environment = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT || 'master');
  return { environment };
}

async function deleteAssets() {
  console.log('Delete Migrated Assets');
  console.log('=================\n');

  const assetMapPath = './data/asset-map.json';
  if (!await fs.pathExists(assetMapPath)) {
    console.log('No asset-map.json found. Nothing to delete.');
    return;
  }

  const assetMap = await fs.readJson(assetMapPath);
  const assetIds = Object.values(assetMap);
  const count = assetIds.length;

  if (count === 0) {
    console.log('Asset map is empty. Nothing to delete.');
    return;
  }

  console.log(`Found ${count} assets to delete.\n`);

  const { environment } = await getClient();
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
    const batch = assetIds.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (assetId) => {
      try {
        const asset = await environment.getAsset(assetId);
        if (asset.isPublished()) {
          await asset.unpublish();
        }
        await asset.delete();
        deleted++;
        process.stdout.write(`  ✓ Deleted ${deleted}/${count}\r`);
      } catch (error) {
        failed++;
        if (error.name === 'NotFound') {
          // Already deleted
          deleted++;
        } else {
          console.error(`\n  ✗ Failed to delete ${assetId}: ${error.message}`);
        }
      }
    }));

    if (i + BATCH_SIZE < assetIds.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n\nDeleted: ${deleted}, Failed: ${failed}`);

  // Clear asset map
  await fs.writeJson(assetMapPath, {}, { spaces: 2 });
  console.log('\nCleared asset-map.json.');
}

deleteAssets().catch(err => {
  console.error(err);
  process.exit(1);
});
