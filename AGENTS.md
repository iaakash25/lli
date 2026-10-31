<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Frontend-only design prototype: catalogue lives in `src/lib/catalog.ts`, cart/wishlist/panel state in `src/lib/store.tsx` (localStorage only) — no backend by explicit user request.
- Site chrome (header, drawers, footer, toaster) is mounted once in `src/routes/__root.tsx`; pages only render content.
- Shared visual primitives are `@utility` classes in `src/styles.css` (btn-ink, btn-outline, eyebrow, link-line); use them instead of ad-hoc button styles.
