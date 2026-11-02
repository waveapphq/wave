#!/bin/bash
# Seed palette usage data for V-CANVAS-01f tests
#
# This script seeds localStorage with palette usage history
# to populate the Recent and Most Used sections in flyouts.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The seed data will be injected via browser localStorage
# during test setup. This script prepares any backend data
# if needed (none required for this test as usage tracking
# is client-side via Zustand + localStorage).

echo "V-CANVAS-01f: Palette usage data will be seeded via test setup"
echo "No backend seeding required - usage tracking is client-side"
