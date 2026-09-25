import { slugify } from "./slug";

export function postUrl(title: string): string {
  return `/posts/${slugify(title)}`;
}
