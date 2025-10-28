# Workflow Rules for Cursor Agent

---

- Always read this file and 01_PRD.md before coding.
- Treat the user as the Product Owner.
- Never make assumptions beyond what's in context.
- Always summarize your understanding before writing code.
- Follow 02_ImplementationPlan.md for the next feature phase.
- For UI → use Expo + React Native conventions.
- For backend → use Supabase JS client.
- Always comment your code for beginners (explain logic clearly).
- When refactoring → explain reasoning before changing files.
- When confused → ask clarifying questions, don't hallucinate.
- Output diffs clearly, not full files unless requested.
- Keep code readable and modular (small components, named hooks).

## AI Collaboration Flow
1. Start with Traycer review notes and confirm scope with the Product Owner before coding.
2. Outline the change strategy (plan tool or written summary) so reviewers can follow along.
3. Implement fixes iteratively, sharing diffs or checkpoints when risk is high.
4. Re-run Traycer after changes to verify issues are resolved before handoff.

## Document Priority Order
**Source of truth order (conflict resolution):** 01_PRD.md > 02_ImplementationPlan.md > 03_ProjectStructure.md > 04_UI_UX.md > 06_WorkflowRules.md > 05_BugTracker.md
**Note:** This file (06_WorkflowRules.md) is process-only and does not override product/tech specs.

## RLS Policy Reference
- `fantasy_teams`: `user_id = auth.uid()` for all operations
- `fantasy_rosters`: `team_id IN (SELECT id FROM fantasy_teams WHERE user_id = auth.uid())` for all operations  
- `players`: Create and expose `public_players` view for anon role with limited columns (`id`, `name`, `position`, `team`, `price`, `fppg`). Avoid direct table access from clients.
- Reference: https://supabase.com/docs/guides/auth/row-level-security

## Code Quality Requirements
- **TypeScript check:** Run `npx tsc --noEmit` before committing
- **Linting:** Run `npx eslint . --ext .ts,.tsx` (add ESLint config if needed)
- **Formatting:** Run `npx prettier --write .` (add Prettier config if needed)
- **Testing:** UI/state changes must include basic tests or manual checklist
- **Bug tracking:** Update `05_BugTracker.md` when new known issues are found during a phase
- **Bug template:** Use the template in `05_BugTracker.md` for consistent bug reporting

## Security Requirements
- **Environment variables:** Only anon public keys go under `EXPO_PUBLIC_*`, never service-role or secrets
- **Never commit:** `.env` files, API keys, or sensitive configuration
- **Always commit:** `.env.example` with placeholder values for documentation
- **Setup workflow:** Copy `.env.example` to `.env` and fill in real values locally
- **Sharing:** Never share real keys in PRs, issues, or screenshots
- **Production:** Use EAS secrets or separate environment files for production
### Handoff Checklist
1. Run Traycer in Review mode → identify issues.
2. Hand off fix plan to Cursor → implement changes.
3. Commit results to Git.
4. Run Traycer again → verify fixes.
5. If stable → mark context as verified.
