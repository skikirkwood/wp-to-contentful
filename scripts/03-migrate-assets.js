/**
 * 03-migrate-assets.js
 * Migrates WordPress media library to Contentful Assets
 *
 * Downloads files from WordPress URLs, uploads to Contentful via createUpload,
 * then creates assets with uploadFrom (Contentful no longer accepts external URLs in upload field).
 */

require('dotenv').config();
const contentful = require('contentful-management');
const fs = require('fs-extra');
const axios = require('axios');

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
 * Check if asset was already migrated by querying wpId metadata
 */
async function findExistingAsset(environment, wpId) {
  // Search for asset with matching wpId in metadata
  // Note: This is a simplified check - in production you might use tags or external references
  try {
    const assets = await environment.getAssets({
      'metadata.tags.sys.id[in]': `wp-${wpId}`
    });
    return assets.items[0] || null;
  } catch (error) {
    return null;
  }
}

/**
 * Wait for asset processing to complete
 */
async function waitForProcessing(environment, assetId, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const asset = await environment.getAsset(assetId);
    
    // Check if file has been processed (url is populated)
    const file = asset.fields.file?.['en-US'];
    if (file?.url) {
      return asset;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  throw new Error(`Asset ${assetId} processing timeout`);
}

/**
 * Sanitize title for Contentful
 */
function sanitizeTitle(title) {
  if (!title) return 'Untitled Asset';
  // Remove HTML entities and trim
  return title
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, '')
    .trim() || 'Untitled Asset';
}

/**
 * Get source URL for media item - WordPress REST API field names and fallbacks
 */
function getSourceUrl(item) {
  return item.source_url || item.guid?.rendered || null;
}

/**
 * Get file extension from URL or mime type
 */
function getFileName(item) {
  const sourceUrl = getSourceUrl(item);
  const urlPath = sourceUrl?.split('?')[0] || '';
  const fileName = urlPath.split('/').pop() || `asset-${item.id}`;
  return fileName;
}

async function migrateAssets() {
  console.log('Contentful Asset Migration');
  console.log('==========================\n');

  // Use PoC export if it exists (from npm run filter-poc)
  const wpExportPath = await fs.pathExists('./data/wp-export-poc.json')
    ? './data/wp-export-poc.json'
    : './data/wp-export.json';
  if (wpExportPath.includes('poc')) {
    console.log('Using PoC export (wp-export-poc.json)\n');
  }
  if (!await fs.pathExists(wpExportPath)) {
    console.error('Error: wp-export.json not found. Run npm run export first.');
    process.exit(1);
  }

  const wpData = await fs.readJson(wpExportPath);
  const rawMedia = wpData.media || [];
  
  // Filter invalid items (empty strings, null) - some WordPress hosts return these
  const media = rawMedia.filter(item => typeof item === 'object' && item !== null);
  
  if (rawMedia.length > 0 && media.length === 0) {
    console.error('Error: wp-export.json has media entries but they are invalid (empty or missing data).');
    console.error('Re-run "npm run export" to fetch fresh data. Ensure WP_API_URL points to wp/v2 and');
    console.error('set WP_USERNAME/WP_APP_PASSWORD if the WordPress site requires authentication.');
    process.exit(1);
  }
  
  console.log(`Found ${media.length} media items to migrate\n`);

  if (media.length === 0) {
    console.log('No media to migrate.');
    await fs.writeJson('./data/asset-map.json', {}, { spaces: 2 });
    return;
  }

  const { environment } = await getClient();
  
  // Load existing asset map for resume capability
  const assetMapPath = './data/asset-map.json';
  let assetMap = {};
  if (await fs.pathExists(assetMapPath)) {
    assetMap = await fs.readJson(assetMapPath);
    console.log(`Resuming from previous run (${Object.keys(assetMap).length} assets already migrated)\n`);
  }

  const stats = {
    total: media.length,
    migrated: 0,
    skipped: 0,
    failed: 0
  };

  // Process in batches
  for (let i = 0; i < media.length; i += BATCH_SIZE) {
    const batch = media.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(async (item) => {
      const wpId = item.id;
      
      // Skip if already migrated
      if (assetMap[wpId]) {
        stats.skipped++;
        return;
      }

      try {
        const title = sanitizeTitle(item.title?.rendered);
        const description = item.alt_text || item.caption?.rendered?.replace(/<[^>]*>/g, '') || '';
        const fileName = getFileName(item);
        const sourceUrl = getSourceUrl(item);

        if (!sourceUrl) {
          throw new Error('No source_url or guid.rendered for media item');
        }

        // Download file from WordPress (Contentful requires file content, not external URLs)
        // Contentful CMA allows up to 1GB; set MAX_ASSET_SIZE_MB in .env for larger files
        const maxSizeMB = parseInt(process.env.MAX_ASSET_SIZE_MB || '500');
        const axiosConfig = {
          responseType: 'arraybuffer',
          maxContentLength: maxSizeMB * 1024 * 1024,
          timeout: 120000, // 2 min for large files
          validateStatus: (status) => status === 200
        };
        if (process.env.WP_USERNAME && process.env.WP_APP_PASSWORD) {
          axiosConfig.auth = {
            username: process.env.WP_USERNAME,
            password: process.env.WP_APP_PASSWORD
          };
        }
        const response = await axios.get(sourceUrl, axiosConfig);

        const fileBuffer = Buffer.from(response.data);

        // Upload file to Contentful (createUpload only accepts file content)
        const upload = await environment.createUpload({
          file: fileBuffer
        });

        // Create asset with uploadFrom reference
        const asset = await environment.createAsset({
          fields: {
            title: { 'en-US': title },
            description: { 'en-US': description.substring(0, 500) },
            file: {
              'en-US': {
                contentType: item.mime_type,
                fileName,
                uploadFrom: {
                  sys: {
                    type: 'Link',
                    linkType: 'Upload',
                    id: upload.sys.id
                  }
                }
              }
            }
          }
        });

        // Process the asset (processes the uploaded file)
        await asset.processForAllLocales();
        
        // Wait for processing to complete
        const processedAsset = await waitForProcessing(environment, asset.sys.id);
        
        // Publish the asset
        await processedAsset.publish();
        
        assetMap[wpId] = asset.sys.id;
        stats.migrated++;
        
        console.log(`  ✓ ${title.substring(0, 50)}...`);
        
      } catch (error) {
        stats.failed++;
        console.error(`  ✗ Failed [${wpId}]: ${error.message}`);
        
        // Log detailed error for debugging
        if (error.details?.errors) {
          console.error(`    Details: ${JSON.stringify(error.details.errors)}`);
        }
      }
    });

    await Promise.all(promises);
    
    // Save progress after each batch
    await fs.writeJson(assetMapPath, assetMap, { spaces: 2 });
    
    const progress = Math.min(i + BATCH_SIZE, media.length);
    console.log(`\n  Progress: ${progress}/${media.length} (${Math.round(progress/media.length*100)}%)\n`);
    
    // Rate limiting delay
    if (i + BATCH_SIZE < media.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log('==========================');
  console.log('Asset Migration Complete!\n');
  console.log('Statistics:');
  console.log(`  Total:    ${stats.total}`);
  console.log(`  Migrated: ${stats.migrated}`);
  console.log(`  Skipped:  ${stats.skipped}`);
  console.log(`  Failed:   ${stats.failed}`);
  console.log(`\nAsset map saved to: ./data/asset-map.json`);
  console.log('\nNext step: npm run migrate-content');
}

migrateAssets().catch(error => {
  console.error('\nMigration failed:', error.message);
  process.exit(1);
});
