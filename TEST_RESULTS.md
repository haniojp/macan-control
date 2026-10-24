# テスト結果

実施日：2026-10-24（日本時間）

## ローカル実行

`CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test -- --project=chromium --project=mobile-chromium`

**12件成功、失敗0件**（6シナリオ × 2環境）。iPhone 13相当の画面・タッチ設定を適用したChromiumと、デスクトップChromiumを使用。GitHub Pagesと同じ `/macan-control/` 配下で実行。

| 検証 | 結果 |
| --- | --- |
| 車両手入力、表示、再読込後の保存、CSV、JSONバックアップ・復元 | 成功 |
| ワイパー整備登録、再読込、編集、CSV、JSON復元、同ID更新、削除、全削除時の編集解除 | 成功 |
| 不正な数値JSONの一括取込拒否、保存容量不足の通知、既存記録保持 | 成功 |
| 横はみ出しなし、非表示ボタン、manifest・アイコン取得、実行時例外なし | 成功 |
| サブパスでサービスワーカー登録、オフライン再読込、記録表示 | 成功 |
| randomUUID未対応時のID生成、不正日付拒否、編集／削除キャンセル | 成功 |

`node --check app.js`、`node --check sw.js`、`git diff --check` も成功。

## WebKit / 実機の範囲

この環境ではWebKitの配布ドメインがネットワークポリシーで403（Domain forbidden）となり、ローカルWebKitテストは実行できなかった。GitHub Actionsで同じシナリオをiPhoneサイズのWebKitでも実行する設定を追加済み。WebKitではPlaywrightのサービスワーカー制御に制限があるためオフラインテスト1件を明示的にスキップする。

実機iPhone Safari、共有メニューによるホーム画面追加、ホーム画面からの起動、Safari／「ファイル」アプリでのダウンロード保存は未検証。公開後に実機で確認する。自動テストのエミュレーションは実機検証の代替ではない。

## 公開

Pagesワークフローを追加。mainへのマージとSettings → Pages → Source「GitHub Actions」の設定後に公開できる。今回の作業ではmainへのマージと本番公開は行わない。
