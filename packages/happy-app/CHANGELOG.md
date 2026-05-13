# Changelog

## Version 14 - 2026-05-13

This release fixes a navigation regression introduced in the previous update, and cleans up some leftover brand references in the Settings page.

- Fixed: starting a new session no longer jumps back to the previous session after sending the first message — navigation now correctly lands on the new session
- Fixed: the Back gesture from a new session now returns to the session list instead of the new-session input page
- Fixed: Settings page now correctly shows "easyfan/happy" for the GitHub link, and removes leftover third-party brand references from the about section
- Security: improved internal file handling to prevent path traversal in file upload operations

## Version 13 - 2026-05-11

This release fixes several small issues affecting attachment handling, image picker, and navigation stability.

- Fixed: selecting an image or file attachment and then switching to another session no longer carries the attachment over — it is now cleared automatically
- Fixed: replaced a deprecated image picker API to ensure continued compatibility with future Expo updates
- Fixed: removed a stale navigation route registration that could cause warnings on app startup

## Version 12 - 2026-05-10

This release adds support for sending compressed archive files, and fixes a rare issue where a deleted file attachment could cause repeated failed network requests.

- Added support for sending .zip, .tar, and .gz archive files as attachments
- Fixed: deleted file attachments now show a permanent "Download failed" state instead of retrying endlessly
- Improved reliability of background sync when a session is not found

## Version 11 - 2026-05-05

This release improves multi-device reliability for web sessions — permission prompts that were handled on another device during a brief disconnect are now clearly surfaced instead of silently disappearing.

- Fixed: Web sessions now show a "Handled on another device" notification when a permission request was approved or denied on another device while the web client was briefly disconnected
- Permissions missed during a temporary disconnect are surfaced automatically once the web session reconnects, so you always know what decisions were made

## Version 10 - 2026-04-27

This release improves the file attachment experience — the upload progress now appears inline inside the input box, and the preview card disappears cleanly once the file is ready. Word, Excel, and PowerPoint files are now supported alongside PDF and text.

- Attachment upload progress is now shown inside the message input box, expanding it naturally instead of floating above
- Attachment preview card disappears automatically once the file finishes uploading — the file is silently attached and sent with your next message
- Tapping the (now highlighted) attach button while a file is attached will cancel and remove it
- Added support for Microsoft Office file formats: .doc, .docx, .xls, .xlsx, .ppt, .pptx

## Version 9 - 2026-04-15

## Version 9 - 2026-04-26

Voice reliability, better content rendering, and a new diff viewer.

- Fixed voice calls breaking on second session — works reliably every time now
- Tables and code blocks scroll horizontally instead of overflowing
- New diff viewer with syntax highlighting and unified/split toggle (desktop and web only)
- Model and effort level choices now persist on mobile
- Permission prompts (accept/reject) no longer get lost
- Settings no longer randomly reset during sync
- Added scroll-to-bottom button in chat
- Delete machines you no longer use from settings

## Version 7 - 2026-04-08

This preview release expands the current update with the latest Gemini models, a smarter voice onboarding flow, and more reliable Happy CLI sessions for plan approvals and Codex turns.

- Update Happy CLI with `npm i -g happy`
- Added the latest Gemini models to the picker
- Improved voice onboarding with smarter first-run prompts and clearer upgrade guidance for free users
- Fixed Happy CLI plan approval flows so Accept and Reject buttons show up reliably in plan mode
- Fixed Happy CLI background task updates and Codex turns that could sometimes hang or fail to complete

## Version 6 - 2026-03-19

This is the biggest update since launch — a redesigned session creation experience, Git worktree management, expanded agent support.

- New session composer screen with machine selection, worktree picker, draft persistence, and offline machine visibility.
- Git worktree management — list, create, and select worktrees from the app. Worktrees auto-cleanup on session delete.
- Automatic plan mode switching when your agent enters planning mode.
- OpenClaw added as a selectable AI agent alongside Claude Code and Codex.
- Session quick actions for faster interaction with active sessions.
- Session resume support — pick up where you left off.
- Delete sessions directly from the session info screen.
- Renamed "bypass" permission mode to "yolo" with updated styling.
- Improved markdown rendering and message formatting.
- Improved message sync reliability with edge case fixes.
- Various UI polish: send spinner, hidden internal tool calls, improved spacing.

## Version 5 - 2025-12-22

This release expands AI agent support and refines the voice experience, while improving markdown rendering for a better chat experience.

- We are working on adding Gemini support using ACP and hopefully fixing codex stability issues using the same approach soon! Stay tuned.
- Removed model configurations from agents. We were not able to keep up with the models so for now we are removing the configuration from the mobile app. You can still configure it through your CLIs, happy will simply use defaults.
- Elevenlabs ... is epxensive. Voice conversations will soon require a subscription after 3 free trials - we'll soon allow connecting your own ElevenLabs agent if you want to manage your own spendings.
- Improved markdown table rendering in chat - no more ASCII pipes `|--|`, actual formatted tables (layout still needs work, but much better!)

## Version 4 - 2025-09-12

This release revolutionizes remote development with Codex integration and Daemon Mode, enabling instant AI assistance from anywhere. Start coding sessions with a single tap while maintaining complete control over your development environment.

- Introduced Codex support for advanced AI-powered code completion and generation capabilities.
- Implemented Daemon Mode as the new default, enabling instant remote session initiation without manual CLI startup.
- Added one-click session launch from mobile devices, automatically connecting to your development machine.
- Added ability to connect anthropic and gpt accounts to account

## Version 3 - 2025-08-29

This update introduces seamless GitHub integration, bringing your developer identity directly into Happy while maintaining our commitment to privacy and security.

- Added GitHub account connection through secure OAuth authentication flow
- Integrated profile synchronization displaying your GitHub avatar, name, and bio
- Implemented encrypted token storage on our backend for additional security protection
- Enhanced settings interface with personalized profile display when connected
- Added one-tap GitHub disconnect functionality with confirmation protection
- Improved account management with clear connection status indicators

## Version 2 - 2025-06-26

This update focuses on seamless device connectivity, visual refinements, and intelligent voice interactions for an enhanced user experience.

- Added QR code authentication for instant and secure device linking across platforms
- Introduced comprehensive dark theme with automatic system preference detection
- Improved voice assistant performance with faster response times and reduced latency
- Added visual indicators for modified files directly in the session list
- Implemented preferred language selection for voice assistant supporting 15+ languages

## Version 1 - 2025-05-12

Welcome to Happy - your secure, encrypted mobile companion for Claude Code. This inaugural release establishes the foundation for private, powerful AI interactions on the go.

- Implemented end-to-end encrypted session management ensuring complete privacy
- Integrated intelligent voice assistant with natural conversation capabilities
- Added experimental file manager with syntax highlighting and tree navigation
- Built seamless real-time synchronization across all your devices
- Established native support for iOS, Android, and responsive web interfaces
