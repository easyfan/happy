# May 7 — New sidebar, code editor, session branching

Desktop got a full refresh with a file browser, built-in editor, and zen mode. Sessions can now be branched or rewound.

- Thinking effort selection bug fixed.
- Smarter push notifications — suppressed when you're already in the app.
- Unread dots persist on sessions until you open them.
- Redesigned sidebar with file browser, code editor, and zen mode.
- Fixed stale sessions refusing to load, blank screen on launch, dual cursors in remote mode, `claude --resume` not finding Happy sessions.

Experimental — enable in Settings → Features:
- File diffs sidebar — see git changes next to chat on desktop.
- Image attachments — paste images into chat, E2E encrypted.
- Session fork & rewind — branch off any session or roll back to any message.

# April 26 — Voice fixes, diffs, scroll

Voice actually works reliably now, plus better content rendering.

- Voice calls no longer break on second session.
- Tables and code blocks scroll horizontally.
- New diff viewer with syntax highlighting and unified/split toggle.
- Model and effort choices persist on mobile.
- Permission prompts no longer get lost.
- Settings stop randomly resetting during sync.
- Scroll-to-bottom button in chat.
- Delete machines from settings.

# April 8 — Gemini models, voice onboarding, CLI fixes

New models, smoother onboarding, fewer CLI hangs.

- Latest Gemini models in the picker.
- Better voice onboarding — clearer first-run prompts.
- CLI plan approval buttons actually show up now.
- CLI background tasks and Codex turns no longer hang.

# March 19 — New session screen, git worktrees, more agents

Completely new way to start sessions, plus worktree support and more agents.

- New session composer — pick machine, worktree, draft persists.
- Git worktree management from the app. Auto-cleanup on delete.
- Auto plan mode when your agent enters planning.
- OpenClaw as a selectable agent.
- Session quick actions, resume, delete from info screen.
- "Bypass" renamed to "yolo".

# December 22 — Agent updates, voice changes, tables

Agent config changes and voice pricing heads-up.

- Gemini support coming via ACP.
- Model config removed from app — use CLI defaults.
- Voice going subscription after 3 free trials.
- Markdown tables render properly now.

# September 12 — Codex, daemon mode, one-tap launch

Sessions start instantly now. No more manual CLI startup.

- Codex support for code completion and generation.
- Daemon mode — sessions start instantly without manual CLI startup.
- One-tap launch from mobile.
- Connect Anthropic and GPT accounts.

# August 29 — GitHub integration

Your GitHub identity in Happy.

- Connect your GitHub account via OAuth.
- Avatar, name, and bio sync to the app.
- Encrypted token storage.

# June 26 — QR login, dark mode, voice

Link devices instantly, look good doing it.

- QR code auth for instant device linking.
- Dark theme with system preference detection.
- Faster voice responses.
- Modified file indicators in session list.
- 15+ languages for voice.

# May 12 — Hello world

First release. Everything is new.

- E2E encrypted sessions.
- Voice assistant.
- File manager with syntax highlighting.
- Real-time sync across devices.

# May 13 — iOS OTA fix

This release fixes OTA update delivery on iOS — updates now correctly reach your device over the air.

- Fixed: iOS app now correctly receives OTA updates (resolved a missing channel header in native config)

# May 13 — Navigation fixes, brand cleanup, security

This release fixes a navigation regression and cleans up leftover brand references in the Settings page.

- Fixed: starting a new session no longer jumps back to the previous session after sending the first message
- Fixed: the Back gesture from a new session now returns to the session list instead of the new-session input page
- Fixed: Settings page now correctly shows "easyfan/happy" for the GitHub link
- Security: improved internal file handling to prevent path traversal in file upload operations

# May 11 — Attachment, image picker, navigation stability

This release fixes several small issues affecting attachment handling, image picker, and navigation stability.

- Fixed: selecting an image or file attachment and then switching to another session no longer carries the attachment over
- Fixed: replaced a deprecated image picker API to ensure continued compatibility with future Expo updates
- Fixed: removed a stale navigation route registration that could cause warnings on app startup

# May 10 — Archive file support, attachment fixes

This release adds support for sending compressed archive files and fixes a rare attachment retry issue.

- Added support for sending .zip, .tar, and .gz archive files as attachments
- Fixed: deleted file attachments now show a permanent "Download failed" state instead of retrying endlessly
- Improved reliability of background sync when a session is not found

# May 5 — Multi-device permission reliability (web)

This release improves multi-device reliability for web sessions.

- Fixed: Web sessions now show a "Handled on another device" notification when a permission request was approved or denied on another device while briefly disconnected
- Permissions missed during a temporary disconnect are surfaced automatically once the web session reconnects

# April 27 — File attachment experience improvements

This release improves the file attachment experience with inline upload progress and broader file format support.

- Attachment upload progress is now shown inside the message input box
- Attachment preview card disappears automatically once the file finishes uploading
- Tapping the attach button while a file is attached will cancel and remove it
- Added support for Microsoft Office file formats: .doc, .docx, .xls, .xlsx, .ppt, .pptx
