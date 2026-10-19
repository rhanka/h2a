/** Cooperative complete-source search. Cancellation never publishes partial results. */
export function searchSource(lines, query, current, publish) {
  let offset = 0;
  const matches = [], needle = query.toLocaleLowerCase();
  const chunk = () => {
    if (!current()) return;
    const end = Math.min(lines.length, offset + 4096);
    if (needle) for (; offset < end; offset++) {
      if (lines[offset].toLocaleLowerCase().includes(needle)) matches.push(offset + 1);
    }
    else offset = lines.length;
    if (offset < lines.length) setTimeout(chunk, 0);
    else if (current()) publish(matches);
  };
  setTimeout(chunk, 0);
}
