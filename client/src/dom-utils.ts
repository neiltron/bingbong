type ElementAttributes = Record<string, string | Record<string, string>>;

export function createElement(
  tag: string,
  attrs: ElementAttributes = {},
  children: (string | HTMLElement | null)[] = []
): HTMLElement {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('data-')) {
      (el as HTMLElement).dataset[key.slice(5)] = value as string;
    } else {
      el.setAttribute(key, value as string);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child) {
      el.appendChild(child);
    }
  }

  return el;
}
