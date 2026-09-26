# Safe branch switching on Windows

Branches 04-08 previously tracked 1,362 files under `node_modules`, and 04/05 also
tracked `.env`. An ignore rule does not untrack files already in Git. Switching
to an early branch therefore attempted to remove dependencies and could pause
at Windows file-access prompts. Interrupting Git can leave `index.lock` behind.

Each local milestone branch now has an additive maintenance commit removing
these entries from its tip, with the same ignore rules and safety tools. Application
code and earlier commits are preserved. No dependency or credential files were
deleted from disk by the cleanup. It does not rewrite old commits or remote refs.

## Normal workflow

1. Stop `npm start` with Ctrl+C in the terminal running the server. Stop Live Server
   when switching to an older layout. Keep each terminal outside `node_modules`.
2. Finish commits/merges and save changes you want to keep. Run one Git write
   operation at a time; don't start another checkout while one is still waiting.
3. From the project root in PowerShell, use:

   ```powershell
   .\tools\switch-branch.ps1 08
   ```

   Or audit every local branch without switching:

   ```powershell
   .\tools\switch-branch.ps1 -CheckOnly
   ```

   If PowerShell blocks this trusted repository script under your existing execution
   policy, `git switch --no-overwrite-ignore 08` remains available after checking
   `git status` and ensuring no other Git operation is running. No policy change is required.
4. On a branch with `package-lock.json`, run `npm ci` after switching if dependencies
   changed or a prior interrupted checkout left them incomplete. Stop the server first.
   Early branches such as 03 have no Node package manifest; use their original UI.

The helper checks for active Git processes, locks, merges/rebases, tracked changes,
and unsafe files in the target branch. It never removes locks, kills processes,
auto-stashes work, forces checkout, or overwrites ignored files. An unrelated Git
operation can conservatively block it; wait and retry. Git itself remains the final
check for conflicting untracked files. Read its errors rather than forcing a switch.

## Commit protection

This checkout uses a repository-local setting, not a global Git setting:

```powershell
git config --local core.hooksPath .githooks
```

Repeat this once after cloning. The pre-commit hook checks the staged index and rejects
dependencies, real `.env` files, uploads and build output, even when force-added.
`.env.example` remains allowed. The hook does not examine or print secret contents.
Hooks can be bypassed and are not installed automatically by Git on other computers.
Run the audit after importing another branch, merging older work or pulling remote changes.
`.gitattributes` keeps shell hooks in LF format when Windows checks them out.

## If index.lock already exists

Do not delete it while Git is running. Inspect the original terminal first: Git may
be waiting for an editor or a file-access retry. Finish that operation, or cancel it
there. After confirming there are no active Git operations, a leftover lock can be
removed. Then inspect `git status`; an interrupted checkout may have partly changed
files. Do not run `git reset --hard`, `git clean -fdx`, or a forced checkout to hide
the problem. They can destroy work, uploads or local credentials.

These safeguards reduce the recurring dependency-checkout problem. They cannot
prevent a crash, power loss, external file lock or simultaneous Git process.
Automatic lock deletion is deliberately not used.

## Credentials and historical commits

Removing `.env` from branch tips does not remove it from older commits. If real
database passwords or JWT secrets from those commits were shared or pushed, rotate
them. History cleanup is a separate coordinated operation; this maintenance does
not rewrite history or push to GitHub. Old remote branches and detached historical
commits can still contain tracked dependencies or credentials.
