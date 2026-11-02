# WAVE Frontend

React-based web interface for the Workflow Automation and Validation Engine (WAVE).

## Overview

The WAVE frontend provides an intuitive visual interface for:
- Building workflows with drag-and-drop (React Flow)
- Managing test suites and regressions
- Real-time execution monitoring via WebSocket
- Interactive debugging and inspection

## Technology Stack

- **React**: 19.x (latest)
- **Build Tool**: Vite 7
- **Language**: TypeScript 5.9
- **Workflow Visualization**: @xyflow/react (React Flow)
- **State Management**: Zustand
- **Testing**: Vitest with React Testing Library

## Quick Start

Run these commands sequentially to set up the frontend:

```bash
# 1. Verify Node.js 22.13 or a later 22 release, or Node.js 24 or later
node --version

# 2. Navigate to frontend directory
cd frontend

# 3. Install all dependencies
npm ci

# 4. Run tests to verify setup
npx vitest run tests/lib/api.test.ts

# All set! ✅
```

## Development Workflow

### Running the Dev Server

```bash
# Start development server at http://localhost:3000
npm run dev
```

The development server will proxy API requests to the backend at `http://localhost:8000`.

### Custom Backend/Frontend Ports

To run a second frontend and backend beside your first (a second backend in the same clone uses the same config file and data folder):

```bash
# Frontend on port 3001, connecting to backend on port 8001
WAVE_BE_URL=http://localhost:8001 npm run dev -- --port 3001
```

**Environment Variables:**
- `WAVE_BE_URL`: where the dev server's proxy sends API and WebSocket requests (default: `VITE_API_BASE_URL`, then `http://localhost:8000`)
- `VITE_API_BASE_URL`: the backend URL the browser calls directly, skipping the proxy (default: the page's own address plus `/api`)
- `VITE_WS_URL`: the WebSocket URL (default: from `VITE_API_BASE_URL` when set, otherwise `/ws` on the page's own address)

**CORS Note:** The backend must allow the frontend origin. For development, ports 3000 and 3001 are pre-configured in `backend/config/config.example.yaml`, the file `backend/config/config.yaml` is copied from. Start the backend with:

```bash
# Backend on port 8001, from the root of the clone
cd backend
WAVE_ADMIN_ALLOWED=true poetry run uvicorn wavecore.api.app:app --reload --reload-exclude "$PWD/data" --reload-exclude "$PWD/tests" --port 8001
```

### Running Unit Tests

```bash
# Run the tests of one file
npx vitest run tests/lib/api.test.ts
```

From the root of the clone, `./scripts/ci-frontend-local.sh` runs every test and fails below 100% coverage of lines, branches and statements, or below 96% of functions.

### Running E2E/Visual Tests (Playwright)

E2E specs live in `tests/e2e/` and run in containers. From the root of the clone: `./scripts/e2e-targeted-local.sh <spec>` for one spec, `./scripts/ci-playwright-local.sh` for all. See `tests/e2e/README.md`.

### Code Quality

```bash
# Type checking
npm run type-check

# Build production bundle
npm run build
```

## Project Structure

```
src/
├── app/            # Entry point, router, layouts, App.tsx, main.tsx, index.css
├── components/     # Shared UI components
├── design-system/  # Design tokens and base components
├── features/       # Feature modules (domain-driven)
├── hooks/          # Shared React hooks
├── lib/            # Utilities and helpers
├── services/       # API client services
├── stores/         # Global Zustand stores
└── types/          # Shared TypeScript types
```

Tests live in `frontend/tests/`, not in `src/`.

## Development Notes

- React 19 uses automatic batching and concurrent features for improved performance
- Vite provides extremely fast HMR (Hot Module Replacement)
- TypeScript strict mode is enabled for maximum type safety
- All tests use Vitest with jsdom environment for React component testing

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development workflow and guidelines.

## License

See project root for license information.
