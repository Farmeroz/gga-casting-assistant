import { esc } from './core.mjs';

function bookCodes() {
  const codes = new Set();
  globalThis.game?.journal?.forEach((journal) => {
    journal.pages?.forEach((page) => {
      if (page.type === 'pdf' && typeof page.system?.code === 'string') codes.add(page.system.code);
    });
  });
  return [...codes].sort((a, b) => b.length - a.length);
}

export function pdfReference(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^\[PDF:\s*([\s\S]*)\]$/i, '$1')
    .replace(/^PDF:\s*/i, '')
    .trim();
  // Preserve registered codes, case, and page labels for GGA's own resolver.
  // Numeric ranges open their first page; A-10 is a page label, not a range.
  if (/[\[\]<>"'|;\r\n]/.test(text))
    throw new Error('Use a book/page reference such as B248, DFC:A-10, or DFRPG Spells:20.');
  const colon = /^(.+):\s*([^\s:,]+(?:\s*[–-]\s*\d+)?)$/.exec(text);
  if (colon) {
    const book = colon[1].trim();
    const page = colon[2].trim().replace(/^(\d+)\s*[–-]\s*\d+$/, '$1');
    if (/^[\p{L}\p{N}][\p{L}\p{N} ._:()+/-]*$/u.test(book)) {
      const code =
        !bookCodes().includes(book) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(book)
          ? book.toUpperCase()
          : book;
      return code + ':' + page;
    }
  }
  const compact = /^([A-Za-z]+)\s*(\d+)(?:\s*[–-]\s*\d+)?$/.exec(text);
  if (compact)
    return (bookCodes().includes(compact[1]) ? compact[1] : compact[1].toUpperCase()) + compact[2];
  const code = bookCodes().find(
    (book) => text.startsWith(book) && /^\d+$/.test(text.slice(book.length)),
  );
  if (code) return text;
  throw new Error('Use a book/page reference such as B248, DFC:A-10, or DFRPG Spells:20.');
}

export function pageLinks(raw = '') {
  let last = 0,
    out = '';
  const text = String(raw ?? '');
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const page = '(?:\\d+(?:\\s*[–-]\\s*\\d+)?|[A-Za-z][A-Za-z0-9_-]*\\d+)';
  const registered = bookCodes().map((code) => escapePattern(code) + ':?' + page);
  const patterns = [
    'https?:\\/\\/[^\\s<>"\\],;]+',
    '\\[PDF:[^\\]\\r\\n]+\\]',
    ...registered,
    // Multiword codes in standalone fields and comma-separated reference lists.
    '(?<![^,;\\n])\\s*[\\p{L}\\p{N}][\\p{L}\\p{N} ._:()+/-]*:\\s*' + page + '(?=\\s*(?:[,;]|$))',
    '\\b[A-Za-z][A-Za-z0-9_-]*:\\s*' + page,
    '\\b[A-Za-z]+\\s*\\d+(?:\\s*[–-]\\s*\\d+)?\\b',
  ];
  const pattern = new RegExp(patterns.join('|'), 'gu');
  for (const m of text.matchAll(pattern)) {
    out += esc(text.slice(last, m.index));
    const url = /^https?:\/\//i.test(m[0]);
    let ref;
    try {
      ref = url ? m[0] : pdfReference(m[0]);
    } catch {
      out += esc(m[0]);
      last = m.index + m[0].length;
      continue;
    }
    out += `<a class="gca-pdf" href="${url ? esc(ref) : '#'}" data-page-ref="${esc(ref)}" title="${url ? 'Open reference' : 'Open PDF at ' + esc(ref)}"${url ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(m[0])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last)) || '<span class="gca-muted">No page reference</span>';
}

export async function openPage(raw) {
  if (/^https?:\/\//i.test(String(raw))) {
    window.open(raw, '_blank', 'noopener,noreferrer');
    return;
  }
  const ref = pdfReference(raw),
    pdf = GURPS.modules?.Pdf;
  if (typeof pdf?.handlePdf === 'function') {
    await pdf.handlePdf(ref);
    return;
  }
  if (typeof GURPS.handlePdf === 'function') {
    await GURPS.handlePdf(ref);
    return;
  }
  if (typeof GURPS.executeOTF === 'function') {
    const opened = await GURPS.executeOTF('[PDF:' + ref + ']');
    if (opened !== false) return;
  }
  throw new Error(
    'GGA could not open this PDF reference.  Check its book mapping on the character sheet.',
  );
}
