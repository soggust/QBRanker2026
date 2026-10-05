const BASE_URL = 'https://qbranker2026.web.app';

interface Column {
  label: string;
  // The cell in a row, found by its position (and position inside a grouped box)
  path: number[];
}

// Copy the rankings exactly as shown: current order and the visible columns, read from the list (or,
// with stats off, just the rank, picture and name). Plain text is tab-separated (pastes into spreadsheets
// and notes); HTML is a table with each row's picture: a player's headshot, or the team's logo (pastes
// into forums and docs).
export function copyRankingsToClipboard(list: HTMLElement, stats = true): Promise<void> {
  const header = list.querySelector<HTMLElement>(':scope > li.header-row');
  const rows = Array.from(list.querySelectorAll<HTMLElement>(':scope > li.player:not(.header-row)'));
  const columns = header && stats ? readColumns(header) : [];

  // (headshots load as they scroll into view: one that has loaded gives the shape for every row's)
  const loaded = rows.map((row) => row.querySelector<HTMLImageElement>('img.headshot')).find((img) => img?.naturalWidth);
  const headshotRatio = loaded ? loaded.naturalWidth / loaded.naturalHeight : 160 / 116;
  const table = rows.map((row, index) => ({
    rank: index + 1,
    name: row.querySelector('.player-name strong')?.textContent?.trim() ?? '',
    // (a player's headshot when the row has one, a fighter's in MMA; else the team's logo)
    image: rowImage(row, headshotRatio),
    values: columns.map((column) => cellText(cellAt(row, column.path))),
  }));

  // Plain text: tab-separated, with a row of column labels when the stats come along (a spreadsheet's
  // header); just "rank, name" lines without them
  const labels = ['Rank', 'Name', ...columns.map((c) => c.label)];
  const plain = [...(columns.length ? [labels] : []), ...table.map((r) => [r.rank, r.name, ...r.values])]
    .map((cells) => cells.join('\t'))
    .join('\n');

  // HTML: no header row, the picture in a cell of its own between the rank and the name (forums strip the
  // space or margin between an image and its text, not a cell's padding), the rank close to it; each picture
  // a fixed size, as attributes and style (forums keep one or the other, and an image with only a height
  // gets stretched to the post's width)
  const td = (html: string, padding = '2px 8px') => `<td style="padding:${padding};white-space:nowrap">${html}</td>`;
  const img = ({ src, width, height }: RowImage) =>
    `<img src="${src}" width="${width}" height="${height}" style="width:${width}px;height:${height}px;max-width:${width}px;vertical-align:middle">`;
  const html = [
    '<table><tbody>',
    ...table.map(
      (r) =>
        `<tr>${td(String(r.rank), '2px 4px 2px 8px')}${td(r.image ? img(r.image) : '', '2px 4px')}${td(`<b>${escape(r.name)}</b>`, '2px 8px 2px 4px')}${r.values
          .map((v) => td(escape(v)))
          .join('')}</tr>`,
    ),
    '</tbody></table>',
  ].join('');

  const clipboardItem = new ClipboardItem({
    'text/plain': new Blob([plain], { type: 'text/plain' }),
    'text/html': new Blob([html], { type: 'text/html' }),
  });
  return navigator.clipboard.write([clipboardItem]);
}

// A row's image in the copy: its full address and a size keeping its proportions (the forum keeps the
// width and height; a logo is square, a headshot a cutout wider than tall)
interface RowImage {
  src: string;
  width: number;
  height: number;
}
const IMAGE_HEIGHT = 20;

function rowImage(row: HTMLElement, headshotRatio: number): RowImage | null {
  const headshot = row.querySelector<HTMLImageElement>('img.headshot');
  const img = headshot?.getAttribute('src') ? headshot : row.querySelector<HTMLImageElement>('img.team-logo');
  const src = img ? imageUrl(img) : '';
  if (!img || !src) return null;
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : img === headshot ? headshotRatio : 1;
  return { src, width: Math.round(IMAGE_HEIGHT * ratio), height: IMAGE_HEIGHT };
}

// An image's full address, wherever it's pasted: resolved against the page (each sport's app serves its own
// assets: /nfl/assets/...), and from the live site when copied from a local dev server
function imageUrl(img: HTMLImageElement): string {
  const src = img.getAttribute('src');
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
    // (a collapsed group's strip has no label: not a column)
    if (!(cell instanceof HTMLElement) || i < 2 || !cell.querySelector('.stat-label')) return;
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
