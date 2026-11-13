const paths = {
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  compass:
    '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  heart:
    '<path d="M20.4 4.6a5.4 5.4 0 0 0-7.6 0L12 5.5l-.8-.9a5.4 5.4 0 0 0-7.6 7.7L12 21l8.4-8.7a5.4 5.4 0 0 0 0-7.7Z"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5V15"/>',
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2M8 11h.01M16 11h.01"/>',
  store:
    '<path d="M3 9h18l-2-6H5L3 9Z"/><path d="M3 9v3a3 3 0 0 0 6 0V9m0 0v3a3 3 0 0 0 6 0V9m0 0v3a3 3 0 0 0 6 0V9M5 15v6h14v-6M9 21v-5h6v5"/>',
  upload:
    '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download:
    '<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  "arrow-right": '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  "arrow-up-right": '<path d="M6 18 18 6M6 6h12v12"/>',
  "chevron-left": '<path d="m14 6-6 6 6 6"/>',
  "chevron-right": '<path d="m10 6 6 6-6 6"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sliders:
    '<path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h11m4 0h1"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  utensils:
    '<path d="M5 3v7a3 3 0 0 0 6 0V3M8 3v18M20 3c-5 0-5 11 0 11V3Zm0 11v7"/>',
  paw: '<ellipse cx="7" cy="6" rx="2" ry="3"/><ellipse cx="16" cy="6" rx="2" ry="3"/><ellipse cx="3.5" cy="12" rx="2" ry="2.5" transform="rotate(-25 3.5 12)"/><ellipse cx="20.5" cy="12" rx="2" ry="2.5" transform="rotate(25 20.5 12)"/><path d="M6 19c-1-2 3-8 6-8s7 6 6 8c-1 3-4 1-6 1s-5 2-6-1Z"/>',
  tent: '<path d="m3 21 9-18 9 18H3Zm5 0 4-8 4 8M10 3l2 3 2-3"/>',
  car: '<path d="m5 7 2-4h10l2 4 2 4v8H3v-8l2-4Zm-1 4h16M6 19v2m12-2v2M7 15h.01M17 15h.01M5 7h14"/>',
  pencil: '<path d="m15 4 5 5-11 11-6 1 1-6L15 4Zm-9 9 5 5M15 4l2-2 5 5-2 2"/>',
  sprout:
    '<path d="M12 22v-9M12 15C4 15 3 9 3 5c6 0 9 2 9 8m0-2c0-5 3-8 9-8 0 6-3 9-9 9"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  calculator:
    '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h1m6 0h1M8 14h1m6 0h1M8 18h1m6 0h1"/>',
  columns:
    '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  shield:
    '<path d="m12 2 9 4v7c0 5-9 9-9 9S3 18 3 13V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  sparkles:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7-2v4m-2-2h4M3 18v4m-2-2h4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};

export function icon(name, extraClass = "") {
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const wrapper = document.createElement("span");
    wrapper.innerHTML = icon(node.dataset.icon, node.className);
    node.replaceWith(wrapper.firstElementChild);
  });
}
