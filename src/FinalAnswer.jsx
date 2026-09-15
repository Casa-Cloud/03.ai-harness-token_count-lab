import React from 'react';

function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) =>
    part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> :
    part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

// Render the small formatting vocabulary requested by the prompt as React text,
// never as HTML from the model.
export default function FinalAnswer({ children = '' }) {
  const lines = children.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { blocks.push(<h3 key={i}>{inline(heading[1])}</h3>); i++; continue; }
    const list = line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
    if (list) {
      const start = i;
      const ordered = !list[1];
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
        if (!item || !item[1] !== ordered) break;
        const itemKey = i;
        const details = [];
        i++;
        // Indented continuation lines belong to the preceding list item.
        while (i < lines.length) {
          if (!lines[i].trim() && i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) { i++; continue; }
          if (!/^\s{2,}\S/.test(lines[i])) break;
          details.push(lines[i].trim());
          i++;
        }
        items.push(<li key={itemKey}><div>{inline(item[2])}</div>{details.map((detail, index) => <div className="item-detail" key={index}>{inline(detail)}</div>)}</li>);
        if (!lines[i]?.trim() && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i + 1] || '')) i++;
      }
      blocks.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>);
      continue;
    }
    blocks.push(<p key={i}>{inline(line)}</p>);
    i++;
  }
  return <div className="final-answer">{blocks}</div>;
}
