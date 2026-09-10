// APIルート(Route Handler)内で、リクエスト自身のオリジン(スキーム+ホスト)を
// 組み立てる。クライアント側ではwindow.location.originが使えるが、サーバー側の
// リクエストにはそれが無いため、ヘッダーから同等の値を作る。
// Vercelはx-forwarded-protoヘッダーを付けてくれるので、それが無い(=ローカル開発)
// 場合だけhttpにフォールバックする。(animator-workspace-app/lib/requestOrigin.jsと同一)
export function getRequestOrigin(request) {
  const host = request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || (/^(localhost|127\.0\.0\.1)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
