# 05_BugTracker.md

This file tracks known bugs, UI glitches, or Supabase issues during development.

## Bug Template
| ID | Date | Area | Description | Severity | Status | Assigned | Reproduction Steps | Expected | Actual | Environment |
|----|------|-------|--------------|----------|---------|-----------|-------------------|----------|--------|-------------|
| XXX | YYYY-MM-DD | Component/Feature | Brief description | Critical/High/Medium/Low | Open/In Progress/Fixed/Closed | Name | 1. Step 1<br>2. Step 2 | What should happen | What actually happens | Dev/Staging/Prod |

## Known Issues

| ID | Date | Area | Description | Severity | Status | Assigned | Reproduction Steps | Expected | Actual | Environment |
|----|------|-------|--------------|----------|---------|-----------|-------------------|----------|--------|-------------|
| 001 | 2024-10-26 | Navigation | Route filename conflicts between docs and code | Medium | Fixed | Cursor | 1. Check 03_ProjectStructure.md<br>2. Check actual app files | Consistent naming | Mixed _layout.tsx vs layout.tsx | Dev |
| 002 | 2024-10-26 | Architecture | App.tsx contains direct Supabase calls violating layer rules | High | Fixed | Cursor | 1. Check App.tsx<br>2. Verify layer rules | No direct DB calls in App.tsx | Direct supabase calls present | Dev |
| 003 | 2024-10-26 | Dependencies | UI/UX doc references NativeWind but project doesn't include it | Medium | Fixed | Cursor | 1. Check 04_UI_UX.md<br>2. Check package.json | Consistent styling approach | NativeWind references without deps | Dev |
