// アプリ内のカメラで読み取ったQRの内容が、このサイトのスタンプのURLかを確かめる(他のサイト・余計な付属情報は拒否)。
const OK_PATH = /^\/stamp\/(t\/(badminton|volleyball)\/[0-9]{1,6}\.[A-Za-z0-9_-]{32}|q\/[A-Za-z0-9_-]{1,64}\/[12]\/[A-Za-z0-9_-]{32})$/;
export function stampPathFromQr(data: string, origin: string): string | null {
  try {
    const u = new URL(data);
    if (u.origin !== origin || u.search || u.hash || u.username || u.password) return null;
    return OK_PATH.test(u.pathname) ? u.pathname : null;
  } catch { return null; }
}
