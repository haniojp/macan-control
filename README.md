# Macan Control

iPhone Safari向けの静的車両管理アプリ。Porsche Connectの読み取り専用サーバー連携に対応します。初回は別途サーバーの設置とPorsche ID設定が必要です。未設定時は手入力・JSON取込で利用できます。

**実車情報を表示するための手順：[初めてのAPI接続設定](docs/API_SETUP.md)**。GitHub PagesだけではAPI接続は動きません。

**走行統計の追加・更新手順：[平均電費など4項目の表示](docs/TRIP_STATISTICS.md)**。既存のRenderサーバーも手動更新してください。

**ログイン付きアプリ：[設定・30日保持・履歴引き継ぎ手順](docs/APP_LOGIN.md)**。有効にした後はRenderのURLを利用します。

## 機能

- アプリ用パスワードでのログインと30日間の保持（Render側で有効にする方式）
- 従来のGitHub Pagesモードでは接続キーの任意保存も継続

- Porsche Connectサーバー接続、画面表示中の5分更新、取得／測定日時とエラー表示
- 短期・長期・充電サイクルの平均電費・走行距離・走行時間・平均速度（API対応時）

- 車両情報（残量・航続可能距離・走行距離・充電状態）と残量グラフ、直近50件の一覧
- 「メンテナンス記録」ボタンから専用画面を開き、ワイパー交換、タイヤ、点検などの整備記録を登録・編集・削除
- 車両情報・整備履歴それぞれのCSV出力とJSONバックアップ・取込
- ホーム画面用アイコン、オフライン起動、iPhoneのセーフエリア対応

データは端末のlocalStorageに保存します（既存キー `macan-control-records-v1` と `macan-control-maintenance-v1` を維持）。ブラウザデータの削除・端末変更に備え、**車両情報と整備履歴の両方のJSON**を保存してください。CSVは閲覧用で、復元はJSONを使用します。

車両JSONは `sample-snapshot.json` と同じオブジェクト、またはその配列です。timestampはISO8601、socは0–100、rangeKm・odometerKmは0以上、chargingStatusは文字列。整備JSONはアプリから保存した配列を使用します。同じ整備IDは更新されます。取込上限は1MB・1000件／回です。車両JSON取込は追加方式なので、同じバックアップの再取込で重複します。

## GitHub Pagesで公開

1. Pull Requestをmainへマージします。
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。
3. 「Test and deploy Pages」ワークフローを実行します（mainへのpushでも実行）。テスト成功後、配信用静的ファイルのみをPagesへアップロードします。
4. 公開先は通常 `https://haniojp.github.io/macan-control/` です。実際のURLはActionsのdeployment出力で確認します。

公開リポジトリに個人の車両記録や認証情報をコミットしないでください。JSON取込は端末内だけで処理されます。

## iPhoneで利用

Safariで公開URLを開き、共有 →「ホーム画面に追加」→「追加」。初回はオンラインで開き、その後ホーム画面のアイコンで起動します。Safariにホーム画面追加用の自動プロンプトはありません。更新が保留される場合は、このアプリのタブ・ホーム画面アプリをすべて閉じて再度開きます。オンライン時は新しいファイルを取得し、オフライン時は保存済み画面を使用します。

CSV／JSONボタンからファイルを保存し、Safariのダウンロード一覧／「ファイル」アプリで確認します。ホーム画面アプリとSafariで保存領域が異なる場合があるため、移行はJSONで行ってください。

## 開発・自動テスト

アプリ自体はビルド不要です。`python3 -m http.server 8000` で起動できます。サービスワーカーはHTTPSまたはlocalhostで有効です。

```sh
npm ci
npx playwright install --with-deps webkit chromium
npm test
```

テストは `/macan-control/` のサブパスで、iPhoneサイズのWebKit・ChromiumおよびデスクトップChromiumを対象とします。車両登録／再読込、整備CRUD、CSV内容、JSON復元、異常入力、保存失敗、アイコン、横スクロールを確認します。オフライン再読込はサービスワーカー制御に対応するChromiumで確認します。

実行環境でシステムChromiumを使う場合は `CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test -- --project=chromium --project=mobile-chromium`。

実機のSafari、共有メニュー、ホーム画面インストール、端末内のファイル保存については公開後の実機確認が必要です。テスト結果は `TEST_RESULTS.md` に記載します。

## メンテナンス記録の画面

最初の画面には「メンテナンス記録」ボタンだけを表示します。ボタンを押すと入力・整備履歴・編集削除・CSV・JSONバックアップの専用画面へ切り替わります。「← 車両情報に戻る」で最初の画面へ戻れます。Safariの戻る／進むにも対応します。

画面の切り替えでは入力途中の内容を保持しますが、未保存の内容は再読み込み・終了で消えます。登録済みデータの保存場所やJSON形式は変更しません。ログインも維持します。Renderのログイン付きアプリへの反映は、マージ後に「macan-control-api」画面右上の **Manual Deploy → Deploy latest commit** を実行し、緑色の **✓ Live** になってからアプリを開き直してください。環境変数の変更や履歴の再移行は不要です。

## データ追加の画面

最初の画面の **データ追加** ボタンを押すと、手入力・JSON取込・サンプル追加の専用画面を開きます。手入力欄は最初から表示します。保存・取込の結果はこの画面で確認し、**← 車両情報に戻る** で最初の画面へ戻れます。

メンテナンス専用画面と同様、Safariの戻る／進む、専用画面の再読込に対応。画面を切り替えても入力途中の内容を保持しますが、未保存の入力は再読込・終了で消えます。ログイン・既存記録の保存方法は変更しません。Renderへの反映にはマージ後の **Manual Deploy → Deploy latest commit** が必要です。
