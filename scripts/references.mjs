import {esc} from './core.mjs';

export function pdfReference(raw) {
  const text=String(raw??'').trim().replace(/^\[?PDF:\s*/i,'').replace(/\]$/,'').replace(/\s*[–-]\s*\d+\s*$/,'');
  const colon=/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(\d+)$/.exec(text);
  if(colon)return `${colon[1].toUpperCase()}:${colon[2]}`;
  const compact=/^([A-Za-z][A-Za-z_-]*)\s*(\d+)$/.exec(text);
  if(compact)return `${compact[1].toUpperCase()}${compact[2]}`;
  throw new Error('Use a book/page reference such as B248 or DF1:29.');
}
export function pageLinks(raw='') {
  let last=0,out='';const text=String(raw??'');
  const pattern=/https?:\/\/[^\s<>"\],;]+|\b[A-Za-z][A-Za-z0-9_-]*\s*:\s*\d+(?:\s*[–-]\s*\d+)?\b|\b[A-Za-z][A-Za-z_-]*\s*\d+(?:\s*[–-]\s*\d+)?\b/g;
  for(const m of text.matchAll(pattern)) {
    out+=esc(text.slice(last,m.index));const url=/^https?:\/\//i.test(m[0]);
    out+=`<a class="gca-pdf" href="${url?esc(m[0]):'#'}" data-page-ref="${esc(m[0])}" title="${url?'Open reference':'Open PDF at '+esc(m[0])}"${url?' target="_blank" rel="noopener noreferrer"':''}>${esc(m[0])}</a>`;last=m.index+m[0].length;
  }
  return out+esc(text.slice(last)) || '<span class="gca-muted">No page reference</span>';
}
export async function openPage(raw) {
  if(/^https?:\/\//i.test(String(raw))){window.open(raw,'_blank','noopener,noreferrer');return;}
  const ref=pdfReference(raw),pdf=GURPS.modules?.Pdf;
  if(typeof pdf?.handlePdf==='function'){await pdf.handlePdf(ref);return;}
  if(typeof GURPS.handlePdf==='function'){await GURPS.handlePdf(ref);return;}
  if(typeof GURPS.executeOTF==='function') {
    const opened=await GURPS.executeOTF(`[PDF:${ref}]`);
    if(opened!==false)return;
  }
  throw new Error('GGA could not open this PDF reference.  Check its book mapping on the character sheet.');
}
