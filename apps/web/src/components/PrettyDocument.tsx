import { useMemo, useState, type ReactNode } from 'react';
import { FileText, Pencil, Type } from 'lucide-react';
import { CodeEditor } from './studio';
import { cn } from './ui';

export function isDocumentPath(filePath?: string | null) {
  return /\.(md|markdown|txt)$/i.test(String(filePath || ''));
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const source = text.replace(/\r/g, '');
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|\b(PASS|FAIL|SKIP|ERROR|WARN)\b)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(source))) {
    if (match.index > last) parts.push(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('`')) parts.push(<code key={key++} className="pretty-doc-code">{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    else if (token.startsWith('~~')) parts.push(<s key={key++}>{token.slice(2, -2)}</s>);
    else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']'));
      const href = token.slice(token.indexOf('(') + 1, -1);
      parts.push(<a key={key++} href={href} target="_blank" rel="noreferrer">{label}</a>);
    } else {
      const tone = token === 'PASS' ? 'pass' : token === 'FAIL' || token === 'ERROR' ? 'fail' : token === 'SKIP' ? 'skip' : 'warn';
      parts.push(<span key={key++} className={`pretty-doc-badge pretty-doc-badge-${tone}`}>{token}</span>);
    }
    last = match.index + token.length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

function parseTableRow(line: string) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

function isDivider(line: string) {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

type Block =
  | { type: 'h'; level: number; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1; }
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: 'table', headers, rows });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ type: 'h', level: heading[1].length, text: heading[2].trim() }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) { blocks.push({ type: 'hr' }); continue; }
    if (/^>\s?/.test(line)) {
      const quote = [line.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) { i += 1; quote.push(lines[i].replace(/^>\s?/, '')); }
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [line.replace(/^\s*[-*+]\s+/, '')];
      while (i + 1 < lines.length && /^\s*[-*+]\s+/.test(lines[i + 1])) { i += 1; items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [line.replace(/^\s*\d+[.)]\s+/, '')];
      while (i + 1 < lines.length && /^\s*\d+[.)]\s+/.test(lines[i + 1])) { i += 1; items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); }
      blocks.push({ type: 'ol', items });
      continue;
    }
    const para = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#{1,4}\s|```|>\s|[-*+]\s|\d+[.)]\s|\s*\|)/.test(lines[i + 1])) {
      i += 1;
      para.push(lines[i]);
    }
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

export function PrettyDocument({
  source, path, tone = 'light', className,
}: {
  source: string;
  path?: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const blocks = useMemo(() => parseBlocks(source || ''), [source]);
  const plain = /\.txt$/i.test(path || '') && !/[[#|*`]/.test(source || '');
  return (
    <article className={cn('pretty-doc', tone === 'dark' ? 'pretty-doc-dark' : 'pretty-doc-light', className)} dir="auto">
      {plain
        ? <pre className="pretty-doc-plain">{source}</pre>
        : blocks.map((block, index) => {
          if (block.type === 'h') {
            const Tag = (`h${Math.min(block.level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4');
            return <Tag key={index} className={`pretty-doc-h pretty-doc-h${block.level}`}>{inline(block.text)}</Tag>;
          }
          if (block.type === 'p') return <p key={index} className="pretty-doc-p">{inline(block.text)}</p>;
          if (block.type === 'ul') return <ul key={index} className="pretty-doc-ul">{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>;
          if (block.type === 'ol') return <ol key={index} className="pretty-doc-ol">{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ol>;
          if (block.type === 'quote') return <blockquote key={index} className="pretty-doc-quote">{inline(block.text)}</blockquote>;
          if (block.type === 'hr') return <hr key={index} className="pretty-doc-hr" />;
          if (block.type === 'code') return <pre key={index} className="pretty-doc-fence" dir="ltr"><code>{block.text}</code></pre>;
          return (
            <div key={index} className="pretty-doc-table-wrap">
              <table className="pretty-doc-table">
                <thead><tr>{block.headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        })}
    </article>
  );
}

export function FilePreview({
  path, code, tone = 'light', editable = false, onChange, className, emptyText = 'فایلی انتخاب نشده است.',
}: {
  path?: string;
  code?: string;
  tone?: 'light' | 'dark';
  editable?: boolean;
  onChange?: (value: string) => void;
  className?: string;
  emptyText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const documentFile = isDocumentPath(path);
  if (!path || code == null) {
    return <div className={cn('flex h-full min-h-48 items-center justify-center px-6 text-center text-sm', tone === 'dark' ? 'text-slate-500' : 'text-gray-400')}>{emptyText}</div>;
  }
  if (!documentFile || editing) {
    return (
      <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
        {documentFile && editable && (
          <div className="flex justify-end border-b border-white/10 px-3 py-2">
            <button type="button" onClick={() => setEditing(false)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">
              <FileText className="h-3.5 w-3.5" />نمایش زیبا
            </button>
          </div>
        )}
        {editable && onChange
          ? <div className="h-full min-h-0 flex-1 overflow-hidden"><CodeEditor value={code} onChange={onChange} path={path} /></div>
          : <div className="h-full min-h-0 flex-1 overflow-hidden"><CodeEditor value={code} readOnly path={path} /></div>}
      </div>
    );
  }
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className={cn('flex items-center justify-between gap-2 px-4 py-2 text-[11px]', tone === 'dark' ? 'border-b border-white/10 text-slate-400' : 'border-b border-slate-100 text-slate-500')}>
        <span className="inline-flex items-center gap-1"><Type className="h-3.5 w-3.5" />{path.toLowerCase().endsWith('.txt') ? 'متن قالب‌بندی‌شده' : 'Markdown'}</span>
        {editable && <button type="button" onClick={() => setEditing(true)} className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1', tone === 'dark' ? 'hover:bg-white/10' : 'hover:bg-black/5')}><Pencil className="h-3.5 w-3.5" />ویرایش</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <PrettyDocument source={code} path={path} tone={tone} />
      </div>
    </div>
  );
}
