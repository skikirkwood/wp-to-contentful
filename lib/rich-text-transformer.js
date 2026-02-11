/**
 * rich-text-transformer.js
 * Converts WordPress HTML content to Contentful Rich Text format
 */

const { BLOCKS, INLINES } = require('@contentful/rich-text-types');
const { parse } = require('node-html-parser');

class RichTextTransformer {
  /**
   * @param {Object} assetMap - Maps WordPress media IDs to Contentful asset IDs
   * @param {Object} entryMap - Maps WordPress post IDs to Contentful entry IDs
   * @param {Object} options - Configuration options
   */
  constructor(assetMap = {}, entryMap = {}, options = {}) {
    this.assetMap = assetMap;
    this.entryMap = entryMap;
    this.options = {
      preserveWhitespace: false,
      stripShortcodes: true,
      ...options
    };
    this.warnings = [];
  }

  /**
   * Transform WordPress HTML to Contentful Rich Text
   * @param {string} wpHtml - WordPress HTML content
   * @returns {Object} Contentful Rich Text document
   */
  transform(wpHtml) {
    this.warnings = [];
    
    if (!wpHtml || typeof wpHtml !== 'string') {
      return this.emptyDocument();
    }

    // Pre-process HTML
    let html = wpHtml;
    
    // Strip WordPress shortcodes if enabled
    if (this.options.stripShortcodes) {
      html = this.stripShortcodes(html);
    }

    // Handle WordPress Gutenberg blocks
    html = this.preprocessGutenbergBlocks(html);

    // Parse HTML
    const root = parse(html, {
      blockTextElements: {
        script: false,
        noscript: false,
        style: false,
        pre: true
      }
    });

    // Process nodes
    const content = this.processNodes(root.childNodes);

    // Ensure we have at least one block
    const finalContent = content.length > 0 ? content : [this.emptyParagraph()];

    return {
      nodeType: 'document',
      data: {},
      content: finalContent
    };
  }

  /**
   * Get warnings from last transformation
   */
  getWarnings() {
    return this.warnings;
  }

  /**
   * Strip WordPress shortcodes
   */
  stripShortcodes(html) {
    // Remove shortcodes like [gallery], [caption], etc.
    // Preserve content inside [caption]...[/caption]
    html = html.replace(/\[caption[^\]]*\](.*?)\[\/caption\]/gi, '$1');
    
    // Remove self-closing shortcodes
    html = html.replace(/\[[^\]]+\/\]/g, '');
    
    // Remove opening/closing shortcode pairs (but not content between)
    html = html.replace(/\[(\w+)[^\]]*\](.*?)\[\/\1\]/gi, '$2');
    
    // Remove remaining shortcodes
    html = html.replace(/\[[^\]]+\]/g, '');
    
    return html;
  }

  /**
   * Pre-process Gutenberg block comments
   */
  preprocessGutenbergBlocks(html) {
    // Remove Gutenberg block comments
    html = html.replace(/<!--\s*wp:[^>]+-->/g, '');
    html = html.replace(/<!--\s*\/wp:[^>]+-->/g, '');
    return html;
  }

  /**
   * Process an array of nodes
   */
  processNodes(nodes) {
    const results = [];
    
    for (const node of nodes) {
      const processed = this.processNode(node);
      if (processed) {
        if (Array.isArray(processed)) {
          results.push(...processed.filter(Boolean));
        } else {
          results.push(processed);
        }
      }
    }
    
    return results;
  }

  /**
   * Process a single node
   */
  processNode(node) {
    // Text node
    if (node.nodeType === 3) {
      const text = node.text;
      // Skip whitespace-only text nodes at block level
      if (!text.trim() && !this.options.preserveWhitespace) {
        return null;
      }
      return this.createTextNode(text);
    }

    // Comment node
    if (node.nodeType === 8) {
      return null;
    }

    // Element node
    const tag = node.tagName?.toLowerCase();
    if (!tag) return null;

    switch (tag) {
      // Block elements
      case 'p':
        return this.createParagraph(node);
      
      case 'h1':
      case 'h2':
        return this.createHeading(node, 2);
      
      case 'h3':
        return this.createHeading(node, 3);
      
      case 'h4':
      case 'h5':
      case 'h6':
        return this.createHeading(node, 4);
      
      case 'ul':
        return this.createList(node, BLOCKS.UL_LIST);
      
      case 'ol':
        return this.createList(node, BLOCKS.OL_LIST);
      
      case 'blockquote':
        return this.createBlockquote(node);
      
      case 'pre':
        return this.createParagraph(node); // Preserve as paragraph with code marks
      
      case 'hr':
        return { nodeType: BLOCKS.HR, data: {}, content: [] };
      
      case 'table':
        // Tables aren't supported in Contentful Rich Text
        // Convert to text representation
        this.warnings.push('Table converted to text (not supported in Rich Text)');
        return this.tableToText(node);
      
      // Media elements
      case 'img':
        return this.createEmbeddedAsset(node);
      
      case 'figure':
        return this.processFigure(node);
      
      case 'video':
      case 'audio':
        this.warnings.push(`${tag} element skipped (not directly supported)`);
        return null;
      
      case 'iframe':
        // Could be embedded video, etc.
        this.warnings.push('iframe skipped (embed content manually)');
        return null;
      
      // Inline elements that should create hyperlinks
      case 'a':
        return this.createHyperlink(node);
      
      // Container elements - process children
      case 'div':
      case 'section':
      case 'article':
      case 'main':
      case 'aside':
      case 'header':
      case 'footer':
      case 'span':
        return this.processNodes(node.childNodes);
      
      // Line break
      case 'br':
        return this.createTextNode('\n');
      
      // Inline formatting - handled in inline context
      case 'strong':
      case 'b':
      case 'em':
      case 'i':
      case 'u':
      case 'code':
      case 'mark':
      case 'sub':
      case 'sup':
        return this.wrapWithMark(node, this.getMarkType(tag));
      
      default:
        // Unknown element - try to process children
        return this.processNodes(node.childNodes);
    }
  }

  /**
   * Create a paragraph node
   */
  createParagraph(node) {
    const content = this.processInlineContent(node);
    
    // Skip empty paragraphs
    if (!content.length || (content.length === 1 && content[0].value === '')) {
      return null;
    }
    
    return {
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content
    };
  }

  /**
   * Create a heading node
   */
  createHeading(node, level) {
    const content = this.processInlineContent(node);
    
    if (!content.length) {
      return null;
    }
    
    return {
      nodeType: `heading-${level}`,
      data: {},
      content
    };
  }

  /**
   * Create a list node
   */
  createList(node, listType) {
    const items = [];
    
    for (const child of node.childNodes) {
      if (child.tagName?.toLowerCase() === 'li') {
        const listItemContent = [];
        
        // Check if list item contains nested lists
        const nestedLists = child.querySelectorAll(':scope > ul, :scope > ol');
        
        if (nestedLists.length > 0) {
          // Process non-list children first
          const inlineContent = this.processInlineContent(child, true);
          if (inlineContent.length > 0) {
            listItemContent.push({
              nodeType: BLOCKS.PARAGRAPH,
              data: {},
              content: inlineContent
            });
          }
          
          // Then process nested lists
          for (const nestedList of nestedLists) {
            const nestedType = nestedList.tagName.toLowerCase() === 'ul' 
              ? BLOCKS.UL_LIST 
              : BLOCKS.OL_LIST;
            const nested = this.createList(nestedList, nestedType);
            if (nested) {
              listItemContent.push(nested);
            }
          }
        } else {
          // Simple list item
          const content = this.processInlineContent(child);
          if (content.length > 0) {
            listItemContent.push({
              nodeType: BLOCKS.PARAGRAPH,
              data: {},
              content
            });
          }
        }
        
        if (listItemContent.length > 0) {
          items.push({
            nodeType: BLOCKS.LIST_ITEM,
            data: {},
            content: listItemContent
          });
        }
      }
    }
    
    if (items.length === 0) {
      return null;
    }
    
    return {
      nodeType: listType,
      data: {},
      content: items
    };
  }

  /**
   * Create a blockquote node
   */
  createBlockquote(node) {
    const blocks = this.processNodes(node.childNodes);
    
    // Ensure blockquote has at least a paragraph
    const content = blocks.length > 0 ? blocks : [{
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content: this.processInlineContent(node)
    }];
    
    return {
      nodeType: BLOCKS.QUOTE,
      data: {},
      content: content.filter(b => b.nodeType === BLOCKS.PARAGRAPH)
    };
  }

  /**
   * Process a figure element (typically contains images)
   */
  processFigure(node) {
    const results = [];
    
    // Find image
    const img = node.querySelector('img');
    if (img) {
      const asset = this.createEmbeddedAsset(img);
      if (asset) {
        results.push(asset);
      }
    }
    
    // Find caption
    const figcaption = node.querySelector('figcaption');
    if (figcaption) {
      const caption = this.createParagraph(figcaption);
      if (caption) {
        results.push(caption);
      }
    }
    
    return results;
  }

  /**
   * Create an embedded asset node
   */
  createEmbeddedAsset(imgNode) {
    const src = imgNode.getAttribute('src') || '';
    const classAttr = imgNode.getAttribute('class') || '';
    const dataId = imgNode.getAttribute('data-id');
    
    // Try to find WordPress media ID
    let wpId = null;
    
    // Check data-id attribute (Gutenberg)
    if (dataId) {
      wpId = parseInt(dataId);
    }
    
    // Check class for wp-image-{id}
    if (!wpId) {
      const wpIdMatch = classAttr.match(/wp-image-(\d+)/);
      if (wpIdMatch) {
        wpId = parseInt(wpIdMatch[1]);
      }
    }
    
    // Try to extract from URL
    if (!wpId) {
      const urlMatch = src.match(/\/(\d+)\//);
      if (urlMatch) {
        wpId = parseInt(urlMatch[1]);
      }
    }
    
    // Look up Contentful asset ID
    const contentfulAssetId = wpId ? this.assetMap[wpId] : null;
    
    if (!contentfulAssetId) {
      this.warnings.push(`Asset not found for image: ${src.substring(0, 100)}`);
      
      // Fallback: create paragraph with image info
      const alt = imgNode.getAttribute('alt') || '';
      return {
        nodeType: BLOCKS.PARAGRAPH,
        data: {},
        content: [{
          nodeType: 'text',
          value: `[Image: ${alt || src}]`,
          marks: [{ type: 'italic' }],
          data: {}
        }]
      };
    }

    return {
      nodeType: BLOCKS.EMBEDDED_ASSET,
      data: {
        target: {
          sys: {
            type: 'Link',
            linkType: 'Asset',
            id: contentfulAssetId
          }
        }
      },
      content: []
    };
  }

  /**
   * Create a hyperlink node
   */
  createHyperlink(node) {
    const href = node.getAttribute('href') || '';
    const content = this.processInlineContent(node);
    
    if (!content.length) {
      content.push(this.createTextNode(href || 'link'));
    }

    // Check if internal link to migrated post
    const wpPostId = this.extractWpPostIdFromUrl(href);
    const contentfulEntryId = wpPostId ? this.entryMap[`post_${wpPostId}`] : null;
    
    if (contentfulEntryId) {
      return {
        nodeType: INLINES.ENTRY_HYPERLINK,
        data: {
          target: {
            sys: {
              type: 'Link',
              linkType: 'Entry',
              id: contentfulEntryId
            }
          }
        },
        content
      };
    }

    // External hyperlink
    return {
      nodeType: INLINES.HYPERLINK,
      data: { uri: href },
      content
    };
  }

  /**
   * Process inline content from a node
   */
  processInlineContent(node, excludeNestedLists = false) {
    const results = [];
    
    for (const child of node.childNodes) {
      // Skip nested lists if requested
      if (excludeNestedLists) {
        const tag = child.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol') continue;
      }
      
      if (child.nodeType === 3) {
        // Text node
        const text = child.text;
        if (text) {
          results.push(this.createTextNode(text));
        }
      } else if (child.nodeType === 1) {
        // Element node
        const tag = child.tagName?.toLowerCase();
        
        // Handle inline elements
        if (['strong', 'b', 'em', 'i', 'u', 'code', 'mark'].includes(tag)) {
          const marked = this.wrapWithMark(child, this.getMarkType(tag));
          if (Array.isArray(marked)) {
            results.push(...marked);
          } else if (marked) {
            results.push(marked);
          }
        } else if (tag === 'a') {
          results.push(this.createHyperlink(child));
        } else if (tag === 'br') {
          results.push(this.createTextNode('\n'));
        } else if (tag === 'img') {
          // Inline image - skip (handled at block level)
        } else {
          // Recurse into other elements
          const nested = this.processInlineContent(child, excludeNestedLists);
          results.push(...nested);
        }
      }
    }
    
    // Ensure at least one text node
    if (results.length === 0) {
      return [this.createTextNode('')];
    }
    
    return results;
  }

  /**
   * Wrap content with a mark
   */
  wrapWithMark(node, markType) {
    if (!markType) {
      return this.processInlineContent(node);
    }
    
    const content = this.processInlineContent(node);
    
    return content.map(item => {
      if (item.nodeType === 'text') {
        return {
          ...item,
          marks: [...(item.marks || []), { type: markType }]
        };
      }
      return item;
    });
  }

  /**
   * Get mark type for HTML tag
   */
  getMarkType(tag) {
    const markMap = {
      'strong': 'bold',
      'b': 'bold',
      'em': 'italic',
      'i': 'italic',
      'u': 'underline',
      'code': 'code',
      'mark': 'bold', // No direct equivalent
      'sub': 'subscript',
      'sup': 'superscript'
    };
    return markMap[tag];
  }

  /**
   * Convert table to text
   */
  tableToText(tableNode) {
    const rows = tableNode.querySelectorAll('tr');
    const textRows = [];
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td, th');
      const cellTexts = Array.from(cells).map(cell => 
        cell.textContent.trim()
      );
      textRows.push(cellTexts.join(' | '));
    }
    
    return {
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content: [{
        nodeType: 'text',
        value: textRows.join('\n'),
        marks: [],
        data: {}
      }]
    };
  }

  /**
   * Try to extract WordPress post ID from URL
   */
  extractWpPostIdFromUrl(url) {
    if (!url) return null;
    
    // Match ?p=123 format
    const paramMatch = url.match(/[?&]p=(\d+)/);
    if (paramMatch) return parseInt(paramMatch[1]);
    
    // This would need customization based on your permalink structure
    return null;
  }

  /**
   * Create a text node
   */
  createTextNode(text) {
    return {
      nodeType: 'text',
      value: text,
      marks: [],
      data: {}
    };
  }

  /**
   * Create an empty document
   */
  emptyDocument() {
    return {
      nodeType: 'document',
      data: {},
      content: [this.emptyParagraph()]
    };
  }

  /**
   * Create an empty paragraph
   */
  emptyParagraph() {
    return {
      nodeType: BLOCKS.PARAGRAPH,
      data: {},
      content: [this.createTextNode('')]
    };
  }
}

module.exports = RichTextTransformer;
