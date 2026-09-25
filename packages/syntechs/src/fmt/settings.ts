/** The reviewer's layout preferences. They come from the person reading the diff, never from repo config. */
export interface Settings {
  lineWidth: number;
  indentWidth: number;
  useTabs: boolean;
  /** `{ a }` rather than `{a}` for a list printed on one line. */
  bracketSpacing: boolean;
  /** A list the author broke after its opening bracket stays broken (prettier's `objectWrap: "preserve"`). */
  keepExpanded: boolean;
  /** Blank lines kept between items where the input had any. */
  maxBlankLines: 0 | 1;
}

/** Prettier's defaults. */
export const defaultSettings: Settings = {
  lineWidth: 80,
  indentWidth: 2,
  useTabs: false,
  bracketSpacing: true,
  keepExpanded: true,
  maxBlankLines: 1,
};
