function parseShuffleOutput(output) {
  const headerLines = [];
  const models = [];
  let current = null;

  for (const line of output.split(/\r?\n/)) {
    const model = line.match(/^Model:\s*(.+)$/);
    if (model) {
      current = {
        name: model[1],
        editUrl: null,
        previewUrl: null,
        screenshotUrl: null,
        lines: [line],
      };
      models.push(current);
      continue;
    }

    if (!current) {
      headerLines.push(line);
      continue;
    }

    current.lines.push(line);

    const edit = line.match(/^\s*Edit:\s*(.+)$/);
    const preview = line.match(/^\s*Preview:\s*(.+)$/);
    const screenshot = line.match(/^\s*Screenshot URL:\s*(.+)$/);

    if (edit) current.editUrl = edit[1];
    if (preview) current.previewUrl = preview[1];
    if (screenshot) current.screenshotUrl = screenshot[1];
  }

  return { headerLines, models };
}

module.exports = {
  parseShuffleOutput,
};
