# Admin Component Audit

Audit date: 2026-11-01. Android Admin UI is a React Native monolith in `apps/admin-app/App.js`; there is no separate component directory.

| Component / source | Props and behavior | Dependencies and risks | Status |
|---|---|---|---|
| `App` (`App.js`) | No props; wraps `AppBody` in safe-area provider/view and status bar | Native framework shell; Expo bundle build succeeded | PASS – bundle/build |
| `AppBody` (`App.js`) | No props; owns login, profile, tokens, navigation, API payloads, filters, modals, push, support, reward and CSV state | Highly coupled; 20 section branches and numerous inline callbacks make regression risk high. Not independently component-tested | NOT TESTED – authenticated interaction |
| `Button` (`App.js`) | `title`, `onPress`, `disabled`, `secondary`; accessible Pressable with nested Text | Correct RN text nesting and disabled styles; no automated interaction test | PASS – source/build; interaction NOT TESTED |
| `DetailFields` (`App.js`) | `value`, optional `depth`; recursive, masks secret-like field names, formats paise | Used for arbitrary API data; recursive rendering; raw JSX text scan passed | PASS – parser/build |
| React Native built-in `Modal` | Inline claim/support/detail/zoom modal trees | No separate reusable modal abstraction; native modal interaction untested | NOT TESTED |
| `TextInput` fields | Login/search/status/announcement/reward/claim/support inputs are inline | Validation varies by flow; no form-level component tests | NOT TESTED – interaction |
| `ScrollView` / `RefreshControl` | Main section navigation, records and refresh | P2P auto-polls every 4 seconds; full list pagination absent except deposits | PASS – bundle; device layout NOT TESTED |
| `Image` evidence viewer | Claim screenshot from secure evidence API; zoom modal | Protected endpoint requires admin auth; image access not exercised with a device/admin session | BLOCKED – authenticated device test |
| `ActivityIndicator` | Shown when shared `busy` state is true | Many actions share one flag; requests may block other operations; request lacks explicit timeout | NOT TESTED – network failure UX |
| `responseHelpers.cjs` (`asArray`, `asRecord`, `ensureApiObject`, `normalizeListPayload`, `normalizeP2pPayload`, `normalizeSupportTicket`) | Normalizes server collections and rejects invalid successful payload | Existing unit suite covers malformed API shapes and nested collections | PASS – 3/3 tests |
| `styles` (`StyleSheet.create`, `App.js`) | One shared white theme and layout tokens | Single global style object; responsive small-screen layout and accessibility contrast not device-measured | NOT TESTED – device UI |

## Static component checks

- Babel parsed the full `App.js` JSX successfully.
- JSX text-node scan found no visible raw text directly under non-`Text` nodes.
- Expo Android bundling passed after the audit fixes.
- Missing keys: list/map renderers inspected; section cards, rows, chart rows, events, rules, and detail entries use keys. Runtime device confirmation remains NOT TESTED.

## Component-level findings

1. **High maintainability risk:** screen logic, state, callbacks and styles are all in a single file; there are no isolated screens or component tests.
2. **Medium UX risk:** one `busy` boolean serializes unrelated work and can disable unrelated controls while long requests run.
3. **Medium loading risk:** `request()` originally had no explicit timeout; a network stall can keep a section busy until the platform rejects the request. This remains an open issue.
4. **Medium responsiveness risk:** horizontal navigation and compact search/status fields are present, but no physical Android screen-size test was possible because `adb devices` returned no devices.

No new UI package/component was introduced. One rendering defect in System Health was fixed; see final report.
