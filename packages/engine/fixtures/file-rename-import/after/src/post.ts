import { slugify } from "./text/slug";

export function postUrl(title: string): string {
  return `/posts/${slugify(title)}`;
}
