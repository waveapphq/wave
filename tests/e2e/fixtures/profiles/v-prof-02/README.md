# V-PROF-02: Profile Create/Edit Modal

Verify Profile modal for creating and editing connection profiles.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/profiles/v-prof-02/01-seed.sh
```

## Steps

1. Open http://localhost:3000/profiles
2. Click "+ New Profile" button to test create modal
3. Click Edit button on a profile row to test edit modal

## Validation

### Create Modal
- **Header:** "Create Profile" with close button
- **Width:** Approximately 460px
- **Name field:** Required input
- **Description field:** Optional input, side-by-side with Name
- **Type selector:** Enabled dropdown to select profile type
- **Tags input:** Present for adding tags
- **Configuration section:** Shows type-specific fields after type selection
- **Secret fields:** Lock icon, masked values, visibility toggle
- **Footer:** Cancel button, Create button (blue)

### Edit Modal
- **Header:** "Edit Profile" with close button
- **Type selector:** Disabled/locked (cannot change type after creation)
- **Existing values:** Name, description, tags, config fields populated
- **Tags display:** Existing tags shown as removable badges
- **Secret fields:** Masked by default with visibility toggle
- **Footer:** Delete Profile (red, left), Cancel, Save Changes

### Constraints
- **Delete disabled:** When profile Usage > 0
- **Delete enabled:** When profile Usage = 0
- **Config fields locked:** When Usage > 0 (can only add new fields)
- **Tooltip:** Explains why delete is disabled
