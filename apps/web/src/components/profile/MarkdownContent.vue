<script setup lang="ts">
import { computed } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";

const props = defineProps<{ source: string }>();

const html = computed(() => {
  const rendered = marked.parse(props.source, { async: false, breaks: true, gfm: true }) as string;
  const clean = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "blockquote", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "h4", "hr", "a", "img", "table", "thead", "tbody", "tr", "th", "td"],
    ALLOWED_ATTR: ["href", "src", "alt", "title"],
    ALLOW_DATA_ATTR: false,
  });
  const document = new DOMParser().parseFromString(clean, "text/html");
  document.querySelectorAll("a").forEach((anchor) => {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer nofollow";
  });
  document.querySelectorAll("img").forEach((image) => {
    image.loading = "lazy";
    image.decoding = "async";
  });
  return document.body.innerHTML;
});
</script>

<template>
  <div class="markdown-content" v-html="html"></div>
</template>

<style scoped>
.markdown-content { min-width: 0; color: var(--ink); font-size: 14.5px; line-height: 1.85; overflow-wrap: anywhere; }
.markdown-content :deep(> :first-child) { margin-top: 0; }
.markdown-content :deep(> :last-child) { margin-bottom: 0; }
.markdown-content :deep(p), .markdown-content :deep(ul), .markdown-content :deep(ol), .markdown-content :deep(blockquote), .markdown-content :deep(pre), .markdown-content :deep(table) { margin: .8em 0; }
.markdown-content :deep(h1), .markdown-content :deep(h2), .markdown-content :deep(h3), .markdown-content :deep(h4) { margin: 1.25em 0 .5em; color: var(--ink); font-family: var(--serif); font-weight: 400; line-height: 1.45; letter-spacing: .04em; }
.markdown-content :deep(h1) { font-size: 1.55em; }
.markdown-content :deep(h2) { font-size: 1.35em; }
.markdown-content :deep(h3), .markdown-content :deep(h4) { font-size: 1.15em; }
.markdown-content :deep(a) { color: var(--aqua); text-decoration: underline; text-decoration-color: rgba(142, 217, 208, .4); text-underline-offset: 3px; }
.markdown-content :deep(blockquote) { padding: .25em 0 .25em 1em; border-left: 2px solid rgba(231, 201, 130, .55); color: var(--ink-soft); }
.markdown-content :deep(code) { padding: .12em .35em; border: 1px solid rgba(145, 177, 210, .18); border-radius: 5px; background: rgba(3, 8, 20, .6); color: #c8eee8; font-size: .9em; }
.markdown-content :deep(pre) { max-width: 100%; overflow-x: auto; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: rgba(3, 8, 20, .7); }
.markdown-content :deep(pre code) { padding: 0; border: 0; background: transparent; }
.markdown-content :deep(img) { display: block; max-width: 100%; max-height: 680px; margin: 1em auto; border-radius: 10px; object-fit: contain; }
.markdown-content :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.markdown-content :deep(th), .markdown-content :deep(td) { padding: 7px 10px; border: 1px solid var(--line); text-align: left; }
.markdown-content :deep(th) { color: var(--gold); font-weight: 500; }
.markdown-content :deep(hr) { margin: 1.4em 0; border: 0; border-top: 1px solid var(--line); }
</style>
