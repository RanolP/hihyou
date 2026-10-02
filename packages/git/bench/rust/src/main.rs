// Times the bench operations with libgit2 in-process and prints one JSON object of per-iteration
// milliseconds, keyed "<op>/<warm|cold>". run.mjs passes the same inputs it gives our reader.
use git2::{DiffOptions, Oid, Repository};
use std::io::Read;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = &args[1];
    let n: usize = args[2].parse().unwrap();
    let (a, b) = (&args[3], &args[4]);
    let mut stdin = String::new();
    std::io::stdin().read_to_string(&mut stdin).unwrap();
    let blobs: Vec<Oid> = stdin.split_whitespace().map(|s| Oid::from_str(s).unwrap()).collect();

    let ops: Vec<(&str, Box<dyn Fn(&Repository)>)> = vec![
        ("worktree", Box::new(|r: &Repository| {
            let head = r.head().unwrap().peel_to_tree().unwrap();
            let diff = r
                .diff_tree_to_workdir_with_index(Some(&head), Some(&mut DiffOptions::new()))
                .unwrap();
            std::hint::black_box(diff.deltas().count());
        })),
        ("treediff", Box::new(move |r: &Repository| {
            let ta = r.revparse_single(a).unwrap().peel_to_tree().unwrap();
            let tb = r.revparse_single(b).unwrap().peel_to_tree().unwrap();
            let diff = r.diff_tree_to_tree(Some(&ta), Some(&tb), None).unwrap();
            std::hint::black_box(diff.deltas().count());
        })),
        ("blobs", Box::new(move |r: &Repository| {
            let mut total = 0;
            for id in &blobs {
                total += r.find_blob(*id).unwrap().content().len();
            }
            std::hint::black_box(total);
        })),
        ("revparse", Box::new(|r: &Repository| {
            std::hint::black_box(r.revparse_single("HEAD~20").unwrap().id());
        })),
    ];

    let mut out = Vec::new();
    for (name, op) in &ops {
        let warm = Repository::open(path).unwrap();
        op(&warm);
        let mut times = Vec::new();
        for _ in 0..n {
            let t = Instant::now();
            op(&warm);
            times.push(t.elapsed().as_secs_f64() * 1e3);
        }
        out.push(format!("\"{name}/warm\":{times:?}"));
        let mut times = Vec::new();
        for _ in 0..n {
            let t = Instant::now();
            op(&Repository::open(path).unwrap());
            times.push(t.elapsed().as_secs_f64() * 1e3);
        }
        out.push(format!("\"{name}/cold\":{times:?}"));
    }
    println!("{{{}}}", out.join(","));
}
