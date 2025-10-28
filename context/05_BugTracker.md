# 05_BugTracker.md

---

This file tracks known bugs, UI glitches, or Supabase issues during development.

## Severity Levels

| Severity | Response Time | Repair Time | Definition |
|----------|---------------|-------------|------------|
| **Critical** | Immediate | 4 hours | Blocks core functionality or causes data loss |
| **High** | 2 hours | 1 business day | Major feature broken or significant UX issue |
| **Medium** | 1 business day | 3 business days | Minor feature issue or moderate UX problem |
| **Low** | 2 business days | 1 week | Cosmetic issues or minor annoyances |

**Closure Approval:** Product Owner must approve closure for Critical and High severity issues.

## Bug Template
| ID | Date | Area | Description | Severity | Status | Reporter | Owner | Reproduction Steps | Expected | Actual | Environment |
|----|------|-------|--------------|----------|---------|-----------|-------|-------------------|----------|--------|-------------|
| XXX | YYYY-MM-DD | Component/Feature | Brief description | Critical/High/Medium/Low | Open/In Progress/Fixed/Closed | Name | Name | 1. Step 1<br>2. Step 2 | What should happen | What actually happens | Dev/Staging/Prod |

## Known Issues

| ID | Date | Area | Description | Severity | Status | Reporter | Owner | Reproduction Steps | Expected | Actual | Environment |
|----|------|-------|--------------|----------|---------|-----------|-------|-------------------|----------|--------|-------------|
| 001 | 2024-10-26 | Navigation | Route filename conflicts between docs and code | Medium | Fixed | Cursor | Cursor | 1. Check 03_ProjectStructure.md<br>2. Check actual app files | Consistent naming | Mixed _layout.tsx vs layout.tsx | Dev |
| 002 | 2024-10-26 | Architecture | App.tsx contains direct Supabase calls violating layer rules | High | Fixed | Cursor | Cursor | 1. Check App.tsx<br>2. Verify layer rules | No direct DB calls in App.tsx | Direct supabase calls present | Dev |
| 003 | 2024-10-26 | Dependencies | UI/UX doc references NativeWind but project doesn't include it | Medium | Fixed | Cursor | Cursor | 1. Check 04_UI_UX.md<br>2. Check package.json | Consistent styling approach | NativeWind references without deps | Dev |
