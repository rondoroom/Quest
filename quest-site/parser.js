/* parser.js — ☖/☗ 노트 텍스트를 트리 구조로 파싱 (전역 스코프) */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function indentOf(raw) {
  let n = 0;
  for (const ch of raw) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 4;
    else if (ch === '\u3000') n += 2; // full-width space
    else break;
  }
  return n;
}

// 헤더 랭크: 1(대분류) < 2(중분류) < 3(소분류/일반)
function headerRank(line) {
  const chars = [...line];
  const starIdx = chars.findIndex((c) => c === '＊' || c === '*');
  if (starIdx > -1 && starIdx < 5) return 1;
  const cp = chars[0].codePointAt(0);
  if (chars[0] === '【') return 1;
  if (cp >= 0x1d400 && cp <= 0x1d419) return 1; // 𝐐 등 볼드 대문자
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) return 2; // 스타일 숫자 코드 (𝟭𝟬𝟭, 𝟤𝟢𝟤𝗔…)
  if (
    (cp >= 0x1d434 && cp <= 0x1d44d) || // 이탤릭 대문자
    (cp >= 0x1d468 && cp <= 0x1d481) || // 볼드이탤릭 대문자
    (cp >= 0x1d5d4 && cp <= 0x1d5ed) || // 산세리프 대문자
    (cp >= 0x1d608 && cp <= 0x1d621)    // 산세리프 이탤릭 대문자
  ) return 2;
  if (/^\d+\.\s/.test(line)) return 2;
  return 3;
}

const BULLET_RE = /^[┣┗┡┢┠┖├└┝│]+[━─]*\s*/;
const DASH_RE = /^[━─]{1,3}\s+/;

/**
 * parseDoc(title, text, cat) → { section, todayTasks }
 * cat: 'goal' | 'list' | 'routine'
 */
function parseDoc(title, text, cat = 'goal', year = new Date().getFullYear()) {
  const section = { id: uid(), title, cat, nodes: [] };
  const todayTasks = [];
  // stack: { indent, prio, ch }  (prio: 헤더=rank, 체크항목=4)
  const stack = [{ indent: -1, prio: 0, ch: section.nodes }];

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = indentOf(raw);
    let line = raw.trim();

    // 순수 구분선 스킵
    if (/^[▬─━═\-—]+$/.test(line.replace(/\s/g, ''))) continue;

    let st = null; // null=헤더, 'o'=미완, 'd'=완료
    let date = null;
    let textOut = line;

    const bannerM = line.match(/^[▬━]{2,}\s*(.+?)\s*[▬━]{2,}$/);

    if (line.includes('☖') || line.includes('☗')) {
      st = line.includes('☗') ? 'd' : 'o';
      textOut = line.replace(/[☖☗]/g, ' ').replace(/\s+/g, ' ').trim();
    } else if (/^\d{1,2}\/\d{1,2}\s+\S/.test(line)) {
      const m = line.match(/^(\d{1,2})\/(\d{1,2})\s+(.+)$/);
      st = 'o';
      date = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      textOut = m[3].trim();
    } else if (bannerM) {
      textOut = bannerM[1];
    } else if (BULLET_RE.test(line)) {
      st = 'o';
      textOut = line.replace(BULLET_RE, '').replace(/\s+/g, ' ').trim();
    } else if (DASH_RE.test(line)) {
      st = 'o';
      textOut = line.replace(DASH_RE, '').replace(/\s+/g, ' ').trim();
    } else {
      textOut = line.replace(/\s+/g, ' ').trim();
    }

    if (!textOut) continue;

    const prio = st === null ? headerRank(textOut) : 4;

    // 스택 정리
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (indent < top.indent) { stack.pop(); continue; }
      if (indent === top.indent && prio <= top.prio) { stack.pop(); continue; }
      break;
    }

    const node = { id: uid(), text: textOut, st, ch: [] };
    if (date) node.date = date;
    stack[stack.length - 1].ch.push(node);
    stack.push({ indent, prio, ch: node.ch });

    if (date) {
      todayTasks.push({
        id: uid(), text: textOut, date, done: st === 'd', src: node.id,
      });
    }
  }
  return { section, todayTasks };
}
