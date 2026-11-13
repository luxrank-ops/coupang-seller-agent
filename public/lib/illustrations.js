import { escapeHtml, safeExternalUrl } from "./products.js";

const palettes = {
  living: ["#edf2ef", "#a3b8ab", "#7b9687", "#d2dfd5"],
  kitchen: ["#f5f0e9", "#d6ba98", "#ad9174", "#e8d5ba"],
  pet: ["#f3ede6", "#d3af87", "#a68a71", "#e6d0b9"],
  outdoor: ["#edf0eb", "#a8b6a1", "#7b8c72", "#d3dbcc"],
  car: ["#edf0f2", "#9ba8ad", "#65747e", "#ccd5db"],
  office: ["#f0eef6", "#baafd0", "#9386b5", "#dbd3e8"],
  fashion: ["#f6eeed", "#d4b1aa", "#ad8c84", "#ead4ce"],
  garden: ["#eef2e9", "#b4c29a", "#8e9f7b", "#dae4cc"],
  other: ["#eff1f7", "#b0bcd3", "#8b99b7", "#dbe1ee"],
};
// Original vector product illustrations. They are placeholders, never supplier photos.
const drawings = {
  organizer: `<path d="m60 57 103-5 29 18-105 8Z" fill="var(--light)"/><path d="m62 64 24 16 103-8-5 71-99 10-21-21Z" fill="var(--body)"/><path d="m86 80 103-8-5 71-99 10Z" fill="var(--light)" opacity=".9"/><path d="m62 64 24 16-1 73-21-21Z" fill="var(--dark)" opacity=".5"/><path d="m59 57 105-7 31 19-109 9Z" fill="var(--body)"/><path d="m86 78 109-9v10L85 88Z" fill="var(--dark)" opacity=".5"/><path d="m117 97 34-2v11l-34 3Z" fill="#fff" opacity=".8"/><path d="m97 115 76-6m-76 15 75-6m-75 15 74-6" stroke="#fff" opacity=".4" stroke-width="1.5"/>`,
  rack: `<path d="M61 52v101m114-101v101M71 48v102m94-102v102" stroke="var(--dark)" stroke-width="5" stroke-linecap="round"/><path d="m54 61 108-13 25 15-111 15Zm0 43 108-13 25 15-111 15Z" fill="var(--light)"/><path d="m54 61 22 17 111-15v7L76 85l-22-16Zm0 43 22 17 111-15v7L76 128l-22-17Z" fill="var(--body)"/><rect x="89" y="36" width="27" height="24" rx="3" fill="var(--body)"/><path d="M128 32v26h20V32" fill="var(--dark)" opacity=".5"/><path d="M126 31h24v5h-24Z" fill="var(--body)"/>`,
  bag: `<path d="M89 65V46c0-31 59-31 59 0v19" stroke="var(--dark)" stroke-width="8"/><path d="m66 55 109-2 12 99H56Z" fill="var(--body)"/><path d="m67 55 10 96h97l-7-96" fill="var(--light)" opacity=".75"/><path d="M88 54v30m61-31v29" stroke="var(--dark)" stroke-width="7" stroke-linecap="round"/><path d="m76 99 87-2-2 39H80Z" fill="var(--body)" opacity=".7"/><path d="M114 110h17" stroke="#fff" opacity=".6" stroke-width="3" stroke-linecap="round"/>`,
  tape: `<ellipse cx="119" cy="110" rx="61" ry="38" fill="var(--dark)"/><path d="M58 89v23c0 51 122 51 122 0V89Z" fill="var(--body)"/><ellipse cx="119" cy="89" rx="61" ry="38" fill="var(--light)"/><ellipse cx="119" cy="89" rx="33" ry="20" fill="var(--dark)"/><path d="M88 88c4-20 59-20 63 0-8 24-55 24-63 0Z" fill="#f9f7f1"/><path d="M178 89c7 24-11 50-31 51l-16 18 44-1c25-12 35-52 3-68Z" fill="var(--light)"/><path d="m175 154-41 3" stroke="var(--body)" stroke-width="2"/>`,
  brush: `<g transform="rotate(-29 122 98)"><rect x="109" y="23" width="19" height="89" rx="9" fill="var(--body)"/><circle cx="119" cy="34" r="3" fill="#fff" opacity=".8"/><path d="M88 107h61v24c-4 30-57 30-61 0Z" fill="var(--light)"/><path d="M85 108c0-17 67-17 67 0v19H85Z" fill="var(--dark)"/><path d="M94 130v17m10-15v21m10-19v23m10-23v23m10-25v21m10-23v17" stroke="var(--body)" stroke-width="5" stroke-linecap="round"/></g>`,
  kitchen: `<g transform="rotate(-14 87 99)"><rect x="79" y="37" width="13" height="113" rx="6" fill="var(--body)"/><path d="M66 37V22h40v15c0 24-40 24-40 0Z" fill="var(--dark)"/><path d="M76 23v14m10-14v14m10-14v14" stroke="#fff" stroke-width="2" opacity=".5"/></g><g transform="rotate(10 143 97)"><rect x="136" y="67" width="12" height="88" rx="6" fill="var(--body)"/><ellipse cx="142" cy="44" rx="18" ry="30" fill="var(--dark)"/><ellipse cx="142" cy="40" rx="11" ry="21" fill="var(--light)"/></g><path d="m177 62 5 82" stroke="var(--body)" stroke-width="10" stroke-linecap="round"/><path d="M165 33h19l6 35h-24Z" fill="var(--light)"/>`,
  clip: `<g transform="rotate(-20 98 82)"><rect x="65" y="48" width="63" height="30" rx="10" fill="var(--dark)"/><rect x="68" y="51" width="57" height="20" rx="8" fill="var(--light)"/><rect x="91" y="69" width="10" height="45" rx="4" fill="var(--body)"/><path d="M91 85h10" stroke="var(--dark)" stroke-width="3"/></g><g transform="rotate(26 161 113)"><rect x="130" y="86" width="63" height="30" rx="10" fill="var(--body)"/><rect x="134" y="89" width="55" height="19" rx="8" fill="var(--light)"/><rect x="157" y="106" width="10" height="45" rx="4" fill="var(--dark)"/></g>`,
  mat: `<path d="m40 112 98-59 73 49-97 62Z" fill="var(--dark)"/><path d="m40 107 98-59 73 49-97 62Z" fill="var(--body)"/><path d="m50 107 88-51 63 42-87 53Z" fill="var(--light)"/><path d="m63 107 76-43m-60 54 76-43m-58 55 76-43m-58 55 76-43" stroke="var(--body)" stroke-width="5"/><path d="m83 86 65 42m-48-52 65 42m-48-52 65 42" stroke="var(--body)" stroke-width="4" opacity=".5"/>`,
  petbowl: `<path d="M43 101h154l-8 43H50Z" fill="var(--body)"/><ellipse cx="120" cy="100" rx="78" ry="28" fill="var(--light)"/><ellipse cx="82" cy="99" rx="29" ry="17" fill="var(--dark)"/><ellipse cx="158" cy="99" rx="29" ry="17" fill="var(--dark)"/><path d="M54 98c3 20 52 20 56 0" fill="#f9f7f1"/><path d="M130 98c3 20 52 20 56 0" fill="#f9f7f1"/><ellipse cx="82" cy="97" rx="24" ry="12" fill="#ddd4c7"/><ellipse cx="158" cy="97" rx="24" ry="12" fill="#cadbe0"/><path d="M76 94h3m7 3h3m-9 6h3" stroke="#ac9480" stroke-width="5" stroke-linecap="round"/>`,
  bottle: `<path d="M100 40h42v13l10 16v76c0 15-62 15-62 0V69l10-16Z" fill="var(--body)"/><path d="M100 52h42V39h-42Z" fill="var(--dark)"/><rect x="101" y="29" width="40" height="13" rx="4" fill="var(--dark)"/><path d="M96 77h50v55H96Z" fill="var(--light)"/><path d="M108 85h26m-26 8h18" stroke="#fff" opacity=".5" stroke-width="3" stroke-linecap="round"/><path d="M96 72v67" stroke="#fff" opacity=".35" stroke-width="4" stroke-linecap="round"/>`,
  car: `<path d="m72 45 99-9 16 111-99 16Z" fill="var(--dark)"/><path d="m81 50 82-7 15 96-83 14Z" fill="var(--body)"/><path d="m90 78 77-8 5 30-77 12Z" fill="var(--light)"/><path d="m96 116 78-11 4 31-78 13Z" fill="var(--light)"/><path d="M133 111v31M129 76v29" stroke="var(--dark)" stroke-width="2" opacity=".5"/><path d="M96 49V29m57 14V24" stroke="var(--dark)" stroke-width="5" stroke-linecap="round"/><path d="m102 63 47-5" stroke="#fff" opacity=".3" stroke-width="3"/>`,
  stationery: `<g transform="rotate(-12 111 91)"><rect x="70" y="31" width="81" height="121" rx="5" fill="var(--dark)"/><rect x="76" y="30" width="77" height="119" rx="4" fill="var(--body)"/><path d="M86 32v115" stroke="var(--dark)" stroke-width="2" opacity=".4"/><rect x="97" y="52" width="42" height="18" rx="2" fill="var(--light)"/><path d="M103 60h29" stroke="#fff" opacity=".7" stroke-width="2"/></g><g transform="rotate(17 174 105)"><rect x="169" y="51" width="10" height="87" rx="2" fill="var(--light)"/><path d="m169 138 5 16 5-16Z" fill="var(--body)"/><path d="m172 148 2 6 2-6Z" fill="var(--dark)"/><path d="M169 59h10" stroke="var(--dark)" stroke-width="3"/></g>`,
  glove: `<g transform="rotate(-13 98 98)"><path d="M72 109V65c0-8 12-8 12 0V43c0-8 12-8 12 0v-8c0-9 12-9 12 0v7c0-8 12-8 12 0v11c0-7 12-7 12 0v41l10-13c8-8 17 1 11 10l-22 34v27H78v-27Z" fill="var(--body)"/><path d="M78 130h53v22H78Z" fill="var(--dark)"/><path d="M87 137v11m9-11v11m9-11v11m9-11v11m9-11v11" stroke="var(--light)" stroke-width="2"/></g>`,
  garden: `<path d="M83 96h78l-10 57H94Z" fill="var(--body)"/><path d="M78 88h88v16H78Z" fill="var(--dark)"/><path d="M122 89V42" stroke="var(--dark)" stroke-width="5"/><path d="M121 64C90 67 83 45 88 31c24 1 36 13 33 33Z" fill="var(--light)"/><path d="M123 73c28 0 39-17 35-31-22-2-34 12-35 31Z" fill="var(--body)"/><path d="m129 66 21-17m-34 8-20-18" stroke="var(--dark)" stroke-width="2" opacity=".5"/>`,
};
const categoryArt = {
  living: "organizer",
  kitchen: "kitchen",
  pet: "petbowl",
  outdoor: "bag",
  car: "car",
  office: "stationery",
  fashion: "bag",
  garden: "garden",
};

export function illustration(product, extraClass = "") {
  const palette = Object.hasOwn(palettes, product.categoryId)
    ? palettes[product.categoryId]
    : palettes.other;
  const art =
    (Object.hasOwn(drawings, product.art) ? drawings[product.art] : null) ||
    (Object.hasOwn(categoryArt, product.categoryId)
      ? drawings[categoryArt[product.categoryId]]
      : null) ||
    drawings.organizer;
  // SVG presentation attributes, rather than inline CSS, work with the site's CSP.
  const coloredArt = art
    .replaceAll("var(--body)", palette[1])
    .replaceAll("var(--dark)", palette[2])
    .replaceAll("var(--light)", palette[3]);
  const label =
    product.dataKind === "demo"
      ? product.name + " 예시 일러스트"
      : product.name + " 이미지 대체 일러스트";
  return `<svg class="product-art ${extraClass}" viewBox="0 0 240 180" role="img" aria-label="${escapeHtml(label)}" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="180" fill="${palette[0]}"/><circle cx="184" cy="39" r="66" fill="#fff" opacity=".22"/><ellipse cx="121" cy="155" rx="74" ry="9" fill="${palette[2]}" opacity=".12"/>${coloredArt}</svg>`;
}

export function productVisual(product, extraClass = "") {
  const url = safeExternalUrl(product.imageUrl);
  if (url)
    return `<img class="${extraClass}" data-product-image="${escapeHtml(product.id)}" src="${escapeHtml(url)}" alt="${escapeHtml(product.name)}" loading="lazy" referrerpolicy="no-referrer">`;
  return illustration(product, extraClass);
}
