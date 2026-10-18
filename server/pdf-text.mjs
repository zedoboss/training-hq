// A small PDF text reader (A11, the Evolt results PDF): every piece of text with where it sits on the page, read from
// the page content streams and the form XObjects they draw. Enough for generated reports (simple fonts, WinAnsi or
// ToUnicode); not a general PDF library. No outside packages: node's zlib inflates the streams.
import { inflateSync } from 'node:zlib';

/** Objects by number: {dict: string, stream: Buffer|null}. */
function readObjects(buf) {
  const s = buf.toString('latin1');
  const out = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.search(/\bstream\r?\n/);
    let dict = body; let stream = null;
    if (si >= 0) {
      dict = body.slice(0, si);
      let a = si + 6; if (body[a] === '\r') a++; if (body[a] === '\n') a++;
      // /Length 123, or /Length 721 0 R (an indirect length: then read up to "endstream").
      const lenM = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      const b = lenM && !lenM[2] ? a + Number(lenM[1]) : body.lastIndexOf('endstream');
      let raw = Buffer.from(body.slice(a, b), 'latin1');
      if (/\/FlateDecode/.test(dict)) { try { raw = inflateSync(raw); } catch { raw = null; } }
      stream = raw;
    }
    out.set(Number(m[1]), { dict, stream, at: m.index });
    re.lastIndex = end;
  }
  // Object streams (PDF 1.5+): objects packed inside /Type /ObjStm. With incremental updates (values added to a
  // report later), the definition nearest the end of the file wins, whether plain or packed.
  for (const [, o] of [...out]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] || 0); const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] || 0);
    const t = o.stream.toString('latin1');
    const head = t.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = head[2 * i]; const off = head[2 * i + 1]; const next = i + 1 < n ? head[2 * i + 3] : t.length - first;
      const cur = out.get(num);
      if (!cur || cur.at < o.at) out.set(num, { dict: t.slice(first + off, first + next), stream: null, at: o.at });
    }
  }
  return out;
}

const ref = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict); return m ? Number(m[1]) : null; };

/** The inline or referenced dictionary text for a key (/Resources << ... >> or /Resources 12 0 R). */
function subDict(objs, dict, key) {
  const r = ref(dict, key);
  if (r != null) return objs.get(r)?.dict || '';
  const i = dict.search(new RegExp(`/${key}\\s*<<`));
  if (i < 0) return '';
  let depth = 0; let j = dict.indexOf('<<', i);
  for (let k = j; k < dict.length - 1; k++) {
    if (dict[k] === '<' && dict[k + 1] === '<') { depth++; k++; } else if (dict[k] === '>' && dict[k + 1] === '>') { depth--; k++; if (!depth) return dict.slice(j, k + 1); }
  }
  return dict.slice(j);
}

/** name -> object number, for entries like /T1_0 12 0 R in a resource sub-dictionary. */
const namedRefs = (d) => new Map([...String(d).matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)].map((m) => [m[1], Number(m[2])]));

const WIN = { 0x80: '€', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0xae: '®', 0xb0: '°', 0xb2: '²', 0xb3: '³', 0xd7: '×' };
const GLYPH = { ff: 'ff', fl: 'fl', fi: 'fi', registered: '®', degree: '°', twosuperior: '²', endash: '–', emdash: '—', quoteright: '’', bullet: '•', multiply: '×' };

/** A font's decoder: ToUnicode when there is one, else WinAnsi with the font's /Differences. */
function fontDecoder(objs, fontNum) {
  const f = objs.get(fontNum);
  if (!f) return (bytes) => Buffer.from(bytes).toString('latin1');
  const map = new Map();
  const tu = ref(f.dict, 'ToUnicode');
  const cmap = tu != null ? objs.get(tu)?.stream?.toString('latin1') : null;
  let two = false;
  if (cmap) {
    const hex = (h) => String.fromCodePoint(...(h.match(/.{4}/g) || [h]).map((x) => parseInt(x, 16)));
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, a, b] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) { map.set(parseInt(a, 16), hex(b)); if (a.length > 2) two = true; }
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const [, a, b, c] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const lo = parseInt(a, 16); const hi = parseInt(b, 16); const base = parseInt(c, 16);
        for (let k = lo; k <= hi; k++) map.set(k, String.fromCodePoint(base + (k - lo)));
        if (a.length > 2) two = true;
      }
    }
  }
  const encRef = ref(f.dict, 'Encoding');
  const enc = encRef != null ? objs.get(encRef)?.dict || '' : '';
  const diffs = /\/Differences\s*\[([^\]]*)\]/.exec(enc)?.[1];
  if (diffs) {
    let code = 0;
    for (const t of diffs.trim().split(/\s+/)) {
      if (/^\d+$/.test(t)) code = Number(t);
      else if (t.startsWith('/')) { const n = t.slice(1); if (!map.has(code)) map.set(code, GLYPH[n] ?? (n.length === 1 ? n : '')); code++; }
    }
  }
  return (bytes) => {
    let out = '';
    if (two) { for (let i = 0; i + 1 < bytes.length; i += 2) { const c = (bytes[i] << 8) | bytes[i + 1]; out += map.get(c) ?? ''; } return out; }
    for (const b of bytes) out += map.get(b) ?? WIN[b] ?? String.fromCharCode(b);
    return out;
  };
}

/** Tokens of a content stream: numbers, names, strings (bytes), arrays, operators. */
function* tokens(t) {
  let i = 0; const n = t.length;
  while (i < n) {
    const c = t[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && t[i] !== '\n') i++; continue; }
    if (c === '(') {
      const bytes = []; let depth = 1; i++;
      while (i < n && depth) {
        const ch = t[i];
        if (ch === '\\') {
          const nx = t[i + 1];
          const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }[nx];
          if (esc != null) { bytes.push(esc); i += 2; continue; }
          if (/[0-7]/.test(nx)) { let o = ''; let k = i + 1; while (k < i + 4 && /[0-7]/.test(t[k])) o += t[k++]; bytes.push(parseInt(o, 8) & 255); i = k; continue; }
          if (nx === '\r' || nx === '\n') { i += 2; continue; }
          i++; continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (!depth) { i++; break; } }
        bytes.push(t.charCodeAt(i) & 255); i++;
      }
      yield { s: bytes }; continue;
    }
    if (c === '<' && t[i + 1] !== '<') {
      const j = t.indexOf('>', i); const h = t.slice(i + 1, j).replace(/\s+/g, '');
      const bytes = []; for (let k = 0; k < h.length; k += 2) bytes.push(parseInt((h.slice(k, k + 2) + '0').slice(0, 2), 16));
      yield { s: bytes }; i = j + 1; continue;
    }
    if (c === '[') { yield { open: true }; i++; continue; }
    if (c === ']') { yield { close: true }; i++; continue; }
    if (c === '<' || c === '>') { // dictionaries in inline images and BDC properties: skip them as one token
      if (t[i + 1] === c) { let depth = 0; let k = i; for (; k < n - 1; k++) { if (t[k] === '<' && t[k + 1] === '<') { depth++; k++; } else if (t[k] === '>' && t[k + 1] === '>') { depth--; k++; if (!depth) break; } } yield { dict: true }; i = k + 1; continue; }
      i++; continue;
    }
    if (c === '/') { let k = i + 1; while (k < n && !/[\s/[\]()<>{}%]/.test(t[k])) k++; yield { name: t.slice(i + 1, k) }; i = k; continue; }
    let k = i; while (k < n && !/[\s/[\]()<>{}%]/.test(t[k])) k++;
    const w = t.slice(i, k); i = k || i + 1;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { num: Number(w) }; else yield { op: w };
  }
}

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

/**
 * Text runs and filled rectangles on each page: {pages: [{width, height, runs: [{x, y, size, text}], rects: [{x, y, w, h, white}]}]}.
 * x, y in page points from the bottom left; y is the text baseline.
 */
export function pdfText(buf) {
  const objs = readObjects(buf);
  const pagesOut = [];
  const pageNums = [...objs].filter(([, o]) => /\/Type\s*\/Page\b(?!s)/.test(o.dict)).map(([k]) => k);
  for (const pn of pageNums) {
    const page = objs.get(pn);
    const box = /\/MediaBox\s*\[\s*([\d.\s-]+)\]/.exec(page.dict)?.[1].trim().split(/\s+/).map(Number) || [0, 0, 595, 842];
    const runs = []; const rects = [];
    const draw = (streams, resDict, ctm0, depth = 0) => {
      if (depth > 6) return;
      const fonts = namedRefs(subDict(objs, resDict, 'Font'));
      const xobjs = namedRefs(subDict(objs, resDict, 'XObject'));
      const decoders = new Map();
      const dec = (name) => { if (!decoders.has(name)) decoders.set(name, fontDecoder(objs, fonts.get(name))); return decoders.get(name); };
      let ctm = ctm0; const stack = []; let fill = null;
      let tm = [1, 0, 0, 1, 0, 0]; let tlm = tm; let font = null; let size = 1; let leading = 0; let tc = 0; let tw = 0; let th = 1;
      let args = []; let arr = null;
      const show = (bytes) => {
        const text = dec(font)(bytes);
        const m = mul(tm, ctm);
        const sz = size * Math.hypot(m[0], m[1]);
        if (text.trim()) runs.push({ x: m[4], y: m[5], size: Math.round(sz * 100) / 100, text });
        // Advance roughly (glyph widths unknown here): enough to keep pieces of one TJ in order.
        const adv = (text.length * size * 0.5 + text.length * tc + (text.split(' ').length - 1) * tw) * th;
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      };
      for (const content of streams) {
        if (!content) continue;
        for (const tok of tokens(content.toString('latin1'))) {
          if (tok.open) { arr = []; continue; }
          if (tok.close) { args.push({ arr }); arr = null; continue; }
          if (arr) { arr.push(tok); continue; }
          if (!tok.op) { args.push(tok); continue; }
          const a = args; args = [];
          const nums = a.map((x) => x.num);
          switch (tok.op) {
            case 'q': stack.push({ ctm, fill }); break;
            case 'Q': ({ ctm, fill } = stack.pop() || { ctm, fill }); break;
            case 'cm': ctm = mul(nums, ctm); break;
            case 'rg': case 'scn': case 'sc': if (a.length >= 3 && a.every((x) => x.num != null)) fill = nums.slice(-3); break;
            case 'g': fill = [nums[0], nums[0], nums[0]]; break;
            case 're': { const [x, y, w, h] = nums; const p = mul([1, 0, 0, 1, x, y], ctm); rects.push({ x: p[4], y: p[5], w: w * Math.hypot(ctm[0], ctm[1]), h: h * Math.hypot(ctm[2], ctm[3]), white: !!fill && fill.every((v) => v > 0.97) }); break; }
            case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm; break;
            case 'Tf': font = a[0]?.name; size = nums[1] || 1; break;
            case 'Tc': tc = nums[0]; break;
            case 'Tw': tw = nums[0]; break;
            case 'Tz': th = nums[0] / 100; break;
            case 'TL': leading = nums[0]; break;
            case 'Tm': tm = nums; tlm = tm; break;
            case 'Td': tlm = mul([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = tlm; break;
            case 'TD': leading = -nums[1]; tlm = mul([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = tlm; break;
            case 'T*': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; break;
            case 'Tj': if (a[0]?.s) show(a[0].s); break;
            case "'": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; if (a[0]?.s) show(a[0].s); break;
            case '"': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; if (a[2]?.s) show(a[2].s); break;
            case 'TJ': {
              const items = a[0]?.arr || [];
              const parts = []; for (const it of items) if (it.s) parts.push(...it.s); else if (it.num != null && it.num < -200) parts.push(32);
              if (parts.length) show(parts);
              break;
            }
            case 'Do': {
              const num = xobjs.get(a[0]?.name);
              const xo = num != null ? objs.get(num) : null;
              if (xo && /\/Subtype\s*\/Form/.test(xo.dict)) {
                const mtx = /\/Matrix\s*\[([^\]]*)\]/.exec(xo.dict)?.[1].trim().split(/\s+/).map(Number) || [1, 0, 0, 1, 0, 0];
                draw([xo.stream], subDict(objs, xo.dict, 'Resources') || resDict, mul(mtx, ctm), depth + 1);
              }
              break;
            }
            default: break;
          }
        }
      }
    };
    const contents = /\/Contents\s*\[([^\]]*)\]/.exec(page.dict)?.[1];
    const list = contents ? [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1])) : [ref(page.dict, 'Contents')].filter((x) => x != null);
    // Resources may sit on the page or be inherited from the Pages tree.
    let res = subDict(objs, page.dict, 'Resources');
    let parent = ref(page.dict, 'Parent');
    while (!res && parent != null) { const pd = objs.get(parent)?.dict || ''; res = subDict(objs, pd, 'Resources'); parent = ref(pd, 'Parent'); }
    draw(list.map((n) => objs.get(n)?.stream), res, [1, 0, 0, 1, 0, 0]);
    pagesOut.push({ width: box[2] - box[0], height: box[3] - box[1], runs, rects });
  }
  return { pages: pagesOut };
}
