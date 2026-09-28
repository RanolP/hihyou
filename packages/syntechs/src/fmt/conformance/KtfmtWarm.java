// ktfmt's formatting time in a warm JVM, for bench.node.ts: a JVM starts in about a second, which would swamp a
// folder-level time, so this reads every .kt/.kts file under a directory once, formats them all in memory per
// pass with --kotlinlang-style, and prints the median pass in ms after the warmup passes. Run from source with the
// ktfmt jar on the classpath:
//
//   java -cp ktfmt-<version>-with-dependencies.jar KtfmtWarm.java <dir> <warmup> <runs>

import com.facebook.ktfmt.format.Formatter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

class KtfmtWarm {
  public static void main(String[] args) throws Exception {
    List<String> texts = new ArrayList<>();
    try (Stream<Path> paths = Files.walk(Path.of(args[0]))) {
      for (Path p : (Iterable<Path>) paths.filter(KtfmtWarm::isKotlin).sorted()::iterator)
        texts.add(Files.readString(p));
    }
    int warmup = Integer.parseInt(args[1]);
    int runs = Integer.parseInt(args[2]);
    double[] samples = new double[runs];
    for (int i = 0; i < warmup + runs; i++) {
      long t = System.nanoTime();
      for (String text : texts) Formatter.format(Formatter.KOTLINLANG_FORMAT, text);
      if (i >= warmup) samples[i - warmup] = (System.nanoTime() - t) / 1e6;
    }
    Arrays.sort(samples);
    System.out.println(samples[runs >> 1]);
  }

  private static boolean isKotlin(Path p) {
    String name = p.getFileName().toString();
    return name.endsWith(".kt") || name.endsWith(".kts");
  }
}
