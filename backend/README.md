# Read-only Porsche bridge

利用者向けの手順は [API_SETUP.md](../docs/API_SETUP.md)。FastAPIアプリはGitHub Pagesとは別のPythonホストへ設置する。Render Blueprint（Free、1 worker）を同梱。実車・実アカウントでの認証は未検証。

## 環境設定

ホスト側の秘密変数として以下を設定する。

- `PORSCHE_EMAIL` / `PORSCHE_PASSWORD`：Porsche IDの資格情報
- `BRIDGE_ACCESS_KEY`：32文字以上のランダム秘密値。Renderでは256bitの値を自動生成
- `ALLOWED_ORIGIN`：許可するHTTPSオリジンを1つ指定（例 `https://haniojp.github.io`、パス・末尾スラッシュなし）
- `PORSCHE_VIN`：省略可能。1台なら一覧から選択、複数ならサーバー側で明示

認証トークン、PKCE verifier、CAPTCHA stateはプロセスメモリのみ。Porsche資格情報を画面・localStorage・GitHub・Pagesに含めない。Bearerキーも画面メモリのみで、リロード後は再入力。別オリジンのCookieやSafariの第三者Cookieに依存しない。CORSだけを認証の代わりにはしない。

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
# 上記の変数を環境に設定済みの状態で実行する
.venv/bin/uvicorn backend.app:create_app --factory --host 127.0.0.1 --port 8001 --workers 1 --no-access-log
```

ローカル検証では `.env` を読み込む機能はない。環境変数はホストのsecret managerや安全な起動手段で設定する。iPhoneから使用する場合はHTTPSで公開する。ローカルHTTPへの接続はフロント側で拒否する。

## API

- `GET /healthz`：公開の起動確認。Porscheにアクセスしない
- `GET /api/snapshot`：`Authorization: Bearer <BRIDGE_ACCESS_KEY>`必須
- `POST /api/auth/captcha`：同じ認証が必須。JSON `{"code":"画像の文字"}`。state/verifierは受け取らない

レスポンスはschemaVersion、取得時刻、車両計測時刻、allowlist済みsnapshotのみ。`Cache-Control: no-store`。VIN、位置、トークン、上流の生レスポンス・例外本文は返さない。ライブラリの機密ログを抑止し、Uvicornのアクセスログも無効化。

ライブラリの `get_stored_overview()` は例外を握り潰すため使わず、`Connection.get()` で必要なmeasurementだけを問い合わせる。取得はGETのみ。車両wake-upパラメータ、制御コマンド、位置データ取得を含まない。上流認証はライブラリのOAuth/PKCE実装を使う。充電のmodeだけから「充電中」と推測せず、未知のstatusはnullとする。欠損値を0に補完しない。

1プロセスのロックで取得を直列化し、成功を5分キャッシュ、失敗後は60～300秒の再試行待ち。上流処理は30秒で打ち切る。フロントは無料ホストのコールドスタートを考慮して90秒でタイムアウト。CAPTCHAは最大5分保持し、再認証は同じPKCE transactionで再開。SMS/MFAやパスキー専用認証の対応は保証しない。

## 検証

```sh
.venv/bin/pip install -r backend/requirements-test.txt
.venv/bin/python -m pytest backend/tests -q
```

バックエンドの全テストは模擬通信で、Porscheへの実ネットワーク接続を行わない。固定したSDKバージョン0.2.9で呼出し形式を確認。Porsche上流の変更・契約・地域・クラウドIP制限により実接続が失敗する可能性がある。

## 走行統計

`/api/snapshot` に `tripStatistics` を追加。既存6 measurementの車両情報取得後、短期・長期・充電サイクルの3 measurementを別のGETで取得。オプション通信の失敗・未対応でも車両snapshotを返す。追加通信は最大6秒・既存の全体30秒タイムアウト内。単位と表示・更新手順は [TRIP_STATISTICS.md](../docs/TRIP_STATISTICS.md) を参照。
