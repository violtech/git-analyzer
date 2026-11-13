# Git Analyzer

Git repository analytics by [Violtech](https://www.violtech.com/). Inspect commit activity, explicit AI attribution, source-code growth and release history through a local dashboard or JSON command-line interface.

Git Analyzer is the general-purpose measurement tool behind Violtech's [AI Development Activity Index](https://www.violtech.com/statistics/ai-development-activity-index). This repository contains the analyzer. Violtech's report selection, research pipeline, historical research datasets and publishing operations are maintained separately.

## Requirements

- Node.js 22 or later, npm and Git.
- Network access when analyzing a public GitHub repository for the first time. Existing local Git repositories can also be analyzed.
- An optional read-only `GITHUB_TOKEN` increases GitHub API limits for repository discovery and pull-request data. Keep tokens in your local environment; never commit them.

## Run locally

```sh
git clone https://github.com/violtech/git-analyzer.git
cd git-analyzer
npm ci
npm run dev
```

Open `http://localhost:3000`. The dashboard runs locally; this repository does not provide a hosted public analysis service. Local caches are written to `.cache/` and are ignored by Git.

## Command line

```sh
# List supported commands and output sections.
npm run ga -- describe

# Analyze a public repository, or provide a local Git repository path.
npm run ga -- report owner/repository --sections summary,ai
```

Read [HEADLESS.md](HEADLESS.md) for command options, JSON fields and measurement definitions. The dashboard and CLI use the same analysis code.

## What the measurements mean

- **AI credit** means an author identity or co-author trailer matches a recognized AI agent. It is an observed minimum: uncredited assistance and credit lost during squash merges are not visible. It does not measure the percentage of all code written by AI, hours worked, autonomy or code quality.
- **Source growth** measures source-language lines in repository trees, with documented file and path exclusions. It is different from gross lines added across commits.
- **Release cadence** uses recognized release tags. Rolling builds, package tags and repository-specific conventions require separate treatment.
- Agent configuration, exclusions, repository history, dates and analyzer versions affect results. The JSON output includes provenance and applied rules where relevant.

See [HEADLESS.md](HEADLESS.md) for the detailed limitations. The published Violtech report contains its own project selection, comparisons, reporting periods and interpretation; running this tool does not by itself reproduce that report.

## Development checks

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Tests include synthetic Git histories, classification rules, release handling, report generation and CLI behavior.

## Citation and feedback

Use [CITATION.cff](CITATION.cff) to cite the software. When citing findings from the AI Development Activity Index, credit **Violtech** and link to the [report](https://www.violtech.com/statistics/ai-development-activity-index).

Report reproducible analyzer bugs through [GitHub Issues](https://github.com/violtech/git-analyzer/issues). Include the analyzer version, relevant command, repository and applicable rules, while removing credentials and private repository information.

## License

[MIT](LICENSE). Existing copyright and attribution notices are retained.
