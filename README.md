# SOAR releases

This repository hosts SOAR's installer and updater assets. Source stays in the private source repositories.

Publishing a release posts its title, release notes and download link to SOAR Beta's `#announcements`, mentioning `@everyone`. Drafts and edits do not post. The channel-scoped incoming webhook is stored only in the repository's `DISCORD_RELEASE_WEBHOOK_URL` Actions secret.

The **Announce SOAR release on Discord** Actions workflow also accepts a published tag manually. It defaults to a dry run with mentions off. Turn off dry run to deliver; enable `mention_everyone` only when you intend to notify members. Manual runs and re-runs can post again, so check the channel before repeating a successful delivery.

Create future release tags from the current `main` branch so they include this workflow. Existing tags predating it can be announced manually. Releases published with another workflow's `GITHUB_TOKEN` do not trigger a release workflow: explicitly dispatch this workflow after publishing in that case. Releases published through the normal GitHub UI or authenticated release CLI trigger automatically.
