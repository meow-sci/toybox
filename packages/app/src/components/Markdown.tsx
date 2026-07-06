/**
 * Sanitized markdown rendering for mod readmes / release notes.
 * Raw HTML in the source markdown is NOT passed through (the full marked
 * output is sanitized with DOMPurify regardless) and links open in new tabs
 * without opener access.
 */

import DOMPurify from 'dompurify'
import { marked } from 'marked'

// Module-level, once: rewrite every sanitized link to open in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function Markdown({ source }: { source: string }) {
  const html = DOMPurify.sanitize(marked.parse(source, { async: false }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'iframe'],
  })
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
