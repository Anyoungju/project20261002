/**
 * mariadb 클라이언트 지시어 DELIMITER 를 해석해 SQL 스크립트를 문장 단위로 나눈다(research R4).
 * 문자열('…', "…", `…`)과 주석(-- …, # …, /* … *\/) 안의 구분자는 무시한다.
 */
export function splitSqlStatements(script: string): string[] {
  const out: string[] = [];
  let delimiter = ';';
  let buf = '';
  let i = 0;
  const n = script.length;
  let atLineStart = true;

  const push = () => {
    const s = buf.trim();
    if (s) out.push(s);
    buf = '';
  };

  while (i < n) {
    // 줄 시작의 DELIMITER 지시어
    if (atLineStart) {
      const m = /^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/i.exec(script.slice(i));
      if (m) {
        push();
        delimiter = m[1];
        i += m[0].length;
        atLineStart = true;
        continue;
      }
    }
    const ch = script[i];
    const next = script[i + 1];

    // 한 줄 주석
    if ((ch === '-' && next === '-' && /\s/.test(script[i + 2] ?? ' ')) || ch === '#') {
      const end = script.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      // 주석은 버린다(서버에 보낼 필요 없음)
      i = stop;
      continue;
    }
    // 블록 주석
    if (ch === '/' && next === '*') {
      const end = script.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // 문자열
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (script[j] === '\\' && q !== '`') {
          j += 2;
          continue;
        }
        if (script[j] === q) {
          if (script[j + 1] === q) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      buf += script.slice(i, j + 1);
      i = j + 1;
      atLineStart = false;
      continue;
    }
    // 구분자
    if (script.startsWith(delimiter, i)) {
      push();
      i += delimiter.length;
      atLineStart = false;
      continue;
    }
    buf += ch;
    atLineStart = ch === '\n';
    i++;
  }
  push();
  return out;
}
