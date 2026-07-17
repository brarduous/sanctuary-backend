const fs = require('node:fs');
const path = require('node:path');

const resultDir = path.resolve(
  __dirname,
  '../../sanctuary-clergy-web/qa-fixtures/sermon-voice/evaluation-private',
);

const requestedFile = process.argv[2] ? path.resolve(process.argv[2]) : null;

function newestPrivateResult() {
  const candidates = fs.readdirSync(resultDir)
    .filter((name) => name.endsWith('-private-results.json'))
    .map((name) => path.join(resultDir, name))
    .sort();
  return candidates.at(-1);
}

function renderArtifact(label, run) {
  const { response } = run;
  return [
    `## ${label}`,
    '',
    `### ${response.title}`,
    '',
    `Scripture: ${response.scripture}`,
    '',
    response.body,
    '',
    'Outline:',
    '',
    ...response.outline.map((item) => `- ${item}`),
    '',
    'Format notes:',
    '',
    ...response.formatNotes.map((item) => `- ${item}`),
  ].join('\n');
}

function main() {
  const sourceFile = requestedFile || newestPrivateResult();
  if (!sourceFile || !fs.existsSync(sourceFile)) {
    throw new Error('No private evaluation result was found.');
  }

  const result = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  const sections = [
    '# Blinded Pastor-Voice Review',
    '',
    'Review the three treatments without trying to identify their configuration. Choose a preferred label for each artifact and note any theological, pastoral, quotation, or format concerns. Treatment identities are intentionally omitted.',
  ];

  for (const artifact of [...new Set(result.runs.map((run) => run.artifact))]) {
    sections.push('', `# ${artifact.replaceAll('_', ' ')}`, '');
    const labelEntries = Object.entries(result.blindMap)
      .filter(([key]) => key.startsWith(`${artifact}:`))
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [key, treatment] of labelEntries) {
      const label = key.split(':')[1];
      const run = result.runs.find((candidate) => candidate.artifact === artifact && candidate.treatment === treatment);
      if (!run) throw new Error(`Missing run for ${artifact} ${label}.`);
      sections.push(renderArtifact(label, run), '');
    }
  }

  const packetFile = sourceFile.replace(/-private-results\.json$/, '-blinded-review.md');
  fs.writeFileSync(packetFile, `${sections.join('\n')}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'review_packet_created', packetFile }));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
