// 主催者のパスワードのハッシュを作る。入力した文字は画面に出ず、保存もされない。出力(標準出力)はハッシュだけ。
// 使い方: node scripts/hash-admin-password.mjs | firebase apphosting:secrets:set playce-admin-password-hash --data-file - --project playce-e1455
import { hashPassword, passwordProblem } from "../src/lib/domain/password.ts";

function ask(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("端末(ターミナル)から実行してください"));
    process.stderr.write(prompt);
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buf = "";
    const done = (v, err) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", on); process.stderr.write("\n"); if (err) reject(err); else resolve(v); };
    const on = (ch) => {
      for (const c of ch) {
        if (c === "\u0003") return done("", new Error("中止しました"));
        if (c === "\r" || c === "\n") return done(buf);
        if (c === "\u007f" || c === "\b") buf = buf.slice(0, -1); else if (c >= " ") buf += c;
      }
    };
    stdin.on("data", on);
  });
}

try {
  process.stderr.write("主催者のパスワードを決めます(14文字以上。長い文章や単語をつないだものがおすすめ)。入力した文字は表示されません。\n");
  const a = await ask("新しいパスワード: ");
  const problem = passwordProblem(a);
  if (problem) { process.stderr.write(`× ${problem}\n`); process.exit(1); }
  const b = await ask("もう一度入力: ");
  if (a !== b) { process.stderr.write("× 2回の入力が一致しません。やり直してください。\n"); process.exit(1); }
  process.stdout.write(await hashPassword(a));
  process.stderr.write("✔ ハッシュを作りました(パスワード自体は保存されていません)。\n");
} catch (e) {
  process.stderr.write(`× ${e.message}\n`); process.exit(1);
}
