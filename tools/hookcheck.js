// Hook checker for the eDNA Razor views.
// Records everything the backend / external JS can depend on, then verifies a
// redesigned copy still has all of it.
//
//   node hookcheck.js snapshot <viewsDir> <baseline.json>
//   node hookcheck.js compare  <viewsDir> <baseline.json> [relative/file.cshtml ...]
//
// Exit code 1 when any contract is broken.
'use strict';
const fs = require('fs');
const path = require('path');

// Classes that only control layout and may be dropped when spacer markup is removed.
const LAYOUT_CLASS = /^(col-(xs|sm|md|lg)-(offset-)?\d+|pull-(left|right)|row|form-group|form-horizontal|form-inline|text-(center|right|left)|center-block|clearfix|float-left|content-wrapper)$/;

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p, base, out); }
    else if (e.name.endsWith('.cshtml')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

const norm = s => s.replace(/\s+/g, ' ').trim();
const all = (re, s, f = m => m[1]) => { const r = []; let m; re.lastIndex = 0; while ((m = re.exec(s))) r.push(f(m)); return r; };

function extract(src) {
  // Strip Razor comments: they are not part of the contract.
  const s = src.replace(/@\*[\s\S]*?\*@/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tags = all(/<([a-zA-Z][\w]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g, s, m => ({ tag: m[1].toLowerCase(), attrs: m[2] }));

  const idTags = {}, hiddenIds = [];
  for (const t of tags) {
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(t.attrs);
    if (!id) continue;
    (idTags[id[1]] = idTags[id[1]] || []).push(t.tag);
    const st = /\bstyle\s*=\s*["']([^"']*)["']/i.exec(t.attrs);
    if (st && /display\s*:\s*none/i.test(st[1])) hiddenIds.push(id[1]);
  }

  const classes = new Set();
  for (const c of all(/(?:\bclass\s*=\s*"([^"]*)"|@class\s*=\s*"([^"]*)")/g, s, m => m[1] ?? m[2]))
    c.split(/\s+/).filter(x => x && !x.includes('@')).forEach(x => classes.add(x));

  return {
    ids: all(/\bid\s*=\s*["']([^"'@]+)["']/gi, s),
    idTags,
    hiddenIds,
    classes: [...classes].sort(),
    names: all(/\bname\s*=\s*["']([^"']+)["']/gi, s),
    htmlHelpers: all(/@Html\.(\w+)\(\s*([^,)\n]*)/g, s, m => `${m[1]}(${norm(m[2])})`),
    urlActions: all(/Url\.(?:Action|Content)\(([^)]*)\)/g, s, m => norm(m[1])),
    ajaxUrls: all(/\burl\s*:\s*("[^"]*"|'[^']*'|[^,\n]+)/g, s, m => norm(m[1])),
    jsCalls: all(/(?:href\s*=\s*"(javascript:[^"]*)"|\b(on\w+)\s*=\s*"([^"]*)")/gi, s, m => m[1] ? norm(m[1]) : `${m[2].toLowerCase()}=${norm(m[3])}`),
    dataAttrs: all(/\b(data-[\w-]+)\s*=\s*"([^"]*)"/g, s, m => `${m[1]}=${m[2]}`),
    razorReads: all(/(ViewBag\.\w+|ViewData\["\w+"\]|Session\["\w+"\]|@model\s+[\w.<>]+|@using\s+[\w.]+|Html\.(?:Partial|RenderPartial)\([^)]*\)|RenderSection\([^)]*\)|RenderBody\(\)|Styles\.Render\([^)]*\)|Scripts\.Render\([^)]*\))/g, s, m => norm(m[1])),
    razorControl: all(/(?:@|else\s+)(if|foreach|for|while|switch)\s*\(([^\n]*)/g, s, m => `${m[1]} (${norm(m[2])}`),
    areas: all(/<area\b([^>]*)>/gi, s, m => norm(m[1])),
    forms: all(/<(form|input|select|textarea|button)\b([^>]*)>/gi, s, m => {
      const type = /\btype\s*=\s*["']([^"']+)/i.exec(m[2]); const id = /\bid\s*=\s*["']([^"']+)/i.exec(m[2]);
      return id ? `${m[1].toLowerCase()}#${id[1]}${type ? '[' + type[1] + ']' : ''}` : null;
    }).filter(Boolean),
    scripts: all(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, s, m => norm(m[1] + '|' + m[2])),
  };
}

function multisetDiff(a, b) { // items in a not covered by b
  const cnt = new Map(); b.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1));
  const miss = []; a.forEach(x => { const n = cnt.get(x) || 0; if (n) cnt.set(x, n - 1); else miss.push(x); });
  return miss;
}

function compare(base, cur) {
  const errors = [], notes = [];
  const exact = ['names', 'htmlHelpers', 'urlActions', 'ajaxUrls', 'jsCalls', 'dataAttrs', 'razorReads', 'razorControl', 'areas', 'forms', 'scripts', 'hiddenIds'];
  for (const k of exact) {
    const lost = multisetDiff(base[k], cur[k]), added = multisetDiff(cur[k], base[k]);
    lost.forEach(x => errors.push(`${k} missing: ${x.slice(0, 160)}`));
    if (k === 'scripts') added.forEach(x => notes.push(`scripts added: ${x.slice(0, 120)}`));
    else if (k === 'hiddenIds') added.forEach(x => errors.push(`hiddenIds added (now starts hidden): ${x}`));
    else added.forEach(x => notes.push(`${k} added: ${x.slice(0, 160)}`));
  }
  multisetDiff(base.ids, cur.ids).forEach(x => errors.push(`id missing: ${x}`));
  multisetDiff(cur.ids, base.ids).forEach(x => notes.push(`id added: ${x}`));
  for (const [id, tags] of Object.entries(base.idTags)) {
    const now = cur.idTags[id] || [];
    if (now.length && now.join() !== tags.join()) errors.push(`id ${id} changed element: <${tags}> -> <${now}>`);
  }
  for (const c of base.classes) {
    if (cur.classes.includes(c)) continue;
    (LAYOUT_CLASS.test(c) ? notes : errors).push(`class removed: ${c}`);
  }
  return { errors, notes };
}

const [mode, dir, file, ...only] = process.argv.slice(2);
if (!mode || !dir || !file) { console.error('usage: snapshot|compare <viewsDir> <baseline.json> [files]'); process.exit(2); }

if (mode === 'snapshot') {
  const snap = {};
  for (const f of walk(dir)) snap[f] = extract(fs.readFileSync(path.join(dir, f), 'utf8'));
  fs.writeFileSync(file, JSON.stringify(snap, null, 1));
  console.log(`snapshot: ${Object.keys(snap).length} views -> ${file}`);
} else {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const files = only.length ? only : Object.keys(base);
  let bad = 0;
  for (const f of files) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { console.log(`FAIL ${f}: file missing`); bad++; continue; }
    const { errors, notes } = compare(base[f], extract(fs.readFileSync(p, 'utf8')));
    if (errors.length) bad++;
    if (errors.length || notes.length || only.length) console.log(`${errors.length ? 'FAIL' : 'ok  '} ${f}`);
    errors.forEach(e => console.log('   x ' + e));
    if (process.env.VERBOSE) notes.forEach(n => console.log('   . ' + n));
    else if (notes.length) console.log(`   . ${notes.length} additions/layout-only changes (VERBOSE=1 to list)`);
  }
  for (const f of walk(dir)) if (!base[f]) console.log(`new  ${f}`);
  console.log(bad ? `\n${bad} view(s) broke the contract` : `\nall ${files.length} view(s) keep their hooks`);
  process.exit(bad ? 1 : 0);
}
