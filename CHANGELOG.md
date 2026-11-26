# Changelog

## 2026-11-26: Kino stands on ui-sdk

Every Kino component is now built on [ui-sdk](https://ui-sdk.dev) (`@ui-sdk/react` and `@ui-sdk/core`). Base UI is gone, and each item installs ui-sdk itself, so `shadcn init` can set your project up on either base. An AI agent can read and drive every component through the [Agent bridge](https://kinoui.com/docs/agent-bridge).

### Renamed

Items and parts take ui-sdk's names. The old install names are gone; the old docs pages redirect to the new ones.

| Was                             | Now                                                                  |
| ------------------------------- | -------------------------------------------------------------------- |
| `dropdown-menu`, `context-menu` | `menu`                                                               |
| `sheet`, `drawer`               | `drawer`, from any side                                              |
| `number-field`                  | `number-input`                                                       |
| `input-otp`                     | `otp-input`                                                          |
| `radio-group`                   | `radio`                                                              |
| `toggle-group`                  | part of `toggle`                                                     |
| `TabsTrigger`                   | `TabsTab`                                                            |
| `…Popup`                        | `…Content`                                                           |
| `…Portal`, `…Positioner`        | gone: popups open in the top layer and are placed from their content |
| `MenuShortcut`                  | the item's `shortcut` prop                                           |
| `MenuLinkItem`                  | `MenuItem` with `render={<a />}`                                     |

### Changed

- Every change callback gets ui-sdk's details: read `details.source` and call `details.cancel()`.
- Menu: submenus are the `MenuSub…` parts. The content's `title` and `sheetLabel` props are gone.
- Drawer: opens from the bottom by default, and a flick's speed carries it, replacing `--drawer-swipe-strength`.
- Tree: `mode` replaces `multiple`, a single value is `string | null`, and `TreeItemCheckbox` is gone.
- Accordion: find in page is opt-in.
- Navigation menu: `active` is `current`, `closeOnClick` is `closeOnSelect`, and the Indicator is gone.
- Number input: the wheel no longer changes the value, and a typed value snaps to `step`.
- Slider: `onValueCommit` fires when a change ends, a range submits as `start/end`, and `largeStep` is 10 steps.
- Money input: `allowOutOfRange` is gone, and an amount clamps when it is committed.
- Rating: a form reset clears it.
- File input: `multiple` is `false` by default.
- Toast: one past `maxVisible` waits and comes in when there is room.

### Removed

- Date picker: month, year and time granularity. Type a date and time in the Date input, or pick a month or year in the Calendar.
- Date input: month and year granularity, and `monthFormat`.
- Time input: a range across midnight.
- Calendar and Date picker: `focusedValue`, `autoFocus`, and `minDays` in multiple mode.
- OTP input: `normalizeValue`.
- Search field: undoing a clear with Cmd/Ctrl+Z.
- Image cropper: Settle mode, drawing a new box, and resizing with Alt and the arrows. Tab to a handle instead.
- Pagination: First and Last are no longer links from `getHref`.
- Color picker: text it can't read goes back to the last colour instead of showing as invalid.
- Carousel: the arrow keys on Previous and Next.
