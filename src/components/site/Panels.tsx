import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Minus, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { formatINR, getProduct, PRODUCTS, searchProducts } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { NAV } from "./Header";

function Drawer({
  open,
  side = "right",
  label,
  onClose,
  children,
  className,
}: {
  open: boolean;
  side?: "right" | "left" | "top";
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const pos =
    side === "right"
      ? "right-0 top-0 h-full w-full max-w-[460px]"
      : side === "left"
        ? "left-0 top-0 h-full w-full max-w-[420px]"
        : "inset-x-0 top-0 max-h-[100dvh]";
  const hidden =
    side === "right"
      ? "translate-x-full"
      : side === "left"
        ? "-translate-x-full"
        : "-translate-y-full";
  return (
    <div className={cn("fixed inset-0 z-50", !open && "pointer-events-none")} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-ink/40 transition-opacity duration-500",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "absolute flex flex-col bg-chalk transition-transform duration-700 ease-lux",
          pos,
          open ? "translate-0 shadow-drawer" : hidden,
          className,
        )}
      >
        {children}
      </aside>
    </div>
  );
}

function DrawerHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-hairline px-6">
      <p className="eyebrow">{title}</p>
      <button
        onClick={onClose}
        aria-label="Close"
        className="-mr-2 grid h-10 w-10 place-items-center hover:text-oxblood"
      >
        <X className="h-5 w-5 stroke-[1.3]" />
      </button>
    </div>
  );
}

export function CartDrawer() {
  const { panel, setPanel, cart, setQty, removeLine, subtotal, count } = useStore();
  const close = () => setPanel(null);
  const free = 2500;
  return (
    <Drawer open={panel === "cart"} label="Shopping bag" onClose={close}>
      <DrawerHead title={`Your bag (${count})`} onClose={close} />
      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="font-display text-3xl">Your bag is empty</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Begin with something small — card cases start at ₹1,290.
          </p>
          <Link
            to="/collections/$slug"
            params={{ slug: "new-in" }}
            onClick={close}
            className="btn-ink mt-8"
          >
            Shop new in
          </Link>
        </div>
      ) : (
        <>
          <div className="border-b border-hairline px-6 py-4 text-xs text-muted-foreground">
            {subtotal >= free
              ? "Your order qualifies for complimentary shipping."
              : `Add ${formatINR(free - subtotal)} for complimentary shipping.`}
            <div className="mt-2 h-px bg-hairline">
              <div
                className="h-px bg-oxblood transition-all duration-700"
                style={{ width: `${Math.min(100, (subtotal / free) * 100)}%` }}
              />
            </div>
          </div>
          <ul className="flex-1 divide-y divide-hairline overflow-y-auto px-6">
            {cart.map((l, i) => {
              const p = getProduct(l.slug);
              if (!p) return null;
              return (
                <li key={`${l.slug}-${l.colour}-${l.size}`} className="flex gap-4 py-5">
                  <Link
                    to="/products/$slug"
                    params={{ slug: p.slug }}
                    onClick={close}
                    className="w-24 shrink-0 bg-paper"
                  >
                    <img
                      src={p.images[0]!}
                      alt={p.name}
                      className="aspect-[4/5] w-full object-cover"
                    />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-3">
                      <p className="text-sm">{p.name}</p>
                      <p className="text-sm tabular-nums">{formatINR(p.price * l.qty)}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {l.colour}
                      {l.size ? ` · ${l.size} cm` : ""}
                    </p>
                    <div className="mt-auto flex items-center justify-between">
                      <div className="flex h-9 items-center border border-input">
                        <button
                          aria-label="Decrease quantity"
                          onClick={() => setQty(i, l.qty - 1)}
                          disabled={l.qty <= 1}
                          className="grid h-full w-9 place-items-center disabled:opacity-30"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
                          {l.qty}
                        </span>
                        <button
                          aria-label="Increase quantity"
                          onClick={() => setQty(i, l.qty + 1)}
                          disabled={l.qty >= 10}
                          className="grid h-full w-9 place-items-center disabled:opacity-30"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          removeLine(i);
                          toast(`${p.name} removed`);
                        }}
                        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-oxblood"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-hairline px-6 py-6">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatINR(subtotal)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Taxes included. Shipping calculated at checkout.
            </p>
            <button
              className="btn-ink mt-5 w-full"
              onClick={() =>
                toast("Checkout is a demo", {
                  description: "No payment is taken in this design preview.",
                })
              }
            >
              Checkout <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function WishlistDrawer() {
  const { panel, setPanel, wishlist, toggleWish, addToCart } = useStore();
  const close = () => setPanel(null);
  const items = wishlist.map(getProduct).filter(Boolean) as typeof PRODUCTS;
  return (
    <Drawer open={panel === "wishlist"} label="Wishlist" onClose={close}>
      <DrawerHead title={`Wishlist (${items.length})`} onClose={close} />
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="font-display text-3xl">Nothing saved yet</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Tap the heart on any piece to keep it here.
          </p>
          <Link
            to="/collections/$slug"
            params={{ slug: "all" }}
            onClick={close}
            className="btn-outline mt-8"
          >
            Explore the collection
          </Link>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-hairline overflow-y-auto px-6">
          {items.map((p) => (
            <li key={p.slug} className="flex gap-4 py-5">
              <Link
                to="/products/$slug"
                params={{ slug: p.slug }}
                onClick={close}
                className="w-20 shrink-0 bg-paper"
              >
                <img src={p.images[0]!} alt={p.name} className="aspect-[4/5] w-full object-cover" />
              </Link>
              <div className="flex flex-1 flex-col">
                <p className="text-sm">{p.name}</p>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {formatINR(p.price)}
                </p>
                <div className="mt-auto flex gap-4 text-xs">
                  <button
                    className="underline underline-offset-4 hover:text-oxblood"
                    onClick={() =>
                      addToCart({ slug: p.slug, colour: p.colours[0]!, size: p.sizes?.[2] })
                    }
                  >
                    Add to bag
                  </button>
                  <button
                    className="text-muted-foreground underline underline-offset-4 hover:text-oxblood"
                    onClick={() => toggleWish(p.slug)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function SearchOverlay() {
  const { panel, setPanel } = useStore();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const open = panel === "search";
  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 150);
  }, [open]);
  const close = () => setPanel(null);
  const results = q.trim() ? searchProducts(q).slice(0, 8) : [];
  const suggestions = ["Tote", "Wallet", "Oxblood", "Briefcase", "Belt", "Weekender"];
  return (
    <Drawer open={open} side="top" label="Search" onClose={close} className="overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-5 pb-10 pt-6 lg:px-10">
        <form
          className="flex items-center gap-4 border-b border-ink pb-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (!q.trim()) return;
            close();
            navigate({
              to: "/collections/$slug",
              params: { slug: "all" },
              search: { q: q.trim() },
            });
          }}
        >
          <Search className="h-5 w-5 shrink-0 stroke-[1.3]" />
          <label htmlFor="site-search" className="sr-only">
            Search the collection
          </label>
          <input
            id="site-search"
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bags, wallets, colours…"
            className="font-display w-full bg-transparent text-2xl outline-none placeholder:text-muted-foreground/60 lg:text-4xl"
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="grid h-10 w-10 shrink-0 place-items-center hover:text-oxblood"
          >
            <X className="h-5 w-5 stroke-[1.3]" />
          </button>
        </form>
        {!q.trim() ? (
          <div className="mt-8">
            <p className="eyebrow text-muted-foreground">Popular searches</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setQ(s)}
                  className="border border-input px-4 py-2 text-sm hover:border-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-display text-3xl">No pieces match “{q}”</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Try a shape (tote, wallet) or a colour (ink, oxblood).
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex items-baseline justify-between">
              <p className="eyebrow text-muted-foreground">{searchProducts(q).length} results</p>
              <Link
                to="/collections/$slug"
                params={{ slug: "all" }}
                search={{ q: q.trim() }}
                onClick={close}
                className="text-sm link-line"
              >
                View all results
              </Link>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-8">
              {results.map((p) => (
                <li key={p.slug}>
                  <Link
                    to="/products/$slug"
                    params={{ slug: p.slug }}
                    onClick={close}
                    className="group block"
                  >
                    <div className="overflow-hidden bg-paper">
                      <img
                        src={p.images[0]!}
                        alt=""
                        className="aspect-[4/5] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    </div>
                    <p className="mt-2 text-[13px]">{p.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatINR(p.price)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}

export function MobileMenu() {
  const { panel, setPanel } = useStore();
  const close = () => setPanel(null);
  const [sub, setSub] = useState<string | null>(null);
  return (
    <Drawer open={panel === "menu"} side="left" label="Menu" onClose={close}>
      <DrawerHead title="Menu" onClose={close} />
      <nav className="flex-1 overflow-y-auto px-6 py-4" aria-label="Mobile">
        <ul>
          {NAV.map((n) => (
            <li key={n.slug} className="border-b border-hairline">
              <button
                className="flex w-full items-center justify-between py-4 text-left font-display text-2xl"
                aria-expanded={sub === n.slug}
                onClick={() => setSub(sub === n.slug ? null : n.slug)}
              >
                {n.label}
                <Plus
                  className={cn(
                    "h-4 w-4 stroke-[1.3] transition-transform duration-500",
                    sub === n.slug && "rotate-45",
                  )}
                />
              </button>
              <div
                className={cn(
                  "grid transition-all duration-500 ease-lux",
                  sub === n.slug ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                  <Link
                    to="/collections/$slug"
                    params={{ slug: n.slug }}
                    onClick={close}
                    className="relative mb-4 block aspect-[16/9] overflow-hidden"
                  >
                    <img src={n.image} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 scrim-bottom" />
                    <span className="absolute bottom-3 left-3 eyebrow text-chalk">
                      Shop all {n.label}
                    </span>
                  </Link>
                  {n.cols
                    .flatMap((c) => c.links)
                    .map((l) => (
                      <Link
                        key={l.label}
                        to="/collections/$slug"
                        params={{ slug: l.slug }}
                        onClick={close}
                        className="block py-2 text-[15px] text-muted-foreground hover:text-ink"
                      >
                        {l.label}
                      </Link>
                    ))}
                </div>
              </div>
            </li>
          ))}
          <li className="border-b border-hairline">
            <Link to="/" hash="house" onClick={close} className="block py-4 font-display text-2xl">
              The House
            </Link>
          </li>
        </ul>
        <div className="mt-8 space-y-3 text-sm">
          <button
            className="block"
            onClick={() => {
              close();
              setTimeout(() => setPanel("wishlist"), 50);
            }}
          >
            Wishlist
          </button>
          <button
            className="block"
            onClick={() => toast("Accounts are not part of this design preview")}
          >
            Account
          </button>
          <button
            className="block"
            onClick={() => toast("Client care: sample contact details to be supplied")}
          >
            Client care
          </button>
        </div>
      </nav>
    </Drawer>
  );
}
