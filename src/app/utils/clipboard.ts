const BASE_URL = 'https://qbranker2026.web.app';

interface Column {
  label: string;
  // The cell in a row, found by its position (and position inside a grouped box)
  path: number[];
}

// Copy the rankings exactly as shown: current order and the visible columns, read from the list.
// Plain text is tab-separated (pastes into spreadsheets and notes); HTML is a table with team
// logos (pastes into forums and docs).
export function copyRankingsToClipboard(list: HTMLElement): Promise<void> {
  const header = list.querySelector<HTMLElement>(':scope > li.header-row');
  const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > li.player:not(.header-row)'));
  const columns = header ? readColumns(header) : [];

  const table = rows.map((row, index) => ({
    rank: index + 1,
    name: row.querySelector('.player-name strong')?.textContent?.trim() ?? '',
    logo: row.querySelector<HTMLImageElement>('.team-logo')?.getAttribute('src') ?? '',
    values: columns.map((column) => cellText(cellAt(row, column.path))),
  }));

  const labels = ['Rank', 'Name', ...columns.map((c) => c.label)];
  const plain = [labels, ...table.map((r) => [r.rank, r.name, ...r.values])]
    .map((cells) => cells.join('\t'))
    .join('\n');

  const th = (text: string) => `<th style="text-align:left;padding:2px 8px">${escape(text)}</th>`;
  const td = (html: string) => `<td style="padding:2px 8px">${html}</td>`;
  const html = [
    '<table><thead><tr>',
    labels.map(th).join(''),
    '</tr></thead><tbody>',
    ...table.map(
      (r) =>
        `<tr>${td(String(r.rank))}${td(
          `<img src="${BASE_URL}/${r.logo}" height="16" style="vertical-align:middle"> <b>${escape(r.name)}</b>`,
        )}${r.values.map((v) => td(escape(v))).join('')}</tr>`,
    ),
    '</tbody></table>',
  ].join('');

  const clipboardItem = new ClipboardItem({
    'text/plain': new Blob([plain], { type: 'text/plain' }),
    'text/html': new Blob([html], { type: 'text/html' }),
  });
  return navigator.clipboard.write([clipboardItem]);
}

// Header cells after the drag handle and player info; grouped boxes contribute one column per grade
function readColumns(header: HTMLElement): Column[] {
  const columns: Column[] = [];
  Array.from(header.children).forEach((cell, i) => {
    if (!(cell instanceof HTMLElement) || i < 2) return;
    const inner = cell.classList.contains('box') ? Array.from(cell.children) : [];
    const grouped = inner.filter((child) => child.querySelector('.stat-label'));
    if (grouped.length > 1) {
      grouped.forEach((child) =>
        columns.push({ label: labelOf(child), path: [i, inner.indexOf(child)] }),
      );
    } else {
      columns.push({ label: labelOf(cell), path: [i] });
    }
  });
  return columns;
}

function labelOf(cell: Element): string {
  return cell.querySelector('.stat-label')?.textContent?.trim() ?? '';
}

function cellAt(row: HTMLElement, path: number[]): Element | undefined {
  let el: Element | undefined = row;
  for (const i of path) el = el?.children[i];
  return el;
}

// The value only: no labels or icon ligature text (e.g. "arrow_drop_up")
function cellText(cell: Element | undefined): string {
  if (!cell) return '';
  const copy = cell.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('.stat-label, mat-icon').forEach((el) => el.remove());
  // Recent results: W/L/T letters, with unplayed games dropped
  const results = copy.querySelectorAll('.last-five p');
  if (results.length) {
    return Array.from(results)
      .map((p) => p.textContent?.trim())
      .filter((t) => t && t !== '-')
      .join('');
  }
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
