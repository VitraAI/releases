// The inline Markdown subset release text may use: **bold**, _italic_,
// `code` and [label](https://url). Parsed once into runs, then rendered to
// Slack rich_text elements, HTML or plain text, so every surface agrees on
// what a string means.

const LINK = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/;
const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * @typedef {{ bold?: true, italic?: true, code?: true }} Style
 * @typedef {{ text: string, style: Style, url?: string }} Run
 */

/** Parses `src` into runs. Throws on an unclosed ** or `. */
export function parseInline(src, style = {}) {
  /** @type {Run[]} */
  const runs = [];
  let buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, style: { ...style } });
    buf = '';
  };

  for (let i = 0; i < src.length;) {
    const rest = src.slice(i);

    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1);
      if (end === -1) throw new Error(`unclosed \` in "${src}"`);
      flush();
      runs.push({ text: src.slice(i + 1, end), style: { ...style, code: true } });
      i = end + 1;
      continue;
    }

    if (rest.startsWith('**')) {
      const end = src.indexOf('**', i + 2);
      if (end === -1) throw new Error(`unclosed ** in "${src}"`);
      flush();
      runs.push(...parseInline(src.slice(i + 2, end), { ...style, bold: true }));
      i = end + 2;
      continue;
    }

    const link = LINK.exec(rest);
    if (link) {
      flush();
      runs.push({ text: link[1], url: link[2], style: { ...style } });
      i += link[0].length;
      continue;
    }

    // _italic_ only at word boundaries, so snake_case stays literal.
    if (src[i] === '_' && !isWordChar(src[i - 1]) && src[i + 1] && src[i + 1] !== ' ') {
      let end = -1;
      for (let j = i + 2; j < src.length; j++) {
        if (src[j] === '_' && src[j - 1] !== ' ' && !isWordChar(src[j + 1])) {
          end = j;
          break;
        }
      }
      if (end !== -1) {
        flush();
        runs.push(...parseInline(src.slice(i + 1, end), { ...style, italic: true }));
        i = end + 1;
        continue;
      }
    }

    buf += src[i];
    i += 1;
  }
  flush();
  return runs;
}

const cleanStyle = (style, extra = {}) => {
  const s = { ...style, ...extra };
  for (const k of Object.keys(s)) if (!s[k]) delete s[k];
  return Object.keys(s).length ? s : undefined;
};

/** Slack rich_text elements for `src`; `extra` adds a style to every run. */
export function toSlackElements(src, extra = {}) {
  return parseInline(src).map((run) => {
    const style = cleanStyle(run.style, extra);
    const el = run.url
      ? { type: 'link', url: run.url, text: run.text }
      : { type: 'text', text: run.text };
    if (style) el.style = style;
    return el;
  });
}

export const escapeHtml = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function toHtml(src) {
  return parseInline(src)
    .map((run) => {
      let html = escapeHtml(run.text);
      if (run.style.code) html = `<code>${html}</code>`;
      if (run.style.italic) html = `<em>${html}</em>`;
      if (run.style.bold) html = `<strong>${html}</strong>`;
      if (run.url) html = `<a href="${escapeHtml(run.url)}">${html}</a>`;
      return html;
    })
    .join('');
}

export function toPlain(src) {
  return parseInline(src)
    .map((run) => run.text)
    .join('');
}
