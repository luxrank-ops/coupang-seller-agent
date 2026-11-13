import { MAX_PRODUCTS, isStoredProduct } from "./products.js";

export const STORAGE_KEY = "coupang-sourcing-workspace-v1";

export function loadWorkspace(storage) {
  const empty = {
    favorites: [],
    selected: [],
    imported: [],
    drafts: {},
    mode: "demo",
    warning: false,
  };
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return empty;
    const data = JSON.parse(text);
    if (!data || data.version !== 1) return { ...empty, warning: true };
    const products = (value, limit) =>
      Array.isArray(value) ? value.filter(isStoredProduct).slice(0, limit) : [];
    // Copy only known draft fields; never merge arbitrary persisted objects into state.
    const drafts = Object.create(null);
    if (data.drafts && typeof data.drafts === "object") {
      for (const [id, value] of Object.entries(data.drafts).slice(
        -MAX_PRODUCTS,
      )) {
        if (!value || typeof value !== "object") continue;
        drafts[id] = {};
        for (const field of [
          "name",
          "price",
          "shipping",
          "margin",
          "fee",
          "description",
          "seoName",
          "seoNote",
        ]) {
          if (typeof value[field] === "string")
            drafts[id][field] = value[field].slice(
              0,
              field === "description" ? 2000 : 300,
            );
        }
        for (const field of ["tags", "points"])
          drafts[id][field] = Array.isArray(value[field])
            ? value[field]
                .filter((item) => typeof item === "string")
                .slice(0, 20)
                .map((item) => item.slice(0, 500))
            : [];
      }
    }
    return {
      favorites: products(data.favorites, MAX_PRODUCTS),
      selected: products(data.selected, 100),
      imported: products(data.imported, MAX_PRODUCTS),
      drafts,
      mode: data.mode === "imported" ? "imported" : "demo",
      warning: false,
    };
  } catch {
    return { ...empty, warning: true };
  }
}

export function saveWorkspace(storage, state) {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        favorites: [...state.favorites.values()],
        selected: [...state.selected.values()],
        imported: state.imported,
        drafts: Object.fromEntries([...state.drafts].slice(-MAX_PRODUCTS)),
        mode: state.mode === "imported" ? "imported" : "demo",
      }),
    );
    return true;
  } catch {
    return false;
  }
}
