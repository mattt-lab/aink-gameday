// Layout measurements taken from the device itself, once per run. Fonts and sizes are fixed; these
// numbers are what lets the screens decide "does it fit" by arithmetic instead of trial and error.

const table = (rows) => ({ op: 'table', columns: ['a', 'b', 'c'], rows: Array.from({ length: rows }, () => ['x', 'x', 'x']), size: 12, lines: true });
export const pinBarOp = (text = 'Washington 7  -  Michigan St 3', right = '1Q 5:02  |  BTN') => ({
  op: 'box', border: 1, radius: 6, padding: [6, 10], direction: 'row', align: 'center', gap: 10, children: [
    { op: 'icon', name: 'star', size: 20 },
    { op: 'text', text, size: 18, bold: true, flex: 1, wrap: false },
    { op: 'text', text: right, size: 12, wrap: false },
  ],
});

/**
 * @returns {Promise<{scoreW, clockW, rowPitch12, tableHeaderH12, headerH, headerSubH, pinBarH}>}
 *  headerH = header with title only; headerSubH = header with a subtitle.
 */
export async function measureMetrics(device) {
  const [score, clock] = await device.measure([
    { text: '88', size: 24, bold: true },
    { text: '4Q 11:05', size: 12, bold: true },
  ]);
  const h1 = await device.naturalHeight(table(1));
  const h2 = await device.naturalHeight(table(2));
  const rowPitch12 = h2 - h1;
  return {
    scoreW: score.width + 6,
    clockW: clock.width + 8,
    rowPitch12,
    tableHeaderH12: h1 - rowPitch12,
    headerH: await device.naturalHeight({ op: 'header', title: 'Gameday - Live', right: '2:47 PM', icon: 'bolt' }),
    headerSubH: await device.naturalHeight({ op: 'header', title: 'Gameday - Up Next', subtitle: 'Saturday, Nov 14', right: 'x', icon: 'calendar' }),
    pinBarH: await device.naturalHeight(pinBarOp()),
  };
}

/** Width of the widest string at this size, plus cell padding. */
export async function colWidth(device, strings, size, bold = false) {
  if (!strings.length) return 16;
  const m = await device.measure(strings.map((text) => ({ text, size, bold })));
  return Math.max(...m.map((x) => x.width)) + 16;
}
