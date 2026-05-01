# Context Management & Handover Protocol
As an AI Agent, you must strictly manage context size to prevent token limits.

## The Handover Process
If the session becomes too long, or if you receive the command "Initiate Handover", you must follow these steps before the session is cleared:
1. Create or update a file named `WIP-handover.md` in the project root.
2. In `WIP-handover.md`, document the following in clear, bulleted points:
   - **Current Objective:** What feature or bug were we just working on?
   - **Completed Progress:** What files were successfully modified and what logic is complete?
   - **Current Blockers/Errors:** What errors were we currently facing (include brief stack trace or symptom)?
   - **Next Steps:** Exactly which files and functions need to be modified next.
3. After saving the file, explicitly instruct the user to run `/clear`.

## Resuming Work
When starting a new session or after a `/clear`, if you see a `WIP-handover.md` file in the root directory, ALWAYS read it first to understand the current context before answering the user's first prompt.