// T150 — 스타일가이드 v2 위반 검출: hex 직접 사용 · 300(Light) 굵기 · 토큰 외 box-shadow · 토큰 외 border-radius
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(vue|css|ts)$/.test(f) && !p.endsWith('tokens.css')) files.push(p);
  }
})(root);
const ALLOWED_RADIUS = /^(0|0px|50%|var\(--r-(none|xs|sm|md|full)\))$/;
const rules = [
  [(l) => /#[0-9a-fA-F]{3,8}\b/.test(l) && /(color|background|border|fill|stroke)\s*:/.test(l), 'hex 색상 직접 사용 — tokens.css 변수를 쓰세요'],
  [(l) => /font-weight:\s*300\b/.test(l) || /\b300\s+\d+px\//.test(l), '300(Light) 굵기 금지 — 본문은 400 (v2)'],
  [(l) => [...l.matchAll(/box-shadow:\s*([^;}]+)/g)].some((m) => !/^(none|inset\b|var\(--(focus-ring|shadow-float)\))/.test(m[1].trim())), 'box-shadow 금지(입력 포커스 inset · --focus-ring · --shadow-float 토큰만 허용)'],
  [(l) => [...l.matchAll(/border-radius:\s*([^;}]+)/g)].some((m) => !ALLOWED_RADIUS.test(m[1].trim())), '모서리는 토큰만(--r-xs 4 · --r-sm 6 · --r-md 10 · --r-full)'],
];
let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    for (const [test, msg] of rules) {
      if (test(l)) {
        bad++;
        console.log(`${path.relative(root, f)}:${i + 1}  ${msg}\n    ${l.trim()}`);
      }
    }
  });
}
console.log(bad ? `\n[check-style] 위반 ${bad}건` : '[check-style] OK');
process.exit(bad ? 1 : 0);
