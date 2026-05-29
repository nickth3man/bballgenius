# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MIT License
- CONTRIBUTING.md with development setup and guidelines
- GitHub issue and PR templates
- .editorconfig for cross-editor consistency
- Architecture documentation (docs/architecture.md)
- Code of Conduct (Contributor Covenant v2.1)
- Security policy (SECURITY.md)
- Dependabot configuration for automated dependency updates
- Daily security audit workflow
- .markdownlint.json for consistent documentation formatting

## [1.0.0] - Initial Release

### Added

- **Hub**: Keyboard-driven OpenTUI NBA analytics hub
  - Game Center: recent games, box scores, player shot charts
  - Career Time-Machine: player/team search, BBR mirror views, dossiers, honors
  - SQL Sandbox: schema browser and ad-hoc DuckDB query editor
- **Chatbot**: LangGraph-powered conversational NBA agent
  - ReAct agent with SQL critic error-correction loop
  - DuckDB tools: `query_nba_db` (read-only SQL) and `get_schema_info` (table discovery)
  - Streaming token output via OpenRouter
  - Interactive model selector
  - 100-query eval suite across 17 NBA categories
- **Infrastructure**: Bun monorepo with Biome, Lefthook, strict TypeScript
- **CI**: 9-job GitHub Actions pipeline with DuckDB fixture for integration tests
- **BBR Mirror**: Firecrawl-based Basketball-Reference screenshot and markdown mirror
