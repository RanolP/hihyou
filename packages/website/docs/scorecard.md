<script setup lang="ts">
import { data } from "./scorecard.data.ts";
</script>

# Scorecard

How closely syntechs prints each language the way its reference formatter does, and how fast. CI measures every commit to `main` and rebuilds this page from the results.

<table>
  <thead>
    <tr>
      <th>Language</th>
      <th>Reference</th>
      <th>Compatibility</th>
      <th>oxfmt compatibility</th>
      <th>Speed vs reference</th>
      <th>Speed vs oxfmt</th>
      <th>Refused</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="row in data.rows" :key="row.language">
      <td>{{ row.language }}</td>
      <td>{{ row.reference }}</td>
      <td>{{ row.compatibility }}</td>
      <td>{{ row.oxfmt }}</td>
      <td>{{ row.vsReference }}</td>
      <td>{{ row.vsOxfmt }}</td>
      <td>{{ row.refused }}</td>
    </tr>
  </tbody>
</table>

Measured at commit <a :href="`https://github.com/RanolP/hihyou/commit/${data.commit}`"><code>{{ data.commit.slice(0, 7) }}</code></a> on {{ data.date.slice(0, 10) }}.

## How to read it

- **Compatibility**: the share of the reference formatter's own test fixtures that syntechs prints byte-identical to the reference, under every option set the fixture's spec declares.
- **oxfmt compatibility**: the same fixtures and expected output, scored for oxfmt, for context. oxfmt formats only the prettier-family languages.
- **Speed**: syntechs' whole-process time to format a folder of the corpus files and the fixtures, against each tool doing the same (median of 5 runs). Timed against {{ data.benchTools }}.
- **Refused**: fixtures where syntechs declined to print rather than risk changing the code: the formatter threw, or its self-check found a token or comment dropped, changed or invented. Refused fixtures do not count as passed.
