# Bubble Tasks（Windows / Mac）

## 動かす（開発中）
```
cd C:\development\bubble-tasks
npm install
npm start
```
タスクトレイ（右下の「^」の中にあることも）の泡アイコンをクリック、または Ctrl+Shift+Space で入力小窓が出ます。起動直後にも一度表示されます。

## インストーラーを作る
```
npm run dist:win
```
`dist\` に `Bubble Tasks Setup x.x.x.exe` ができます。インストール版は Windows のサインイン時に自動で起動します。

## Mac 側について
Mac でも同じコードが動きます。Mac で使っている `iconTemplate.png` / `iconTemplate@2x.png` をこのフォルダにコピーしてください。

## 新しい版を出す（GitHub）
```
npm version minor
git push --follow-tags
```
タグ（v0.2.0 など）を push すると、GitHub Actions が Windows版・Mac版を作って Releases に置きます。Windows のインストール版は自動でアップデートされます。
