# V-PROF-03: Profile Copy Values - Tag Search & Tooltip

Verify Copy Values modal tag-based search (PROFILE-44) and tag match tooltip on hover.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/profiles/v-prof-03/01-seed.sh
```

## Steps

1. Open http://localhost:3000/profiles
2. Click Edit on "Database Config" profile
3. Ensure "Staging" environment is selected (default, first alphabetically after Development)
4. Select "Staging" from the environment dropdown
5. Click "Copy Values" button to open the Copy Values modal
6. Verify Recommended and Other sections appear
7. Hover over tag match badge to verify tooltip

## Validation

### Tag Match Sections
- **Recommended section visible**: "Integration" shown with "2 tags match" badge
- **Other section visible**: QA (1 tag match), Development (0), Production (0)
- **Tag match counts correct**: Integration=2, QA=1, Development=0, Production=0

### Tag Match Tooltip
- **Recommended tooltip**: Hovering "2 tags match" badge on Integration shows tooltip with "testing" and "staging" tag chips
- **Other tooltip**: Hovering "1 tag match" badge on QA shows tooltip with "testing" tag chip
- **No tooltip for 0 match**: Development and Production show "0 tags match" without tooltip trigger

### Tag-Based Search (PROFILE-44)
- **Search by tag**: Typing "qa" in search shows only QA environment
- **Case-insensitive**: Typing "TESTING" shows Integration, QA (environments tagged "testing")
- **Name + tag combined**: Typing "dev" matches Development by name
- **Empty result**: Typing "zzznomatch" shows "No environments match your search"
