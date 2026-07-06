<script lang="ts">
  /**
   * Sanitized markdown rendering for mod readmes / release notes.
   * Raw HTML in the source markdown is NOT passed through (marked escapes it
   * only with the right options, so we sanitize the full output with
   * DOMPurify regardless) and links open in new tabs without opener access.
   */
  import DOMPurify from 'dompurify'
  import { marked } from 'marked'

  let { source }: { source: string } = $props()

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })

  const html = $derived(
    DOMPurify.sanitize(marked.parse(source, { async: false }), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'iframe'],
    }),
  )
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized above -->
<div class="markdown">{@html html}</div>

<style>
  .markdown :global(h1) {
    font-size: 1.4em;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
  }
  .markdown :global(h2) {
    font-size: 1.15em;
    margin-top: 1.4em;
  }
  .markdown :global(pre) {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
  }
  .markdown :global(pre code) {
    background: none;
    padding: 0;
  }
  .markdown :global(a) {
    color: var(--accent);
  }
  .markdown :global(img) {
    max-width: 100%;
  }
  .markdown :global(blockquote) {
    border-left: 3px solid var(--border);
    margin-left: 0;
    padding-left: 12px;
    color: var(--text-dim);
  }
</style>
