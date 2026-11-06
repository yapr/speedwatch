# 運用手順と費用

## 最小限の設定

このPRだけでは定期運用・公開は始まりません。マージ後、運用開始の承認と以下の設定が必要です。

0. `docs/workflow-templates/{ci,monitor}.yml` を `.github/workflows/` へ配置するPRを、workflow書き込み可能な本人の環境で作成。現時点ではGitHubがworkflow scope不足で書き込みを拒否したため、実行されないテンプレートとして同梱しています。権限拡大は未実施です。
1. **非公開の専用R2 Standard bucket**を作成。public URL/r2.devは無効、削除Lifecycleは設定しない。
2. bucket限定の読み書きキーを発行（恒久キー発行と権限は本人が確認）。GitHub Secretsへ `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` を登録。チャットへ貼らない。
3. Google CloudでPageSpeed Insights APIを有効化。API制限付きキーを `PAGESPEED_API_KEY` Secretへ登録。予算や割当を確認。
4. 設定の対象サイト・画像公開フラグをレビュー。公開repo内に秘密の対象URLを置かない。
5. Actions variable `MONITOR_ENABLED=true` を設定し手動実行を1回確認。その後毎日05:23 JST予定。Actionsの実行は遅延/スキップする可能性があります。

R2接続の成功、private bucket状態、キーの最小権限は実環境で確認が必要です。キーを公開PR、ログ、ローカル設定ファイルへ書かないでください。

## 結果の確認

Actions summaryと7日保持のartifactには**公開許可した数値・画像のみ**を含めます。画像は各サイト/デバイスの直近2枚だけをレポートへコピーし、履歴本体はR2に残ります。Artifactは長期保管先ではありません。手元で同じR2環境変数を設定し `STORAGE=r2 npm run report` を実行するとprivateレポートと画像比較を作れます。画像への外部URLや署名URLは発行しません。

公開版の出力先に古いprivateデータが混在しないよう、レポート生成は空ディレクトリのみ許可します。公開フラグを戻しても、過去に配布したartifact/レポートは撤回されません。新しい公開は必ず出力を確認してください。

## 費用の目安

2026-11-06確認: [R2公式料金](https://developers.cloudflare.com/r2/pricing/)。Standardは10GB-month無料枠、超過$0.015/GB-month、Class A $4.50/百万（無料100万）、Class B $0.36/百万（無料1,000万）。共有アカウントの無料枠・操作料・税は別途確認。

画像500KB仮定なら1サイト×2枚×365日で約0.365GB/年。30サイトなら約10.95GB/年。5年後54.75GBの保管料は無料枠を全て使える場合約$0.67/月。**これは画像サイズの仮定で実測ではありません**。上限3MBなら30サイトで65.7GB/年になります。

初期ソフト上限は合計**1GB**。新規1組あたり3.1MBの余裕がなければ計測前に停止し、既存記録を削除しません。最大設定値は10GB。専用bucket全体をlistして容量を集計し、100,000 object超で停止。Actions concurrencyで同時書き込みを制限。外部writerが同じbucketを使うと競合するため禁止します。R2そのものの課金上限を保証する機能ではありません。

1サイトは通常PSI2回/日、画像2枚/日。30サイトは通常60回/日、再試行含め最大120回/日。GitHub実行時間は最大30分/回、1日1回で最大930分/月（手動分別）。public repoの標準GitHub-hosted runner利用条件・artifact無料枠は[GitHub公式](https://docs.github.com/en/billing/concepts/product-billing/github-actions)を確認してください。課金対象runnerへの変更や対象増加は実測後に判断します。

## 障害・停止

- PSI 429/5xx: 2秒後に1回だけ再試行。認証エラー/timeout/invalid結果は失敗として保存。
- 通信量: 全リソースの本文受信を合算し30MB到達で進行中・後続取得を止める。並行数4。到着済みチャンク/OS/TLSバッファ/ヘッダー分の超過はあり、厳密な転送課金上限ではない。
- 撮影失敗: PSI結果と別管理。無限retryなし。ブラウザは毎回閉じる。
- ストレージ失敗: workflowを失敗にする。次回は未保存レコードのみ再開。
- 同日記録済み: 失敗も含め再取得しない。履歴保全のため初期版は置換コマンドを提供しない。
- スケジュール欠損: 更新日時/当日不足を確認して手動実行。過去の画像は復元できない。
- 容量停止: レポートのtotalBytes、専用bucketの利用量を確認。削除はせず、予算確認後に上限変更PR。
- 即時停止: `MONITOR_ENABLED=false` またはDaily monitor workflowをDisable。実行中のrunもCancelする。保存データは残る。

メール/Slack/外部の死活通知は未設定です。GitHubのworkflow失敗通知と定期的な更新日時確認を使用し、独立したheartbeatは運用後の追加候補です。
