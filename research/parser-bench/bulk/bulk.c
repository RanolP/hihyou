// Option B probe: tree-sitter compiled to wasm32-wasi with ONE export that serializes the
// whole tree into a flat u32 buffer, so JS pays one boundary crossing per tree instead of
// several per node. Build: ./build.sh (zig cc). Input is UTF-16LE so offsets match JS indices.
#include <stdint.h>
#include <stdlib.h>
#include <tree_sitter/api.h>

#define EXPORT(name) __attribute__((export_name(#name)))

const TSLanguage *tree_sitter_typescript(void);
const TSLanguage *tree_sitter_python(void);
const TSLanguage *tree_sitter_json(void);

static TSParser *parser;
static const TSLanguage *langs[3];
static uint32_t *out;
static uint32_t out_cap;

EXPORT(alloc) void *alloc(uint32_t n) { return malloc(n); }
EXPORT(dealloc) void dealloc(void *p) { free(p); }

EXPORT(set_language) const TSLanguage *set_language(uint32_t which) {
  if (!parser) {
    parser = ts_parser_new();
    langs[0] = tree_sitter_typescript();
    langs[1] = tree_sitter_python();
    langs[2] = tree_sitter_json();
  }
  ts_parser_set_language(parser, langs[which]);
  return langs[which];
}
EXPORT(symbol_count) uint32_t symbol_count(const TSLanguage *l) { return ts_language_symbol_count(l); }
EXPORT(symbol_name) const char *symbol_name(const TSLanguage *l, uint32_t s) { return ts_language_symbol_name(l, s); }

EXPORT(parse_utf16) TSTree *parse_utf16(const uint16_t *src, uint32_t len) {
  return ts_parser_parse_string_encoding(parser, NULL, (const char *)src, len * 2, TSInputEncodingUTF16LE);
}
EXPORT(tree_delete) void tree_delete(TSTree *t) { ts_tree_delete(t); }

// Pre-order records of 8 u32: symbol | named<<16 | error<<17 | missing<<18, child_count,
// start, end (UTF-16 units), start row, start col, end row, end col (col in UTF-16 units).
#define REC 8
static void emit(TSNode n, uint32_t *count) {
  if ((*count + 1) * REC > out_cap) {
    out_cap = out_cap ? out_cap * 2 : 1 << 16;
    out = realloc(out, out_cap * sizeof(uint32_t));
  }
  uint32_t *r = out + (*count)++ * REC;
  TSPoint sp = ts_node_start_point(n), ep = ts_node_end_point(n);
  r[0] = ts_node_symbol(n) | (ts_node_is_named(n) << 16) | (ts_node_is_error(n) << 17) | (ts_node_is_missing(n) << 18);
  r[1] = ts_node_child_count(n);
  r[2] = ts_node_start_byte(n) / 2;
  r[3] = ts_node_end_byte(n) / 2;
  r[4] = sp.row;
  r[5] = sp.column / 2;
  r[6] = ep.row;
  r[7] = ep.column / 2;
}
EXPORT(export_tree) uint32_t export_tree(TSTree *t) {
  uint32_t count = 0;
  TSTreeCursor c = ts_tree_cursor_new(ts_tree_root_node(t));
  for (;;) {
    emit(ts_tree_cursor_current_node(&c), &count);
    if (ts_tree_cursor_goto_first_child(&c)) continue;
    while (!ts_tree_cursor_goto_next_sibling(&c)) {
      if (!ts_tree_cursor_goto_parent(&c)) {
        ts_tree_cursor_delete(&c);
        return count;
      }
    }
  }
}
EXPORT(export_ptr) uint32_t *export_ptr(void) { return out; }
