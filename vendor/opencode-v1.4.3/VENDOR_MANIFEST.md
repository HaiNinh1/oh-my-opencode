# Vendor Manifest: OpenCode v1.4.3

## Source

- **Repository**: https://github.com/nicepkg/opencode
- **Tag**: v1.4.3
- **Commit**: 877be7e8e04142cd8fbebcb5e6c4b9617bf28cce
- **Date**: 2025-04-18

## Packages Vendored

| Package | Path | Purpose |
|---------|------|---------|
| opencode | packages/opencode/ | Main CLI + TUI + server |
| @opencode-ai/sdk | packages/sdk/js/ | SDK types used by TUI |
| @opencode-ai/plugin | packages/plugin/ | Plugin API contract |
| @opencode-ai/util | packages/util/ | Shared utilities |
| @opencode-ai/script | packages/script/ | Build script helpers |

## Modified Files (Hermes Transparent Proxy)

All modifications are confined to TUI display/selection logic:

| File | Change |
|------|--------|
| packages/opencode/src/cli/cmd/tui/context/local.tsx | Filter selectable agents to Hermes-only |
| packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx | Show proxy target in prompt bar |
| packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx | Filter @autocomplete to allowed targets |
| packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx | Simplify agent picker (Hermes only) |
| packages/opencode/src/cli/cmd/tui/routes/session/index.tsx | Show proxy target colors/labels |
| packages/opencode/src/cli/cmd/tui/routes/session/subagent-footer.tsx | Enhanced label for proxy sessions |

## Build

```bash
cd vendor/opencode-v1.4.3
bun install
cd packages/opencode
bun run script/build.ts --single --skip-embed-web-ui
```

Binary output: `packages/opencode/dist/opencode-<platform>-<arch>/bin/opencode`

## Refresh Process

1. Update this manifest with the new upstream tag/commit
2. Re-copy packages from upstream (rsync with --delete)
3. Re-apply modifications listed above
4. Verify build: `bun run script/build.ts --single --skip-embed-web-ui`
5. Smoke test: run binary and verify Hermes proxy display
