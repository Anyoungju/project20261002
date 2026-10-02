// T150 — 스타일가이드 위반 검출: hex 직접 사용 · 500 굵기 · box-shadow · 0 외 border-radius (아이콘 버튼·아바타의 --r-full 은 허용)
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
const ALLOWED_RADIUS = /^(0|0px|var\(--r-none\)|var\(--r-full\)|50%)$/;
const rules = [
  [(l) => /#[0-9a-fA-F]{3,8}\b/.test(l) && /(color|background|border|fill|stroke)\s*:/.test(l), 'hex 색상 직접 사용 — tokens.css 변수를 쓰세요'],
  [(l) => /font-weight:\s*500\b/.test(l) || /\b500\s+\d+px\//.test(l), '500 굵기 금지(700/400/300)'],
  [(l) => [...l.matchAll(/box-shadow:\s*([^;}]+)/g)].some((m) => !/^(none|inset\b)/.test(m[1].trim())), 'box-shadow 금지(입력 포커스 inset 만 허용)'],
  [(l) => [...l.matchAll(/border-radius:\s*([^;}]+)/g)].some((m) => !ALLOWED_RADIUS.test(m[1].trim())), '둥근 모서리 금지(0px, 아이콘 버튼·아바타·스피너만 원형)'],
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
