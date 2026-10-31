import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getProduct } from "./catalog";

export type CartLine = { slug: string; colour: string; size?: string | undefined; qty: number };
type Panel = null | "cart" | "search" | "menu" | "wishlist";

type Store = {
  cart: CartLine[];
  wishlist: string[];
  panel: Panel;
  setPanel: (p: Panel) => void;
  addToCart: (line: Omit<CartLine, "qty">, qty?: number, open?: boolean) => void;
  setQty: (i: number, qty: number) => void;
  removeLine: (i: number) => void;
  toggleWish: (slug: string) => void;
  count: number;
  subtotal: number;
};

const Ctx = createContext<Store | null>(null);
const CART_KEY = "llx-demo-cart";
const WISH_KEY = "llx-demo-wishlist";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setCart(JSON.parse(localStorage.getItem(CART_KEY) || "[]"));
      setWishlist(JSON.parse(localStorage.getItem(WISH_KEY) || "[]"));
    } catch { /* ignore corrupt demo data */ }
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) localStorage.setItem(CART_KEY, JSON.stringify(cart)); }, [cart, loaded]);
  useEffect(() => { if (loaded) localStorage.setItem(WISH_KEY, JSON.stringify(wishlist)); }, [wishlist, loaded]);

  useEffect(() => {
    document.body.style.overflow = panel ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  const addToCart = useCallback((line: Omit<CartLine, "qty">, qty = 1, open = true) => {
    const p = getProduct(line.slug);
    if (!p) return;
    if (p.stock === "out") { toast.error("This piece is currently unavailable (demo)"); return; }
    setCart((c) => {
      const i = c.findIndex((l) => l.slug === line.slug && l.colour === line.colour && l.size === line.size);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: Math.min(10, l.qty + qty) } : l));
      return [...c, { ...line, qty }];
    });
    toast.success(`${p.name} added to bag`, { description: `${line.colour}${line.size ? ` · ${line.size} cm` : ""} · Qty ${qty}` });
    if (open) setPanel("cart");
  }, []);

  const setQty = useCallback((i: number, qty: number) => setCart((c) => c.map((l, j) => (j === i ? { ...l, qty: Math.max(1, Math.min(10, qty)) } : l))), []);
  const removeLine = useCallback((i: number) => setCart((c) => c.filter((_, j) => j !== i)), []);
  const toggleWish = useCallback((slug: string) => {
    setWishlist((w) => {
      const has = w.includes(slug);
      const name = getProduct(slug)?.name ?? "Item";
      toast(has ? `${name} removed from wishlist` : `${name} saved to wishlist`);
      return has ? w.filter((s) => s !== slug) : [...w, slug];
    });
  }, []);

  const value = useMemo<Store>(() => ({
    cart, wishlist, panel, setPanel, addToCart, setQty, removeLine, toggleWish,
    count: cart.reduce((a, l) => a + l.qty, 0),
    subtotal: cart.reduce((a, l) => a + (getProduct(l.slug)?.price ?? 0) * l.qty, 0),
  }), [cart, wishlist, panel, addToCart, setQty, removeLine, toggleWish]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
