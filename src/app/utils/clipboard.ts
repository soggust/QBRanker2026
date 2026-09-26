const BASE_URL = 'https://qbranker2026.web.app';

// Copy a ranked list as plain text (for Notepad) and HTML with team logos (for web forums)
export function copyRankingsToClipboard(
  players: { name: string; teamLogo: string }[],
): Promise<void> {
  const plain = players
    .map((player, index) => {
      const number = index + 1;
      const playerName = `${number}. ${player.name}`;

      // Add an extra blank line every 10 players
      return number % 10 === 0 ? `${playerName}\n` : playerName;
    })
    .join('\n');

  const html = players
    .map((player, index) => {
      const number = index + 1;
      const teamLogo = `<img src="${BASE_URL}/${player.teamLogo}" alt="${player.teamLogo}" loading="lazy" height="16px" width="auto">`;
      const playerName = `${number}.  ${teamLogo}  <b>${player.name}</b>`;

      // Add an extra blank line every 5 players
      return number % 5 === 0 ? `${playerName}<br>` : playerName;
    })
    .join('<br>');

  const clipboardItem = new ClipboardItem({
    'text/plain': new Blob([plain], { type: 'text/plain' }),
    'text/html': new Blob([`<div>${html}</div>`], { type: 'text/html' }),
  });

  return navigator.clipboard.write([clipboardItem]);
}
