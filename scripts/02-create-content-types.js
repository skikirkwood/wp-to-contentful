/**
 * 02-create-content-types.js
 * Creates Contentful content types for WordPress content
 */

require('dotenv').config();
const contentful = require('contentful-management');
const fs = require('fs-extra');
const path = require('path');

async function getClient() {
  const client = contentful.createClient({
    accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
  });
  
  const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
  const environment = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT || 'master');
  
  return { client, space, environment };
}

/**
 * Check if content type exists
 */
async function contentTypeExists(environment, id) {
  try {
    await environment.getContentType(id);
    return true;
  } catch (error) {
    if (error.name === 'NotFound') return false;
    throw error;
  }
}

/**
 * Create or update a content type
 */
async function createContentType(environment, id, definition) {
  const exists = await contentTypeExists(environment, id);
  
  if (exists) {
    console.log(`  ⏭  ${id} already exists, skipping`);
    return;
  }
  
  try {
    const contentType = await environment.createContentTypeWithId(id, definition);
    await contentType.publish();
    console.log(`  ✓  Created: ${id}`);
  } catch (error) {
    console.error(`  ✗  Failed to create ${id}: ${error.message}`);
    throw error;
  }
}

async function createContentTypes() {
  console.log('Contentful Content Type Creation');
  console.log('================================\n');
  
  if (!process.env.CONTENTFUL_MANAGEMENT_TOKEN || !process.env.CONTENTFUL_SPACE_ID) {
    console.error('Error: Missing Contentful credentials in .env');
    process.exit(1);
  }

  const { environment } = await getClient();
  console.log(`Space: ${process.env.CONTENTFUL_SPACE_ID}`);
  console.log(`Environment: ${process.env.CONTENTFUL_ENVIRONMENT || 'master'}\n`);

  // Load custom mappings if they exist
  const mappingsPath = path.join(__dirname, '../mappings/content-type-mappings.json');
  let customMappings = {};
  if (await fs.pathExists(mappingsPath)) {
    customMappings = await fs.readJson(mappingsPath);
    console.log('Loaded custom mappings\n');
  }

  console.log('Creating content types:\n');

  // Author content type
  await createContentType(environment, 'author', {
    name: 'Author',
    displayField: 'name',
    fields: [
      {
        id: 'name',
        name: 'Name',
        type: 'Symbol',
        required: true
      },
      {
        id: 'slug',
        name: 'Slug',
        type: 'Symbol',
        required: true,
        validations: [{ unique: true }]
      },
      {
        id: 'bio',
        name: 'Bio',
        type: 'Text'
      },
      {
        id: 'avatar',
        name: 'Avatar',
        type: 'Link',
        linkType: 'Asset'
      },
      {
        id: 'email',
        name: 'Email',
        type: 'Symbol'
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Category content type
  await createContentType(environment, 'category', {
    name: 'Category',
    displayField: 'name',
    fields: [
      {
        id: 'name',
        name: 'Name',
        type: 'Symbol',
        required: true
      },
      {
        id: 'slug',
        name: 'Slug',
        type: 'Symbol',
        required: true,
        validations: [{ unique: true }]
      },
      {
        id: 'description',
        name: 'Description',
        type: 'Text'
      },
      {
        id: 'parent',
        name: 'Parent Category',
        type: 'Link',
        linkType: 'Entry',
        validations: [{ linkContentType: ['category'] }]
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Tag content type
  await createContentType(environment, 'tag', {
    name: 'Tag',
    displayField: 'name',
    fields: [
      {
        id: 'name',
        name: 'Name',
        type: 'Symbol',
        required: true
      },
      {
        id: 'slug',
        name: 'Slug',
        type: 'Symbol',
        required: true,
        validations: [{ unique: true }]
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Blog Post content type
  await createContentType(environment, 'blogPost', {
    name: 'Blog Post',
    displayField: 'title',
    fields: [
      {
        id: 'title',
        name: 'Title',
        type: 'Symbol',
        required: true
      },
      {
        id: 'slug',
        name: 'Slug',
        type: 'Symbol',
        required: true,
        validations: [{ unique: true }]
      },
      {
        id: 'publishDate',
        name: 'Publish Date',
        type: 'Date',
        required: true
      },
      {
        id: 'modifiedDate',
        name: 'Modified Date',
        type: 'Date'
      },
      {
        id: 'excerpt',
        name: 'Excerpt',
        type: 'Text'
      },
      {
        id: 'content',
        name: 'Content',
        type: 'RichText',
        validations: [
          {
            enabledNodeTypes: [
              'document', 'paragraph', 'heading-2', 'heading-3', 'heading-4',
              'blockquote', 'unordered-list', 'ordered-list', 'list-item',
              'hr', 'embedded-asset-block', 'embedded-entry-block',
              'embedded-entry-inline',
              'hyperlink', 'entry-hyperlink', 'asset-hyperlink'
            ]
          },
          {
            enabledMarks: ['bold', 'italic', 'underline', 'code']
          }
        ]
      },
      {
        id: 'featuredImage',
        name: 'Featured Image',
        type: 'Link',
        linkType: 'Asset'
      },
      {
        id: 'author',
        name: 'Author',
        type: 'Link',
        linkType: 'Entry',
        validations: [{ linkContentType: ['author'] }]
      },
      {
        id: 'categories',
        name: 'Categories',
        type: 'Array',
        items: {
          type: 'Link',
          linkType: 'Entry',
          validations: [{ linkContentType: ['category'] }]
        }
      },
      {
        id: 'tags',
        name: 'Tags',
        type: 'Array',
        items: {
          type: 'Link',
          linkType: 'Entry',
          validations: [{ linkContentType: ['tag'] }]
        }
      },
      {
        id: 'seoTitle',
        name: 'SEO Title',
        type: 'Symbol'
      },
      {
        id: 'seoDescription',
        name: 'SEO Description',
        type: 'Text',
        validations: [{ size: { max: 160 } }]
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Create custom content types early (page sections may reference them)
  if (customMappings.contentTypes) {
    console.log('\nCreating custom content types:\n');
    for (const [id, definition] of Object.entries(customMappings.contentTypes)) {
      await createContentType(environment, id, definition);
    }
  }

  // Rich Text Section - for free-form content blocks on pages
  const richTextValidations = [
    {
      enabledNodeTypes: [
        'document', 'paragraph', 'heading-2', 'heading-3', 'heading-4',
        'blockquote', 'unordered-list', 'ordered-list', 'list-item',
        'hr', 'embedded-asset-block', 'embedded-entry-block',
        'embedded-entry-inline',
        'hyperlink', 'entry-hyperlink', 'asset-hyperlink'
      ]
    },
    { enabledMarks: ['bold', 'italic', 'underline', 'code'] }
  ];

  await createContentType(environment, 'richTextSection', {
    name: 'Rich Text Section',
    displayField: 'internalTitle',
    description: 'Free-form rich text content block for pages',
    fields: [
      {
        id: 'internalTitle',
        name: 'Internal Title',
        type: 'Symbol',
        required: true,
        disabled: false
      },
      {
        id: 'content',
        name: 'Content',
        type: 'RichText',
        validations: richTextValidations
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Blog Post Grid Section - for showcasing blog posts on pages
  await createContentType(environment, 'blogPostGridSection', {
    name: 'Blog Post Grid Section',
    displayField: 'sectionTitle',
    description: 'Section that displays a grid of blog post references',
    fields: [
      {
        id: 'sectionTitle',
        name: 'Section Title',
        type: 'Symbol',
        required: false
      },
      {
        id: 'blogPosts',
        name: 'Blog Posts',
        type: 'Array',
        items: {
          type: 'Link',
          linkType: 'Entry',
          validations: [{ linkContentType: ['blogPost'] }]
        }
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Content Reference Section - for referencing any content (blog posts, products, etc.)
  await createContentType(environment, 'contentReferenceSection', {
    name: 'Content Reference Section',
    displayField: 'sectionTitle',
    description: 'Section that references blog posts, products, or other content',
    fields: [
      {
        id: 'sectionTitle',
        name: 'Section Title',
        type: 'Symbol',
        required: false
      },
      {
        id: 'entries',
        name: 'Referenced Content',
        type: 'Array',
        items: {
          type: 'Link',
          linkType: 'Entry',
          validations: [{
            linkContentType: ['blogPost', 'product', 'testimonial']
          }]
        }
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Page content type - modular, references sections and content
  await createContentType(environment, 'page', {
    name: 'Page',
    displayField: 'title',
    description: 'Modular page composed of sections that can include rich text and content references',
    fields: [
      {
        id: 'title',
        name: 'Title',
        type: 'Symbol',
        required: true
      },
      {
        id: 'slug',
        name: 'Slug',
        type: 'Symbol',
        required: true,
        validations: [{ unique: true }]
      },
      {
        id: 'sections',
        name: 'Sections',
        type: 'Array',
        items: {
          type: 'Link',
          linkType: 'Entry',
          validations: [{
            linkContentType: ['richTextSection', 'blogPostGridSection', 'contentReferenceSection']
          }]
        }
      },
      {
        id: 'featuredImage',
        name: 'Featured Image',
        type: 'Link',
        linkType: 'Asset'
      },
      {
        id: 'parent',
        name: 'Parent Page',
        type: 'Link',
        linkType: 'Entry',
        validations: [{ linkContentType: ['page'] }]
      },
      {
        id: 'template',
        name: 'Template',
        type: 'Symbol',
        validations: [{
          in: ['default', 'full-width', 'sidebar', 'landing']
        }]
      },
      {
        id: 'seoTitle',
        name: 'SEO Title',
        type: 'Symbol'
      },
      {
        id: 'seoDescription',
        name: 'SEO Description',
        type: 'Text',
        validations: [{ size: { max: 160 } }]
      },
      {
        id: 'wpId',
        name: 'WordPress ID',
        type: 'Integer',
        disabled: true
      }
    ]
  });

  // Note: If page content type already exists with the old schema (single content field),
  // you'll need to delete it in Contentful and re-run, or manually migrate the model.

  console.log('\n================================');
  console.log('Content type creation complete!');
  console.log('\nNext step: npm run migrate-assets');
}

createContentTypes().catch(error => {
  console.error('\nFailed:', error.message);
  process.exit(1);
});
