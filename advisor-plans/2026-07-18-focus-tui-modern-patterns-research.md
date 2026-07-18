# Focus TUI modern-pattern research

Date: 2026-07-18

## Scope

This research informs the approved depfresh direction:

- Focus TUI for capable interactive terminals.
- Visual+ as the durable inline, narrow-terminal, non-TTY, CI, pipe, dumb-terminal, and `NO_COLOR`
  fallback.
- A truthful command-level transaction with full preflight before the first replacement.
- No change to machine-readable output or library behavior.

The goal is a stronger visual and functional experience, not a decorative dashboard.

## Primary sources reviewed

- [Bubble Tea](https://github.com/charmbracelet/bubbletea) and its v2 release notes: declarative
  terminal capabilities, one render owner, color downsampling, high-fidelity keyboard handling,
  clipboard support, and support for inline, full-window, or mixed presentation.
- [OpenTUI renderer](https://opentui.com/docs/core-concepts/renderer/),
  [renderables](https://opentui.com/docs/core-concepts/renderables/),
  [ScrollBox](https://opentui.com/docs/components/scrollbox/), and
  [keymap](https://opentui.com/docs/keymap/overview/): on-demand rendering, bounded live rendering,
  scroll-to-selection, viewport culling, layered discoverable commands, and explicit
  suspend/destroy behavior.
- [Textual layout](https://textual.textualize.io/guide/layout/),
  [DataTable](https://textual.textualize.io/widgets/data_table/), and
  [command palette](https://textual.textualize.io/guide/command_palette/): proportional grids,
  fixed table headers/columns, row cursors, zebra treatment, and a built-in discoverability path.
- [Lazygit configuration](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md):
  configurable side-panel proportions, focus expansion, and width/height thresholds for portrait
  layouts.
- [Posting](https://github.com/darrenburns/posting): jump-mode navigation, command palette,
  keyboard-centric workflows, customizable bindings, and editor/pager escape hatches.
- [GitUI](https://github.com/gitui-org/gitui): responsive layout, contextual help, asynchronous
  operations, and keyboard-only control.
- [K9s](https://github.com/derailed/k9s): context-aware shortcut help, command navigation, search,
  view history, and explicit confirmation for configured side-effecting commands.
- [Ratatui layout](https://ratatui.rs/concepts/layout/): constraint-based proportional layouts
  that adapt to the available terminal rectangle.
- [Command Line Interface Guidelines](https://clig.dev/): visible feedback within 100 ms,
  progress for long work, no animation outside a TTY, `NO_COLOR`/`TERM=dumb` behavior, and an
  obvious escape path.

## Research findings

### 1. Adapt the information architecture, not only the column widths

A fixed three-pane composition is insufficient. Strong TUIs change topology when the viewport
shrinks:

- Wide: scope/impact, change table, and evidence lens are visible together.
- Medium: scope becomes a compact rail and the evidence lens overlays or replaces the table.
- Narrow: one drill-down surface with breadcrumbs and Back/Escape navigation.
- Unsupported or non-interactive: Visual+ remains the complete output.

The exact breakpoints must be proven with snapshot tests across widths and Unicode content rather
than treated as visual constants.

### 2. Focus expansion is more valuable than permanent panel density

Lazygit's focus-expansion model and responsive terminal tools support a better depfresh interaction:

- `z` toggles Focus Lens for the active package or dependency.
- The focused surface gets the room previously owned by secondary panels.
- The transition is immediate because keyboard navigation is high-frequency; no decorative motion
  should delay it.
- Escape restores the previous topology and selection.

### 3. A command palette solves discoverability without a permanent wall of shortcuts

Use a contextual footer for the four or five actions relevant to the current focus. Put the full
command set behind `Ctrl+P`, with `?` as the help alias. Commands are data with names, bindings,
availability, and descriptions; they are not scattered key listeners.

Required commands include filtering, focus/zoom, copying the evidence or final report, switching
views, opening help, and leaving the TUI. Side-effect authority remains governed by the invocation,
not by hidden palette commands.

### 4. The dependency table needs genuine table ergonomics

The change table should gain:

- A fixed header and a row cursor.
- A restrained alternating-row treatment for scanability.
- A visible position/scroll indicator.
- Selection-follow scrolling that moves only the minimum distance.
- A compact field/owner breadcrumb rather than repeating those values in every row.
- Search/filter state that remains visible until cleared.

No horizontal scrolling should be required in the supported wide and medium layouts. Narrow mode
uses stacked current/target values rather than truncating away the decision.

### 5. The evidence lens is the product-specific visual differentiator

Generic package dashboards are easy to copy. depfresh already has richer evidence. The selected
dependency should therefore show:

- Exact current and proposed values.
- Diff class, publication age, dependency field, and physical owner.
- Every observed occurrence and its owner.
- Runtime/evidence state without converting unknown into success.
- Policy or apply blockers when they exist.
- A small terminal-native occurrence graph connecting one dependency to its exact owners.

This graph is useful, grounded, and visually distinctive. It must never imply unproven workspace or
hoist topology.

### 6. Motion belongs to asynchronous state, not navigation

Animate only the active asynchronous phase and live progress values. Package selection, pane focus,
filters, command-palette navigation, and zoom toggles should respond immediately. Completion replaces
ephemeral motion with stable state. Reduced-motion mode keeps semantic color/state changes and drops
movement.

### 7. One component must own terminal input and rendering

Bubble Tea v2 explicitly centralizes terminal I/O, and both the existing Plan 026 and depfresh's
failure history show why this matters. The Focus TUI must own cursor, raw mode, alternate screen,
resize, and signal cleanup for its entire lifetime. Durable output begins only after that owner has
destroyed or suspended itself.

### 8. Full-screen output must end in durable shell truth

The alternate screen is an ephemeral workspace, not the only result. On completion or safety block:

1. Stop live rendering.
2. Restore raw input, cursor, and screen state.
3. Print the approved Visual+ result.
4. Set the documented exit code and return normally.

`Ctrl+C`, unexpected errors, resize failures, and terminal capability downgrade require the same
cleanup ordering.

## Focus TUI v2 proposal

### Wide workspace

- **Impact Rail**: package counts, severity profile, and direct jump targets.
- **Change Table**: fixed header, search/filter chip, row cursor, and complete dependency rows.
- **Evidence Lens**: exact facts, occurrence graph, blockers, and next action.
- **Run Rail**: scan, resolve, review, preflight, write, and observe states with one live owner.
- **Command Deck**: contextual bindings plus `Ctrl+P` for every discoverable command.

### Focus Lens

`z` expands the selected dependency into a centered evidence surface. It keeps the package and table
selection as context, shows the exact occurrence graph, and offers copy/report actions. Escape returns
without losing position.

### Responsive topology

- Wide: three coordinated surfaces.
- Medium: compact Impact Rail plus Change Table; Evidence Lens opens over the table.
- Narrow: one surface at a time with breadcrumbs and Back/Escape.
- Non-capable: locked Visual+.

### Motion contract

- Immediate navigation and focus changes.
- One linear live indicator for the active asynchronous phase.
- No looping decoration after completion.
- No animation for non-TTY, `NO_COLOR`, dumb terminal, reduced motion, or keyboard navigation.

## Runtime constraint discovered

The depfresh package currently requires Node `>=24.15.0`. OpenTUI documents that its native renderer
is Bun-first; native renderer creation from Node requires Node `26.4.0` with experimental FFI. Its
keymap package is portable, but the renderer is not compatible with the current shipped runtime
contract without a product-level runtime decision.

The visual and interaction design can be approved independently. Renderer selection must be a later
explicit decision among a Node-native renderer, a dual-runtime optional TUI, or a breaking runtime
change. The design does not assume one.

## Decision update

After reviewing the Focus TUI direction, the maintainer selected Visual+ as the primary human
experience and rejected a full-screen TUI as the default direction. The applicable research is
therefore carried into Visual+ as terminal-native inline visualization:

- A compact change-topology flow instead of permanent panels.
- Exact repeated-occurrence and owner maps instead of an inspector pane.
- Major-update blast-radius graphs instead of a focus overlay.
- One ephemeral asynchronous phase animation that resolves into stable scrollback.
- Complete grouped detail and durable terminal truth without alternate-screen ownership.

The OpenTUI/runtime constraint remains recorded as evidence but is no longer an implementation
decision required by the approved product direction.

## Rejected ideas

- Decorative ASCII logos, gradients, or animations with no state meaning.
- Mouse-only controls or hidden keyboard exits.
- Image/graphics protocols as required UI; Unicode cells remain the portable visual baseline.
- A permanent three-pane layout at every terminal width.
- Progress that survives into final scrollback as repeated frames.
- A TUI-only result with no durable post-cleanup report.
