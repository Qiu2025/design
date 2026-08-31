# Repository Guidelines

## Project Structure & Module Organization

Design is a TypeScript Next.js App Router project. Feature routes live under `app/`: code images in `app/(navigation)/(code)/`, icons in `app/(navigation)/icon/`, metadata removal in `app/(navigation)/metadata/`, and server endpoints in `app/api/`. Reusable UI belongs in `components/`; cross-feature hooks and helpers belong in `utils/`. Keep feature-specific components, stores, styles, and assets beside their route. Static files served unchanged go in `public/`.

Use the configured aliases instead of long relative imports: `@/*` for the repository root, `@code/*` for the code-image feature, and `@icon/*` for the icon feature.

## Build, Test, and Development Commands

- `npm ci`: install the locked dependency set; Node.js 22 is required.
- `npm run dev`: start the development server on `http://localhost:4000`.
- `npm run lint`: run the Next.js ESLint rules across the repository.
- `npm run type-check`: validate strict TypeScript without emitting files.
- `npm run build`: create the production standalone Next.js build.
- `npm run start`: serve the production build on port 4000.

Before submitting changes, run `npm run lint`, `npm run type-check`, and `npm run build`.

## Coding Style & Naming Conventions

Prettier uses double quotes and a 120-character print width; use two-space indentation and semicolons. ESLint enforces Next.js Core Web Vitals, and Stylelint orders CSS declarations. Husky runs `lint-staged` before commits.

Use `PascalCase` for React components, `useCamelCase` for hooks, and `camelCase` for utilities. Feature component files use `PascalCase`; shared primitive filenames use lowercase kebab case (for example, `button-group.tsx`). Name CSS Modules after their component and follow App Router filenames (`page.tsx`, `layout.tsx`, `route.ts`).

## Testing Guidelines

There is no automated test framework or coverage threshold. Treat linting, type checking, a production build, and focused browser checks as required validation. If introducing tests, co-locate them as `*.test.ts` or `*.test.tsx` and add the runner command to `package.json`.

## Commit & Pull Request Guidelines

Follow the history's Conventional Commit style, such as `feat(metadata): add selective inspection` or `fix(api): preserve localhost URLs`. Keep commits focused and use an optional scope for the affected feature. For commit-worthy changes, end the response with a Conventional Commit message. Pull requests should explain the user-visible impact, link relevant issues, list validation commands, and include before/after screenshots for UI changes. Document any new environment variables or deployment requirements.

## Security & Configuration

Never commit `.env*.local` files or credentials such as `SHLINK_API_KEY`. Metadata video routes require `ffmpeg`/`ffprobe`; configure `FFMPEG_PATH` and `FFPROBE_PATH` when they are not available on `PATH`.
