const BASE_URL = 'https://qbranker2026.web.app';

interface Column {
  label: string;
  // The cell in a row, found by its position (and position inside a grouped box)
  path: number[];
}

// Copy the rankings exactly as shown: current order and the visible columns, read from the list (or,
// with stats off, just the rank, logo and name). Plain text is tab-separated (pastes into spreadsheets
// and notes); HTML is a table with team logos (pastes into forums and docs).
export function copyRankingsToClipboard(list: HTMLElement, stats = true): Promise<void> {
  const header = list.querySelector<HTMLElement>(':scope > li.header-row');
  const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > li.player:not(.header-row)'));
  const columns = header && stats ? readColumns(header) : [];

  const table = rows.map((row, index) => ({
    rank: index + 1,
    name: row.querySelector('.player-name strong')?.textContent?.trim() ?? '',
    logo: logoUrl(row.querySelector<HTMLImageElement>('.team-logo')),
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
          `${r.logo ? `<img src="${r.logo}" height="16" style="vertical-align:middle"> ` : ''}<b>${escape(r.name)}</b>`,
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

// A logo's full address, wherever it's pasted: resolved against the page (each sport's app serves its own
// assets: /nfl/assets/...), and from the live site when copied from a local dev server
function logoUrl(img: HTMLImageElement | null): string {
  const src = img?.getAttribute('src');
  if (!src) return '';
  const url = new URL(src, document.baseURI);
  return /^(localhost|127\.0\.0\.1)$/.test(url.hostname) ? `${BASE_URL}${url.pathname}` : url.href;
}

// A row's cells, looking through display: contents column-group wrappers
function rowCells(row: Element): Element[] {
  return Array.from(row.children).flatMap((child) =>
    child.classList.contains('col-group') ? Array.from(child.children) : [child],
  );
}

// Header cells after the drag handle and player info; grouped boxes contribute one column per grade
function readColumns(header: HTMLElement): Column[] {
  const columns: Column[] = [];
  rowCells(header).forEach((cell, i) => {
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
  let el: Element | undefined = rowCells(row)[path[0]];
  for (const i of path.slice(1)) el = el?.children[i];
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
