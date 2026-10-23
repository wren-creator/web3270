// Pure scan behind Hidden Field Reveal, split out so it is tested without a
// browser. Works on the screen object either engine emits: 3270 and 5250 both
// carry screen.fields with startAddr, nondisplay, protected and content.
export function findHiddenFields(screen) {
  if (!screen || !screen.fields) return [];
  const cols = screen.cols || 80;
  return screen.fields
    .filter(f => f.nondisplay)
    .map(f => {
      const addr = f.startAddr + 1; // first data cell, not the attribute cell
      const content = (f.content || '').replace(/\x00/g, ' ').trimEnd();
      return {
        row: Math.floor(addr / cols), col: addr % cols,
        protected: !!f.protected, length: content.length, content,
      };
    });
}
