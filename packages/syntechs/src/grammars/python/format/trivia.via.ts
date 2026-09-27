// The customs trivia.ts's rules name.
import { ruffFmt } from "../fmt/sink.js";

export const triviaVia = {
  // A comment prints by the placement's record of it, which marks it printed so that it prints once.
  "trivia.comment": (c: number) => {
    const f = ruffFmt();
    const comment = f.comments.all.find((x) => x.ts === c);
    if (!comment) throw new Error(`python trivia: comment ${JSON.stringify(f.text(c))} was never placed`);
    f.writeComment(comment);
  },
};
